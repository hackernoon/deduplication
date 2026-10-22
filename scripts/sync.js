window.DDsync = function (n, budgetMs) {
  const t0 = Date.now(); budgetMs = budgetMs || 38000;
  const AL = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  const enc = (arr, max) => arr.map(v => AL[Math.max(0, Math.min(63, Math.round((v || 0) / (max || 1) * 63)))]).join('');
  const get = (url) => { const x = new XMLHttpRequest(); x.open('GET', url, false); x.send(); return { s: x.status, t: x.responseText }; };
  const strip = t => JSON.parse(t.slice(t.indexOf('\n') + 1));
  const jobs = JSON.parse(localStorage.getItem('dd_jobs'));
  const out = JSON.parse(localStorage.getItem('dd_out') || '{}');
  const err = [];
  const end = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCDate(0); return d.toISOString().slice(0, 10).replace(/-/g, '') + '00'; })();
  let did = 0, rate = false;
  for (const [u, qa, qb, wa, wb] of jobs) {
    if (did >= n || Date.now() - t0 > budgetMs) break;
    if (out[u] && out[u].tr !== undefined) continue;
    const o = out[u] || {};
    try {
      const req = { comparisonItem: [qa, qb].map(k => ({ keyword: k, geo: '', time: 'all' })), category: 0, property: '' };
      const r = get('/trends/api/explore?hl=en-US&tz=0&req=' + encodeURIComponent(JSON.stringify(req)));
      if (r.s === 429) { rate = true; break; }
      const w = strip(r.t).widgets.find(x => x.id === 'TIMESERIES');
      const r2 = get('/trends/api/widgetdata/multiline?hl=en-US&tz=0&req=' + encodeURIComponent(JSON.stringify(w.request)) + '&token=' + w.token);
      if (r2.s === 429) { rate = true; break; }
      const tl = strip(r2.t).default.timelineData;
      if (!tl.length) o.tr = null; else {
        const first = new Date(+tl[0].time * 1000);
        const A = tl.map(x => x.value[0]), B = tl.map(x => x.value[1]);
        const q = arr => { const o2 = []; for (let i = 0; i < arr.length; i += 3) { const s = arr.slice(i, i + 3); o2.push(s.reduce((a, b) => a + b, 0) / s.length); } return o2; };
        const l12 = arr => arr.slice(-12).reduce((a, b) => a + b, 0);
        o.tr = { s: first.getUTCFullYear() + '' + String(first.getUTCMonth() + 1).padStart(2, '0'), a: enc(q(A), 100), b: enc(q(B), 100), la: l12(A), lb: l12(B) };
      }
    } catch (e) { err.push(u + ' tr ' + e.message); o.tr = null; }
    try {
      const list = [wa, wb].filter(Boolean);
      if (list.length) {
        const c = {}; list.forEach(t => c[t] = t);
        const r = JSON.parse(get('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&titles=' + encodeURIComponent(list.join('|'))).t);
        (r.query.normalized || []).forEach(nn => list.forEach(t => { if (c[t] === nn.from) c[t] = nn.to; }));
        (r.query.redirects || []).forEach(nn => list.forEach(t => { if (c[t] === nn.from) c[t] = nn.to; }));
        const missing = new Set(Object.values(r.query.pages || {}).filter(p => 'missing' in p).map(p => p.title));
        const pv = t => { if (!t || missing.has(t)) return null; const x = get('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/' + encodeURIComponent(t.replace(/ /g, '_')) + '/monthly/2015070100/' + end); return x.s === 200 ? JSON.parse(x.t).items.map(i => i.views) : null; };
        const pa = pv(c[wa]), pb = pv(c[wb]);
        if (pa || pb) {
          const len = Math.max((pa || []).length, (pb || []).length);
          const padA = pa ? Array(len - pa.length).fill(0).concat(pa) : Array(len).fill(0);
          const padB = pb ? Array(len - pb.length).fill(0).concat(pb) : Array(len).fill(0);
          const qq = arr => { const o2 = []; for (let k = 0; k < arr.length; k += 3) o2.push(arr.slice(k, k + 3).reduce((x, y) => x + y, 0) / Math.min(3, arr.length - k)); return o2; };
          const QA = qq(padA), QB = qq(padB), m = Math.max(1, ...QA, ...QB);
          o.wp = { m: Math.round(m), a: pa ? enc(QA, m) : '', b: pb ? enc(QB, m) : '', a12: pa ? pa.slice(-12).reduce((x, y) => x + y, 0) : null, b12: pb ? pb.slice(-12).reduce((x, y) => x + y, 0) : null, ta: (pa && c[wa]) || '', tb: (pb && c[wb]) || '' };
        }
      }
    } catch (e) { err.push(u + ' wp ' + e.message); }
    try { const h = q => { const x = get('https://hn.algolia.com/api/v1/search?hitsPerPage=0&tags=(story,comment)&query=' + encodeURIComponent('"' + q + '"')); return x.s === 200 ? JSON.parse(x.t).nbHits : null; }; o.hn = [h(qa), h(qb)]; } catch (e) { err.push(u + ' hn'); }
    out[u] = o; did++;
  }
  localStorage.setItem('dd_out', JSON.stringify(out));
  const total = jobs.length, have = jobs.filter(j => out[j[0]] && out[j[0]].tr !== undefined).length;
  return JSON.stringify({ did, have, total, rate, ms: Date.now() - t0, err });
};
'ok'
