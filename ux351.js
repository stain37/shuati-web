/* Lucian UX/UI Prompt #351 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#351
   刷题站落点：错题本 / 收藏列表——滚动越快，列表行越往滚动方向倾一点、轻微拉伸，停下立刻弹回。
   慢速滚动几乎不倾（≤0.6°），不影响读题；prefers-reduced-motion 下完全不倾。 */
(function () {
  'use strict';
  if (window.__ux351) return;
  window.__ux351 = 1;

  var rm = false;
  try { rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e0) {}
  if (rm) return;

  var SEL = '.wi';            /* 错题本 / 收藏 的列表行 */
  var MAX_DEG = 4.2, GAIN = 3.0;
  var lastY = window.scrollY || 0, lastT = performance.now();
  var vel = 0, skew = 0, vv = 0, raf = 0, rows = [];

  var lastPick = 0;
  function pick(force) {
    var now = performance.now();
    if (!force && now - lastPick < 1200) return rows;
    lastPick = now;
    rows = Array.prototype.slice.call(document.querySelectorAll('#view ' + SEL)).slice(0, 60);
    rows.forEach(function (r) { r.style.transformOrigin = '50% 50%'; });
    return rows;
  }

  function tick() {
    raf = 0;
    var now = performance.now();
    if (now - lastT > 80) vel *= 0.55;
    var target = Math.max(-MAX_DEG, Math.min(MAX_DEG, -vel * GAIN));
    vv += (target - skew) * 0.28;
    vv *= 0.74;
    skew += vv;
    if (!rows.length) pick();
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].isConnected) { rows = []; break; }
      rows[i].style.transform = 'skewY(' + skew.toFixed(2) + 'deg)';
    }
    if (Math.abs(skew) > 0.02 || Math.abs(vv) > 0.02 || Math.abs(vel) > 0.05) {
      raf = requestAnimationFrame(tick);
    } else {
      skew = 0; vv = 0;
      for (var j = 0; j < rows.length; j++) rows[j].style.transform = '';
    }
  }
  function run() { if (!raf) raf = requestAnimationFrame(tick); }

  window.addEventListener('scroll', function () {
    var y = window.scrollY || 0, now = performance.now();
    var dt = Math.max(8, now - lastT);
    vel = vel * 0.55 + ((y - lastY) / dt) * 0.45;
    lastY = y; lastT = now;
    if (!rows.length) pick();
    if (!rows.length) return;           /* 这页没有可倾斜的行，别每帧白跑 */
    run();
  }, { passive: true });

  /* 换页 / 重新渲染后重新取行 */
  document.addEventListener('click', function () { setTimeout(function () { rows = []; }, 60); }, true);
  setInterval(function () { if (!rows.length) pick(true); }, 1500);
  window.addEventListener('hashchange', function () { rows = []; lastPick = 0; }, { passive: true });
})();
