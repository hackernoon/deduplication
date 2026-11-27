// deduplication.tech — weekly queue miner.
// Finds competing word pairs in bulk, checks them on Wikipedia, and fills discovery/queue.json with up to TARGET
// pending candidates for an editor to accept or reject at deduplication.tech/admin.
//
//   node scripts/mine-queue.mjs                 # fill the queue up to 1,000 pending
//   node scripts/mine-queue.mjs --target 300    # smaller run
//   node scripts/mine-queue.mjs --dry-run       # print, don't write
//
// Duplicates-first: instead of scanning trending pages that mostly have no rival meaning, it starts from Wikipedia titles
// that already carry a qualifier ("Lean (proof assistant)", "Threads (social network)", "Heat (1995 film)") — every one of
// those exists because the plain word means something else — then keeps the pairs where both meanings get real traffic.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { bestPair, wikiTop, DEFAULTS } from './discover-core.mjs';

const ROOT = new URL('../', import.meta.url).pathname, Q = ROOT + 'discovery/queue.json', TRIED = ROOT + 'discovery/tried.json';
const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const TARGET = +arg('--target', process.env.QUEUE_TARGET || 1000);
const DRY = process.argv.includes('--dry-run');
const BUDGET_MS = +(process.env.MINE_MINUTES || 90) * 60000, t0 = Date.now();
const UA = 'deduplication.tech queue miner (https://deduplication.tech; HackerNoon)';
const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Tech first (the site's emphasis), then media/culture qualifiers where movies and shows take over words.
export const QUALIFIERS = ['language model', 'chatbot', 'AI', 'software', 'programming language', 'app', 'web browser', 'company', 'operating system',
  'web framework', 'database', 'cryptocurrency', 'blockchain', 'protocol', 'search engine', 'microarchitecture', 'processor', 'robot', 'website',
  'social network', 'streaming service', 'video game', 'spacecraft', 'rocket', 'satellite', 'service', 'malware', 'hacker group', 'brand',
  'film', 'TV series', 'American TV series', 'miniseries', 'magazine', 'podcast', 'band', 'novel'];

// Category guess from Wikipedia short descriptions. The editor can change it in /admin.
const CAT_RULES = [['ai', /language model|chatbot|artificial intelligence|\bAI\b|machine learning|neural/i], ['crypto', /cryptocurrenc|blockchain|token|stablecoin|crypto/i],
  ['security', /malware|hacker|vulnerabilit|security|botnet|ransomware|cyber/i], ['gaming', /video game|game series|esports/i],
  ['hardware', /processor|microarchitecture|smartphone|chip|semiconductor|hardware|console|computer model/i], ['data', /database|data /i],
  ['code', /programming language|software|framework|library|operating system|text editor|compiler|app\b|application/i],
  ['infra', /cloud|server|network protocol|protocol|hosting/i], ['fintech', /bank|financial|payment|investment|stock|fund|insurance|economic/i],
  ['science', /spacecraft|rocket|satellite|planet|moon|star|asteroid|species|genus|chemical|physic|astronom|mission/i],
  ['media', /film|television|TV series|miniseries|sitcom|magazine|newspaper|podcast|album|song|band|novel|streaming|comic/i],
  ['internet', /website|social network|social media|online|internet|meme|slang/i], ['business', /company|corporation|brand|startup|retailer|manufacturer/i]];
export const guessCat = (a, b) => { const txt = [a.desc, a.title, b.desc, b.title].join(' '); for (const [c, re] of CAT_RULES) if (re.test(txt)) return c; return 'internet'; };

async function search(q, offset) {
  const p = new URLSearchParams({ action: 'query', format: 'json', list: 'search', srsearch: `intitle:"${q}"`, srlimit: '50', sroffset: String(offset), srnamespace: '0', srprop: '' });
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch('https://en.wikipedia.org/w/api.php?' + p, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } }); if (r.ok) return (await r.json()).query?.search || []; } catch (e) {}
    await sleep(1500 * (i + 1));
  }
  return [];
}

function siteState() {
  const tmp = ROOT + '.terms.jsonl';
  execFileSync('node', [ROOT + 'build.mjs', '--terms-jsonl', tmp], { cwd: ROOT, env: { ...process.env, SKIP_WIKI: '1' }, stdio: 'ignore' });
  execFileSync('node', [ROOT + 'build.mjs', '--jobs'], { cwd: ROOT, env: { ...process.env, SKIP_WIKI: '1' }, stdio: 'ignore' });
  const terms = fs.readFileSync(tmp, 'utf8').trim().split('\n').map(l => JSON.parse(l)), jobs = JSON.parse(fs.readFileSync(ROOT + 'jobs.json', 'utf8'));
  fs.unlinkSync(tmp); fs.unlinkSync(ROOT + 'jobs.json');
  const existing = new Set(), words = new Set();
  terms.forEach((t, i) => { words.add(fold(t.term)); const [, , , wa, wb] = jobs[i] || []; [wa, wb].forEach(w => w && existing.add(fold(t.term) + '|' + fold(w))); });
  return { existing, words };
}

export const itemId = c => fold(c.word) + '|' + c.senses.map(s => fold(s.title)).sort().join('|');

if (import.meta.url === 'file://' + process.argv[1]) {
  const queue = fs.existsSync(Q) ? JSON.parse(fs.readFileSync(Q, 'utf8')) : { updated: null, items: [] };
  const known = new Set(queue.items.map(i => i.id));
  const triedList = fs.existsSync(TRIED) ? JSON.parse(fs.readFileSync(TRIED, 'utf8')) : [];
  const block = fs.existsSync(ROOT + 'discovery/blocklist.txt') ? fs.readFileSync(ROOT + 'discovery/blocklist.txt', 'utf8').split('\n').map(fold).filter(Boolean) : [];
  const triedWords = new Set(queue.items.map(i => fold(i.word)).concat(triedList, block));
  const blocked = new Set(block);
  const site = siteState();
  const pending = () => queue.items.filter(i => i.status === 'pending').length;
  console.log(`mine-queue: ${queue.items.length} items in queue (${pending()} pending), target ${TARGET} pending`);

  // Candidate words: seeds first, then a week of trending pages, then qualifier titles (deeper each week via queue.cursor).
  const pool = new Map();
  const seeds = fs.existsSync(ROOT + 'discovery/seeds.txt') ? fs.readFileSync(ROOT + 'discovery/seeds.txt', 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')) : [];
  seeds.forEach(w => pool.set(w, { anchor: null, source: 'seed' }));
  for (let d = 1; d <= 7; d++) { try { (await wikiTop(new Date(Date.now() - d * 864e5))).slice(0, 500).forEach(a => { const w = a.title.replace(/\s*\([^)]*\)\s*$/, '').trim(); if (!pool.has(w)) pool.set(w, { anchor: a.title, source: 'wikipedia-top' }); }); } catch (e) {} }
  const cursor = queue.cursor || {};
  for (const ql of QUALIFIERS) {
    const start = cursor[ql] || 0;
    for (let off = start; off < start + 300; off += 50) {
      for (const x of await search(ql, off)) { const m = x.title.match(/^(.+?) \(([^)]*)\)$/); if (m && fold(m[2]).includes(fold(ql)) && !pool.has(m[1])) pool.set(m[1], { anchor: x.title, source: 'qualifier: ' + ql }); }
      await sleep(150);
    }
    cursor[ql] = (start + 300) % 9000; // move deeper next week, wrap after ~9,000 results
  }
  const words = [...pool.keys()].filter(w => !blocked.has(fold(w)) && (pool.get(w).source === 'seed' || !triedWords.has(fold(w))) && w.length <= 30 && w.split(/\s+/).length <= 3 && !/\d{4}/.test(w));
  console.log(`mine-queue: ${pool.size} candidate words, ${words.length} not tried before`);

  let added = 0, checked = 0; const tried = new Set(triedList);
  const save = () => { fs.writeFileSync(Q, JSON.stringify({ updated: new Date().toISOString(), cursor, items: queue.items })); fs.writeFileSync(TRIED, JSON.stringify([...tried].slice(-30000))); };
  for (let i = 0; i < words.length && pending() < TARGET && Date.now() - t0 < BUDGET_MS; i += 4) {
    const batch = words.slice(i, i + 4);
    const res = await Promise.all(batch.map(w => bestPair(w, { anchor: pool.get(w).anchor, existing: site.existing, opts: DEFAULTS }).catch(e => ({ word: w, reject: 'error' }))));
    for (const r of res) {
      checked++; tried.add(fold(r.word));
      if (r.reject) continue;
      const id = itemId(r); if (known.has(id)) continue; known.add(id);
      const [a, b] = r.senses;
      queue.items.push({ id, word: r.word, status: 'pending', cat: guessCat(a, b), score: r.score, share: r.share, total: r.total, tech: r.tech,
        onSite: site.words.has(fold(r.word)), source: pool.get(r.word)?.source || '', added: new Date().toISOString().slice(0, 10),
        A: { title: a.title, views: a.views12, desc: a.desc }, B: { title: b.title, views: b.views12, desc: b.desc } });
      added++;
    }
    if (checked % 200 < 4) { console.log(`  checked ${checked}, added ${added}, pending ${pending()}`); if (!DRY) save(); }
  }
  // Best fights first: score blends competitiveness, traffic and the tech emphasis; words already on the site go last.
  queue.items.sort((x, y) => (x.status === 'pending') - (y.status === 'pending') || (x.onSite - y.onSite) || y.score - x.score);
  console.log(`mine-queue: checked ${checked} words, added ${added}. Queue: ${pending()} pending, ${queue.items.filter(i => i.status === 'accepted').length} accepted, ${queue.items.filter(i => i.status === 'published').length} published.`);
  if (DRY) { console.log(JSON.stringify(queue.items.filter(i => i.status === 'pending').slice(0, 25).map(i => [i.word, i.cat, i.share, i.A.title, i.B.title]), null, 1)); process.exit(0); }
  save();
}
