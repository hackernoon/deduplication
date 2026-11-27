// Adds three extra sources to every term page, beyond the Wikipedia definition:
//   1. IN THEIR OWN WORDS  one sentence from the official website of a company/product/work (meta description), quoted + linked
//   2. FIRST RECORDED      the earliest dated milestone on Wikidata (founded, released, launched, published…) + IMDb/TMDB links
//   3. ON HACKERNOON       the earliest HackerNoon story that uses the word (needs HN_SEARCH_* secrets; otherwise tag + search links)
// Writes src/enrich.json, keyed by term page key ("term/original/duplicate"). build.mjs renders it.
//
//   node scripts/enrich.mjs          # only terms not yet in enrich.json
//   node scripts/enrich.mjs --all    # redo everything (monthly)
//
// Sources: Wikidata (CC0), each official website (one-sentence quote with link), HackerNoon. No API keys needed except the optional HN search.
import fs from 'node:fs';
import { get, jobs } from './refresh-data.mjs';

const ROOT = new URL('../', import.meta.url).pathname, OUT = ROOT + 'src/enrich.json';
const UA = 'deduplication.tech enrich (https://deduplication.tech; HackerNoon)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ALL = process.argv.includes('--all');

// Wikidata properties that date a thing's first appearance, with the verb we show.
export const DATE_PROPS = [['P577', 'Released'], ['P1191', 'First performed'], ['P571', 'Founded'], ['P606', 'First flight'], ['P619', 'Launched'],
  ['P575', 'Discovered'], ['P580', 'Started'], ['P1619', 'Opened'], ['P729', 'In service'], ['P585', 'Happened'], ['P569', 'Born']];

export function firstDate(claims) {
  let best = null;
  for (const [p, verb] of DATE_PROPS) {
    if (!verb) continue;
    for (const c of claims?.[p] || []) {
      const v = c.mainsnak?.datavalue?.value; if (!v || !v.time) continue;
      const m = v.time.match(/^([+-])(\d+)-(\d\d)-(\d\d)/); if (!m) continue;
      const year = (m[1] === '-' ? -1 : 1) * +m[2];
      const prec = v.precision; // 9 = year, 10 = month, 11 = day
      const sortKey = year * 10000 + (+m[3] || 0) * 100 + (+m[4] || 0);
      if (!best || sortKey < best.sortKey) best = { verb, prop: p, year, month: prec >= 10 ? +m[3] : null, day: prec >= 11 ? +m[4] : null, sortKey };
    }
  }
  if (!best) return null;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const y = best.year < 0 ? Math.abs(best.year) + ' BC' : String(best.year);
  const text = best.day ? `${best.day} ${MONTHS[best.month - 1]} ${y}` : best.month ? `${MONTHS[best.month - 1]} ${y}` : y;
  return { verb: best.verb, date: text, year: best.year };
}
const str = (claims, p) => claims?.[p]?.[0]?.mainsnak?.datavalue?.value;

// One clean sentence from a homepage's meta description, or null.
export function ownWords(html) {
  const pick = re => { const m = html.match(re); return m ? m[1] : null; };
  let d = pick(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']{20,400})["']/i) || pick(/<meta[^>]+content=["']([^"']{20,400})["'][^>]*name=["']description["']/i)
    || pick(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']{20,400})["']/i) || pick(/<meta[^>]+content=["']([^"']{20,400})["'][^>]*property=["']og:description["']/i);
  if (!d) return null;
  d = d.replace(/&amp;/g, '&').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
  if (/cookie|javascript|enable js|access denied|just a moment|captcha|403|404|page not found|sign in to/i.test(d)) return null;
  const first = (d.match(/^.{20,220}?[.!?](\s|$)/) || [d])[0].trim();
  if (first.length < 20) return null;
  return first.length > 220 ? first.slice(0, 217).replace(/\s+\S*$/, '') + '…' : first;
}

async function fetchHome(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(9000) });
    if (!r.ok || !/html/i.test(r.headers.get('content-type') || '')) return null;
    return (await r.text()).slice(0, 200000);
  } catch (e) { return null; }
}

// Optional: earliest HackerNoon story. Set HN_SEARCH_APP, HN_SEARCH_KEY (search-only) and HN_SEARCH_INDEX in repo secrets.
async function hackernoonFirst(term) {
  const { HN_SEARCH_APP: app, HN_SEARCH_KEY: key, HN_SEARCH_INDEX: index } = process.env;
  if (!app || !key || !index) return null;
  try {
    const r = await fetch(`https://${app.toLowerCase()}-dsn.algolia.net/1/indexes/${encodeURIComponent(index)}/query`, {
      method: 'POST', headers: { 'X-Algolia-API-Key': key, 'X-Algolia-Application-Id': app, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `"${term}"`, hitsPerPage: 200, restrictSearchableAttributes: ['title'], attributesToRetrieve: ['title', 'slug', 'url', 'publishedAt', 'published_at', 'createdAt', 'created_at'] }) });
    if (!r.ok) return null;
    const hits = (await r.json()).hits || [];
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const dated = hits.filter(h => re.test(h.title || '')).map(h => ({ h, t: new Date(h.publishedAt || h.published_at || h.createdAt || h.created_at || 0).getTime() })).filter(x => x.t > 0).sort((a, b) => a.t - b.t);
    if (!dated.length) return null;
    const { h, t } = dated[0];
    const url = h.url || (h.slug ? 'https://hackernoon.com/' + h.slug : null);
    return url ? { title: h.title, url, year: new Date(t).getUTCFullYear(), total: hits.filter(x => re.test(x.title || '')).length } : null;
  } catch (e) { return null; }
}

async function wikidataFor(titles) {
  // Wikipedia title -> Wikidata entity (claims + description)
  const qid = {};
  for (let i = 0; i < titles.length; i += 50) {
    const b = titles.slice(i, i + 50);
    const p = new URLSearchParams({ action: 'query', format: 'json', redirects: '1', prop: 'pageprops', ppprop: 'wikibase_item', titles: b.join('|') });
    const j = await get('https://en.wikipedia.org/w/api.php?' + p);
    const m = {}; b.forEach(t => m[t] = t);
    for (const k of ['normalized', 'redirects']) (j.query[k] || []).forEach(n => { for (const t in m) if (m[t] === n.from) m[t] = n.to; });
    const pages = {}; Object.values(j.query.pages || {}).forEach(pg => pages[pg.title] = pg);
    b.forEach(t => { const q = pages[m[t]]?.pageprops?.wikibase_item; if (q) qid[t] = q; });
    await sleep(100);
  }
  const ids = [...new Set(Object.values(qid))], ent = {};
  for (let i = 0; i < ids.length; i += 50) {
    const p = new URLSearchParams({ action: 'wbgetentities', format: 'json', ids: ids.slice(i, i + 50).join('|'), props: 'claims|descriptions', languages: 'en' });
    const j = await get('https://www.wikidata.org/w/api.php?' + p);
    Object.assign(ent, j.entities || {});
    await sleep(150);
  }
  const out = {}; for (const t in qid) out[t] = { qid: qid[t], ...(ent[qid[t]] || {}) };
  return out;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const have = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const { execFileSync } = await import('node:child_process');
  execFileSync('node', [ROOT + 'build.mjs', '--terms-jsonl', ROOT + '.terms.jsonl'], { cwd: ROOT, env: { ...process.env, SKIP_WIKI: '1' }, stdio: 'ignore' });
  const termOf = Object.fromEntries(fs.readFileSync(ROOT + '.terms.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(t => [t.key, t.term]));
  fs.unlinkSync(ROOT + '.terms.jsonl');
  const list = jobs().filter(([k]) => ALL || !have[k]);
  console.log('enrich:', list.length, 'terms to enrich');
  const titles = [...new Set(list.flatMap(([, , , wa, wb]) => [wa, wb]).filter(Boolean))];
  const wd = await wikidataFor(titles);
  const homeCache = {};
  const side = async wiki => {
    const e = wd[wiki]; if (!e) return null;
    const c = e.claims || {};
    const o = { qid: e.qid };
    const fd = firstDate(c); if (fd) o.first = fd;
    const imdb = str(c, 'P345'), tmdbM = str(c, 'P4947'), tmdbT = str(c, 'P4983');
    if (imdb) o.imdb = 'https://www.imdb.com/title/' + imdb + '/';
    if (tmdbM) o.tmdb = 'https://www.themoviedb.org/movie/' + tmdbM;
    else if (tmdbT) o.tmdb = 'https://www.themoviedb.org/tv/' + tmdbT;
    const site = str(c, 'P856');
    if (site && /^https?:\/\//.test(site)) {
      if (!(site in homeCache)) homeCache[site] = ownWords((await fetchHome(site)) || '');
      if (homeCache[site]) o.own = { quote: homeCache[site], url: site, domain: new URL(site).hostname.replace(/^www\./, '') };
    }
    return o;
  };
  let n = 0;
  for (const [k, , , wa, wb] of list) {
    const [A, B] = await Promise.all([side(wa), side(wb)]);
    const hn = await hackernoonFirst(termOf[k] || k.split('/')[0]);
    have[k] = { A, B, hn, at: new Date().toISOString().slice(0, 10) };
    if (++n % 50 === 0) { fs.writeFileSync(OUT, JSON.stringify(have)); console.log('  ', n); }
  }
  fs.writeFileSync(OUT, JSON.stringify(have));
  const c = Object.values(have);
  console.log(`enrich: done. own words ${c.filter(x => x.A?.own || x.B?.own).length}, first recorded ${c.filter(x => x.A?.first || x.B?.first).length}, earliest HackerNoon story ${c.filter(x => x.hn).length} of ${c.length}`);
}
