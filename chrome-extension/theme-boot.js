// Apply the saved appearance before first paint (System / Dark / Light / Cyber / Parano1d World, plus Paranoid orange).
(function () {
  var c = 'system', para = false; try { c = localStorage.getItem('p1w-theme') || 'system'; para = localStorage.getItem('p1w-paranoid') === 'on'; } catch (e) {}
  if (c === 'cyber' && localStorage.getItem('p1w-theme-v2') !== '1') { try { localStorage.setItem('p1w-theme', 'world'); } catch (e) {} c = 'world'; }
  try { localStorage.setItem('p1w-theme-v2', '1'); } catch (e) {}
  var mode = (c === 'cyber' || c === 'world') ? c : (c === 'dark' || (c === 'system' && !(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches))) ? 'dark' : 'light';
  var r = document.documentElement; r.setAttribute('data-theme', mode); r.setAttribute('data-theme-choice', c); if (mode === 'cyber' || mode === 'world') r.setAttribute('data-mono', '');
  if (para) r.setAttribute('data-paranoid', 'on');
})();
