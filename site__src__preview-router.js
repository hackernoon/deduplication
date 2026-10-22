(function(){
  const tok = p => p.replace(/\/$/, '').replace(/\//g, '~');
  const fromTok = t => { const p = t.replace(/~/g, '/'); return p ? p + '/' : ''; };
  function norm(href){ let h = href.split('#')[0].replace(/index\.html$/, '').replace(/^(\.\.\/)+/, ''); if (h === 'home') h = ''; if (h && !h.endsWith('/')) h += '/'; return h; }
  function show(path, push){
    const pg = window.PAGES[path] || window.PAGES[''];
    document.getElementById('view').innerHTML = pg.body; document.title = pg.title;
    window.DEDUP = Object.assign({ root: '' }, pg.data || {});
    if (window.DEDUP_RUN) window.DEDUP_RUN();
    if (push) { try { history.replaceState(null, '', path ? '#' + tok(path) : location.pathname); } catch (e) {} }
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a'); if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^(https?:|mailto:|#)/.test(href) || a.target === '_blank') return;
    e.preventDefault(); show(norm(href), true); const anc = href.split('#')[1]; if (anc) { const t = document.getElementById(anc); if (t) t.scrollIntoView(); }
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches && e.target.matches('.search input')) {
      const a = e.target.parentElement.querySelector('.results a');
      if (a) { e.preventDefault(); e.stopImmediatePropagation(); show(norm(a.getAttribute('href')), true); }
    }
  }, true);
  show(fromTok(location.hash.slice(1)), false);
})();
