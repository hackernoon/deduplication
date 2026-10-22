// Runs inside a trends.google.com tab. window.DD_JOBS must be set first.
(async () => {
  const AL = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  const enc = (arr, max) => arr.map(v => AL[Math.max(0, Math.min(63, Math.round((v || 0) / (max || 1) * 63)))]).join('');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const store = () => { try { localStorage.setItem('dd_out', JSON.stringify(window.DD.out)); } catch (e) {} };
  window.DD = window.DD || {};
  try { window.DD.out = window.DD.out || JSON.parse(localStorage.getItem('dd_out') || '{}'); } catch (e) { window.DD.out = {}; }
  const D = window.DD; D.status = 'running'; D.err = D.err || [];
  const jobs = window.DD_JOBS;
  const strip = t => JSON.parse(t.slice(t.indexOf('\n') + 1));
  async function trends(qa, qb) {
    const req = { comparisonItem: [qa, qb].map(k => ({ keyword: k, geo: '', time: 'all' })), category: 0, property: '' };
    for (let tries = 0; tries < 4; tries++) {
      const r = await fetch('/trends/api/explore?hl=en-US&tz=0&req=' + encodeURIComponent(JSON.stringify(req)));
      if (r.status === 429) { await sleep(20000 * (tries + 1)); continue; }
      if (!r.ok) throw new Error('explore ' + r.status);
      const ex = strip(await r.text());
      const w = ex.widgets.find(x => x.id === 'TIMESERIES');
      await sleep(400);
      const r2 = await fetch('/trends/api/widgetdata/multiline?hl=en-US&tz=0&req=' + encodeURIComponent(JSON.stringify(w.request)) + '&token=' + w.token);
      if (r2.status === 429) { await sleep(20000 * (tries + 1)); continue; }
      if (!r2.ok) throw new Error('multiline ' + r2.status);
      const tl = strip(await r2.text()).default.timelineData;
      const first = new Date(+tl[0].time * 1000);
      const A = tl.map(x => x.value[0]), B = tl.map(x => x.value[1]);
      // quarterly means
      const q = arr => { const o = []; for (let i = 0; i < arr.length; i += 3) { const s = arr.slice(i, i + 3); o.push(s.reduce((a, b) => a + b, 0) / s.length); } return o; };
      const l12 = arr => arr.slice(-12).reduce((a, b) => a + b, 0);
      return { s: first.getUTCFullYear() + '' + String(first.getUTCMonth() + 1).padStart(2, '0'), a: enc(q(A), 100), b: enc(q(B), 100), la: l12(A), lb: l12(B) };
    }
    throw new Error('trends 429');
  }
  async function canon(titles) {
    const out = {}; const list = titles.filter(Boolean); if (!list.length) return out;
    const r = await (await fetch('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&titles=' + encodeURIComponent(list.join('|')))).json();
    list.forEach(t => out[t] = t);
    (r.query.normalized || []).forEach(n => list.forEach(t => { if (out[t] === n.from) out[t] = n.to; }));
    (r.query.redirects || []).forEach(n => list.forEach(t => { if (out[t] === n.from) out[t] = n.to; }));
    const missing = new Set(Object.values(r.query.pages || {}).filter(p => 'missing' in p).map(p => p.title));
    list.forEach(t => { if (missing.has(out[t])) out[t] = null; });
    return out;
  }
  const end = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCDate(0); return d.toISOString().slice(0, 10).replace(/-/g, '') + '00'; })();
  async function pv(title) {
    if (!title) return null;
    const r = await fetch('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/' + encodeURIComponent(title.replace(/ /g, '_')) + '/monthly/2015070100/' + end);
    if (!r.ok) return null;
    return (await r.json()).items.map(i => i.views);
  }
  async function hn(q) {
    const r = await fetch('https://hn.algolia.com/api/v1/search?hitsPerPage=0&tags=(story,comment)&query=' + encodeURIComponent('"' + q + '"'));
    return r.ok ? (await r.json()).nbHits : null;
  }
  for (let i = 0; i < jobs.length; i++) {
    if (D.stop) break;
    const [u, qa, qb, wa, wb] = jobs[i];
    if (D.out[u] && D.out[u].tr) continue;
    D.i = i;
    const o = D.out[u] || {};
    try { o.tr = await trends(qa, qb); } catch (e) { D.err.push(u + ' trends ' + e.message); }
    try {
      const c = await canon([wa, wb]);
      const [pa, pb] = await Promise.all([pv(c[wa]), pv(c[wb])]);
      if (pa || pb) {
        const len = Math.max((pa || []).length, (pb || []).length);
        const padA = pa ? Array(len - pa.length).fill(0).concat(pa) : Array(len).fill(0);
        const padB = pb ? Array(len - pb.length).fill(0).concat(pb) : Array(len).fill(0);
        const qq = arr => { const out = []; for (let k = 0; k < arr.length; k += 3) out.push(arr.slice(k, k + 3).reduce((x, y) => x + y, 0) / Math.min(3, arr.length - k)); return out; };
        const QA = qq(padA), QB = qq(padB), m = Math.max(1, ...QA, ...QB);
        o.wp = { m: Math.round(m), a: pa ? enc(QA, m) : '', b: pb ? enc(QB, m) : '', a12: pa ? pa.slice(-12).reduce((x, y) => x + y, 0) : null, b12: pb ? pb.slice(-12).reduce((x, y) => x + y, 0) : null, ta: c[wa] || '', tb: c[wb] || '' };
      }
    } catch (e) { D.err.push(u + ' wiki ' + e.message); }
    try { o.hn = [await hn(qa), await hn(qb)]; } catch (e) { D.err.push(u + ' hn'); }
    D.out[u] = o; store();
    await sleep(1200);
  }
  D.status = 'done';
})();
'started'
