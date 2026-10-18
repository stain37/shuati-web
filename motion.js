/* ============================================================
   motion.js — hero 指针柔光（只改 CSS 变量，不改布局）
   移动端/触屏不启用；prefers-reduced-motion 时完全不动。
   ============================================================ */
(function () {
  'use strict';
  var reduce = false;
  try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  if (reduce) return;
  try { document.documentElement.classList.add('motion-ok'); } catch (e) {}
  var active = null, raf = 0, mx = 50, my = 0;
  /* 除了 hero，所有面板（卡片 / bento 卡 / 目录卡 / 继续刷题）也要有指针柔光 */
  var PANEL = '.card,.vb-card,.nb-card,.resume,.bank,.kbcard,.sheet';
  function heroOf(t) {
    try { return t && t.closest ? t.closest('.hero') : null; } catch (e) { return null; }
  }
  function panelOf(t) {
    try { return t && t.closest ? t.closest(PANEL) : null; } catch (e) { return null; }
  }
  function paint() {
    raf = 0;
    if (!active) return;
    active.style.setProperty('--mx', mx.toFixed(2) + '%');
    active.style.setProperty('--my', my.toFixed(2) + '%');
  }
  function clear() {
    if (!active) return;
    active.style.removeProperty('--mx');
    active.style.removeProperty('--my');
    active = null;
  }
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    var h = heroOf(e.target) || panelOf(e.target);
    if (!h) { clear(); return; }
    active = h;
    var r = h.getBoundingClientRect();
    if (!r.width || !r.height) return;
    mx = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100));
    my = Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100));
    if (!raf) raf = requestAnimationFrame(paint);
  }, { passive: true });
  document.addEventListener('pointerleave', clear, true);
  window.addEventListener('blur', clear);
})();
