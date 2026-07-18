// Autism: Bringing Change — v0. One file, on purpose.
// Grows in phases like the stock platform did; refactor when it hurts.
const express = require('express');
const fs = require('fs');

const DATA_FILE = './data.json';
const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

const app = express();
app.use(express.urlencoded({ extended: true }));

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const remaining = (event) => {
  if (event.capacity === null) return null;
  const taken = db.registrations.filter((r) => r.eventId === event.id).length;
  return Math.max(0, event.capacity - taken);
};

// ---------- layout ----------
const page = (title, body) => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — Autism: Bringing Change</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Public+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root{--navy:#26324f;--navy-deep:#1b2438;--paper:#faf6ee;--white:#fff;--gold:#d9a514;--gold-soft:#f3df9d;--sage:#8aa882;--ink:#2b2f36;--ink-soft:#5c6270;--line:#e5ddcc;--r:6px}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Public Sans',system-ui,sans-serif;background:var(--paper);color:var(--ink);line-height:1.65}
  h1,h2{font-family:'Bricolage Grotesque',system-ui,sans-serif;color:var(--navy);line-height:1.15}
  .wrap{max-width:960px;margin:0 auto;padding:0 1.5rem}
  nav{background:var(--navy);position:sticky;top:0}
  nav .wrap{display:flex;justify-content:space-between;align-items:center;padding:.9rem 1.5rem;flex-wrap:wrap;gap:.75rem}
  nav a{color:var(--paper);text-decoration:none;font-weight:600;font-size:.95rem;margin-left:1.2rem}
  nav a.brand{margin:0;font-family:'Bricolage Grotesque',sans-serif;font-weight:700}
  .blocks{display:inline-block;width:10px;height:10px;background:var(--gold);box-shadow:14px 0 0 var(--sage),28px 0 0 var(--paper);margin-right:2.2rem;vertical-align:middle}
  .hero{background:var(--navy);color:var(--paper);padding:4rem 0}
  .hero h1{color:var(--paper);font-size:clamp(2.2rem,6vw,3.6rem);max-width:18ch}
  .hero p{font-size:1.2rem;max-width:48ch;opacity:.9;margin:1rem 0 1.5rem}
  section{padding:2.5rem 0}
  .card{background:var(--white);border:1px solid var(--line);border-radius:var(--r);padding:1.5rem;margin-bottom:1rem;box-shadow:0 2px 12px rgba(38,50,79,.08)}
  .btn{display:inline-block;background:var(--gold);color:var(--navy-deep);padding:.75rem 1.5rem;border-radius:var(--r);border:none;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
  .btn-navy{background:var(--navy);color:var(--paper)}
  .btn-quiet{background:var(--line);color:var(--navy-deep)}
  .muted{color:var(--ink-soft)}
  .chip{display:inline-block;background:var(--gold-soft);color:var(--navy-deep);padding:.15rem .6rem;border-radius:var(--r);font-size:.8rem;font-weight:600}
  .chip.past{background:var(--line);color:var(--ink-soft)}
  .stat{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:1.8rem;color:var(--navy)}
  .statlabel{font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-soft)}
  .stats{display:flex;gap:1rem;flex-wrap:wrap}
  .stats .card{flex:1;min-width:140px;text-align:center;border-top:5px solid var(--gold)}
  label{display:block;font-weight:600;color:var(--navy);margin:.75rem 0 .25rem;font-size:.95rem}
  input{width:100%;padding:.7rem;border:1.5px solid var(--line);border-radius:var(--r);font:inherit;background:var(--white)}
  input:focus{outline:none;border-color:var(--gold)}
  .row{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap}
  .error{color:#8c2f1b;font-weight:600}
  form.inline{display:inline}
  footer{background:var(--navy-deep);color:var(--paper);margin-top:3rem;padding:2.5rem 0;font-size:.95rem}
  footer a{color:var(--gold-soft)}
  @media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}
</style></head><body>
<nav><div class="wrap">
  <a class="brand" href="/"><span class="blocks"></span>Autism: Bringing Change</a>
  <div><a href="/events">Events</a><a href="/impact">Our Impact</a></div>
</div></nav>
${body}
<footer><div class="wrap">
  <p>A youth-led Phoenix initiative funding autism therapy through community events.</p>
  <p class="muted" style="margin-top:.5rem">Autismbringingchange@gmail.com · (480) 875-6570</p>
</div></footer>
</body></html>`;

// ---------- public pages ----------
app.get('/', (req, res) => {
  const past = db.events.filter((e) => e.status === 'completed');
  const open = db.events.find((e) => e.status === 'open');
  const funds = past.reduce((s, e) => s + (parseFloat(String(e.fundsRaised).replace(/[^0-9.]/g, '')) || 0), 0);
  res.send(page('Home', `
  <div class="hero"><div class="wrap">
    <h1>Building blocks for a better future.</h1>
    <p>We fund autism therapy for Phoenix families by running community events anyone can join.</p>
    ${open ? `<a class="btn" href="/events">See the ${esc(open.name)}</a>` : ''}
  </div></div>
  <section><div class="wrap stats">
    <div class="card"><div class="stat">$${funds.toLocaleString()}+</div><div class="statlabel">Raised for therapy</div></div>
    <div class="card"><div class="stat">${past.length}</div><div class="statlabel">Events run</div></div>
    <div class="card"><div class="stat">AZA United</div><div class="statlabel">Where proceeds go</div></div>
  </div></section>
  ${open ? `<section><div class="wrap"><div class="card row">
    <div><h2>${esc(open.name)}</h2>
    <p class="muted">${esc(open.date)} · ${esc(open.time)} · ${esc(open.location)} · ${esc(open.cost)}</p></div>
    <a class="btn btn-navy" href="/events">Details</a>
  </div></div></section>` : ''}`));
});

app.get('/events', (req, res) => {
  const open = db.events.filter((e) => e.status === 'open');
  res.send(page('Events', `<section><div class="wrap">
    <h1>Upcoming events</h1><br>
    ${open.length === 0 ? '<div class="card">Nothing open right now — more is coming.</div>' : ''}
    ${open.map((e) => {
      const left = remaining(e);
      return `<div class="card row">
        <div><span class="chip">Open</span>
        <h2 style="margin:.4rem 0 .2rem">${esc(e.name)}</h2>
        <p class="muted">${esc(e.date)} · ${esc(e.time)} · ${esc(e.location)} · ${esc(e.cost)}</p>
        ${left !== null ? `<p style="font-weight:600;margin-top:.4rem">${left} of ${e.capacity} spots remaining</p>` : ''}</div>
        ${left === 0 ? '<span class="chip past">Full</span>' : '<span class="chip">Registration opens in phase 3</span>'}
      </div>`;
    }).join('')}
  </div></section>`));
});

app.get('/impact', (req, res) => {
  const past = db.events.filter((e) => e.status === 'completed');
  res.send(page('Our Impact', `<section><div class="wrap">
    <h1>What we've done so far</h1><br>
    ${past.map((e) => `<div class="card">
      <span class="chip past">${esc(e.date)}</span>
      <h2 style="margin:.4rem 0 .2rem">${esc(e.name)}</h2>
      <p class="muted">${esc(e.location)}${e.partner ? ' · with ' + esc(e.partner) : ''}</p>
      ${e.fundsRaised ? `<p class="stat" style="margin-top:.5rem">${esc(e.fundsRaised)}</p><p class="statlabel">raised for therapy</p>` : ''}
    </div>`).join('')}
  </div></section>`));
});

// ---------- start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ABC website running on http://localhost:${PORT}`));