/* Lucian UX/UI Prompt #216 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#216 */
/* 刷题站适配：首页首屏分层入场（继续做题 → 统计卡 → 看板 → 热力），只播一次 */
(function () {
  if (window.__ux216) return;
  window.__ux216 = 1;
  var rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var played = false;

  function targets() {
    var view = document.getElementById('view');
    if (!view) return [];
    var list = [];
    var resume = view.querySelector('.vb-resume');
    var dash = view.querySelector('.vb-dash');
    var stg = view.querySelector('.stg');
    var extra = document.getElementById('homeExtra');
    if (resume) list.push({ el: resume, prod: true });
    if (dash) list.push({ el: dash });
    if (stg) list.push({ el: stg });
    if (extra) {
      Array.prototype.forEach.call(extra.children, function (c) { list.push({ el: c }); });
    }
    return list.slice(0, 9);
  }

  function play() {
    var items = targets();
    if (!items.length) return false;
    if (rm) { return true; }
    items.forEach(function (it, i) {
      it.el.classList.add('u216-s');
      if (it.prod) it.el.classList.add('u216-prod');
      it.el.style.setProperty('--d', String(i * 70));
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        items.forEach(function (it, i) {
          setTimeout(function () { it.el.classList.add('u216-in'); }, i * 70);
        });
      });
    });
    return true;
  }

  function tryPlay() {
    if (played) return;
    if (location.hash && location.hash !== '#/' ) return;
    if (play()) played = true;
  }

  window.addEventListener('hashchange', function () {
    if (location.hash === '#/' || !location.hash) { played = false; setTimeout(tryPlay, 120); }
  });

  var t = 0;
  function schedule() { clearTimeout(t); t = setTimeout(tryPlay, 160); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
  var mo = null;
  function watch() {
    var view = document.getElementById('view');
    if (!view) { setTimeout(watch, 300); return; }
    mo = new MutationObserver(function () { if (!played) schedule(); });
    mo.observe(view, { childList: true });
  }
  watch();
})();
