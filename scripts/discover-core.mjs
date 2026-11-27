// deduplication.tech — daily term discovery, core logic.
// Pure `fetch` code with no Node imports, so the same file runs in Node (scripts/discover.mjs) or a browser console.
//
// The idea: Wikipedia already disambiguates every word that has more than one meaning. A word is "duplicated"
// when two different articles are titled with that exact word ("Threads (1984 film)" vs "Threads (social network)").
// So each day we take what people are reading right now, find the word under it, list every exact-title meaning of
// that word, and keep the pairs where BOTH meanings draw real pageviews and neither one has won outright.

export const DEFAULTS = {
  minViews: 15000,        // each meaning needs at least this many Wikipedia pageviews over the last 12 months
  minShare: 0.05,         // the newer meaning's share of pageviews must sit between these two bounds...
  maxShare: 0.95,         // ...the build already hides anything under 1.5% / over 98.5% as "not enough data"
  maxSenses: 14,          // how many exact-title meanings of a word to price per word
  topN: 1000,             // how many of yesterday's most-read Wikipedia articles to scan
};

const UA = 'deduplication.tech discovery (https://deduplication.tech; HackerNoon)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function getJSON(url, f = fetch) {
  for (let i = 0; i < 5; i++) {
    let r;
    try { r = await f(url, { headers: { 'Api-User-Agent': UA, 'User-Agent': UA } }); } catch (e) { await sleep(1500 * (i + 1)); continue; }
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) { await sleep(2500 * (i + 1)); continue; }
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return r.json();
  }
  throw new Error('gave up ' + url);
}
async function getText(url, f = fetch) { try { const r = await f(url, { headers: { 'User-Agent': UA } }); return r.ok ? r.text() : ''; } catch (e) { return ''; } }

// ---------- sources ----------
const SKIP_TOP = /^(Main_Page|Special:|Wikipedia:|Portal:|File:|Help:|Template:|Category:|Talk:|User:|-|Cleopatra$)/;
export async function wikiTop(date, f) {
  const [y, m, d] = date.toISOString().slice(0, 10).split('-');
  const j = await getJSON(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${y}/${m}/${d}`, f);
  return (j?.items?.[0]?.articles || []).map(a => ({ title: a.article.replace(/_/g, ' '), views: a.views })).filter(a => !SKIP_TOP.test(a.title.replace(/ /g, '_')));
}
export async function hnWords(f) {
  const j = await getJSON('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60', f);
  const out = new Set();
  for (const h of j?.hits || []) {
    // Capitalised words that aren't the first word of the title are usually product / project / company names.
    const words = (h.title || '').replace(/[“”"'’:,.!?()[\]]/g, ' ').split(/\s+/).filter(Boolean);
    words.slice(1).forEach(w => { if (/^[A-Z][a-z]{2,14}$/.test(w)) out.add(w); });
  }
  return [...out];
}
export async function googleTrends(f) {
  const x = await getText('https://trends.google.com/trending/rss?geo=US', f);
  return [...x.matchAll(/<item>\s*<title>([^<]+)<\/title>/g)].map(m => m[1].trim()).filter(t => t.split(/\s+/).length <= 2);
}

// Evergreen tech miner: Wikipedia titles carrying a tech qualifier ("Lean (proof assistant)", "Muse (language model)").
// Trending articles skew toward new films, so on most days this is where the AI/tech terms come from.
// Each day rotates through qualifiers and result pages, so the whole space gets covered over a few months.
export const TECH_QUALIFIERS = ['language model', 'chatbot', 'AI', 'artificial intelligence', 'software', 'programming language', 'app', 'web browser',
  'company', 'operating system', 'web framework', 'database', 'cryptocurrency', 'blockchain', 'protocol', 'file format', 'search engine',
  'microarchitecture', 'processor', 'robot', 'spacecraft', 'rocket', 'satellite', 'website', 'social network', 'streaming service', 'video game', 'service'];
export async function techMiner(date, f, perDay = 4) {
  const day = Math.floor(date.getTime() / 864e5), out = new Map();
  for (let k = 0; k < perDay; k++) {
    const i = (day * perDay + k) % TECH_QUALIFIERS.length, ql = TECH_QUALIFIERS[i];
    const offset = (Math.floor((day * perDay + k) / TECH_QUALIFIERS.length) * 100) % 1000;
    for (const off of [offset, offset + 50]) {
      const p = new URLSearchParams({ action: 'query', format: 'json', origin: '*', list: 'search', srsearch: `intitle:"${ql}"`, srlimit: '50', sroffset: String(off), srnamespace: '0', srprop: '' });
      const j = await getJSON('https://en.wikipedia.org/w/api.php?' + p, f);
      for (const x of j?.query?.search || []) { const m = x.title.match(/^(.+?) \(([^)]*)\)$/); if (m && fold(m[2]).includes(fold(ql)) && !out.has(m[1])) out.set(m[1], x.title); }
    }
  }
  return out; // word -> anchor title
}

// ---------- word → meanings ----------
const baseWord = t => t.replace(/\s*\([^)]*\)\s*$/, '').trim();
const isSenseOf = (title, w) => { const b = fold(baseWord(title)); const fw = fold(w); return b === fw || b === 'the ' + fw; };
// Qualifiers that mean "this page is just a person / a name list / a sports thing", which make weak duplicates.
const WEAK_QUAL = /\((?:surname|given name|name|footballer|soccer|basketball|baseball|cricketer|rugby|wrestler|boxer|musician|singer|rapper|band|album|song|EP|politician|actor|actress|horse|racehorse|ship|disambiguation|journal|newspaper|magazine)\b/i;
const PERSON = /\b(born \d{4}|\(\d{4}[–-]\d{0,4}\)|\d{4}\s*[–-]\s*\d{4}|footballer|politician|actor|actress|singer|rapper|songwriter|basketball player|baseball player|American football|cricketer|businessman|businesswoman|wrestler|YouTuber|influencer|journalist)\b/i;
const SENSITIVE = /\b(shooting|massacre|murder|killing|assassinat|terror|genocide|sexual|abuse|suicide|death of|hostage|war crime|stabbing|bombing)\b/i;
const EVENTY = /\b(election|referendum|season|tournament|championship|World Cup|Olympics|Super Bowl|playoffs|draft|awards?|ceremony|Grand Prix)\b/i;
// Both sides being creative works (a film vs the novel it adapts, a film vs a song) is a franchise, not a duplicated word.
const WORK = /\b(film|movie|television series|TV series|miniseries|sitcom|novel|novella|book series|book|song|single|album|musical|play|opera|comic|manga|anime|episode|franchise|media franchise|soundtrack|game series)\b/i;
const SETINDEX = /^(Index of articles|Topics referred to by the same term|Disambiguation)/i;
const DERIVED = /\b(based on|adaptation of|adapted from|sequel to|remake of|spin-off|prequel)\b/i;
const TECH = /\b(software|programming|computer|computing|app|application|artificial intelligence|AI\b|language model|chatbot|machine learning|startup|company|cryptocurrency|blockchain|video game|website|online|internet|semiconductor|GPU|processor|chip|smartphone|operating system|spacecraft|rocket|satellite|streaming|social (?:media|network)|search engine|browser|cloud|data|network|robot)/i;

export async function senses(word, f) {
  const p = new URLSearchParams({ action: 'query', format: 'json', origin: '*', redirects: '1', prop: 'links|pageprops|description', pllimit: '500', plnamespace: '0', ppprop: 'disambiguation', titles: word + '|' + word + ' (disambiguation)' });
  const j = await getJSON('https://en.wikipedia.org/w/api.php?' + p, f);
  const titles = new Set();
  for (const pg of Object.values(j?.query?.pages || {})) {
    if ('missing' in pg) continue;
    const dis = pg.pageprops && 'disambiguation' in pg.pageprops;
    if (!dis && isSenseOf(pg.title, word)) titles.add(pg.title);
    if (dis) (pg.links || []).forEach(l => { if (isSenseOf(l.title, word)) titles.add(l.title); });
  }
  // the primary article itself, if "word" redirected somewhere, counts as a sense only when its title is the word
  return [...titles].filter(t => !WEAK_QUAL.test(t)).slice(0, 60);
}

export async function describe(titles, f) {
  const out = {};
  for (let i = 0; i < titles.length; i += 40) {
    const p = new URLSearchParams({ action: 'query', format: 'json', origin: '*', redirects: '1', prop: 'pageprops|description|extracts', ppprop: 'disambiguation', exintro: '1', explaintext: '1', exsentences: '2', exlimit: '20', titles: titles.slice(i, i + 40).join('|') });
    const j = await getJSON('https://en.wikipedia.org/w/api.php?' + p, f);
    const m = {}; titles.slice(i, i + 40).forEach(t => m[t] = t);
    for (const k of ['normalized', 'redirects']) (j?.query?.[k] || []).forEach(n => { for (const t in m) if (m[t] === n.from) m[t] = n.to; });
    const pages = {}; Object.values(j?.query?.pages || {}).forEach(pg => pages[pg.title] = pg);
    for (const t of titles.slice(i, i + 40)) {
      const pg = pages[m[t]];
      if (!pg || 'missing' in pg) continue;
      out[t] = { canon: pg.title, dis: !!(pg.pageprops && 'disambiguation' in pg.pageprops), desc: pg.description || '', extract: (pg.extract || '').slice(0, 400), redirected: m[t] !== t };
    }
  }
  return out;
}

export async function views12(title, f, end = lastMonthEnd()) {
  const start = new Date(Date.UTC(+end.slice(0, 4) - 1, +end.slice(4, 6), 1)).toISOString().slice(0, 10).replace(/-/g, '') + '00';
  const j = await getJSON('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/' + encodeURIComponent(title.replace(/ /g, '_')) + '/monthly/' + start + '/' + end, f);
  return j ? j.items.reduce((a, x) => a + x.views, 0) : 0;
}
export function lastMonthEnd(now = new Date()) { const d = new Date(now); d.setUTCDate(1); d.setUTCDate(0); return d.toISOString().slice(0, 10).replace(/-/g, '') + '00'; }

// ---------- one word → best competing pair ----------
export async function bestPair(word, { anchor = null, existing = new Set(), opts = DEFAULTS, f } = {}) {
  const why = r => ({ word, reject: r });
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'&+-]{0,28}$/u.test(word) || word.split(/\s+/).length > 3 || /^\d+$/.test(word)) return why('shape');
  const list = await senses(word, f);
  if (anchor && !list.includes(anchor) && isSenseOf(anchor, word)) list.unshift(anchor);
  if (list.length < 2) return why('fewer than 2 exact-title meanings');
  const info = await describe(list.slice(0, opts.maxSenses * 2), f);
  // Follow redirects ("Saw (2004 film)" -> "Saw (film)"), keep only canonical pages still titled with the word, dedupe.
  const byCanon = new Map();
  for (const [, i] of Object.entries(info)) if (!byCanon.has(i.canon) && isSenseOf(i.canon, word)) byCanon.set(i.canon, i);
  let cands = [...byCanon].filter(([t, i]) => !i.dis && !SETINDEX.test(i.desc) && !/^List of/.test(t) && !WEAK_QUAL.test(t) && !PERSON.test(i.desc) && !SENSITIVE.test(i.desc + ' ' + i.extract) && !EVENTY.test(t + ' ' + i.desc)).slice(0, opts.maxSenses);
  if (cands.length < 2) return why('fewer than 2 usable meanings after filters');
  // A trending/mined article is the reason we looked at this word; if it was filtered out, the pair isn't about it.
  const anchorCanon = anchor ? (info[anchor]?.canon || anchor) : null;
  if (anchorCanon && !cands.some(([t]) => t === anchorCanon)) return why('the trending meaning itself was filtered out');
  const v = {};
  for (const [t] of cands) { v[t] = await views12(t, f); await sleep(60); }
  cands = cands.filter(([t]) => v[t] >= opts.minViews).sort((a, b) => v[b[0]] - v[a[0]]);
  if (cands.length < 2) return why('only one meaning has real pageviews');
  // The trending article is one side; the other side is its strongest rival. Without an anchor, the top two.
  if (anchorCanon && !cands.some(([t]) => t === anchorCanon)) return why('the trending meaning has too few pageviews');
  const a = cands.find(([t]) => t === anchorCanon) || cands[0];
  const b = cands.find(([t]) => t !== a[0]);
  const ka = fold(word) + '|' + fold(a[0]), kb = fold(word) + '|' + fold(b[0]);
  if (existing.has(ka) && existing.has(kb)) return why('already on the site');
  const total = v[a[0]] + v[b[0]], share = Math.min(v[a[0]], v[b[0]]) / total;
  if (share < opts.minShare || share > opts.maxShare) return why('one meaning has already won (' + Math.round(share * 100) + '%)');
  if (WORK.test(a[1].desc) && WORK.test(b[1].desc)) return why('both sides are creative works (franchise, not duplication)');
  if ([a, b].some(([, i]) => DERIVED.test(i.extract) && i.extract.toLowerCase().includes(fold(word)))) return why('one side is an adaptation of the other');
  const tech = [a, b].some(([, i]) => TECH.test(i.desc + ' ' + i.extract));
  const competitiveness = 1 - Math.abs(0.5 - share) * 2;              // 1 = dead heat
  const volume = Math.min(1, Math.log10(total) / 7);                    // 10M+/yr = 1
  const score = +(competitiveness * 0.45 + volume * 0.3 + (tech ? 0.25 : 0)).toFixed(3);
  return { word, score, tech, share: +share.toFixed(3), total,
    senses: [a, b].map(([t, i]) => ({ title: t, views12: v[t], desc: i.desc, extract: i.extract })),
    others: cands.slice(0, 6).map(([t]) => ({ title: t, views12: v[t] })) };
}

// ---------- the daily run ----------
export async function discover({ date = new Date(Date.now() - 864e5), existing = new Set(), existingTerms = new Set(), seeds = [], backlog = [], opts = DEFAULTS, f, log = () => {} } = {}) {
  const pool = new Map(); // word -> { anchor, source }
  seeds.forEach(w => pool.set(w, { anchor: null, source: 'seed' }));
  let top = []; try { top = await wikiTop(date, f); } catch (e) { log('wiki top failed: ' + e.message); }
  for (const a of top.slice(0, opts.topN)) {
    const w = baseWord(a.title);
    if (!pool.has(w)) pool.set(w, { anchor: a.title, source: 'wikipedia-top' });
  }
  try { for (const [w, anchor] of await techMiner(date, f, opts.minerQualifiers ?? 6)) if (!pool.has(w)) pool.set(w, { anchor, source: 'tech-miner' }); } catch (e) { log('tech miner failed: ' + e.message); }
  try { (await hnWords(f)).forEach(w => pool.has(w) || pool.set(w, { anchor: null, source: 'hacker-news' })); } catch (e) { log('hn failed'); }
  try { (await googleTrends(f)).forEach(w => pool.has(w) || pool.set(w, { anchor: null, source: 'google-trends' })); } catch (e) { log('trends failed'); }
  backlog.forEach(b => pool.has(b.word) || pool.set(b.word, { anchor: null, source: 'backlog' }));
  // Cheap pre-filter: most trending articles are people or one-off events. Only words with a sibling article survive.
  const words = [...pool.keys()].filter(w => w.split(/\s+/).length <= 3 && w.length <= 30 && !/\d{4}/.test(w));
  log(`pool: ${pool.size} words, ${words.length} after shape filter`);
  const found = [], rejected = [];
  for (const w of words) {
    try {
      const r = await bestPair(w, { anchor: pool.get(w).anchor, existing, opts, f });
      (r.reject ? rejected : found).push({ ...r, source: pool.get(w).source, onSite: existingTerms.has(fold(w)) });
    } catch (e) { rejected.push({ word: w, reject: 'error ' + e.message }); }
  }
  found.sort((a, b) => b.score - a.score);
  return { found, rejected, scanned: words.length };
}

export const _test = { baseWord, isSenseOf, fold };
