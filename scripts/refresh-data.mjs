// Fills src/data.json with Wikipedia pageview evidence, server-side (no browser needed).
// Produces exactly the same `wp` shape as scripts/sync.js, so build.mjs and app.js need no changes.
//
//   node scripts/refresh-data.mjs            # only terms that have no data yet (new terms)
//   node scripts/refresh-data.mjs --all      # re-collect every term (monthly refresh)
//   node scripts/refresh-data.mjs --keys a/b/c,d/e/f
//
// Wikimedia asks API clients to send a descriptive User-Agent and to stay under ~100 req/s; we do ~5 req/s.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const DATA = ROOT + 'src/data.json';
const UA = 'deduplication.tech data refresh (https://deduplication.tech; HackerNoon)';
const AL = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const enc = (arr, max) => arr.map(v => AL[Math.max(0, Math.min(63, Math.round((v || 0) / (max || 1) * 63)))]).join('');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export async function get(url, fetchImpl = fetch) {
  for (let i = 0; i < 5; i++) {
    let r;
    try { r = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA }, signal: AbortSignal.timeout(15000) }); }
    catch (e) { await sleep(1500 * (i + 1)); continue; }
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return r.json();
  }
  throw new Error('gave up ' + url);
}

// Last day of the previous month, as the Wikimedia API wants it (same as sync.js).
export function endStamp(now = new Date()) { const d = new Date(now); d.setUTCDate(1); d.setUTCDate(0); return d.toISOString().slice(0, 10).replace(/-/g, '') + '00'; }

export async function canonical(titles, fetchImpl) {
  const list = titles.filter(Boolean), c = {}; list.forEach(t => c[t] = t);
  if (!list.length) return { c, missing: new Set() };
  const j = await get('https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=' + encodeURIComponent(list.join('|')), fetchImpl);
  for (const k of ['normalized', 'redirects']) (j.query[k] || []).forEach(n => list.forEach(t => { if (c[t] === n.from) c[t] = n.to; }));
  const missing = new Set(Object.values(j.query.pages || {}).filter(p => 'missing' in p).map(p => p.title));
  return { c, missing };
}

export async function monthly(title, end, fetchImpl) {
  const j = await get('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/' + encodeURIComponent(title.replace(/ /g, '_')) + '/monthly/2015070100/' + end, fetchImpl);
  return j ? j.items.map(i => i.views) : null;
}

// Mirror of the wp block in scripts/sync.js.
export function encodeWp(pa, pb, ta, tb) {
  if (!pa && !pb) return null;
  const len = Math.max((pa || []).length, (pb || []).length);
  const padA = pa ? Array(len - pa.length).fill(0).concat(pa) : Array(len).fill(0);
  const padB = pb ? Array(len - pb.length).fill(0).concat(pb) : Array(len).fill(0);
  const qq = arr => { const o = []; for (let k = 0; k < arr.length; k += 3) o.push(arr.slice(k, k + 3).reduce((x, y) => x + y, 0) / Math.min(3, arr.length - k)); return o; };
  const QA = qq(padA), QB = qq(padB), m = Math.max(1, ...QA, ...QB);
  return { m: Math.round(m), a: pa ? enc(QA, m) : '', b: pb ? enc(QB, m) : '', a12: pa ? pa.slice(-12).reduce((x, y) => x + y, 0) : null, b12: pb ? pb.slice(-12).reduce((x, y) => x + y, 0) : null, ta: (pa && ta) || '', tb: (pb && tb) || '' };
}

export async function collect(wa, wb, { end = endStamp(), fetchImpl } = {}) {
  const { c, missing } = await canonical([wa, wb], fetchImpl);
  const ca = wa && !missing.has(c[wa]) ? c[wa] : null, cb = wb && !missing.has(c[wb]) ? c[wb] : null;
  const pa = ca ? await monthly(ca, end, fetchImpl) : null; await sleep(120);
  const pb = cb ? await monthly(cb, end, fetchImpl) : null; await sleep(120);
  return encodeWp(pa, pb, ca, cb);
}

export function jobs() {
  execFileSync('node', [ROOT + 'build.mjs', '--jobs'], { cwd: ROOT, env: { ...process.env, SKIP_WIKI: '1' }, stdio: 'ignore' });
  const j = JSON.parse(fs.readFileSync(ROOT + 'jobs.json', 'utf8')); fs.unlinkSync(ROOT + 'jobs.json'); return j;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const all = process.argv.includes('--all');
  const only = process.argv.includes('--keys') ? new Set(process.argv[process.argv.indexOf('--keys') + 1].split(',')) : null;
  const data = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf8')) : {};
  const end = endStamp(), d = new Date(); d.setUTCDate(1); d.setUTCDate(0);
  const at = MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  const todo = jobs().filter(([k]) => only ? only.has(k) : all || !data[k] || !data[k].wp);
  console.log('refresh-data:', todo.length, 'terms to collect');
  let ok = 0, fail = 0;
  for (const [k, , , wa, wb] of todo) {
    try {
      const wp = await collect(wa, wb, { end });
      const o = data[k] || {}; delete o.tr; delete o.hn;
      if (wp) { o.wp = wp; o.at = at; ok++; } else fail++;
      data[k] = o;
    } catch (e) { fail++; console.log('  fail', k, e.message); }
    if ((ok + fail) % 25 === 0) fs.writeFileSync(DATA, JSON.stringify(data));
  }
  fs.writeFileSync(DATA, JSON.stringify(data));
  console.log('refresh-data: ok', ok, 'no data', fail);
}
