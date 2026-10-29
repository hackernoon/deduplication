// node build.mjs [--explicit]  → dist/
import { aboutBody } from './src/about.mjs';
// --explicit writes links ending in index.html (for file:// and preview hosting)
import fs from 'fs'; import path from 'path';
const SRC = new URL('./src/', import.meta.url).pathname;
const OUT = new URL('./dist/', import.meta.url).pathname;
const PREVIEW = process.argv.includes('--preview');
const EXPLICIT = process.argv.includes('--explicit');
const LIMIT = +(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || 0);
const SITE = 'https://deduplication.tech';

const CATS = { data: 'Data & databases', design: 'Design & UX', ai: 'AI & machine learning', code: 'Programming & software', infra: 'Cloud & infrastructure', security: 'Cybersecurity', hardware: 'Hardware & devices', crypto: 'Crypto & web3', business: 'Business & startups', fintech: 'Money & fintech', internet: 'Internet culture', gaming: 'Gaming', science: 'Science & space', media: 'Film, TV & media' };
const slug = s => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isAcr = t => /^[A-Z0-9]{2,6}$/.test(t);

function query(term, label) {
  const m = label.match(/^(.*?)\s*\((.+)\)$/);
  if (m) return (m[1].toLowerCase() === term.toLowerCase() ? term + ' ' + m[2] : m[1]).toLowerCase();
  return label.toLowerCase();
}
function yearText(y) { if (!y) return 'origin undated'; if (y === 'ancient') return 'ancient / pre-modern'; return /s$/.test(y) ? 'the ' + y : 'c. ' + y; }

// ---------- parse ----------
const readRows = f => fs.existsSync(SRC + f) ? fs.readFileSync(SRC + f, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')) : [];
const userRows = [...readRows('terms-100.txt'), ...readRows('terms-200.txt'), ...readRows('terms-300.txt'), ...readRows('terms-400.txt'), ...readRows('terms-500.txt')];
const key2 = l => { const f = l.split('|').map(x => (x || '').trim()); return f[0].toLowerCase() + '|' + (f[6] || f[5]).toLowerCase(); };
const userKeys = new Set(userRows.map(key2));
const userTermsSeen = new Set();
const dedupUser = userRows.filter(l => { const k = l.split('|')[0].trim().toLowerCase() + '|' + l.split('|')[5].trim().toLowerCase(); if (userTermsSeen.has(k)) return false; userTermsSeen.add(k); return true; });
const rows = [...dedupUser, ...readRows('terms.txt').filter(l => !userKeys.has(key2(l)))];
const RECAT = { lag: 'gaming', respawn: 'gaming', boss: 'gaming', speedrun: 'gaming', switch: 'gaming', quest: 'gaming', steam: 'gaming', unity: 'gaming', godot: 'gaming', halo: 'gaming', fortnite: 'gaming', portal: 'gaming', minecraft: 'gaming', stripe: 'fintech', square: 'fintech', plaid: 'fintech', robinhood: 'fintech', coinbase: 'fintech', pipeline: 'data', record: 'data', shard: 'data', lake: 'data', warehouse: 'data', mining: 'data', stream: 'data', cache: 'data', query: 'data', breadcrumb: 'design', carousel: 'design', drawer: 'design', ribbon: 'design', dock: 'design', desktop: 'design', pane: 'design', window: 'design', pin: 'design', cursor: 'design', retina: 'design', avatar: 'design', profile: 'design', emoji: 'design', sprite: 'design', clipboard: 'design', render: 'design', paint: 'design', wall: 'design' };
const seen = new Set(); let terms = [];
for (const l of rows) {
  const [term, cat, al, aw, ay, bl, bw, by, note, da, db, qa, qb] = l.split('|').map(s => (s ?? '').trim());
  if (!term || !al || !bl) continue;
  const ts = slug(term), as = slug(al) || 'original', bs = slug(bl) || 'duplicate';
  const key = ts + '/' + as + '/' + bs; if (seen.has(key)) continue; seen.add(key);
  terms.push({ term, ts, cat: (RECAT[term.toLowerCase()] && cat !== 'media') ? RECAT[term.toLowerCase()] : cat, note, A: { label: al, slug: as, wiki: aw, year: ay, q: qa || query(term, al), def: da || '' }, B: { label: bl, slug: bs, wiki: bw, year: by, q: qb || query(term, bl), def: db || '' }, url: `term/${key}/` });
}
if (process.argv.includes('--terms-jsonl')) { const out = process.argv[process.argv.indexOf('--terms-jsonl') + 1]; fs.writeFileSync(out, terms.map(t => JSON.stringify({ key: t.url.replace(/^term\//,'').replace(/\/$/,''), term: t.term, cat: t.cat, a: { label: t.A.label, def: t.A.def || t.A.label }, b: { label: t.B.label, def: t.B.def || t.B.label } })).join('\n') + '\n'); console.log('terms.jsonl:', terms.length); process.exit(0); }
if (process.argv.includes('--jobs')) { fs.writeFileSync(new URL('./jobs.json', import.meta.url).pathname, JSON.stringify(terms.map(t => [t.url.replace(/^term\//,'').replace(/\/$/,''), t.A.q, t.B.q, t.A.wiki, t.B.wiki]))); console.log('jobs written'); process.exit(0); }
// baked evidence (Wikipedia pageviews, collected in a real browser)
// ---------- definitions: fill any missing ones from Wikipedia's lead sentence at build time ----------
// Runs on Vercel (which has internet). Offline or on failure, the page falls back to loading it in the browser.
async function fillDefs() {
  if (process.env.SKIP_WIKI) return;
  const need = new Map();
  for (const t of terms) for (const s of [t.A, t.B]) if (!s.def && s.wiki) need.set(s.wiki, null);
  const titles = [...need.keys()];
  const clean = x => {
    let d = (x || '').replace(/\s*\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '').replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();
    const m = d.match(/^(.{40,}?[a-z0-9\)\]"'’])\.(\s|$)/i); if (m) d = m[1] + '.';
    if (d.length > 230) d = d.slice(0, 227).replace(/\s+\S*$/, '') + '…';
    return d;
  };
  let ok = 0;
  try {
    for (let i = 0; i < titles.length; i += 20) {
      const batch = titles.slice(i, i + 20);
      const q = new URLSearchParams({ action: 'query', format: 'json', redirects: '1', prop: 'extracts', exintro: '1', explaintext: '1', exsentences: '2', exlimit: '20', titles: batch.join('|') });
      let r;
      for (let attempt = 0; attempt < 5; attempt++) {
        r = await fetch('https://en.wikipedia.org/w/api.php?' + q, { headers: { 'User-Agent': 'deduplication.tech build (https://deduplication.tech; HackerNoon)' }, signal: AbortSignal.timeout(10000) });
        if (r.status !== 429 && r.status < 500) break;
        await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
      }
      if (!r.ok) throw new Error('wiki ' + r.status);
      await new Promise(res => setTimeout(res, 300));
      const j = await r.json(), map = {};
      batch.forEach(t => map[t] = t);
      for (const k of ['normalized', 'redirects']) (j.query?.[k] || []).forEach(n => { for (const t in map) if (map[t] === n.from) map[t] = n.to; });
      const pages = {}; Object.values(j.query?.pages || {}).forEach(p => pages[p.title] = p);
      for (const t of batch) { const p = pages[map[t]]; if (p && p.extract && !/may refer to/i.test(p.extract)) { need.set(t, clean(p.extract)); ok++; } }
    }
  } catch (e) { console.log('definitions: Wikipedia unavailable (' + e.message + '), using browser fallback'); }
  for (const t of terms) for (const s of [t.A, t.B]) if (!s.def && need.get(s.wiki)) { s.def = need.get(s.wiki); s.defSrc = 'wikipedia'; }
  console.log('definitions from Wikipedia:', ok, 'of', titles.length);
}
await fillDefs();
const HN_TAGS = new Set(fs.existsSync(SRC + 'hn-tags.json') ? JSON.parse(fs.readFileSync(SRC + 'hn-tags.json', 'utf8')) : []);
const tagSlug = x => x.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const BAKED = fs.existsSync(SRC + 'data.json') ? JSON.parse(fs.readFileSync(SRC + 'data.json', 'utf8')) : {};
terms.forEach(t => {
  const d = BAKED[t.url.replace(/^term\//, '').replace(/\/$/, '')] || null; t.data = d;
  if (d) {
    delete d.tr; const tr = null;
    if (d.wp && d.wp.ta && d.wp.ta === d.wp.tb) { d.wp.same = 1; }
    const wp = d.wp && !d.wp.same && d.wp.a12 != null && d.wp.b12 != null && (d.wp.a12 + d.wp.b12) ? d.wp.b12 / (d.wp.a12 + d.wp.b12) : null;
    delete d.hn;
    // A near-total split (under 1.5% or over 98.5%) almost always means one meaning's Wikipedia article is tiny or a stand-in,
    // not that the fight is over. Show "not enough data" until spoken-usage data can confirm it.
    if (wp != null && (wp < 0.015 || wp > 0.985)) { d.wp.x = 1; }
    d.share = d.wp && d.wp.x ? null : (tr ?? wp); d.w = d.wp ? (d.wp.a12 || 0) + (d.wp.b12 || 0) : 0;
  }
});
console.log('baked', terms.filter(t => t.data).length);
if (LIMIT) terms = terms.slice(0, LIMIT);
const href = (u) => EXPLICIT ? u + 'index.html' : u;
if (process.argv.includes('--cards')) {
  const out = process.argv[process.argv.indexOf('--cards') + 1];
  const list = terms.map(t => ({ path: t.url.replace(/\/$/, ''), term: t.term, a: t.A.label, b: t.B.label, cat: CATS[t.cat] || '', share: (() => { const d = BAKED[t.url.replace(/^term\//, '').replace(/\/$/, '')]; const w = d && d.wp; if (!w || w.ta === w.tb || w.a12 == null || w.b12 == null || !(w.a12 + w.b12)) return null; const s = w.b12 / (w.a12 + w.b12); return s < .015 || s > .985 ? null : s; })() }));
  fs.writeFileSync(out, JSON.stringify(list)); console.log('cards:', list.length); process.exit(0);
}
const index = terms.map(t => ({ t: t.term, a: t.A.label, b: t.B.label, u: href(t.url), wa: t.A.wiki, wb: t.B.wiki, c: t.cat, s: t.data?.share ?? null, w: t.data?.w ?? null }));
console.log('terms', terms.length);
const pop = t => t.data ? ((t.data.w || 0) || ((t.data.tr && (t.data.tr.la + t.data.tr.lb)) || 0)) : 0;
const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n || '—');
const byCatAll = {}; terms.forEach(t => (byCatAll[t.cat] ||= []).push(t));
Object.values(byCatAll).forEach(ts => ts.sort((a, b) => pop(b) - pop(a) || a.term.localeCompare(b.term)));
const MINSHOW = Math.min(8, ...Object.values(byCatAll).map(ts => ts.length));
const statusOf = t => { const s = t.data?.share; return s == null ? ['—', ''] : s > .6 ? ['Duplicate dominant', 'b'] : s < .4 ? ['Original holds', 'a'] : ['Contested', 'c']; };


// ---------- fat footer (every page): top 10 per field, "+ more" loads 10 at a time from the index ----------
const FOOTN = 10;
function fatFooter(root) {
  const cols = Object.entries(byCatAll).map(([c, ts]) => `<div class="fcol" data-cat="${c}" data-shown="${Math.min(FOOTN, ts.length)}"><h4><a href="${root}${href('field/' + c + '/')}">${esc(CATS[c] || c)}</a> <span class="n">${ts.length}</span></h4><ul>${ts.slice(0, FOOTN).map(t => `<li><a href="${root}${href(t.url)}">${esc(t.term)}${ts.filter(x => x.term === t.term).length > 1 ? ` <i>· ${esc(t.B.label.replace(t.term, '').replace(/[()]/g, '').trim() || t.B.label)}</i>` : ''}</a></li>`).join('')}</ul>${ts.length > FOOTN ? `<button class="fmore" type="button" aria-label="Show more ${esc(CATS[c] || c)} terms">+ ${ts.length - FOOTN} more</button>` : ''}</div>`).join('');
  return `<footer class="fat"><div class="wrap"><div class="fgrid">${cols}<div class="fcol site"><h4><a href="${root || './'}${EXPLICIT ? 'home.html' : ''}">deduplication.tech</a></h4><ul><li><a href="${root}${EXPLICIT ? 'home.html' : ''}">Home</a></li><li><a href="${root}${href('about/')}">About</a></li><li><a href="${root}${href('methodology/')}">Methodology</a></li><li><a href="${root}${href('terms/')}">All ${terms.length} terms</a></li><li><a href="${root}${href('terms-and-conditions/')}">Terms &amp; conditions</a></li><li><a href="${root}${href('privacy/')}">Privacy</a></li><li><a href="https://hackernoon.com" target="_blank" rel="noopener">HackerNoon</a></li><li><a href="https://hackernoon.ai" target="_blank" rel="noopener">HackerNoon AI</a></li><li><a href="https://hackernoon.cv" target="_blank" rel="noopener">HackerNoon CV</a></li><li><a href="https://hackernoon.tech" target="_blank" rel="noopener">HackerNoon Tech</a></li></ul></div></div>
<p class="fnote"><a class="fb" href="${root || './'}${EXPLICIT ? 'home.html' : ''}">deduplication.tech</a> tracks words that got duplicated: an original meaning, and a newer one riding on its name. Evidence from the <a href="https://wikitech.wikimedia.org/wiki/Analytics/AQS/Pageviews" target="_blank" rel="noopener">Wikimedia Pageviews API</a>. Definitions quote Wikipedia (CC BY-SA 4.0). Published by <a class="fb" href="https://hackernoon.com" target="_blank" rel="noopener">HackerNoon</a>.</p></div></footer>`;
}

// ---------- layout ----------
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@500;700;800;900&family=IBM+Plex+Mono:wght@400;500;600&family=Courier+Prime:wght@400;700&family=IBM+Plex+Sans:wght@400;600&display=swap">';
function ogFor(canonical) {
  const m = { '': 'home', 'about/': 'about', 'methodology/': 'methodology', 'terms/': 'terms' };
  const name = canonical.startsWith('term/') ? canonical.replace(/\/$/, '') : m[canonical];
  return name && fs.existsSync(SRC + 'og/' + name + '.jpg') ? `og/${name}.jpg` : 'og/default.jpg';
}
const FAVICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="32" height="64" fill="#8e908b"/><rect x="32" width="32" height="64" fill="#1c1d1e"/><text x="32" y="47" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="40" text-anchor="middle" fill="#00e85b">d</text></svg>')}`;
function page({ root, title, desc, canonical, body, data, ld, type = 'website', imgAlt }) {
  if (PREVIEW) return { title, data, body };
  const img = `${SITE}/${ogFor(canonical)}`, url = `${SITE}/${canonical}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}">
<meta name="theme-color" content="#141515"><script defer src="/_vercel/insights/script.js"></script><link rel="icon" href="${FAVICON}">
<meta property="og:type" content="${type}"><meta property="og:url" content="${url}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:site_name" content="deduplication.tech">
<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(imgAlt || title)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@hackernoon"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${img}">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}
${fonts}<link rel="stylesheet" href="${root}assets/app.css">
<!-- Hack this site: see something wrong or a term we missed? Pitch it as a story at hackernoon.com/new and tag #deduplication -->
</head><body>
<header class="bar"><div class="wrap"><a class="logo" href="${root}${EXPLICIT ? 'home.html' : ''}"><span class="de">de</span><span class="dup">duplication</span><span class="tld">.tech</span></a>
<div class="search"><input id="q" type="search" placeholder="Search ${terms.length} duplicated terms — try MTS, Python, PR" autocomplete="off" aria-label="Search terms"><kbd>/</kbd><div id="q-results" class="results" hidden></div></div>
<a class="hn" href="https://hackernoon.com/u/deduplication" target="_blank" rel="noopener">a <b>HackerNoon</b> project</a></div></header>
${ticker(root)}
${body}
${fatFooter(root)}
<script>window.DEDUP=${JSON.stringify({ root, ...data }).replace(/</g, '\\u003c')}</script><script src="${root}assets/index.js" defer></script><script src="${root}assets/app.js" defer></script>
</body></html>`;
}
function ticker(root) {
  const pick = terms.filter((_, i) => i % 3 === 0).slice(0, 40);
  const items = pick.map(t => `<a href="${root}${href(t.url)}"><b>${esc(t.term.toUpperCase())}</b> ${esc(t.A.label)} ▸ ${esc(t.B.label)}</a>`).join('');
  return `<div class="ticker" aria-hidden="true"><div>${items}${items}</div></div>`;
}

// ---------- term page ----------
function termPage(t) {
  const root = '../../../../';
  const h1 = `${t.term} / ${t.A.label} / ${t.B.label}`;
  const trendsReq = { comparisonItem: [t.A.q, t.B.q].map(k => ({ keyword: k, geo: '', time: '2004-01-01 ' + new Date().toISOString().slice(0, 10) })), category: 0, property: '' };
  const trendsSrc = `https://trends.google.com/trends/embed/explore/TIMESERIES?req=${encodeURIComponent(JSON.stringify(trendsReq))}&tz=0&eq=${encodeURIComponent(`date=all&q=${t.A.q},${t.B.q}`)}`;
  const trendsLink = `https://trends.google.com/trends/explore?date=all&q=${encodeURIComponent(t.A.q)},${encodeURIComponent(t.B.q)}`;
  const related = terms.filter(x => x !== t && (x.cat === t.cat || x.ts === t.ts)).sort((a, b) => (b.ts === t.ts) - (a.ts === t.ts)).slice(0, 18);
  const body = `
<section class="split${t.data?.share == null ? ' nodata' : t.data.share > .6 ? ' win-b' : t.data.share < .4 ? ' win-a' : ' win-c'}" aria-label="${esc(t.term)}: two meanings" style="--dup:${t.data?.share == null ? 50 : Math.round(t.data.share * 100)}%">
  <div class="tex a" aria-hidden="true">${esc((t.A.label.replace(/ \(.*\)$/, '') + ' · ').repeat(160))}</div><div class="tex b" aria-hidden="true">${esc((t.B.label.replace(/ \(.*\)$/, '') + ' · ').repeat(160))}</div>
  ${t.data?.share != null ? `<div class="pct a" aria-hidden="true">${Math.round((1 - t.data.share) * 100)}<i>%</i></div><div class="pct b" aria-hidden="true">${Math.round(t.data.share * 100)}<i>%</i></div><div class="stamp" aria-hidden="true">${t.data.share > .6 ? 'Duplicate owns the word →' : t.data.share < .4 ? '← Original still owns the word' : 'Contested'}</div>` : ''}
  <div class="side a"><span class="tag">Original · left</span><p class="sense">${esc(t.A.label)}</p>${t.A.def ? `<p class="defn">${esc(t.A.def)}</p>` : ''}<span class="year">First in use: ${esc(yearText(t.A.year))}</span></div>
  <div class="term-mark" aria-hidden="true">${esc(t.term)}</div>
  <div class="side b"><span class="tag">Duplicate · right</span><p class="sense">${esc(t.B.label)}</p>${t.B.def ? `<p class="defn">${esc(t.B.def)}</p>` : ''}<span class="year">First in use: ${esc(yearText(t.B.year))}</span></div>
</section>
<div class="splitbar" id="splitbar" hidden><span id="splitbar-a"></span><span id="splitbar-b"></span></div>
<div class="splitnote" id="splitnote" hidden><div class="wrap">This bar is the word itself, split by who owns it: <b class="pa">grey</b> = original meaning, <b class="pb">green</b> = duplicate meaning, sized by the last 12 months of Wikipedia attention.</div></div>
<div class="h1row"><div class="wrap"><h1 class="path">${esc(t.term)}<span class="s"> / </span><span class="pa">${esc(t.A.label)}</span><span class="s"> / </span><span class="pb">${esc(t.B.label)}</span></h1><span class="live" id="live-status">Loading data…</span></div></div>
<div class="verdict" id="verdict"><div class="cell big"><span>Canonical today</span><b>Measuring…</b></div><div class="cell"><span>Status</span><b>—</b></div><div class="cell"><span>Duplicate share · 12 mo</span><b>—</b></div><div class="cell"><span>Last crossover</span><b>—</b></div></div>
<div class="wrap"><div class="ckey"><span class="kt">Colour key</span><span class="ka"><i></i>Grey · original meaning</span><span class="kb"><i></i>Green · duplicate meaning</span><span class="kc"><i></i>Amber · contested (40–60%)</span><a href="${root}${href('methodology/')}#colors">How colours work</a></div></div>
<main class="wrap">
  <div class="narr" id="narrative"><p>${esc(t.note || '')}</p></div>
  <p class="note">Which meaning of <b>${esc(t.term)}</b> is the original, and which one is the duplicate riding on its name? ${esc(t.A.label)} came first (${esc(yearText(t.A.year))}). ${esc(t.B.label)} arrived ${t.B.year && t.B.year !== 'ancient' ? 'in ' + esc(yearText(t.B.year)).replace('c. ', '') : 'later'}. The data below shows which one owns the word now.</p>
  <section class="panel"><div class="ph"><h2>Wikipedia pageviews since 2015</h2><div class="legend"><span class="la"><i></i>${esc(t.A.label)}</span><span class="lb"><i></i>${esc(t.B.label)}</span></div></div>
    <div class="chart" id="chart-pv"><div class="empty">English Wikipedia pageviews since July 2015 load here.</div></div>
    <div class="ph" style="margin-top:18px"><h2 style="font-size:20px">Duplicate's share of attention</h2><p>Green line = duplicate's % · above 60 it owns the word · below 40 the original does</p></div>
    <div class="chart" id="chart-share"><div class="empty">Share-of-attention line loads here.</div></div></section>
  <section class="panel"><div class="ph"><h2>The case for each meaning</h2><p>Sourced definitions, usage stats and quotes</p></div>
    <div class="cols">
      <div class="col a"><span class="tag" style="color:var(--mut)">Original · ${esc(yearText(t.A.year))}</span><h3>${esc(t.A.label)}</h3><div id="def-A">${t.A.wiki ? `<p class="muted">Loading the Wikipedia definition…</p>` : '<p class="muted">No Wikipedia article covers this sense; the evidence here comes from usage.</p>'}</div><div class="stats" id="stats-A"><div><span>12-mo pageviews</span><b>—</b></div><div><span>Year over year</span><b>—</b></div><div><span>Peak month</span><b>—</b></div></div></div>
      <div class="col b"><span class="tag" style="color:var(--green)">Duplicate · ${esc(yearText(t.B.year))}</span><h3>${esc(t.B.label)}</h3><div id="def-B">${t.B.wiki ? `<p class="muted">Loading the Wikipedia definition…</p>` : '<p class="muted">No Wikipedia article covers this sense; the evidence here comes from usage.</p>'}</div><div class="stats" id="stats-B"><div><span>12-mo pageviews</span><b>—</b></div><div><span>Year over year</span><b>—</b></div><div><span>Peak month</span><b>—</b></div></div></div>
    </div></section>
  <aside class="hnlinks"><span class="hl">On HackerNoon</span><a href="https://hackernoon.com/search?query=${encodeURIComponent(t.term)}" target="_blank" rel="noopener">Search “${esc(t.term)}” stories →</a>${[...new Set([tagSlug(t.term), tagSlug(t.B.label)])].filter(x => HN_TAGS.has(x)).map(x => `<a class="tag" href="https://hackernoon.com/tagged/${x}" target="_blank" rel="noopener">#${x}</a>`).join('')}</aside>
  <section class="panel"><div class="ph"><h2>More duplicated terms</h2><p>${esc(CATS[t.cat] || '')}</p></div><div class="chips">${related.map(x => `<a href="${root}${href(x.url)}">${esc(x.term)} <span style="color:var(--mut)">· ${esc(x.B.label)}</span></a>`).join('')}</div></section>
</main>`;
  const sh = t.data?.share, verdictTxt = sh == null ? 'Which meaning owns the word? Wikipedia data since 2015.' : sh > .6 ? `The duplicate owns the word: ${Math.round(sh * 100)}% of Wikipedia attention.` : sh < .4 ? `The original still owns the word: ${Math.round((1 - sh) * 100)}% of Wikipedia attention.` : `Contested: ${Math.round(sh * 100)}% vs ${Math.round((1 - sh) * 100)}% of Wikipedia attention.`;
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', name: h1, url: `${SITE}/${t.url}`, isPartOf: { '@type': 'WebSite', name: 'deduplication.tech', url: SITE + '/' }, publisher: { '@type': 'Organization', name: 'HackerNoon', url: 'https://hackernoon.com' },
      about: [{ '@type': 'DefinedTerm', name: `${t.term} (${t.A.label})`, description: t.A.def || undefined, sameAs: t.A.wiki ? 'https://en.wikipedia.org/wiki/' + encodeURIComponent(t.A.wiki.replace(/ /g, '_')) : undefined },
              { '@type': 'DefinedTerm', name: `${t.term} (${t.B.label})`, description: t.B.def || undefined, sameAs: t.B.wiki ? 'https://en.wikipedia.org/wiki/' + encodeURIComponent(t.B.wiki.replace(/ /g, '_')) : undefined }] },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'deduplication.tech', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: CATS[t.cat] || t.cat, item: `${SITE}/field/${t.cat}/` },
      { '@type': 'ListItem', position: 3, name: h1, item: `${SITE}/${t.url}` }] }] };
  return page({ root, title: h1, ld, type: 'article', imgAlt: `${t.term}: ${t.A.label} vs ${t.B.label}. ${verdictTxt}`, desc: `${t.term}: ${t.A.label} (original) vs ${t.B.label} (duplicate). ${verdictTxt}`, canonical: t.url, body, data: { term: { term: t.term, note: t.note, A: t.A, B: t.B, data: t.data } } });
}

// ---------- home ----------
function homePage() {
  const root = '';
  const byCat = {}; terms.forEach(t => (byCat[t.cat] ||= []).push(t));
  const body = `
<section class="home-hero"><div class="a"><h1>De</h1><p>Every popular word in tech gets duplicated. A new meaning moves in on an old name, and over time one of them wins.</p></div><div class="b"><h1>duplication</h1><p>We measure which meaning is the original, which one is riding on it, and when the lead changed hands.</p></div></section>
<div class="home-search"><div class="wrap"><div class="search" style="max-width:none"><input id="q-home" type="search" placeholder="Which term do you want to deduplicate?" aria-label="Search terms" autocomplete="off"><div class="results" hidden></div></div></div></div>
<main class="wrap">
  <section class="panel"><div class="ph"><h2>${terms.length} duplicated terms</h2><p id="cloud-status">Loading live Wikipedia pageviews…</p></div>
    <div class="key"><span class="o"><b>■</b> original still owns the word</span><span class="t"><b>■</b> contested (40–60%)</span><span class="d"><b>■</b> duplicate took over</span><span class="x"><b>■</b> not enough data</span><span class="sz">Bigger word = more popular · hover for the split</span></div>
    <div id="cloud">${terms.map(t => `<a class="w tie" href="${href(t.url)}" style="font-size:1.1rem">${esc(t.term)}</a>`).join('')}</div></section>
  <section class="panel"><div class="ph"><h2>Leaderboards</h2><p>Duplicate share of the last 30 days of Wikipedia attention</p></div><div id="leaders"><p class="muted">Leaderboards fill in once live pageviews load.</p></div></section>
  <section class="panel"><div class="ph"><h2>Browse by field</h2><p>Top ${MINSHOW} per field by popularity · click a field for the full ranking</p></div><div class="cats">${Object.entries(byCatAll).map(([c, ts]) => `<div class="cat"><h3><a href="${href('field/' + c + '/')}">${esc(CATS[c] || c)} <span class="n">${ts.length}</span></a></h3><ul>${ts.map((t, i) => `<li${i >= MINSHOW ? ' class="more" hidden' : ''}><a href="${href(t.url)}">${esc(t.term)}</a><span>${esc(t.B.label)}</span></li>`).join('')}</ul>${ts.length > MINSHOW ? `<button class="expand" type="button" data-n="${ts.length - MINSHOW}">Show ${ts.length - MINSHOW} more</button>` : ''}</div>`).join('')}</div></section>
</main>`;
  return page({ root, ld: { '@context': 'https://schema.org', '@type': 'WebSite', name: 'deduplication.tech', alternateName: 'Deduplication Technology', url: SITE + '/', description: 'Words with two competing meanings, measured with Wikipedia attention.', publisher: { '@type': 'Organization', name: 'HackerNoon', url: 'https://hackernoon.com', sameAs: ['https://hackernoon.ai', 'https://hackernoon.cv', 'https://hackernoon.tech'] } }, title: 'deduplication.tech — which meaning owns the word?', desc: `${terms.length} tech, science and media terms with two competing meanings, measured with Wikipedia pageviews.`, canonical: '', body, data: {} });
}
function aboutPage() {
  const root = '../';
  const body = aboutBody({ terms, root, href, cats: Object.keys(byCatAll).length });
  return page({ root, title: 'About Deduplication Technology — deduplication.tech', desc: 'Why HackerNoon built deduplication.tech, and how internet behavior shows which meaning owns a word.', canonical: 'about/', body, data: {} });
}
function methodologyPage() {
  const root = '../';
  const body = `<main class="wrap prose" style="padding-block:28px"><h1 style="font:900 56px/1 var(--display);text-transform:uppercase">Methodology</h1>
<a class="xlink" href="${root}${href('about/')}"><span>Why we built this</span><b>About Deduplication Technology →</b><i>HackerNoon, measuring language with data, and what duplication means</i></a>
<p>A duplicated term is one word carrying two popular meanings. We call the older one the <b>original</b> and the newer one the <b>duplicate</b>, the meaning that rode in on an established name. Every page sits at <code>deduplication.tech/term/definition1/definition2</code>, with the original first.</p>
<h2>Evidence</h2>
<p><b>Wikipedia pageviews.</b> Monthly views of the English Wikipedia article for each meaning, from July 2015 to last month, pulled live from the Wikimedia Pageviews API. Redirects resolve to the canonical article first. We compare the last 12 months to get the duplicate's share of attention, and smooth with a 3-month moving average to find the last month where the lines crossed.</p>
<p><b>Origin dates.</b> Hand-researched approximate dates of first use for each meaning. "Ancient" means the sense predates modern record-keeping.</p>
<h2 id="spoken">Spoken usage: YouTube and Movies &amp; TV (in progress)</h2>
<p>Pageviews show what people look up. To see which meaning people actually <i>say</i>, we're labeling real spoken mentions of every term from two sources:</p>
<ul>
<li><b>YouTube, via <a href="https://huggingface.co/datasets/espnet/yodas2" target="_blank" rel="noopener">YODAS</a>.</b> Transcripts of hundreds of thousands of hours of Creative Commons YouTube videos, released by its authors under CC BY 3.0 (<a href="https://arxiv.org/abs/2406.00899" target="_blank" rel="noopener">paper</a>).</li>
<li><b>Movies &amp; TV, via the <a href="https://opus.nlpl.eu/OpenSubtitles/corpus/version/OpenSubtitles" target="_blank" rel="noopener">OpenSubtitles corpus</a></b> from <a href="http://www.opensubtitles.org/" target="_blank" rel="noopener">opensubtitles.org</a> (<a href="https://aclanthology.org/L16-1147" target="_blank" rel="noopener">Lison &amp; Tiedemann, 2016</a>). We publish counts and shares from it, never dialogue.</li>
</ul>
<p><b>How a mention gets labeled.</b> We find every line containing the term, keep the sentence around it, and a model decides whether it means the original, the duplicate, or something else. Low-confidence lines go to a human reviewer. Each term page will get YouTube and Movies &amp; TV filters showing the split by source and by year.</p>
<h2 id="colors">Colour system</h2>
<p>Every colour on the site answers one question: which meaning owns the word?</p>
<div class="swatches">
<div class="sw"><i style="background:var(--sa)"></i><div><b>Grey · the original</b><span>The older meaning. Grey panels, grey lines, grey words in the cloud. A grey verdict means the original still holds: under 40% of attention goes to the duplicate.</span></div></div>
<div class="sw"><i style="background:var(--green)"></i><div><b>Green · the duplicate</b><span>The newer meaning riding on the name. Green lines and words. A green verdict means the duplicate dominates: over 60% of attention.</span></div></div>
<div class="sw"><i style="background:var(--amber)"></i><div><b>Amber · contested</b><span>Neither side clearly owns the word: the duplicate holds 40–60%. In the cloud, amber words are the live fights.</span></div></div>
<div class="sw"><i style="background:#5d605c"></i><div><b>Dim grey · not enough data</b><span>We can't separate the meanings yet, usually because there's no Wikipedia article for one side or both sides share one.</span></div></div>
</div>
<p><b>Where you see it.</b> On a term page the left half is always grey (original) and the right half black with green (duplicate), whoever is winning. The bar under the hero is the word split by ownership. The "Canonical today" and "Status" boxes take the colour of whichever side wins. In the cloud, word size is popularity (both meanings' Wikipedia views combined) and colour is ownership.</p>
<h2>Verdicts</h2><p>Over 60% duplicate share: <b>duplicate dominant</b>. Under 40%: <b>original holds</b>. In between: <b>contested</b>. The last 12 months of Wikipedia pageviews decide. When neither source separates the meanings (MTS, for example), the page shows no verdict rather than guess. We also hold back a verdict when one side gets under 1.5% of attention: a split that lopsided usually means one meaning's Wikipedia article is tiny or a stand-in, not that the debate is over. Those terms show as not enough data until spoken-usage data can confirm the split.</p>
<h2>Limits</h2><p>Pageviews measure lookups, not usage, and an article can cover more than one sense. Phrase searches miss usages that never spell the meaning out. Treat each page as evidence, not a ruling.</p></main>`;
  return page({ root, title: 'Methodology — deduplication.tech', desc: 'How deduplication.tech decides which meaning of a word is the original and which is the duplicate.', canonical: 'methodology/', body, data: {} });
}
function fieldPage(c) {
  const root = '../../';
  const ts = byCatAll[c];
  const rows = ts.map((t, i) => { const [st, cls] = statusOf(t); const sh = t.data?.share; return `<tr><td class="rk">${i + 1}</td><td><a href="${root}${href(t.url)}"><b>${esc(t.term)}</b></a></td><td class="pair"><span class="pa">${esc(t.A.label)}</span> ▸ <span class="pb">${esc(t.B.label)}</span></td><td class="num">${t.data?.w ? fmtN(t.data.w) : '—'}</td><td class="sharecell">${sh == null ? '—' : `<span class="bar"><i style="width:${(sh * 100).toFixed(0)}%"></i></span> ${Math.round(sh * 100)}%`}</td><td class="st ${cls}">${st}</td></tr>`; }).join('');
  const nav = Object.keys(byCatAll).map(k => `<a href="${root}${href('field/' + k + '/')}"${k === c ? ' class="on"' : ''}>${esc(CATS[k] || k)}</a>`).join('');
  const body = `<section class="home-hero"><div class="a"><h1 style="font-size:clamp(34px,5vw,72px)">${esc((CATS[c] || c).split(' ')[0])}</h1><p>${ts.length} duplicated terms in ${esc(CATS[c] || c)}, ranked by popularity.</p></div><div class="b"><h1 style="font-size:clamp(34px,5vw,72px)">Ranked</h1><p>Popularity = combined English Wikipedia pageviews for both meanings over the last 12 months. Share = the duplicate meaning's slice of those pageviews. Colour: grey = original holds, amber = contested, green = duplicate dominant.</p></div></section>
<main class="wrap" style="padding-block:24px"><nav class="fieldnav">${nav}</nav>
<div class="tablewrap"><table class="rank"><thead><tr><th>#</th><th>Term</th><th>Original ▸ duplicate</th><th>Popularity · 12 mo</th><th>Duplicate share</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></main>`;
  return page({ root, title: `${CATS[c] || c}: words with two meanings`, desc: `${ts.length} ${CATS[c] || c} terms with two competing meanings, ranked by popularity, with which meaning owns each word.`, canonical: `field/${c}/`, body, data: {} });
}
function privacyPage() {
  const root = '../';
  const updated = 'October 29, 2026';
  const body = `<main class="wrap prose" style="padding-block:28px"><h1 style="font:900 56px/1 var(--display);text-transform:uppercase">Privacy</h1>
<p class="muted">Last updated ${updated}</p>
<p>deduplication.tech (the "Site") is published by ArtMap, Inc., doing business as HackerNoon ("HackerNoon," "we," "us"). This page explains what happens to information when you visit the Site. The short version: the Site has no accounts, no ads, no tracking cookies and no forms, and it counts visits only in aggregate, and we don't sell or share personal information.</p>
<h2>1. What we collect</h2>
<p><b>Nothing you type in.</b> The Site has no sign-up, login, comments or contact forms. Searching for a term runs entirely in your browser; your searches aren't sent to us.</p>
<p><b>Server logs.</b> The Site is hosted on <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener">Vercel</a>. Like any web host, Vercel automatically processes technical request data such as your IP address, browser type, the page requested and the time of the request, to deliver pages, keep the service secure and diagnose errors. We use this only in aggregate, to keep the Site running.</p>
<p><b>Traffic statistics.</b> We use <a href="https://vercel.com/docs/analytics/privacy-policy" target="_blank" rel="noopener">Vercel Web Analytics</a> to count page views, referrers, countries and device types in aggregate. It sets no cookies and doesn't identify or track individual visitors across sites.</p>
<p><b>Cookies.</b> We don't set cookies for tracking, advertising or analytics.</p>
<h2>2. Third parties your browser talks to</h2>
<p>Some pages load resources from other services, which receive your IP address and browser details as part of the request:</p>
<ul>
<li><b>Google Fonts</b> serves the Site's typefaces. See <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google's privacy policy</a>.</li>
<li><b>Wikimedia</b>. Some term pages ask the Wikimedia Pageviews API for fresh data directly from your browser. See the <a href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy" target="_blank" rel="noopener">Wikimedia Foundation privacy policy</a>.</li>
</ul>
<p>Links to Wikipedia, HackerNoon and other websites take you to sites with their own privacy policies.</p>
<h2>3. The data on the Site</h2>
<p>The term database is built from public, aggregate statistics, such as monthly Wikipedia pageview totals and counts of spoken mentions. These numbers describe how often a meaning is looked up or said, not who looked it up or said it. We don't publish personal information about anyone.</p>
<h2>4. Children</h2>
<p>The Site isn't directed at children under 13, and we don't knowingly collect personal information from them.</p>
<h2>5. Your rights</h2>
<p>Because we don't keep personal profiles, there's usually nothing to access or delete. If you have a question or request about your data, including under laws such as the GDPR or CCPA, contact us and we'll help.</p>
<h2>6. HackerNoon</h2>
<p>If you go on to read, write or sign up on hackernoon.com, <a href="https://hackernoon.com/privacy" target="_blank" rel="noopener">HackerNoon's privacy policy</a> applies there.</p>
<h2>7. Changes and contact</h2>
<p>We'll update this page if anything changes, and the date above shows the latest version. Questions: write to HackerNoon through <a href="https://hackernoon.com" target="_blank" rel="noopener">hackernoon.com</a>.</p>
</main>`;
  return page({ root, title: 'Privacy — deduplication.tech', desc: 'How deduplication.tech handles visitor information: no accounts, no ads, no tracking cookies.', canonical: 'privacy/', body, data: {} });
}
function tosPage() {
  const root = '../';
  const updated = 'October 21, 2026';
  const body = `<main class="wrap prose" style="padding-block:28px"><h1 style="font:900 56px/1 var(--display);text-transform:uppercase">Terms &amp; conditions</h1>
<p class="muted">Last updated ${updated}</p>
<p>deduplication.tech (the "Site") is published by ArtMap, Inc., doing business as HackerNoon ("HackerNoon," "we," "us"). By using the Site you agree to these terms. If you don't agree, please don't use the Site.</p>
<h2>1. What the Site is</h2>
<p>The Site compares two meanings of the same word: an older ("original") meaning and a newer ("duplicate") one. Each comparison shows public usage signals and a verdict computed from them. Verdicts, labels such as "original holds," "contested" and "duplicate dominant," origin dates and narratives are editorial interpretations of public data. They are not statements of fact about any company, product, person or community.</p>
<h2>2. Data sources and their terms</h2>
<p>The Site displays or summarizes data from third parties, each governed by its own terms:</p>
<ul>
<li><b>Wikipedia and the Wikimedia Pageviews API.</b> Article excerpts are quoted under the <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">Creative Commons Attribution-ShareAlike 4.0</a> license, with a link to the source article. Pageview counts come from the Wikimedia Foundation's public API.</li>
</ul>
<ul>
<li><b>YODAS (YouTube transcripts).</b> Used under CC BY 3.0 with attribution to its authors; excerpts link back to the original video.</li>
<li><b>OpenSubtitles corpus.</b> Used to compute counts and shares only; no subtitle text is republished. Subtitles remain the property of their rights holders. Source: <a href="http://www.opensubtitles.org/" target="_blank" rel="noopener">opensubtitles.org</a>.</li>
</ul>
<p>Third-party data can be incomplete, delayed, revised or wrong. Snapshots may be days or months old. We don't control these sources and aren't responsible for them.</p>
<h2>3. No advice and no warranty</h2>
<p>The Site is for information and entertainment. Nothing on it is legal, trademark, financial, investment or professional advice. The Site and all content are provided "as is" and "as available," without warranties of any kind, express or implied, including accuracy, completeness, merchantability, fitness for a particular purpose and non-infringement.</p>
<h2>4. Trademarks and names</h2>
<p>Many terms on the Site are names of companies, products, projects, people or works, such as Apple, Python, Claude or Kafka. All trademarks, service marks and names belong to their respective owners. Their appearance on the Site is descriptive and doesn't imply endorsement, sponsorship or affiliation with HackerNoon. If you own a mark and believe a page is inaccurate or misleading, contact us and we'll review it.</p>
<h2>5. Our content</h2>
<p>Except for third-party material described above, the Site's design, code, term database, definitions written by HackerNoon, verdict methodology and text are owned by HackerNoon. You may link to any page and quote brief portions with attribution to deduplication.tech. Don't copy the Site wholesale, or republish the term database, without written permission.</p>
<h2>6. Acceptable use</h2>
<p>Don't use the Site to break the law, interfere with its operation, overload it with automated requests, or try to get around security measures. Reasonable crawling that follows robots.txt is welcome.</p>
<h2>7. Suggestions and corrections</h2>
<p>If you send us a correction, a new term or another suggestion, including by writing it up on HackerNoon, you allow us to use it to improve the Site without payment or obligation. HackerNoon stories you publish stay subject to <a href="https://hackernoon.com/terms" target="_blank" rel="noopener">HackerNoon's own terms</a>.</p>
<h2>8. Links</h2>
<p>The Site links to external websites. We're not responsible for their content, policies or availability.</p>
<h2>9. Limitation of liability</h2>
<p>To the fullest extent the law allows, HackerNoon and its officers, employees and contributors aren't liable for any indirect, incidental, special, consequential or punitive damages, or any loss of data, profits or goodwill, arising from your use of the Site. Our total liability for any claim relating to the Site won't exceed one hundred U.S. dollars (US$100).</p>
<h2>10. Changes</h2>
<p>We may update the Site, its data and these terms at any time. The "last updated" date shows when the terms last changed. Continuing to use the Site after a change means you accept the updated terms.</p>
<h2>11. Contact</h2>
<p>Questions, corrections or takedown requests: write to HackerNoon through <a href="https://hackernoon.com" target="_blank" rel="noopener">hackernoon.com</a>.</p>
</main>`;
  return page({ root, title: 'Terms & conditions — deduplication.tech', desc: 'Terms and conditions for using deduplication.tech, published by HackerNoon.', canonical: 'terms-and-conditions/', body, data: {} });
}
function allPage() {
  const root = '../';
  const body = `<main class="wrap" style="padding-block:28px"><div class="ph"><h2 style="font-size:44px">All ${terms.length} terms</h2><p>Original ▸ duplicate</p></div><div class="cats"><div style="grid-column:1/-1"><ul>${[...terms].sort((a, b) => a.term.localeCompare(b.term)).map(t => `<li><a href="${root}${href(t.url)}">${esc(t.term)}</a><span>${esc(t.A.label)} ▸ ${esc(t.B.label)}</span></li>`).join('')}</ul></div></div></main>`;
  return page({ root, title: `All ${terms.length} duplicated terms, A to Z — deduplication.tech`, desc: `Every word with two competing meanings on deduplication.tech, A to Z, with which meaning owns each one.`, canonical: 'terms/', body, data: {} });
}

// ---------- preview (single-file SPA for the in-app viewer) ----------
function header(root){ return `<header class="bar"><div class="wrap"><a class="logo" href="home"><span class="de">de</span><span class="dup">duplication</span><span class="tld">.tech</span></a><div class="search"><input id="q" type="search" placeholder="Search ${terms.length} duplicated terms — try MTS, Python, PR" autocomplete="off" aria-label="Search terms"><kbd>/</kbd><div id="q-results" class="results" hidden></div></div><a class="hn" href="https://hackernoon.com/u/deduplication" target="_blank" rel="noopener">a <b>HackerNoon</b> project</a></div></header><div class="pv-note" id="pv-note">Preview build. Live Wikipedia data loads only on the deployed site.</div>`; }
function footer(root){ return fatFooter(''); }
if (PREVIEW) {
  const pages = { '': homePage(), 'about/': aboutPage(), 'methodology/': methodologyPage(), 'terms/': allPage(), 'terms-and-conditions/': tosPage(), 'privacy/': privacyPage() };
  for (const t of terms) pages[t.url] = termPage(t);
  for (const c of Object.keys(byCatAll)) pages['field/' + c + '/'] = fieldPage(c);
  const css = fs.readFileSync(SRC + 'app.css', 'utf8') + `.pv-note{background:var(--amber);color:var(--ink);font:12px var(--mono);padding:6px max(16px,env(safe-area-inset-left,0px))}.trends iframe{display:none}`;
  const html = `<title>deduplication.tech</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}<style>${css}</style>
${header('')}${ticker('')}<div id="view"></div>${fatFooter('')}
<script>window.DEDUP_PREVIEW=1;window.DEDUP_INDEX=${JSON.stringify(index).replace(/</g, '\\u003c')};window.PAGES=${JSON.stringify(pages).replace(/</g, '\\u003c')};</script>
<script>${fs.readFileSync(SRC + 'app.js', 'utf8')}</script>
<script>${fs.readFileSync(SRC + 'preview-router.js', 'utf8')}</script>`;
  fs.mkdirSync(new URL('./preview/', import.meta.url).pathname, { recursive: true });
  fs.writeFileSync(new URL('./preview/deduplication.html', import.meta.url).pathname, html);
  console.log('preview written', (html.length / 1e6).toFixed(1) + 'MB');
  process.exit(0);
}

// ---------- write ----------
fs.rmSync(OUT, { recursive: true, force: true });
const w = (p, s) => { fs.mkdirSync(path.dirname(OUT + p), { recursive: true }); fs.writeFileSync(OUT + p, s); };
w('assets/app.js', fs.readFileSync(SRC + 'app.js', 'utf8'));
w('assets/index.js', 'window.DEDUP_INDEX=' + JSON.stringify(index) + ';');
w('assets/app.css', fs.readFileSync(SRC + 'app.css', 'utf8'));
w(EXPLICIT ? 'home.html' : 'index.html', homePage()); w('about/index.html', aboutPage()); w('methodology/index.html', methodologyPage()); w('terms-and-conditions/index.html', tosPage()); w('privacy/index.html', privacyPage()); w('terms/index.html', allPage());
for (const t of terms) w(t.url + 'index.html', termPage(t));
for (const c of Object.keys(byCatAll)) w('field/' + c + '/index.html', fieldPage(c));
// term-only redirects: /term/python → first pair
const firsts = {}; terms.forEach(t => firsts[t.ts] ||= t);
if (!EXPLICIT) for (const [ts, t] of Object.entries(firsts)) w(`term/${ts}/index.html`, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${t.url.replace('term/' + ts + '/', '')}${EXPLICIT ? 'index.html' : ''}"><link rel="canonical" href="${SITE}/${t.url}"><title>${esc(t.term)}</title>`);
const TODAY = new Date().toISOString().slice(0, 10);
const smUrl = (u, pr) => `<url><loc>${SITE}/${u}</loc><lastmod>${TODAY}</lastmod><priority>${pr}</priority></url>`;
w('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[['', '1.0'], ['about/', '0.6'], ['methodology/', '0.6'], ['terms/', '0.8'], ['privacy/', '0.2'], ['terms-and-conditions/', '0.2']].map(([u, p]) => smUrl(u, p)).join('')}${Object.keys(byCatAll).map(c => smUrl(`field/${c}/`, '0.7')).join('')}${terms.map(t => smUrl(t.url, '0.8')).join('')}</urlset>`);
// social share cards
if (fs.existsSync(SRC + 'og')) fs.cpSync(SRC + 'og', OUT + 'og', { recursive: true });
w('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n# Hack this site: found a duplicated term we missed? Write it up on HackerNoon and tag #deduplication\n`);
w('vercel.json', JSON.stringify({ cleanUrls: true, trailingSlash: true }, null, 2));
w('terms.json', JSON.stringify(terms.map(t => ({ term: t.term, category: t.cat, url: SITE + '/' + t.url, original: t.A, duplicate: t.B, note: t.note })), null, 1));
console.log('wrote', terms.length + 4, 'pages');
