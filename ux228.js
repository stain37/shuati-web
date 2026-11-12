/* Lucian UX/UI Prompt #228 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#228
   光标扫过卡片时沿边框亮起一道光，离开后慢慢退掉。站点内用于：题目选项、考点卡、首页功能卡。 */
(function () {
  'use strict';
  var SEL = '.opt, .cc-card, .fh-card, .cd-row';
  var rm = false;
  try { rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var p = { x: -9999, y: -9999 }, o = 0, target = 0, raf = 0, last = 0;
  var targets = [];

  function ensureRing(el) {
    var r = el.querySelector(':scope > .ux228-ring');
    if (r) return r;
    r = document.createElement('i');
    r.className = 'ux228-ring';
    r.setAttribute('aria-hidden', 'true');
    var cs = getComputedStyle(el);
    if (cs.position === 'static') el.style.position = 'relative';
    el.appendChild(r);
    return r;
  }

  function collect() {
    targets = [].slice.call(document.querySelectorAll(SEL)).map(function (el) {
      return { el: el, ring: ensureRing(el) };
    });
    apply();
  }

  function apply() {
    var n = targets.length;
    for (var i = 0; i < n; i++) {
      var t = targets[i], el = t.el;
      if (!el.isConnected) continue;
      var r = el.getBoundingClientRect();
      if (!r.width) continue;
      var lx = p.x - r.left, ly = p.y - r.top;
      var inside = lx > -24 && ly > -24 && lx < r.width + 24 && ly < r.height + 24;
      t.ring.style.setProperty('--cx', lx.toFixed(1) + 'px');
      t.ring.style.setProperty('--cy', ly.toFixed(1) + 'px');
      t.ring.style.setProperty('--o', (inside ? o : 0).toFixed(3));
    }
  }

  function frame(now) {
    raf = 0;
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    o += (target - o) * (rm ? 1 : Math.min(1, dt * (target ? 10 : 3)));
    apply();
    if (Math.abs(target - o) > 0.005) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  document.addEventListener('pointermove', function (e) {
    p.x = e.clientX; p.y = e.clientY; target = 1; apply(); kick();
  }, { passive: true });
  document.addEventListener('pointerleave', function () { target = 0; kick(); });
  window.addEventListener('scroll', function () { apply(); }, { passive: true });

  var pend = 0;
  var mo = new MutationObserver(function () {
    if (pend) return;
    pend = requestAnimationFrame(function () { pend = 0; collect(); });
  });
  function boot() {
    collect();
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
