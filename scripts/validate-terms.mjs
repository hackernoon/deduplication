// Checks every term that has no baked data yet (i.e. new rows) against Wikipedia and removes the ones that don't qualify:
//   - either article missing, or a disambiguation ("may refer to") page
//   - one meaning holds 98% or more of the last 12 months of pageviews (not a fight)
//   - either meaning under MIN_VIEWS pageviews in 12 months
// Removed rows are moved to discovery/rejected-terms.txt with the reason. Runs on every pull request that touches src/terms-*.txt.
//   node scripts/validate-terms.mjs [--dry-run]
import fs from 'node:fs';
import { get } from './refresh-data.mjs';

const ROOT = new URL('../', import.meta.url).pathname, SRC = ROOT + 'src/';
const DRY = process.argv.includes('--dry-run');
const MAX = 0.98, MIN_VIEWS = +(process.env.MIN_VIEWS || 3000);
const data = fs.existsSync(SRC + 'data.json') ? JSON.parse(fs.readFileSync(SRC + 'data.json', 'utf8')) : {};
const slug = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const end = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCDate(0); return d.toISOString().slice(0, 10).replace(/-/g, '') + '00'; })();
const startFix = (() => { const y = +end.slice(0, 4), m = +end.slice(4, 6); const d = new Date(Date.UTC(y - 1, m, 1)); return d.toISOString().slice(0, 10).replace(/-/g, '') + '00'; })();

async function info(titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 40) {
    const b = titles.slice(i, i + 40);
    const p = new URLSearchParams({ action: 'query', format: 'json', redirects: '1', prop: 'pageprops', ppprop: 'disambiguation', titles: b.join('|') });
    const j = await get('https://en.wikipedia.org/w/api.php?' + p);
    const m = {}; b.forEach(t => m[t] = t);
    for (const k of ['normalized', 'redirects']) (j.query[k] || []).forEach(n => { for (const t in m) if (m[t] === n.from) m[t] = n.to; });
    const pages = {}; Object.values(j.query.pages || {}).forEach(pg => pages[pg.title] = pg);
    for (const t of b) { const pg = pages[m[t]]; out[t] = !pg || 'missing' in pg ? { missing: true } : { canon: pg.title, dis: !!(pg.pageprops && 'disambiguation' in pg.pageprops) }; }
  }
  return out;
}
async function views(title) {
  const j = await get('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/' + encodeURIComponent(title.replace(/ /g, '_')) + '/monthly/' + startFix + '/' + end);
  return j ? j.items.reduce((a, x) => a + x.views, 0) : 0;
}

const files = fs.readdirSync(SRC).filter(f => /^terms.*\.txt$/.test(f));
const todo = [];
for (const f of files) fs.readFileSync(SRC + f, 'utf8').split('\n').forEach((l, i) => {
  if (!l.trim() || l.startsWith('#')) return;
  const c = l.split('|').map(s => (s || '').trim());
  if (!c[0] || !c[2] || !c[5] || !c[3] || !c[6]) return;
  const key = slug(c[0]) + '/' + slug(c[2]) + '/' + slug(c[5]);
  if (data[key] && data[key].wp) return; // already live with data
  todo.push({ f, i, l, term: c[0], wa: c[3], wb: c[6], key });
});
console.log('validate-terms:', todo.length, 'new rows to check');
const meta = await info([...new Set(todo.flatMap(t => [t.wa, t.wb]))]);
const bad = [];
for (const t of todo) {
  const A = meta[t.wa], B = meta[t.wb];
  let why = null;
  if (A.missing || B.missing) why = 'no Wikipedia article: ' + (A.missing ? t.wa : t.wb);
  else if (A.dis || B.dis) why = 'disambiguation page: ' + (A.dis ? t.wa : t.wb);
  else if (A.canon === B.canon) why = 'both titles lead to the same article';
  else {
    const va = await views(A.canon), vb = await views(B.canon);
    const share = vb / ((va + vb) || 1);
    t.share = share;
    if (Math.min(va, vb) < MIN_VIEWS) why = `too few pageviews (${va} vs ${vb})`;
    else if (share >= MAX || share <= 1 - MAX) why = `one meaning dominates (${(Math.max(share, 1 - share) * 100).toFixed(1)}%)`;
  }
  if (why) { bad.push({ ...t, why }); console.log('  ✗', t.term, '-', why); }
}
console.log('validate-terms:', todo.length - bad.length, 'pass,', bad.length, 'removed');
if (!DRY && bad.length) {
  const byFile = {}; bad.forEach(b => (byFile[b.f] ||= new Set()).add(b.i));
  for (const f in byFile) { const lines = fs.readFileSync(SRC + f, 'utf8').split('\n'); fs.writeFileSync(SRC + f, lines.filter((_, i) => !byFile[f].has(i)).join('\n')); }
  fs.mkdirSync(ROOT + 'discovery', { recursive: true });
  fs.appendFileSync(ROOT + 'discovery/rejected-terms.txt', `# ${new Date().toISOString().slice(0, 10)} removed by validate-terms\n` + bad.map(b => `${b.l}   # ${b.why}`).join('\n') + '\n');
}
