// deduplication.tech — automatic editor (no AI calls). Decides every pending candidate in discovery/queue.json from data alone,
// with a deliberately high bar. Anything that slips through gets fixed or removed by an admin (Edit button on each live page).
//
//   node scripts/review-queue.mjs            # review pending items not reviewed yet
//   node scripts/review-queue.mjs --dry-run
//
// AUTO-ACCEPT only if ALL of these hold:
//   1. Real traffic on both sides: each meaning ≥ 50K Wikipedia views in the last 12 months, ≥ 300K combined.
//   2. A real fight: the newer meaning holds 15–85% of combined views.
//   3. New to the site: the word isn't already a term.
//   4. Different kinds of thing: on Wikidata the two aren't the same type (two films, two companies, two people…).
//   5. Not the same family: Wikidata doesn't link them (company vs. its product, franchise vs. its film, a sequel…).
//   6. No people: neither side is a human being (Wikidata "instance of: human").
// AUTO-REJECT if 5 or 6 fails. Anything else stays pending: it never publishes unless someone accepts it at /admin.
import fs from 'node:fs';
import { wikidataFor } from './enrich.mjs';

const ROOT = new URL('../', import.meta.url).pathname, Q = ROOT + 'discovery/queue.json';
const DRY = process.argv.includes('--dry-run');
export const BAR = { minEach: +(process.env.MIN_VIEWS_EACH || 50000), minTotal: +(process.env.MIN_VIEWS_TOTAL || 300000), minShare: 0.15, maxShare: 0.85 };

export function dataBar(i) {
  const lo = Math.min(i.A.views, i.B.views);
  if (lo < BAR.minEach) return `one meaning has only ${lo.toLocaleString('en-US')} views/yr`;
  if (i.total < BAR.minTotal) return `only ${i.total.toLocaleString('en-US')} combined views/yr`;
  if (i.share < BAR.minShare || i.share > BAR.maxShare) return `not close enough (${Math.round(i.share * 100)}/${100 - Math.round(i.share * 100)})`;
  if (i.onSite) return 'word already on the site';
  return null;
}
const ids = (e, p) => (e?.claims?.[p] || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
// Properties that mean "same family", checked in both directions. P138 (named after) is deliberately NOT here.
const FAMILY = ['P144', 'P361', 'P527', 'P279', 'P31', 'P127', 'P749', 'P355', 'P178', 'P176', 'P123', 'P155', 'P156', 'P4969', 'P8345', 'P179', 'P1269', 'P2860'];
export function sameFamily(ea, eb) {
  if (!ea?.qid || !eb?.qid) return null;
  for (const [x, y] of [[ea, eb], [eb, ea]]) for (const p of FAMILY) if (ids(x, p).includes(y.qid)) return `Wikidata links the two (${p})`;
  return null;
}
export const isHuman = e => ids(e, 'P31').includes('Q5');
export function sameKind(ea, eb) {
  const a = new Set(ids(ea, 'P31')), b = ids(eb, 'P31');
  return a.size && b.length && b.some(x => a.has(x)) ? 'both are the same kind of thing on Wikidata' : null;
}

if (import.meta.url === 'file://' + process.argv[1]) {
  if (!fs.existsSync(Q)) { console.log('review-queue: no queue'); process.exit(0); }
  const queue = JSON.parse(fs.readFileSync(Q, 'utf8'));
  const todo = queue.items.filter(i => i.status === 'pending' && !i.review);
  console.log(`review-queue: ${todo.length} pending items to review`);
  const wd = await wikidataFor([...new Set(todo.flatMap(i => [i.A.title, i.B.title]))]);
  const today = new Date().toISOString().slice(0, 10); let acc = 0, rej = 0, held = 0, n = 0;
  for (const i of todo) {
    const ea = wd[i.A.title], eb = wd[i.B.title];
    const hard = sameFamily(ea, eb) || (isHuman(ea) || isHuman(eb) ? 'one side is a person' : null);
    const soft = dataBar(i) || sameKind(ea, eb) || (!ea || !eb ? 'missing on Wikidata' : null);
    i.review = { at: today, verdict: hard ? 'rejected' : soft ? 'pending' : 'accepted', reason: hard || soft || 'cleared the auto bar' };
    if (hard) { i.status = 'rejected'; i.reviewedBy = 'auto'; rej++; }
    else if (!soft) { i.status = 'accepted'; i.acceptedAt = new Date(Date.now() + n).toISOString(); i.reviewedBy = 'auto'; acc++; }
    else held++;
    n++;
  }
  console.log(`review-queue: ${acc} auto-accepted, ${rej} auto-rejected, ${held} held for a human (they never publish on their own)`);
  if (!DRY) { queue.updated = new Date().toISOString(); fs.writeFileSync(Q, JSON.stringify(queue)); }
}
