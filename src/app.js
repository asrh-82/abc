const express = require('express');
const path = require('node:path');
const { RegistrationError } = require('./db');
const {
  issueCsrfToken,
  verifyCsrfToken,
} = require('./http');
const {
  buildRegistration,
  splitEvents,
  toPublicEvent,
  validateRegistration,
} = require('./services');
const {
  confirmationPage,
  eventDetailPage,
  eventsPage,
  homePage,
  impactPage,
  notFoundPage,
  privacyPage,
  registrationPage,
} = require('./views/pages');

function createRateLimiter({ limit = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const requests = new Map();
  let nextSweepAt = 0;
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    if (now >= nextSweepAt) {
      for (const [storedKey, state] of requests) {
        if (now - state.windowStartedAt >= windowMs) requests.delete(storedKey);
      }
      nextSweepAt = now + windowMs;
    }
    let state = requests.get(key);
    if (!state || now - state.windowStartedAt >= windowMs) {
      state = { count: 0, windowStartedAt: now };
      requests.set(key, state);
    }

    if (state.count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - state.windowStartedAt)) / 1000));
      res.set('Retry-After', String(retryAfter));
      if (req.path.startsWith('/api/')) {
        return res.status(429).json({
          error: {
            code: 'rate_limited',
            message: 'Too many attempts. Wait a few minutes and try again.',
          },
        });
      }
      return res.status(429).send('Too many attempts. Wait a few minutes and try again.');
    }
    state.count += 1;
    return next();
  };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function closeUnprotectedRegistration(event, registrationProtectionReady) {
  if (!event || registrationProtectionReady || !event.registrationOpen) return event;
  return {
    ...event,
    registrationOpen: false,
    registrationState: 'closed',
  };
}

function createApp({
  repositories,
  projectRoot,
  isProduction = false,
  trustProxy = false,
  registrationRetentionDays = 30,
  turnstileSiteKey = '',
  registrationProtectionReady = false,
  verifyHuman = async () => ({ ok: false, unavailable: true }),
  now = () => new Date(),
}) {
  const app = express();
  const registrationLimiter = createRateLimiter();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; frame-src https://challenges.cloudflare.com; object-src 'none'; script-src 'self' https://challenges.cloudflare.com",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (
      req.method === 'POST' &&
      (req.path.startsWith('/api/v1/events/') || req.path.endsWith('/register'))
    ) {
      res.set('Cache-Control', 'no-store');
    }
    next();
  });
  app.use(express.static(path.join(projectRoot, 'public'), { maxAge: '1h', etag: true }));
  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }));

  const protectEvent = (event) => closeUnprotectedRegistration(
    event,
    registrationProtectionReady
  );
  const getEventCollections = () => {
    const { upcoming, past, cancelled } = splitEvents(repositories.events.list(), now());
    return {
      upcoming: upcoming.map(protectEvent),
      past: past.map(protectEvent),
      cancelled: cancelled.map(protectEvent),
    };
  };
  const getEvent = (slug) => {
    const row = repositories.events.findBySlug(slug);
    return row ? protectEvent(toPublicEvent(row, now())) : null;
  };

  const checkHuman = async (req, values) => {
    if (!registrationProtectionReady) return { ok: false, unavailable: true };
    return verifyHuman({
      token: values.turnstileToken,
      remoteIp: req.ip,
      idempotencyKey: values.idempotencyKey,
    });
  };

  const apiRegistrationData = (registration, duplicate) => {
    const confirmation = repositories.registrations.findByConfirmationCode(
      registration.confirmation_code
    );
    return {
      registrationId: confirmation.id,
      confirmationCode: confirmation.confirmation_code,
      eventSlug: confirmation.event_slug,
      eventName: confirmation.event_name,
      partySize: confirmation.party_size,
      duplicate,
    };
  };

  app.get('/health', (req, res) => {
    try {
      repositories.events.list();
      return res.json({ ok: true });
    } catch {
      return res.status(503).json({ ok: false });
    }
  });

  app.get('/api/v1/events', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { upcoming, past, cancelled } = getEventCollections();
    const scope = String(req.query.scope || 'upcoming');
    if (!['upcoming', 'past', 'all'].includes(scope)) {
      return res.status(400).json({
        error: {
          code: 'invalid_scope',
          message: 'Scope must be upcoming, past, or all.',
        },
      });
    }
    const events = scope === 'past'
      ? past
      : scope === 'all'
        ? [...upcoming, ...cancelled, ...past]
        : upcoming;
    return res.json({ data: events, meta: { count: events.length } });
  });

  app.get('/api/v1/events/:slug', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const event = getEvent(req.params.slug);
    if (!event) {
      return res.status(404).json({
        error: { code: 'event_not_found', message: 'Event not found.' },
      });
    }
    return res.json({ data: event });
  });

  app.post('/api/v1/events/:slug/registrations', registrationLimiter, asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const validation = validateRegistration(req.body || {});
    if (!validation.valid) {
      return res.status(422).json({
        error: {
          code: 'invalid_registration',
          message: validation.errors.form || 'Check the submitted registration details.',
          fields: validation.errors,
        },
      });
    }

    const registration = buildRegistration(validation.values);
    const replay = repositories.registrations.findExactReplay(req.params.slug, registration);
    if (replay) {
      if (replay.status === 'cancelled') {
        return res.status(409).json({
          error: {
            code: 'registration_cancelled',
            message: 'This registration was cancelled. Contact ABC if you need help.',
          },
        });
      }
      return res.status(200).json({ data: apiRegistrationData(replay, true) });
    }

    const human = await checkHuman(req, validation.values);
    if (!human.ok) {
      const unavailable = human.unavailable === true;
      return res.status(unavailable ? 503 : 422).json({
        error: {
          code: unavailable ? 'verification_unavailable' : 'human_verification_failed',
          message: unavailable
            ? 'Registration is temporarily unavailable. Please try again shortly.'
            : 'Complete the human verification and try again.',
        },
      });
    }

    try {
      const result = repositories.registrations.createForEvent(
        req.params.slug,
        registration,
        now()
      );
      return res.status(result.duplicate ? 200 : 201).json({
        data: apiRegistrationData(result.registration, result.duplicate),
      });
    } catch (error) {
      if (error instanceof RegistrationError) {
        return res.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
      }
      throw error;
    }
  }));

  app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.send(homePage(getEventCollections()));
  });

  app.get('/events', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.send(eventsPage(getEventCollections()));
  });

  app.get('/events/:slug', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const event = getEvent(req.params.slug);
    if (!event) return next();
    return res.send(eventDetailPage(event));
  });

  app.get('/events/:slug/register', (req, res, next) => {
    const event = getEvent(req.params.slug);
    if (!event) return next();
    if (!event.registrationOpen) return res.redirect(303, `/events/${encodeURIComponent(event.slug)}`);
    const csrfToken = issueCsrfToken(req, res, isProduction);
    res.set('Cache-Control', 'no-store');
    return res.send(registrationPage(event, { csrfToken, turnstileSiteKey }));
  });

  app.post('/events/:slug/register', registrationLimiter, asyncRoute(async (req, res, next) => {
    const event = getEvent(req.params.slug);
    if (!event) return next();

    const csrfValid = verifyCsrfToken(req);
    const validation = validateRegistration(req.body || {});
    if (!csrfValid) {
      validation.valid = false;
      validation.errors.form = 'Your form expired. Review the details and submit again.';
    }

    if (!validation.valid) {
      const csrfToken = issueCsrfToken(req, res, isProduction);
      res.set('Cache-Control', 'no-store');
      return res.status(422).send(registrationPage(event, {
        csrfToken,
        values: validation.values,
        errors: validation.errors,
        turnstileSiteKey,
      }));
    }

    const registration = buildRegistration(validation.values);
    const replay = repositories.registrations.findExactReplay(event.slug, registration);
    if (replay) {
      if (replay.status === 'cancelled') {
        const csrfToken = issueCsrfToken(req, res, isProduction);
        res.set('Cache-Control', 'no-store');
        return res.status(409).send(registrationPage(event, {
          csrfToken,
          values: validation.values,
          errors: { form: 'This registration was cancelled. Contact ABC if you need help.' },
          turnstileSiteKey,
        }));
      }
      return res.redirect(
        303,
        `/registration/confirmed/${encodeURIComponent(replay.confirmation_code)}?duplicate=1`
      );
    }

    const human = await checkHuman(req, validation.values);
    if (!human.ok) {
      const unavailable = human.unavailable === true;
      const csrfToken = issueCsrfToken(req, res, isProduction);
      res.set('Cache-Control', 'no-store');
      return res.status(unavailable ? 503 : 422).send(registrationPage(event, {
        csrfToken,
        values: validation.values,
        errors: {
          form: unavailable
            ? 'Registration is temporarily unavailable. Please try again shortly.'
            : 'Complete the human verification and try again.',
        },
        turnstileSiteKey,
      }));
    }

    try {
      const result = repositories.registrations.createForEvent(
        event.slug,
        registration,
        now()
      );
      const duplicate = result.duplicate ? '?duplicate=1' : '';
      return res.redirect(
        303,
        `/registration/confirmed/${encodeURIComponent(result.registration.confirmation_code)}${duplicate}`
      );
    } catch (error) {
      if (error instanceof RegistrationError) {
        const refreshedEvent = getEvent(event.slug) || event;
        if (error.code === 'event_full' || error.code === 'registration_closed') {
          res.set('Cache-Control', 'no-store');
          return res.status(error.status).send(eventDetailPage(refreshedEvent, {
            notice: error.message,
          }));
        }
        const csrfToken = issueCsrfToken(req, res, isProduction);
        res.set('Cache-Control', 'no-store');
        return res.status(error.status).send(registrationPage(refreshedEvent, {
          csrfToken,
          values: validation.values,
          errors: { form: error.message },
          turnstileSiteKey,
        }));
      }
      throw error;
    }
  }));

  app.get('/registration/confirmed/:code', (req, res, next) => {
    const registration = repositories.registrations.findByConfirmationCode(req.params.code);
    if (!registration) return next();
    res.set('Cache-Control', 'no-store');
    return res.send(confirmationPage(registration, { duplicate: req.query.duplicate === '1' }));
  });

  app.get('/impact', (req, res) => {
    const { past } = getEventCollections();
    res.send(impactPage(past.filter((event) => event.status === 'completed')));
  });

  app.get('/privacy', (req, res) => {
    res.send(privacyPage(registrationRetentionDays));
  });

  app.use('/api', (req, res) => {
    res.status(404).json({
      error: { code: 'not_found', message: 'API route not found.' },
    });
  });

  app.use((req, res) => {
    res.status(404).send(notFoundPage());
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === 'entity.too.large' || error?.status === 413) {
      if (req.path.startsWith('/api/')) {
        return res.status(413).json({
          error: { code: 'payload_too_large', message: 'The request body is too large.' },
        });
      }
      return res.status(413).send('That form submission is too large.');
    }
    if (error?.type === 'entity.parse.failed' || (error instanceof SyntaxError && error.status === 400)) {
      if (req.path.startsWith('/api/')) {
        return res.status(400).json({
          error: { code: 'invalid_json', message: 'The request body is not valid JSON.' },
        });
      }
      return res.status(400).send('That form submission could not be read.');
    }
    if (
      error?.status === 415 ||
      error?.type === 'charset.unsupported' ||
      error?.type === 'encoding.unsupported'
    ) {
      if (req.path.startsWith('/api/')) {
        return res.status(415).json({
          error: {
            code: 'unsupported_media_type',
            message: 'Use UTF-8 JSON for this request.',
          },
        });
      }
      return res.status(415).send('That form encoding is not supported.');
    }
    console.error('Request failed', {
      method: req.method,
      path: req.path,
      name: error.name,
    });
    if (req.path.startsWith('/api/')) {
      return res.status(500).json({
        error: { code: 'internal_error', message: 'Something went wrong.' },
      });
    }
    return res.status(500).send('Something went wrong. Please try again.');
  });

  return app;
}

module.exports = { createApp };
