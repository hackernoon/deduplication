/* deduplication.tech client — pulls live evidence from public APIs */
(function () {
  const D = {}; Object.assign(D, window.DEDUP || {}); D.index = window.DEDUP_INDEX || D.index;
  const $ = (s, r = document) => r.querySelector(s);
  const el = (t, a = {}, h = '') => { const e = document.createElement(t); for (const k in a) e.setAttribute(k, a[k]); if (h) e.innerHTML = h; return e; };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => n == null ? '—' : n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ROOT_ = () => D.root || '';
  const WAPI = 'https://en.wikipedia.org/w/api.php';
  const PV = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/';

  async function j(url) {
    const r = await fetch(url, { headers: { 'Api-User-Agent': 'deduplication.tech (HackerNoon)' } });
    if (!r.ok) throw new Error(r.status + ' ' + url);
    return r.json();
  }
  function lastMonthEnd() {
    const d = new Date(); d.setUTCDate(1); d.setUTCDate(0);
    return d.toISOString().slice(0, 10).replace(/-/g, '') + '00';
  }

  /* ---------- search (every page) ---------- */
  function initSearch() { document.querySelectorAll('.search input').forEach(bindSearch); }
  function bindSearch(input) {
    const box = input.parentElement.querySelector('.results');
    if (!box || !D.index) return;
    const idx = D.index;
    const run = () => {
      const v = input.value.trim().toLowerCase();
      if (!v) { box.hidden = true; box.innerHTML = ''; return; }
      const hits = idx.filter(t => (t.t + ' ' + t.a + ' ' + t.b).toLowerCase().includes(v))
        .sort((x, y) => (x.t.toLowerCase().startsWith(v) ? -1 : 0) - (y.t.toLowerCase().startsWith(v) ? -1 : 0)).slice(0, 12);
      box.innerHTML = hits.length ? hits.map(h => `<a href="${ROOT_()}${h.u}"><b>${esc(h.t)}</b><span class="l">${esc(h.a)}</span><span class="vs">vs</span><span class="r">${esc(h.b)}</span></a>`).join('')
        : `<div class="none">No term matches “${esc(input.value)}”. Try an acronym like PR, AI or MTS.</div>`;
      box.hidden = false;
    };
    input.addEventListener('input', run);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { const a = box.querySelector('a'); if (a) location.href = a.href; } if (e.key === 'Escape') { input.value = ''; run(); } });
    if (input.id === 'q') document.addEventListener('keydown', e => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); input.focus(); } });
  }

  /* ---------- word cloud (home) ---------- */
  async function initCloud() {
    const cloud = $('#cloud'); if (!cloud || !D.index) return;
    const idx = D.index.slice();
    // live weights: last 60 days of Wikipedia pageviews for both senses
    const baked = idx.some(t => t.s != null);
    const titles = baked ? [] : [...new Set(idx.flatMap(t => [t.wa, t.wb]).filter(Boolean))];
    const views = {};
    try {
      for (let i = 0; i < titles.length; i += 50) {
        const batch = titles.slice(i, i + 50);
        let cont = {};
        for (let guard = 0; guard < 6; guard++) {
          const q = new URLSearchParams({ action: 'query', format: 'json', origin: '*', prop: 'pageviews', pvipdays: '30', redirects: '1', titles: batch.join('|'), ...cont });
          const r = await j(WAPI + '?' + q);
          const map = {};
          (r.query?.redirects || []).forEach(x => map[x.to] = x.from);
          (r.query?.normalized || []).forEach(x => map[x.to] = map[x.to] || x.from);
          Object.values(r.query?.pages || {}).forEach(p => {
            const s = Object.values(p.pageviews || {}).reduce((a, b) => a + (b || 0), 0);
            const key = map[p.title] ? map[map[p.title]] || map[p.title] : p.title;
            views[p.title] = (views[p.title] || 0) + s; views[key] = (views[key] || 0) + s;
          });
          if (r.continue) cont = r.continue; else break;
        }
      }
    } catch (e) { cloud.dataset.offline = '1'; }
    idx.forEach(t => {
      if (baked) { t.w = t.w || 0; t.share = t.s == null ? null : t.s; return; }
      const a = views[t.wa] || 0, b = views[t.wb] || 0;
      t.w = a + b; t.share = a + b ? b / (a + b) : 0.5;
    });
    if (baked) views.__baked = 1;
    const max = Math.max(1, ...idx.map(t => t.w));
    idx.sort((x, y) => y.w - x.w || x.t.localeCompare(y.t));
    cloud.innerHTML = '';
    idx.forEach((t, i) => {
      const s = t.w ? 0.8 + 3.2 * Math.sqrt(t.w / max) : 0.8 + (i % 5) * 0.25;
      const side = t.share == null ? 'none' : t.share > 0.6 ? 'dup' : t.share < 0.4 ? 'orig' : 'tie';
      const a = el('a', { href: ROOT_() + t.u, class: 'w ' + side, style: `font-size:${s.toFixed(2)}rem`, title: `${t.a} vs ${t.b}${t.share != null ? ' — ' + Math.round(t.share * 100) + '% of attention goes to the duplicate' : ' — no usable data yet'}` }, esc(t.t));
      cloud.appendChild(a);
    });
    const kids = [...cloud.children];
    for (let i = kids.length - 1; i > 0; i -= 2) { const k = (i * 7919) % (i + 1); cloud.insertBefore(kids[i], kids[k]); }
    const st = $('#cloud-status');
    if (st) st.textContent = baked ? 'Sized and coloured by 12 months of Wikipedia pageviews · snapshot Oct 2026' : Object.keys(views).length ? `Sized by Wikipedia pageviews over the last 30 days · live` : 'Live sizing unavailable here — open deduplication.tech to load Wikipedia pageviews';
    // leaderboards
    const lb = $('#leaders');
    if (lb && Object.keys(views).length) {
      const contested = idx.filter(t => t.w > max * 0.002).sort((x, y) => Math.abs(x.share - .5) - Math.abs(y.share - .5)).slice(0, 10);
      const dupWins = idx.filter(t => t.w > max * 0.002).sort((x, y) => y.share - x.share).slice(0, 10);
      const origWins = idx.filter(t => t.w > max * 0.002).sort((x, y) => x.share - y.share).slice(0, 10);
      const row = t => `<a href="${ROOT_()}${t.u}"><span class="tk">${esc(t.t)}</span><span class="bar"><i style="width:${(t.share * 100).toFixed(1)}%"></i></span><span class="pct">${Math.round(t.share * 100)}%</span></a>`;
      lb.innerHTML = `<section><h3>Most contested</h3><p>Closest to a 50/50 split</p>${contested.map(row).join('')}</section>
        <section><h3>Duplicate took over</h3><p>New meaning owns the word</p>${dupWins.map(row).join('')}</section>
        <section><h3>Original holds</h3><p>Old meaning still wins</p>${origWins.map(row).join('')}</section>`;
    }
  }


  /* ---------- tug-of-war field: each word settles on the side that owns it ---------- */
  function tugField(cloud, idx, max) {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    cloud.innerHTML = '';
    cloud.classList.add('tug');
    const head = el('div', { class: 'tug-head', 'aria-hidden': 'true' }, '<span class="l">← Original owns the word</span><span class="c">Contested</span><span class="r">Duplicate owns the word →</span>');
    const stage = el('div', { class: 'tug-stage' });
    const seam = el('div', { class: 'tug-seam', 'aria-hidden': 'true' });
    stage.appendChild(seam);
    cloud.appendChild(head); cloud.appendChild(stage);
    const W = stage.clientWidth || 1200, narrow = W < 640;
    const minF = narrow ? 9 : 11, maxF = narrow ? 24 : 48;
    const words = idx.map((t, i) => {
      const f = t.w ? minF + (maxF - minF) * Math.sqrt(t.w / max) : minF;
      const share = t.share == null ? 0.5 : t.share;
      const side = share > 0.6 ? 'dup' : share < 0.4 ? 'orig' : 'tie';
      const a = el('a', { href: ROOT_() + t.u, class: 'tw ' + side, style: `font-size:${f.toFixed(1)}px` }, esc(t.t));
      a.dataset.tip = `${t.a} ${Math.round((1 - share) * 100)}% · ${Math.round(share * 100)}% ${t.b}`;
      a.setAttribute('aria-label', `${t.t}: ${t.a} ${Math.round((1 - share) * 100)} percent, ${t.b} ${Math.round(share * 100)} percent`);
      stage.appendChild(a);
      return { a, t, share, f };
    });
    // measure, then place: x from share, y searched outward from the middle row
    const pad = 5, margin = 8, placed = [];
    const hit = (x, y, w, h) => placed.some(r => x < r.x + r.w + pad && x + w + pad > r.x && y < r.y + r.h + pad && y + h + pad > r.y);
    let H = narrow ? 520 : 600;
    words.forEach((o, i) => {
      const w = o.a.offsetWidth, h = o.a.offsetHeight;
      const jitter = (((i * 9301 + 49297) % 233280) / 233280 - 0.5) * 0.08;
      let cx = margin + Math.min(1, Math.max(0, o.share + jitter)) * (W - 2 * margin);
      let x = Math.max(margin, Math.min(W - margin - w, cx - w / 2));
      let y = null;
      for (let r = 0; r < 4000 && y == null; r += 6) {
        for (const dir of [1, -1]) {
          const yy = H / 2 - h / 2 + dir * r;
          if (yy < 4) continue;
          for (const dx of [0, -14, 14, -28, 28]) {
            const xx = Math.max(margin, Math.min(W - margin - w, x + dx));
            if (!hit(xx, yy, w, h)) { x = xx; y = yy; break; }
          }
          if (y != null) break;
        }
      }
      if (y == null) y = H;
      placed.push({ x, y, w, h });
      o.x = x; o.y = y; o.w = w; o.h = h;
    });
    const minY = Math.min(...placed.map(r => r.y)), maxY = Math.max(...placed.map(r => r.y + r.h));
    const top = 14 - minY; H = maxY - minY + 28;
    stage.style.height = H + 'px';
    const cxSeam = W / 2;
    words.forEach((o, i) => {
      o.y += top;
      o.sx = cxSeam - o.w / 2; o.sy = o.y; // start on the seam, then drift out
      o.ph = (i * 2.399) % (Math.PI * 2); o.sp = 0.25 + ((i * 37) % 40) / 100; o.amp = 2 + (o.f / maxF) * 3;
      o.a.style.transform = `translate(${(reduce ? o.x : o.sx).toFixed(1)}px,${o.y.toFixed(1)}px)`;
    });
    if (reduce) return;
    const t0 = performance.now();
    const ease = k => 1 - Math.pow(1 - k, 3);
    let hover = null;
    stage.addEventListener('mouseover', e => { const a = e.target.closest('.tw'); hover = a || null; });
    stage.addEventListener('mouseleave', () => hover = null);
    function frame(now) {
      if (!document.body.contains(stage)) return;
      const el2 = (now - t0) / 1000;
      words.forEach((o, i) => {
        const settle = ease(Math.min(1, Math.max(0, (el2 - (i % 60) * 0.012) / 1.8)));
        const bx = o.sx + (o.x - o.sx) * settle;
        // a tug: words lean toward the seam and back, more for contested words
        const pull = (o.share > 0.4 && o.share < 0.6 ? 6 : 3) * Math.sin(el2 * o.sp + o.ph);
        const dirToSeam = (o.x + o.w / 2) < cxSeam ? 1 : -1;
        const dx = settle * pull * dirToSeam, dy = settle * o.amp * 0.5 * Math.cos(el2 * o.sp * 0.8 + o.ph);
        o.a.style.transform = `translate(${(bx + dx).toFixed(1)}px,${(o.y + dy).toFixed(1)}px)` + (hover === o.a ? ' scale(1.25)' : '');
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- charts ---------- */
  function lineChart(host, series, opts = {}) {
    if (!host) return;
    const W = 920, H = opts.h || 280, P = { l: 56, r: 16, t: 16, b: 30 };
    const n = series[0].values.length; if (!n) return;
    const maxV = Math.max(1, ...series.flatMap(s => s.values));
    const x = i => P.l + (W - P.l - P.r) * (n === 1 ? 0 : i / (n - 1));
    const y = v => P.t + (H - P.t - P.b) * (1 - v / maxV);
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = maxV * k / 4; g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${P.l - 8}" y="${y(v) + 4}" class="ax" text-anchor="end">${fmt(v)}</text>`; }
    const labels = opts.labels || [];
    const step = Math.ceil(n / 10);
    labels.forEach((L, i) => { if (i % step === 0) g += `<text x="${x(i)}" y="${H - 8}" class="ax" text-anchor="middle">${esc(L)}</text>`; });
    if (opts.mark != null) g += `<line x1="${x(opts.mark)}" x2="${x(opts.mark)}" y1="${P.t}" y2="${H - P.b}" class="mark"/><text x="${x(opts.mark) + 6}" y="${P.t + 12}" class="marktxt">${esc(opts.markLabel || '')}</text>`;
    series.forEach(s => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
      if (opts.bars) {
        const bw = Math.max(2, (W - P.l - P.r) / n / series.length - 2);
        s.values.forEach((v, i) => { const off = series.indexOf(s) * bw - bw * series.length / 2; g += `<rect x="${x(i) + off}" y="${y(v)}" width="${bw}" height="${H - P.b - y(v)}" class="${s.cls}"/>`; });
      } else {
        g += `<path d="${d}L${x(n - 1)},${H - P.b}L${x(0)},${H - P.b}Z" class="area ${s.cls}"/><path d="${d}" class="line ${s.cls}"/>`;
        const li = n - 1; g += `<circle cx="${x(li)}" cy="${y(s.values[li])}" r="4" class="dot ${s.cls}"/>`;
      }
    });
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || 'chart')}">${g}<rect class="hover" x="${P.l}" y="${P.t}" width="${W - P.l - P.r}" height="${H - P.t - P.b}" fill="transparent"/></svg><div class="tip" hidden></div>`;
    const svg = host.querySelector('svg'), tip = host.querySelector('.tip');
    svg.addEventListener('mousemove', e => {
      const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(n - 1, Math.round((px - P.l) / (W - P.l - P.r) * (n - 1))));
      tip.hidden = false; tip.style.left = Math.min(r.width - 170, (e.clientX - r.left) + 12) + 'px';
      tip.innerHTML = `<b>${esc(labels[i] || '')}</b>` + series.map(s => `<div class="${s.cls}">${esc(s.name)}: ${fmt(s.values[i])}</div>`).join('');
    });
    svg.addEventListener('mouseleave', () => tip.hidden = true);
  }

  /* ---------- term page ---------- */
  async function wikiInfo(titles) {
    titles = titles.filter(Boolean); if (!titles.length) return {};
    const q = new URLSearchParams({ action: 'query', format: 'json', origin: '*', redirects: '1', prop: 'extracts|info|pageprops', exintro: '1', explaintext: '1', exsentences: '3', inprop: 'url', titles: titles.join('|') });
    const r = await j(WAPI + '?' + q);
    const canon = {};
    titles.forEach(t => canon[t] = t);
    (r.query?.normalized || []).forEach(n => Object.keys(canon).forEach(k => { if (canon[k] === n.from) canon[k] = n.to; }));
    (r.query?.redirects || []).forEach(n => Object.keys(canon).forEach(k => { if (canon[k] === n.from) canon[k] = n.to; }));
    const pages = {}; Object.values(r.query?.pages || {}).forEach(p => pages[p.title] = p);
    const out = {}; titles.forEach(t => out[t] = pages[canon[t]] || null);
    return out;
  }
  async function pageviews(title) {
    const t = encodeURIComponent(title.replace(/ /g, '_'));
    const r = await j(`${PV}${t}/monthly/2015070100/${lastMonthEnd()}`);
    return r.items.map(it => ({ m: it.timestamp.slice(0, 6), v: it.views }));
  }
  function snippet(text, q) {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    const s = Math.max(0, i - 140), e = Math.min(text.length, (i < 0 ? 0 : i) + q.length + 160);
    let out = (s ? '…' : '') + text.slice(s, e) + (e < text.length ? '…' : '');
    out = esc(out); if (i >= 0) out = out.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), m => `<mark>${m}</mark>`);
    return out;
  }
  const ma = (arr, k = 3) => arr.map((_, i) => { const s = arr.slice(Math.max(0, i - k + 1), i + 1); return s.reduce((a, b) => a + b, 0) / s.length; });


  /* ---------- baked snapshot (Google Trends + Wikipedia, collected in a real browser) ---------- */
  const AL = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  const dec = (str, max) => [...(str || '')].map(c => AL.indexOf(c) / 63 * max);
  function qLabels(startYM, n) { let y = +startYM.slice(0, 4), m = +startYM.slice(4) - 1; const out = []; for (let i = 0; i < n; i++) { out.push(`Q${Math.floor(m / 3) + 1} ${String(y).slice(2)}`); m += 3; if (m > 11) { m -= 12; y++; } } return out; }
  function renderBaked(T) {
    const d = T.data; if (!d) return false;
    let share = null, cross = null, crossLabel = '', drift = null, src = '';
    if (d.tr && (d.tr.a || d.tr.b)) {
      const A = dec(d.tr.a, 100), B = dec(d.tr.b, 100), L = qLabels(d.tr.s, A.length);
      const sA = ma(A, 2), sB = ma(B, 2);
      let dir = null;
      for (let i = 1; i < A.length; i++) { const d0 = sB[i - 1] - sA[i - 1], d1 = sB[i] - sA[i]; if (Math.sign(d0) !== Math.sign(d1) && d1 !== 0 && (sA[i] + sB[i]) > 2) { cross = i; dir = d1 > 0 ? 'dup' : 'orig'; } }
      crossLabel = cross != null ? L[cross] : '';
      lineChart($('#chart-tr'), [{ name: T.A.q, values: A, cls: 'sa' }, { name: T.B.q, values: B, cls: 'sb' }], { labels: L, mark: cross, markLabel: cross != null ? (dir === 'dup' ? 'Duplicate overtakes' : 'Original retakes') + ' · ' + L[cross] : '', aria: 'Google Trends interest' });
      const sh = L.map((_, i) => (sA[i] + sB[i]) ? 100 * sB[i] / (sA[i] + sB[i]) : 50);
      lineChart($('#chart-share'), [{ name: 'Duplicate share %', values: sh, cls: 'sb' }], { labels: L, h: 180, aria: 'Duplicate share of search interest' });
      const tot = (d.tr.la || 0) + (d.tr.lb || 0);
      if (tot) share = d.tr.lb / tot;
      const f = A.slice(0, 4).reduce((x, y) => x + y, 0) + B.slice(0, 4).reduce((x, y) => x + y, 0);
      if (f && share != null) drift = Math.round((share - B.slice(0, 4).reduce((x, y) => x + y, 0) / f) * 100);
      src = 'Google Trends';
    } else { const h = $('#chart-tr'); if (h) h.innerHTML = '<div class="empty">Google Trends snapshot pending — Google rate-limits bulk collection, so terms fill in batch by batch. <a href="https://trends.google.com/trends/explore?date=all&q=' + encodeURIComponent(T.A.q) + ',' + encodeURIComponent(T.B.q) + '" target="_blank" rel="noopener">Compare live on Google Trends ↗</a></div>'; }
    if (d.wp && (d.wp.a || d.wp.b)) {
      const n = Math.max(d.wp.a.length, d.wp.b.length);
      const A = d.wp.a ? dec(d.wp.a, d.wp.m) : Array(n).fill(0), B = d.wp.b ? dec(d.wp.b, d.wp.m) : Array(n).fill(0);
      const L = qLabels('201507', n);
      let wc = null, wdir = null;
      if (!d.wp.same && d.wp.a && d.wp.b) { const sA = ma(A, 2), sB = ma(B, 2); for (let i = 1; i < n; i++) { const d0 = sB[i - 1] - sA[i - 1], d1 = sB[i] - sA[i]; if (Math.sign(d0) !== Math.sign(d1) && d1 !== 0) { wc = i; wdir = d1 > 0 ? 'dup' : 'orig'; } } }
      lineChart($('#chart-pv'), [{ name: T.A.label, values: A, cls: 'sa' }, { name: T.B.label, values: B, cls: 'sb' }], { labels: L, mark: wc, markLabel: wc != null ? (wdir === 'dup' ? 'Duplicate overtakes' : 'Original retakes') + ' · ' + L[wc] : '', aria: 'Wikipedia pageviews per month, quarterly average' });
      if (share == null && !d.wp.same && d.wp.a12 != null && d.wp.b12 != null && (d.wp.a12 + d.wp.b12)) {
        share = d.wp.b12 / (d.wp.a12 + d.wp.b12); src = 'Wikipedia'; cross = wc; crossLabel = wc != null ? L[wc] : '';
        const sA = ma(A, 2), sB = ma(B, 2);
        lineChart($('#chart-share'), [{ name: 'Duplicate share %', values: L.map((_, i) => (sA[i] + sB[i]) ? 100 * sB[i] / (sA[i] + sB[i]) : 50), cls: 'sb' }], { labels: L, h: 180, aria: 'Duplicate share of Wikipedia attention' });
        const f = A.slice(0, 4).reduce((x, y) => x + y, 0) + B.slice(0, 4).reduce((x, y) => x + y, 0);
        if (f) drift = Math.round((share - B.slice(0, 4).reduce((x, y) => x + y, 0) / f) * 100);
        const sh = document.querySelector('#chart-share'); if (sh && sh.previousElementSibling) { const h2 = sh.previousElementSibling.querySelector('h2'); if (h2) h2.textContent = "Duplicate's share of Wikipedia attention"; }
      }
      if (d.wp.same) { const nb = $('#chart-pv'); if (nb) nb.insertAdjacentHTML('beforeend', '<p class="muted" style="margin:8px">Both meanings share one Wikipedia article, so pageviews can\'t separate them.</p>'); }
    } else { const h = $('#chart-pv'); if (h) h.innerHTML = '<div class="empty">No Wikipedia article covers ' + (T.A.wiki || T.B.wiki ? 'one of these senses' : 'these senses') + '.</div>'; }
    const yo = (a, b) => b == null ? '—' : fmt(b);
    [['A', 'la', 'a12', 0], ['B', 'lb', 'b12', 1]].forEach(([k, tk, wk, hi]) => {
      const box = $('#stats-' + k); if (!box) return;
      box.innerHTML = `<div><span>Wikipedia · 12 mo</span><b>${d.wp && d.wp[wk] != null ? fmt(d.wp[wk]) : '—'}</b></div><div><span>Share of the word</span><b>${share == null ? '—' : Math.round((k === 'B' ? share : 1 - share) * 100) + '%'}</b></div>`;
    });
    [['A', 'ta'], ['B', 'tb']].forEach(([k, tk]) => { const box = $('#def-' + k), title = d.wp && d.wp[tk]; if (box && title) box.innerHTML += `<cite>Wikipedia article: <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}" target="_blank" rel="noopener">${esc(title)}</a></cite>`; });
    if (share != null) {
      const status = share > 0.6 ? 'DUPLICATE DOMINANT' : share < 0.4 ? 'ORIGINAL HOLDS' : 'CONTESTED';
      const v = $('#verdict');
      if (v) v.innerHTML = `<div class="cell big"><span>Canonical today</span><b class="st ${status === 'CONTESTED' ? 'c' : share > .5 ? 'b' : 'a'}">${esc((share > .5 ? T.B : T.A).label)}</b></div>
        <div class="cell"><span>Status</span><b class="st ${status === 'CONTESTED' ? 'c' : share > .5 ? 'b' : 'a'}">${status}</b></div>
        <div class="cell"><span>Duplicate share · 12 mo · ${esc(src)}</span><b>${Math.round(share * 100)}%</b></div>
        <div class="cell"><span>Drift since ${src === 'Wikipedia' ? '2015' : '2004'}</span><b>${drift == null ? '—' : (drift >= 0 ? '+' : '') + drift + ' pts'}</b></div>
        <div class="cell"><span>Last crossover</span><b>${cross != null ? esc(crossLabel) : src === 'Wikipedia' ? 'None since 2015' : 'None since 2004'}</b></div>`;
      const sb = $('#splitbar'); if (sb) { sb.style.setProperty('--share', (share * 100).toFixed(1) + '%'); sb.hidden = false; $('#splitbar-a').textContent = Math.round((1 - share) * 100) + '%'; $('#splitbar-b').textContent = Math.round(share * 100) + '%'; const sn = $('#splitnote'); if (sn) sn.hidden = false; }
      const nar = $('#narrative');
      if (nar) {
        const lead = share > .5 ? T.B : T.A, lag = share > .5 ? T.A : T.B, big = Math.round(Math.max(share, 1 - share) * 100);
        const cl = x => x === T.B ? 'pb' : 'pa';
        nar.innerHTML = `<p>${T.note ? esc(T.note) + ' ' : ''}Over the last 12 months, <b class="${cl(lead)}">${esc(lead.label)}</b> took ${big}% of the combined ${esc(src)} interest, against ${100 - big}% for <b class="${cl(lag)}">${esc(lag.label)}</b>.` +
          (cross != null ? ` The lines last crossed in <b>${esc(crossLabel)}</b>.` : src === 'Google Trends' ? ' The two meanings have not traded places since Google Trends data begins in 2004.' : '') +
          (drift != null ? ` The duplicate's share has moved ${drift >= 0 ? 'up' : 'down'} ${Math.abs(drift)} points since ${src === 'Wikipedia' ? '2015' : '2004'}.` : '') + '</p>';
      }
    }
    const st = $('#live-status'); if (st) { st.textContent = `Snapshot · Wikipedia pageviews · collected ${d.at || 'Oct 2026'}`; st.className = 'live ok'; }
    return true;
  }

  async function initTerm() {
    const T = D.term; if (!T) return;
    ['A', 'B'].forEach(k => { const box = $('#def-' + k), def = T[k].def; if (box && /Loading the Wikipedia/.test(box.innerHTML)) box.innerHTML = def ? `<blockquote>${esc(def)}</blockquote>` : '<p class="muted">The Wikipedia definition loads on the live site.</p>'; });
    if (T.data && renderBaked(T)) return;
    const status = $('#live-status');
    const setStatus = (t, cls) => { if (status) { status.textContent = t; status.className = 'live ' + (cls || ''); } };
    setStatus('Pulling live data from Wikipedia…');
    let anyOk = false;

    // 1. Wikipedia definitions + pageviews
    let pvA = null, pvB = null;
    try {
      const info = await wikiInfo([T.A.wiki, T.B.wiki]);
      [['A', T.A], ['B', T.B]].forEach(([k, s]) => {
        const p = info[s.wiki];
        const box = $('#def-' + k);
        if (p && p.extract && box) {
          const url = p.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`;
          box.innerHTML = `<blockquote>“${esc(p.extract.slice(0, 520))}${p.extract.length > 520 ? '…' : ''}”</blockquote><cite>— <a href="${url}" target="_blank" rel="noopener">Wikipedia: ${esc(p.title)}</a>${p.pageprops?.['wikibase-shortdesc'] ? ' · ' + esc(p.pageprops['wikibase-shortdesc']) : ''}</cite>`;
          s._canon = p.title;
        }
      });
      const [a, b] = await Promise.all([
        T.A._canon ? pageviews(T.A._canon).catch(() => null) : null,
        T.B._canon ? pageviews(T.B._canon).catch(() => null) : null]);
      pvA = a; pvB = b; anyOk = anyOk || !!(a || b);
    } catch (e) { /* offline */ }

    if (pvA || pvB) {
      const months = [...new Set([...(pvA || []), ...(pvB || [])].map(x => x.m))].sort();
      const mapA = Object.fromEntries((pvA || []).map(x => [x.m, x.v])), mapB = Object.fromEntries((pvB || []).map(x => [x.m, x.v]));
      const A = months.map(m => mapA[m] || 0), B = months.map(m => mapB[m] || 0);
      const labels = months.map(m => MONTHS[+m.slice(4) - 1] + ' ' + m.slice(2, 4));
      const sA = ma(A), sB = ma(B);
      let cross = null, crossDir = null;
      for (let i = 1; i < months.length; i++) { const d0 = sB[i - 1] - sA[i - 1], d1 = sB[i] - sA[i]; if (pvA && pvB && Math.sign(d0) !== Math.sign(d1) && d1 !== 0) { cross = i; crossDir = d1 > 0 ? 'dup' : 'orig'; } }
      const last12A = A.slice(-12).reduce((x, y) => x + y, 0), last12B = B.slice(-12).reduce((x, y) => x + y, 0);
      const prevA = A.slice(-24, -12).reduce((x, y) => x + y, 0), prevB = B.slice(-24, -12).reduce((x, y) => x + y, 0);
      const share = last12A + last12B ? last12B / (last12A + last12B) : null;
      const firstShare = (A.slice(0, 12).reduce((x, y) => x + y, 0) + B.slice(0, 12).reduce((x, y) => x + y, 0)) ? B.slice(0, 12).reduce((x, y) => x + y, 0) / (A.slice(0, 12).reduce((x, y) => x + y, 0) + B.slice(0, 12).reduce((x, y) => x + y, 0)) : null;
      lineChart($('#chart-pv'), [{ name: T.A.label, values: A, cls: 'sa' }, { name: T.B.label, values: B, cls: 'sb' }], { labels, mark: cross, markLabel: cross != null ? (crossDir === 'dup' ? 'Duplicate overtakes' : 'Original retakes') + ' · ' + labels[cross] : '', aria: 'Monthly Wikipedia pageviews' });
      const shareSeries = months.map((_, i) => (sA[i] + sB[i]) ? 100 * sB[i] / (sA[i] + sB[i]) : 50);
      lineChart($('#chart-share'), [{ name: 'Duplicate share %', values: shareSeries, cls: 'sb' }], { labels, h: 180, aria: 'Duplicate share of attention' });
      const peakIdx = arr => arr.indexOf(Math.max(...arr));
      const statsA = { v12: last12A, yoy: prevA ? (last12A - prevA) / prevA : null, peak: A.length ? labels[peakIdx(A)] : '—' };
      const statsB = { v12: last12B, yoy: prevB ? (last12B - prevB) / prevB : null, peak: B.length ? labels[peakIdx(B)] : '—' };
      const yo = v => v == null ? '—' : (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
      [['A', statsA, pvA], ['B', statsB, pvB]].forEach(([k, s, has]) => {
        const box = $('#stats-' + k); if (!box) return;
        box.innerHTML = has ? `<div><span>12-mo pageviews</span><b>${fmt(s.v12)}</b></div><div><span>Year over year</span><b>${yo(s.yoy)}</b></div><div><span>Peak month</span><b>${esc(s.peak)}</b></div>` : `<div><span>Wikipedia</span><b>no article</b></div>`;
      });
      // verdict
      const v = $('#verdict');
      if (v && share != null && pvA && pvB) {
        const canonical = share > 0.5 ? T.B : T.A;
        const status = share > 0.6 ? 'DUPLICATE DOMINANT' : share < 0.4 ? 'ORIGINAL HOLDS' : 'CONTESTED';
        const drift = firstShare != null ? Math.round((share - firstShare) * 100) : null;
        v.innerHTML = `<div class="cell big"><span>Canonical today</span><b class="st ${status === 'CONTESTED' ? 'c' : share > .5 ? 'b' : 'a'}">${esc(canonical.label)}</b></div>
          <div class="cell"><span>Status</span><b class="st ${status === 'CONTESTED' ? 'c' : share > .5 ? 'b' : 'a'}">${status}</b></div>
          <div class="cell"><span>Duplicate share · 12 mo</span><b>${Math.round(share * 100)}%</b></div>
          <div class="cell"><span>Drift since 2015</span><b>${drift == null ? '—' : (drift >= 0 ? '+' : '') + drift + ' pts'}</b></div>
          <div class="cell"><span>Last crossover</span><b>${cross != null ? esc(labels[cross]) : 'None since Jul 2015'}</b></div>`;
        const sb = $('#splitbar'); if (sb) { sb.style.setProperty('--share', (share * 100).toFixed(1) + '%'); sb.hidden = false; $('#splitbar-a').textContent = Math.round((1 - share) * 100) + '%'; $('#splitbar-b').textContent = Math.round(share * 100) + '%'; const sn = $('#splitnote'); if (sn) sn.hidden = false; }
        const nar = $('#narrative');
        if (nar) {
          const lead = share > .5 ? T.B.label : T.A.label, lag = share > .5 ? T.A.label : T.B.label;
          nar.innerHTML = `<p>Over the last 12 months, Wikipedia readers looked up <b>${esc(lead)}</b> ${fmt(Math.max(last12A, last12B))} times, against ${fmt(Math.min(last12A, last12B))} for <b>${esc(lag)}</b> — a ${Math.round(Math.max(share, 1 - share) * 100)}/${Math.round(Math.min(share, 1 - share) * 100)} split.` +
            (cross != null ? ` The lines last crossed in <b>${esc(labels[cross])}</b>, when ${crossDir === 'dup' ? 'the newer meaning pulled ahead of the original' : 'the original meaning won its name back'}.` : ` The two meanings have not traded places since Wikipedia's pageview record begins in July 2015.`) +
            (drift != null ? ` The duplicate's share has moved ${drift >= 0 ? 'up' : 'down'} ${Math.abs(drift)} points since 2015.` : '') + `</p>`;
        }
      }
    }

    setStatus(anyOk ? 'Live · Wikipedia pageviews · refreshed on every visit' : 'Live data could not load here. On deduplication.tech these panels fill from Wikipedia.', anyOk ? 'ok' : 'off');
  }

  function initExpand() {
    document.querySelectorAll('.expand').forEach(b => { if (b.dataset.bound) return; b.dataset.bound = 1; b.addEventListener('click', () => {
      const ul = b.previousElementSibling, open = b.dataset.open === '1';
      ul.querySelectorAll('li.more').forEach(li => li.hidden = open);
      b.dataset.open = open ? '0' : '1'; b.textContent = open ? `Show ${b.dataset.n} more` : 'Show less';
    }); });
  }
  function run() { initExpand(); Object.assign(D, window.DEDUP || {}); D.index = window.DEDUP_INDEX || D.index; initSearch(); initCloud(); initTerm(); }
  window.DEDUP_RUN = run;
  if (!window.DEDUP_PREVIEW) run();
})();
