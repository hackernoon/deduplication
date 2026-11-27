// deduplication.tech — daily publisher.
// Takes the next N terms an editor ACCEPTED at deduplication.tech/admin and turns each into a row in src/terms-auto.txt.
//
//   node scripts/publish-queue.mjs              # publish up to DAILY_LIMIT (default 50)
//   node scripts/publish-queue.mjs --limit 5
//   node scripts/publish-queue.mjs --dry-run
//
// Which meaning is the original: the one Wikidata dates earlier (founded / released / launched…). If Wikidata has no date
// for either, the plain-titled article ("Heat") is the original and the qualified one ("Heat (1995 film)") the duplicate.
// The one-line note comes from the two Wikipedia short descriptions; definitions fill from Wikipedia at build time.
// Edit any of it later with the Edit button on the live page (admins only).
import fs from 'node:fs';
import { wikidataFor, firstDate } from './enrich.mjs';

const ROOT = new URL('../', import.meta.url).pathname, Q = ROOT + 'discovery/queue.json', OUT = ROOT + 'src/terms-auto.txt';
const arg = (k, d) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d;
const LIMIT = +arg('--limit', process.env.DAILY_LIMIT || 50);
const DRY = process.argv.includes('--dry-run');
const fold = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const slug = s => fold(s).replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clean = s => String(s ?? '').replace(/[|\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const CATS = ['ai', 'code', 'infra', 'data', 'design', 'security', 'hardware', 'crypto', 'business', 'fintech', 'internet', 'gaming', 'science', 'media'];

// Label: the article title, with a leading "The " dropped only when the word itself doesn't start with "The".
export const label = (title, word) => /^the /i.test(title) && !/^the /i.test(word) ? title.replace(/^The /, 'The ') : title;
export function orient(item, wd) {
  const a = { ...item.A, first: firstDate(wd[item.A.title]?.claims || {}) }, b = { ...item.B, first: firstDate(wd[item.B.title]?.claims || {}) };
  let [orig, dup] = [a, b];
  if (a.first && b.first) { if (b.first.year < a.first.year) [orig, dup] = [b, a]; }
  else if (/\(/.test(a.title) && !/\(/.test(b.title)) [orig, dup] = [b, a];
  else if (!a.first && b.first && b.first.year < 1900) [orig, dup] = [b, a];
  return [orig, dup];
}
export function fallbackRow(item, orig, dup) {
  const yr = s => s.first ? (s.first.year < 1500 ? 'ancient' : String(s.first.year)) : '';
  const note = orig.desc && dup.desc ? `${cap(orig.desc)} vs. ${dup.desc.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase())}.` : '';
  return [item.word, item.cat, label(orig.title, item.word), orig.title, yr(orig), label(dup.title, item.word), dup.title, yr(dup), note, '', '', '', ''];
}

if (import.meta.url === 'file://' + process.argv[1]) {
  if (!fs.existsSync(Q)) { console.log('publish-queue: no queue yet'); process.exit(0); }
  const queue = JSON.parse(fs.readFileSync(Q, 'utf8'));
  // Oldest acceptance first, so the publishing order matches what /admin shows.
  const next = queue.items.filter(i => i.status === 'accepted').sort((a, b) => (a.acceptedAt || '').localeCompare(b.acceptedAt || '') || b.score - a.score).slice(0, LIMIT);
  console.log(`publish-queue: ${queue.items.filter(i => i.status === 'accepted').length} accepted, publishing ${next.length}`);
  if (!next.length) process.exit(0);
  const wd = await wikidataFor([...new Set(next.flatMap(i => [i.A.title, i.B.title]))]);
  const existingKeys = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(l => l && !l.startsWith('#')).map(l => { const c = l.split('|'); return slug(c[0]) + '/' + slug(c[2]) + '/' + slug(c[5]); }) : []);
  const rows = [], today = new Date().toISOString().slice(0, 10);
  for (const item of next) {
    if (!CATS.includes(item.cat)) item.cat = 'internet';
    const [orig, dup] = orient(item, wd);
    const row0 = fallbackRow(item, orig, dup);
    let row = row0.map(clean);
    const key = slug(row[0]) + '/' + (slug(row[2]) || 'original') + '/' + (slug(row[5]) || 'duplicate');
    if (existingKeys.has(key)) { item.status = 'published'; item.publishedAt = today; item.url = 'term/' + key + '/'; continue; }
    existingKeys.add(key); rows.push(row.join('|'));
    item.status = 'published'; item.publishedAt = today; item.url = 'term/' + key + '/';
    console.log('  +', key);
  }
  if (DRY) { console.log(rows.join('\n')); process.exit(0); }
  if (rows.length) fs.appendFileSync(OUT, `# ${today} · published from the /admin queue\n` + rows.join('\n') + '\n');
  queue.updated = new Date().toISOString();
  fs.writeFileSync(Q, JSON.stringify(queue));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${rows.length}\n`);
  console.log(`publish-queue: published ${rows.length}`);
}
