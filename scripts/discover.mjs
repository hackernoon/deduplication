// deduplication.tech — daily discovery run (Node 20+). Called by .github/workflows/daily-terms.yml.
//
//   node scripts/discover.mjs                 # find, judge and append today's terms to src/terms-auto.txt
//   node scripts/discover.mjs --dry-run       # print what it would add, change nothing
//   node scripts/discover.mjs --limit 10      # max terms to publish today (default: DAILY_LIMIT or 10)
//
// Pipeline:
//   1. SOURCES   yesterday's 1,000 most-read Wikipedia articles, Hacker News front-page names, Google Trends US,
//                words David drops into discovery/seeds.txt, and yesterday's runners-up (discovery/backlog.json).
//   2. PAIRING   for each word, every Wikipedia article titled with exactly that word; keep the trending one plus
//                its strongest rival (scripts/discover-core.mjs).
//   3. GATES     both meanings >= 15K pageviews/yr, newer meaning's share 5–95%, not people, not tragedies,
//                not elections/sports seasons, not already on the site.
//   4. EDITOR    Claude judges each survivor (exact same word? real duplication? which came first?) and writes the
//                row in the site's house style. Needs ANTHROPIC_API_KEY. Without it, nothing is published; the
//                candidates are left in discovery/backlog.json for a human.
//   5. PUBLISH   up to --limit rows appended to src/terms-auto.txt; refresh-data.mjs then bakes their pageviews.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { discover, DEFAULTS } from './discover-core.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DIR = ROOT + 'discovery/';
const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const DRY = process.argv.includes('--dry-run');
const LIMIT = +arg('--limit', process.env.DAILY_LIMIT || 10);
const MIN_QUALITY = +(process.env.MIN_QUALITY || 7);
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const KEY = process.env.ANTHROPIC_API_KEY;
const today = new Date().toISOString().slice(0, 10);
const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const slug = s => fold(s).replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const CATS = ['ai', 'code', 'infra', 'data', 'design', 'security', 'hardware', 'crypto', 'business', 'fintech', 'internet', 'gaming', 'science', 'media'];
fs.mkdirSync(DIR + 'log', { recursive: true });

// ---------- what's already on the site ----------
function siteTerms() {
  const tmp = ROOT + '.terms.jsonl';
  execFileSync('node', [ROOT + 'build.mjs', '--terms-jsonl', tmp], { cwd: ROOT, env: { ...process.env, SKIP_WIKI: '1' }, stdio: 'ignore' });
  execFileSync('node', [ROOT + 'build.mjs', '--jobs'], { cwd: ROOT, env: { ...process.env, SKIP_WIKI: '1' }, stdio: 'ignore' });
  const terms = fs.readFileSync(tmp, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const jobs = JSON.parse(fs.readFileSync(ROOT + 'jobs.json', 'utf8'));
  fs.unlinkSync(tmp); fs.unlinkSync(ROOT + 'jobs.json');
  const existing = new Set(), existingTerms = new Set(), keys = new Set();
  terms.forEach((t, i) => { existingTerms.add(fold(t.term)); keys.add(t.key); const [, , , wa, wb] = jobs[i] || []; [wa, wb].forEach(w => w && existing.add(fold(t.term) + '|' + fold(w))); });
  return { existing, existingTerms, keys, examples: terms };
}

// ---------- the editor ----------
const STYLE = fs.readFileSync(ROOT + 'src/terms-600.txt', 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
const SYSTEM = `You are the editor of deduplication.tech, a HackerNoon site about "duplicated" words: one word, an original meaning, and a newer meaning riding on its name. Each page compares the two meanings using Wikipedia pageviews.

You receive one candidate word with two Wikipedia articles. Decide whether it belongs on the site and, if so, write its database row.

Accept only if ALL are true:
- Both articles are titled with the SAME word (ignoring a parenthetical qualifier or a leading "The"). No puns, prefixes, or "sounds like".
- They are genuinely different meanings a reader could confuse, and one clearly came later. Two unrelated things that merely share a name are fine (that is the point of the site); two articles about the same thing are not.
- Neither side is a living private person, a tragedy, a crime, an election, or a news event that will be stale in a month.
- A general reader would find the face-off interesting. The site leans tech, AI, media and business, but any domain is allowed.

Write in the house style: short labels that contain the word; a note of at most 140 characters, plain, specific and a little wry, no hype, no em dashes; definitions of one sentence each (max 200 chars) in plain English.

Return ONLY JSON:
{"accept":true|false,"reason":"one line","quality":1-10,"cat":"one of ${CATS.join('|')}","original":{"wiki":"exact title given","label":"...","year":"YYYY or 1800s or ancient"},"duplicate":{"wiki":"exact title given","label":"...","year":"..."},"note":"...","originalDef":"...","duplicateDef":"..."}
"original" must be whichever meaning is older. quality 9-10 = a fight people will share; 7 = solid; below 7 = skip.`;

async function judge(c) {
  const ex = STYLE.sort(() => Math.random() - .5).slice(0, 8).join('\n');
  const user = `Examples of published rows (term|cat|origLabel|origWiki|origYear|dupLabel|dupWiki|dupYear|note|...):\n${ex}\n\nCandidate word: ${c.word}\n` +
    c.senses.map((s, i) => `Article ${i + 1}: "${s.title}" — ${s.desc || 'no description'} — ${s.views12.toLocaleString('en-US')} pageviews in 12 months\n  Lead: ${s.extract || ''}`).join('\n') +
    `\nThe newer-looking side holds ${Math.round(c.share * 100)}% or ${100 - Math.round(c.share * 100)}% of combined pageviews.`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, system: SYSTEM, messages: [{ role: 'user', content: user }] }) });
  if (!r.ok) throw new Error('anthropic ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const txt = (await r.json()).content.map(b => b.text || '').join('');
  return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
}

const clean = s => String(s || '').replace(/[|\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
function toRow(c, j) {
  const titles = c.senses.map(s => s.title);
  if (!titles.includes(j.original?.wiki) || !titles.includes(j.duplicate?.wiki) || j.original.wiki === j.duplicate.wiki) throw new Error('editor changed the wiki titles');
  const w = fold(c.word);
  for (const s of [j.original, j.duplicate]) if (!fold(s.label).includes(w) && !fold(s.wiki).includes(w)) throw new Error('label lost the exact word: ' + s.label);
  if (!CATS.includes(j.cat)) j.cat = 'internet';
  return [c.word, j.cat, j.original.label, j.original.wiki, j.original.year, j.duplicate.label, j.duplicate.wiki, j.duplicate.year, j.note, j.originalDef, j.duplicateDef, '', ''].map(clean).join('|');
}

// ---------- run ----------
const site = siteTerms();
const seeds = fs.existsSync(DIR + 'seeds.txt') ? fs.readFileSync(DIR + 'seeds.txt', 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')) : [];
const backlog = fs.existsSync(DIR + 'backlog.json') ? JSON.parse(fs.readFileSync(DIR + 'backlog.json', 'utf8')) : [];
const judged = fs.existsSync(DIR + 'judged.json') ? JSON.parse(fs.readFileSync(DIR + 'judged.json', 'utf8')) : {};   // word|wikiA|wikiB -> verdict, so we never pay twice
console.log(`discover: ${site.keys.size} terms on site, ${seeds.length} seeds, ${backlog.length} in backlog, limit ${LIMIT}`);

const { found, rejected, scanned } = await discover({ existing: site.existing, existingTerms: site.existingTerms, seeds, backlog: backlog.slice(0, 60), opts: DEFAULTS, log: m => console.log('  ' + m) });
console.log(`discover: scanned ${scanned} words → ${found.length} passed the data gates`);
// A word already on the site can still get a second, different fight (Agent has two), but new words come first.
found.forEach(c => { if (c.onSite) c.score = +(c.score - 0.15).toFixed(3); }); found.sort((a, b) => b.score - a.score);

const published = [], skipped = [];
for (const c of found) {
  if (published.length >= LIMIT) break;
  const jk = fold(c.word) + '|' + c.senses.map(s => fold(s.title)).sort().join('|');
  if (judged[jk] && !judged[jk].accept) { skipped.push({ word: c.word, why: 'previously rejected: ' + judged[jk].reason }); continue; }
  if (!KEY) { skipped.push({ word: c.word, why: 'no ANTHROPIC_API_KEY, left for review' }); continue; }
  try {
    const j = await judge(c);
    judged[jk] = { accept: j.accept && j.quality >= MIN_QUALITY, reason: j.reason, quality: j.quality, at: today };
    if (!j.accept || j.quality < MIN_QUALITY) { skipped.push({ word: c.word, why: `editor: ${j.reason} (q${j.quality})` }); continue; }
    const row = toRow(c, j);
    const key = slug(c.word) + '/' + (slug(j.original.label) || 'original') + '/' + (slug(j.duplicate.label) || 'duplicate');
    if (site.keys.has(key)) { skipped.push({ word: c.word, why: 'same page already exists' }); continue; }
    site.keys.add(key);
    published.push({ word: c.word, key, row, score: c.score, share: c.share, quality: j.quality, source: c.source });
  } catch (e) { skipped.push({ word: c.word, why: 'error ' + e.message }); }
}

// Runners-up (passed the data gates, not judged or not published today) become tomorrow's backlog.
const done = new Set(published.map(p => p.word));
const nextBacklog = [...found.filter(c => !done.has(c.word)).map(c => ({ word: c.word, score: c.score, seen: today })), ...backlog.filter(b => !done.has(b.word))]
  .filter((b, i, a) => a.findIndex(x => x.word === b.word) === i).sort((a, b) => b.score - a.score).slice(0, 300);

const report = { date: today, scanned, passedDataGates: found.length, published, skipped, rejectedSample: rejected.slice(0, 200) };
console.log(`discover: publishing ${published.length}`); published.forEach(p => console.log('  + ' + p.key + `  (${Math.round(p.share * 100)}% · q${p.quality} · ${p.source})`));
if (DRY) { console.log(JSON.stringify(found.slice(0, 30).map(c => [c.word, c.score, c.share, c.senses.map(s => s.title)]), null, 1)); process.exit(0); }

if (published.length) fs.appendFileSync(ROOT + 'src/terms-auto.txt', `# ${today} · auto-discovered\n` + published.map(p => p.row).join('\n') + '\n');
fs.writeFileSync(DIR + 'backlog.json', JSON.stringify(nextBacklog, null, 1));
fs.writeFileSync(DIR + 'judged.json', JSON.stringify(judged));
fs.writeFileSync(DIR + 'log/' + today + '.json', JSON.stringify(report, null, 1));
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${published.length}\nkeys=${published.map(p => p.key).join(',')}\n`);
// PR body for the workflow
fs.writeFileSync(DIR + 'last-run.md', `### ${published.length} new terms · ${today}\n\n` + (published.map(p => `- **${p.word}** · [/term/${p.key}/](https://deduplication.tech/term/${p.key}/) · duplicate share ${Math.round(p.share * 100)}% · editor ${p.quality}/10 · via ${p.source}`).join('\n') || '_none passed today_') +
  `\n\nScanned ${scanned} words, ${found.length} passed the Wikipedia gates. Skipped:\n` + skipped.slice(0, 25).map(s => `- ${s.word}: ${s.why}`).join('\n') + '\n');
