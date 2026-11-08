# Zeffy and Cloudflare launch setup

This site is ready for the two account-side connections ABC still needs. Vercel remains the web host. Cloudflare supplies authoritative DNS and Turnstile; Zeffy supplies the donation experience.

## 1. Connect Zeffy

### In Zeffy

1. Finish the organization verification and connect ABC's bank account.
2. Create the public ABC donation campaign and review its title, image, description, suggested amounts, confirmation message, and receipt details.
3. Open the campaign's sharing controls and copy its public `https://www.zeffy.com/...` URL.
4. Keep the campaign unpublished until its content and the website preview have both been approved.

### In Vercel

Add these variables to the Preview environment first:

```text
ZEFFY_DONATION_URL=https://www.zeffy.com/en-US/<campaign-path>?utm_source=website
```

Use the exact campaign URL Zeffy generates. Redeploy the branch and test the Support page on desktop and mobile. The first release deliberately uses a hosted Zeffy handoff: it keeps payment data and third-party scripts off the ABC website and preserves the site's strict security policy.

When the preview is approved, copy the same values into Vercel's Production environment and redeploy production. No Zeffy secret or API key belongs in this repository or in browser code.

### Before announcing donations

- Complete one real low-value donation and refund it, or follow Zeffy's current payment-testing instructions.
- Confirm the receipt and confirmation experience use ABC's approved name and contact details.
- Confirm the bank destination with a second ABC organizer.
- Check the Support page with browser tracking protection enabled.
- Do not claim a tax deduction, a fundraising total, or a fee arrangement unless ABC has approved the exact wording.

## 2. Put the domain on Cloudflare without double-proxying Vercel

Cloudflare should be ABC's registrar/DNS provider initially, not a second reverse proxy in front of Vercel.

1. Add the apex domain and `www` in **Vercel project → Settings → Domains**.
2. Copy the exact A and CNAME targets Vercel shows for this project.
3. In Cloudflare DNS, create:

   | Name | Type | Target | Proxy status |
   | --- | --- | --- | --- |
   | `@` | `A` | Exact apex target shown by Vercel | DNS only / gray cloud |
   | `www` | `CNAME` | Exact `www` target shown by Vercel | DNS only / gray cloud |

4. Remove conflicting web A, AAAA, or CNAME records. Preserve every MX, SPF, DKIM, DMARC, and other service record.
5. Verify both hostnames in Vercel and wait for Vercel's TLS certificate.
6. Choose the canonical hostname in Vercel and configure the other hostname to redirect to it there.
7. If any CAA record already exists, allow `letsencrypt.org` so Vercel can issue its certificate.
8. For a nameserver transfer, disable DNSSEC at the old registrar before changing nameservers. After Cloudflare becomes authoritative, enable DNSSEC in Cloudflare and publish its DS record at the registrar.

Keep the two Vercel records gray-clouded. Turnstile works without Cloudflare proxying site traffic. If ABC deliberately enables the proxy later, use **Full (strict)** TLS and retest Vercel firewall, bot, IP, cache, and certificate behavior first.

## 3. Create the Turnstile widget

Turnstile is already integrated into the dynamic registration service. Static Vercel previews intentionally contain no registration form.

1. Open **Cloudflare Dashboard → Turnstile → Add widget**.
2. Name it `ABC event registration` and choose **Managed** mode.
3. Add the exact production hostname or hostnames that will serve registration.
4. Store the public site key and server-only secret in the eventual dynamic production environment:

```text
TURNSTILE_SITE_KEY=<public-site-key>
TURNSTILE_SECRET_KEY=<server-only-secret>
TURNSTILE_EXPECTED_HOSTNAMES=autismbringingchange.xyz,www.autismbringingchange.xyz
```

Never put the secret in a `NEXT_PUBLIC_`, `PUBLIC_`, HTML, or Git value. The server fails registration closed unless the site key, secret, and hostname allowlist are all configured.

For a controlled preview of the dynamic service, Cloudflare's documented always-pass test pair is:

```text
site key: 1x00000000000000000000AA
secret:   1x0000000000000000000000000000000AA
```

Do not add changing `*.vercel.app` hostnames to the production widget. Use Cloudflare's test keys on previews or a stable staging hostname.

## 4. Production origin and indexing

Only in Vercel's Production environment, set:

```text
PUBLIC_SITE_ORIGIN=https://<canonical-domain>
```

That enables canonical URLs, the XML sitemap, and an indexable `robots.txt`. Leave it unset on branch previews so they remain excluded from search engines.

## 5. Final verification

- `npm run events:validate`
- `npm test`
- `npm run check`
- `npm run build`
- Verify the Zeffy handoff on `/support` reaches the correct public campaign.
- Verify apex and `www` resolve to Vercel, one redirects to the canonical host, and TLS is valid.
- Verify the preview remains no-index and never exposes a registration form.
- Before registration launches, finish the PostgreSQL, organizer authentication, MFA, backups, and restore gates in the launch checklist.

Official references:

- [Zeffy campaign sharing and embedding](https://support.zeffy.com/how-to-embed-your-zeffy-campaign-on-your-website-km0gv)
- [Vercel custom domains](https://vercel.com/docs/domains/set-up-custom-domain)
- [Vercel reverse-proxy guidance](https://vercel.com/docs/security/reverse-proxy)
- [Cloudflare DNS proxy status](https://developers.cloudflare.com/dns/proxy-status/)
- [Cloudflare Turnstile setup](https://developers.cloudflare.com/turnstile/get-started/)
- [Cloudflare Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
