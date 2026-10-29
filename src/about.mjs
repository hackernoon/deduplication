// About page + typewriter-style word art (images drawn from tiny words, à la James Cook's typewriter art).
// Every image is generated from the real term database at build time: no image files, no JS.
const AL = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const dec = (s, m) => [...(s || '')].map(c => AL.indexOf(c) / 63 * m);
const xe = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- typewriter engine ----------
// A grid of typed cells on paper. Each cell: ch, ink (k black | g green ribbon | a amber), w weight 1-4.
// Weight sets ink density; weight 4 is struck twice, slightly offset, like a re-typed key.
function rng(seed) { let x = seed >>> 0 || 1; return () => ((x ^= x << 13, x ^= x >>> 17, x ^= x << 5) >>> 0) / 4294967296; }
class Sheet {
  constructor(W, H, fs = 10, lh = 1.0) { this.W = W; this.H = H; this.fs = fs; this.cw = fs * 0.6; this.lh = fs * lh; this.cols = Math.floor(W / this.cw); this.rows = Math.floor(H / this.lh); this.g = Array.from({ length: this.rows }, () => Array(this.cols).fill(null)); }
  px(c) { return c * this.cw; } py(r) { return (r + 1) * this.lh; }
  cx(x) { return Math.round(x / this.cw); } cy(y) { return Math.round(y / this.lh - 1); }
  set(c, r, ch, ink = 'k', w = 2, force = true) { if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return; if (!force && this.g[r][c]) return; this.g[r][c] = { ch, ink, w }; }
  // stroke a line in pixel coords with a character picked from the slope (or a fixed one)
  line(x0, y0, x1, y1, { ch, ink = 'k', w = 3, step = 1 } = {}) {
    const c0 = this.cx(x0), r0 = this.cy(y0), c1 = this.cx(x1), r1 = this.cy(y1);
    const n = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0), 1), dx = (x1 - x0), dy = (y1 - y0);
    const auto = Math.abs(dy) * 1.6 < Math.abs(dx) ? '_' : Math.abs(dx) < Math.abs(dy) * 0.35 ? '!' : (dx * dy > 0 ? '\\' : '/');
    for (let i = 0; i <= n; i += step) this.set(Math.round(c0 + (c1 - c0) * i / n), Math.round(r0 + (r1 - r0) * i / n), ch || auto, ink, w);
  }
  // trace a polyline
  path(pts, o) { for (let i = 1; i < pts.length; i++) this.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], o); }
  // fill cells inside a shape with a running stream of words
  words(inside, next, { ink = 'k', w = 2, weight, gap = 1 } = {}) {
    for (let r = 0; r < this.rows; r++) {
      let c = 0;
      while (c < this.cols) {
        if (!inside(this.px(c) + this.cw / 2, this.py(r) - this.lh * 0.35)) { c++; continue; }
        const it = next(this.px(c), this.py(r)); const word = it.w;
        for (let k = 0; k < word.length && c < this.cols; k++, c++) {
          if (!inside(this.px(c) + this.cw / 2, this.py(r) - this.lh * 0.35)) break;
          this.set(c, r, word[k], it.ink || ink, weight ? weight(this.px(c), this.py(r)) : (it.w2 || w));
        }
        c += gap;
      }
    }
  }
  // sparse horizontal dashes, like a typed sky
  hatch(inside, { ch = '-', ink = 'k', w = 1, density = 0.12, seed = 7 } = {}) {
    const R = rng(seed);
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      if (this.g[r][c] || !inside(this.px(c), this.py(r))) continue;
      if (R() < density) { const len = 2 + Math.floor(R() * 4); for (let k = 0; k < len && c + k < this.cols; k++) this.set(c + k, r, ch, ink, w, false); c += len + 1; }
    }
  }
  text(x, y, str, ink = 'k', w = 3) { const c = this.cx(x), r = this.cy(y); [...str].forEach((ch, i) => this.set(c + i, r, ch, ink, w)); }
  render(label, seed = 3) {
    const R = rng(seed), op = [0, .38, .62, .84, .95];
    let base = '', over = '';
    for (let r = 0; r < this.rows; r++) {
      const row = this.g[r]; let c = 0;
      while (c < this.cols) {
        const cell = row[c]; if (!cell) { c++; continue; }
        let s = '', k = c; while (k < this.cols && row[k] && row[k].ink === cell.ink && row[k].w === cell.w && k - c < 24) { s += row[k].ch; k++; }
        const j = (R() - .5) * 0.9, o = Math.max(.25, Math.min(1, op[cell.w] + (R() - .5) * .16));
        base += `<text x="${this.px(c).toFixed(1)}" y="${(this.py(r) + j).toFixed(1)}" class="i${cell.ink}" opacity="${o.toFixed(2)}">${xe(s)}</text>`;
        if (cell.w === 4) over += `<text x="${(this.px(c) + .7).toFixed(1)}" y="${(this.py(r) + j + .5).toFixed(1)}" class="i${cell.ink}" opacity=".55">${xe(s)}</text>`;
        c = k;
      }
    }
    const fid = 'ink' + seed;
    return `<svg class="wordart typed" viewBox="0 0 ${this.W} ${this.H}" role="img" aria-label="${xe(label)}" style="font-size:${this.fs}px"><defs><filter id="${fid}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${seed}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6"/></filter></defs><rect class="paper" width="${this.W}" height="${this.H}"/><g filter="url(#${fid})">${base}${over}</g></svg>`;
  }
}
const cycler = list => { let i = 0; return () => list[i++ % list.length]; };
const inkOf = s => s == null ? 'k' : s > .6 ? 'g' : s < .4 ? 'k' : 'a';

// 1. A speech bubble typed from every term: originals on the left in black, duplicates on the right in the ribbon colour of whoever owns the word.
export function bubbleArt(terms) {
  const S = new Sheet(1000, 640, 10), cx = 500, cy = 280, rx = 470, ry = 245;
  const inEll = (x, y, k = 1) => ((x - cx) / (rx * k)) ** 2 + ((y - cy) / (ry * k)) ** 2 <= 1;
  const tail = [[265, 480], [150, 620], [420, 510]];
  const inTail = (x, y) => { const [[ax, ay], [bx, by], [qx, qy]] = tail; const s = (px, py, x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2); const d1 = s(x, y, ax, ay, bx, by), d2 = s(x, y, bx, by, qx, qy), d3 = s(x, y, qx, qy, ax, ay); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  const inside = (x, y) => (inEll(x, y, .975) || inTail(x, y)) && Math.abs(x - cx) > 9;
  // sky
  S.hatch((x, y) => !inEll(x, y, 1.04) && !inTail(x, y), { density: .05, seed: 11 });
  // outline: dotted ellipse like a cable, doubled
  const pts = []; for (let a = 0; a <= Math.PI * 2 + .01; a += .02) pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  S.path(pts, { ch: "'", w: 4 });
  S.path(tail.slice(0, 2), { w: 4 }); S.path(tail.slice(1), { w: 4 });
  const byPop = [...terms].sort((a, b) => (b.data?.w || 0) - (a.data?.w || 0));
  const L = cycler(byPop.map(t => ({ w: t.A.label.replace(/ \(.*\)$/, '') })));
  const Rt = cycler(byPop.map(t => ({ w: t.B.label.replace(/ \(.*\)$/, ''), ink: inkOf(t.data?.share) })));
  // shading: darker toward the lower right, lighter at the top left, like light falling on a form
  const shade = (x, y) => { const v = ((x - cx) / rx + (y - cy) / ry) * .5 + .5 + (Math.sin(x * .05) * .08); return v > .78 ? 4 : v > .5 ? 3 : v > .22 ? 2 : 1; };
  S.words(inside, x => x < cx ? L() : Rt(), { weight: shade });
  for (let r = S.cy(cy - ry * .97); r <= S.cy(cy + ry * .97); r++) S.set(S.cx(cx), r, '!', 'k', 4);
  return S.render('A speech bubble typed from every term in the database: original meanings on the left, duplicate meanings on the right', 3);
}

// 2. Duplication vs deduplication: two overlapping typed copies, then one canonical copy.
export function dedupeArt() {
  const S = new Sheet(1000, 360, 10);
  const box = (x0, y0, s) => (x, y) => x >= x0 && x <= x0 + s && y >= y0 && y <= y0 + s;
  const A = box(50, 30, 220), B = box(170, 90, 220), C = box(650, 55, 250);
  S.hatch((x, y) => !A(x, y) && !B(x, y) && !C(x, y) && y < 320, { density: .04, seed: 5 });
  S.words((x, y) => A(x, y) || B(x, y), (x, y) => (A(x, y) && B(x, y)) ? { w: 'same', ink: 'a', w2: 4 } : { w: 'copy', w2: A(x, y) ? 3 : 2 });
  S.words(C, () => ({ w: 'canonical', ink: 'g' }), { weight: (x, y) => (x - 650 + y - 55) / 500 > .55 ? 4 : 3 });
  const outline = (x0, y0, s, ink = 'k') => { S.line(x0, y0, x0 + s, y0, { ink, w: 4 }); S.line(x0, y0 + s, x0 + s, y0 + s, { ink, w: 4 }); S.line(x0, y0, x0, y0 + s, { ink, w: 4 }); S.line(x0 + s, y0, x0 + s, y0 + s, { ink, w: 4 }); };
  outline(50, 30, 220); outline(170, 90, 220); outline(650, 55, 250, 'g');
  S.line(450, 180, 600, 180, { ch: '-', w: 4 }); S.text(600, 180, '>', 'k', 4);
  S.text(170, 345, 'DUPLICATION', 'k', 4); S.text(705, 345, 'DEDUPLICATION', 'g', 4);
  return S.render('Two overlapping squares typed from the word copy, and an arrow to one square typed from the word canonical', 5);
}

// 3. A word changing hands, typed from its own words: real Wikipedia attention since 2015.
export function crossoverArt(term, la, lb) {
  const w = term.data.wp, A = dec(w.a, w.m), B = dec(w.b, w.m), n = A.length;
  const sm = a => a.map((_, i) => { const s = a.slice(Math.max(0, i - 2), i + 3); return s.reduce((x, y) => x + y, 0) / s.length; });
  const SA = sm(A), SB = sm(B), max = Math.max(...SA, ...SB) * 1.12;
  const S = new Sheet(1000, 460, 10), x0 = 40, x1 = 985, y0 = 20, y1 = 400;
  const X = i => x0 + (x1 - x0) * i / (n - 1), Y = v => y1 - (y1 - y0) * v / max;
  const at = (arr, x) => { const f = (x - x0) / (x1 - x0) * (n - 1), i = Math.max(0, Math.min(n - 2, Math.floor(f))), t = f - i; return arr[i] * (1 - t) + arr[i + 1] * t; };
  const under = (arr) => (x, y) => x >= x0 && x <= x1 && y <= y1 - 4 && y >= Y(at(arr, x));
  S.hatch((x, y) => y < y1 && !under(SA)(x, y) && !under(SB)(x, y), { density: .045, seed: 9 });
  // duplicate area: the new word typed in green, denser where it leads
  S.words((x, y) => under(SB)(x, y) && (at(SB, x) >= at(SA, x) || y < Y(at(SA, x))), () => ({ w: lb, ink: 'g' }), { weight: (x, y) => at(SB, x) > at(SA, x) * 1.4 ? 4 : 3 });
  // original area: the old word typed in black
  S.words((x, y) => under(SA)(x, y) && !S.g[S.cy(y)]?.[S.cx(x)], () => ({ w: la }), { weight: (x, y) => at(SA, x) > at(SB, x) ? 3 : 2 });
  // the two lines, typed as dotted cables
  S.path(SA.map((v, i) => [X(i), Y(v)]), { ch: "'", w: 4 });
  S.path(SB.map((v, i) => [X(i), Y(v)]), { ch: "'", ink: 'g', w: 4 });
  S.line(x0, y1 + 4, x1, y1 + 4, { ch: '_', w: 4 });
  let cross = -1; for (let i = 1; i < n; i++) if ((SB[i - 1] - SA[i - 1]) * (SB[i] - SA[i]) < 0) cross = i;
  const yr = i => 2015 + Math.floor((6 + i * 3) / 12);
  for (let i = 0; i < n; i++) { const m = 6 + i * 3; if (m % 12 === 0 && (2015 + m / 12) % 2 === 0) { S.text(X(i) - 12, y1 + 34, String(2015 + m / 12), 'k', 3); S.set(S.cx(X(i)), S.cy(y1 + 14), '!', 'k', 3); } }
  if (cross > 0) { for (let y = y0 + 20; y < y1; y += 10) S.set(S.cx(X(cross)), S.cy(y), ':', 'k', 3); S.text(X(cross) + 10, y0 + 10, `${lb} takes over, ${yr(cross)}`, 'k', 4); }
  return S.render(`${term.term}: Wikipedia attention to the original meaning versus the duplicate since 2015, typed with the words themselves`, 9);
}

export const DAVID_QUOTE = `Every popular word eventually gets duplicated. Somebody names a product, a protocol or a meme after a word that already meant something, and now how has the meaning of the word changed? I wanted to visualize those battles of a term's meaning with data instead of opinion. Which meaning owns the word today? And how is its internet usage changing the meaning of the word over time?`;

export function aboutBody({ terms, root, href, cats }) {
  const ex = terms.find(t => t.term === 'Vault' && t.data?.wp?.tb === 'HashiCorp');
  const nCats = cats;
  return `<main class="wrap prose about" style="padding-block:28px">
<h1 style="font:900 56px/1 var(--display);text-transform:uppercase">About Deduplication Technology</h1>
<p class="lede"><a href="${root}">deduplication.tech</a> is a <a href="https://hackernoon.com" target="_blank" rel="noopener">HackerNoon</a> project that measures what happens when one word ends up carrying two meanings, and tracks which meaning is winning.</p>
<a class="xlink" href="${root}${href('methodology/')}"><span>How we measure it</span><b>Read the methodology →</b><i>Data sources, verdict thresholds, the colour system and the limits</i></a>
<figure class="art">${bubbleArt(terms)}<figcaption>All ${terms.length} terms, typed out. Left: the original meanings. Right: the duplicates, in the ribbon colour of whoever owns the word today: <span class="k b">green</span> the duplicate, white the original, <span class="k c">amber</span> contested.</figcaption></figure>

<h2>Duplication, and deduplication</h2>
<p>In computing, <b>duplication</b> means the same thing stored twice. <b>Deduplication</b> is the clean-up: find the copies, keep one canonical version, and point everything else at it. Storage systems, databases and search engines do it constantly.</p>
<p>Language duplicates too. A word gets reused for something new (a bug in code, a cloud of servers, a Discord server) and now two meanings share one name. We call the older meaning the <b>original</b> and the newer one the <b>duplicate</b>. Deduplicating a word means working out which meaning is canonical <i>today</i>, with evidence, and keeping both on record.</p>
<figure class="art">${dedupeArt()}<figcaption>Duplication: two copies of the same thing. Deduplication: one canonical copy.</figcaption></figure>

<h2>Using data to measure language</h2>
<p>Dictionaries record what words mean. They're slower at telling you which meaning people reach for right now. So we measure behavior instead. When people meet a word they don't fully know, they look it up, and Wikipedia keeps a public count of every article view. Comparing the views for each meaning's article gives a running vote on what people mean when they hit that word: millions of small, honest signals instead of one editor's opinion.</p>
<p>Next we're adding what people <i>say</i>: spoken mentions from YouTube and from movies and TV, each labeled with the meaning it uses. The <a href="${root}${href('methodology/')}">Methodology</a> page covers the sources, the verdict thresholds and the limits.</p>

<h2>Watching words change hands</h2>
<p>Because the data runs back to 2015, we can watch a meaning take over. Take <b>vault</b>. In 2015 HashiCorp released Vault, a tool for locking away passwords and API keys. The grey is the old meaning, the bank vault. The green is the software. Every mark in the picture is the word itself, and the dashed line is where the lines cross.</p>
${ex ? `<figure class="art">${crossoverArt(ex, 'bank vault', 'Vault')}<figcaption>Wikipedia attention to <span class="k a">bank vault</span> vs <span class="k b">Vault (HashiCorp)</span> since July 2015, quarterly, smoothed. <a href="${root}${href(ex.url)}">See the full Vault page →</a></figcaption></figure>` : ''}
<p>Across ${terms.length} terms in ${nCats} fields, some duplicates have already taken over, some originals are holding on, and a few are still contested. The <a href="${root}">home page</a> shows them all at once.</p>

<h2>Made by HackerNoon</h2>
<p><a href="https://hackernoon.com" target="_blank" rel="noopener">HackerNoon</a> is an independent technology publishing platform, founded in 2016, where technologists write about what they build and what they know. Its library of tech stories averaged <a href="https://hackernoon.com/the-state-of-the-noonion-blogging-our-way-through-the-ai-boom" target="_blank" rel="noopener">4.4M monthly pageviews in Q4 2025</a>. Tech writing reuses everyday words more than almost any other writing, which makes HackerNoon a natural home for a project about words with two jobs.</p>
<h3>HackerNoon AI</h3>
<p><a href="https://hackernoon.ai" target="_blank" rel="noopener">HackerNoon AI</a> covers the AI built into the publishing platform: AI headline suggestions and editing help in the editor, AI audio narration of stories, translation into dozens of languages, and AI-content detection through a <a href="https://hackernoon.com/lite/spring-cleaning-for-tech-writers-ai-detection-developer-hackathons-and-more" target="_blank" rel="noopener">GPTZero partnership</a>, with a human editor still reviewing every story. deduplication.tech uses the same approach: models do the counting and labeling, and people check the edge cases.</p>

<blockquote class="quote"><p>“${DAVID_QUOTE}”</p><cite><a href="https://hackernoon.com/u/David" target="_blank" rel="noopener">David Smooke</a>, founder &amp; CEO, <a href="https://hackernoon.com" target="_blank" rel="noopener">HackerNoon</a></cite></blockquote>

<p class="muted">Found a duplicated word we missed? Write it up on <a href="https://hackernoon.com/new" target="_blank" rel="noopener">HackerNoon</a> and tag it #deduplication. · <a href="${root}${href('methodology/')}">Methodology</a> · <a href="${root}${href('terms/')}">All terms</a></p>
</main>`;
}
