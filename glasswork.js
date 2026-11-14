/* 玻璃拟态皮肤（data-style="glass"）改用 Glasswork 的液态玻璃材质：
   玻璃底色 + 2px 模糊/提亮 + 边缘折射（lens.js，仅 Chromium）+ 边缘光。
   只在桌面端启用；手机上保留原来的磨砂，滚动不掉帧。 */
(function () {
  var SEL = [
    '#view .card', '#view .vb-card', '#view .sheet', '#view .nb-card',
    '#view .cd-bank', '#view .bd-card', '#view .stat-card', '#view .hn-card',
    '#view .lec-hgrp', '.top', '#bnav'
  ].join(',');

  var MAX = 40;                 // 一屏最多给多少块玻璃挂折射，避免几十个 SVG 位移图
  var mounted = new Map();      // el -> lens handle
  var lensMod = null;           // 懒加载的模块
  var lensFail = false;
  var timer = 0;

  function glassOn() {
    return document.documentElement.getAttribute('data-style') === 'glass';
  }
  function light() {
    return !document.body.classList.contains('dark');
  }
  function cheapDevice() {
    /* 只按「真的画不动」的两种情况降级：低动效偏好、触屏（手机）。
       窄窗口不再算弱设备——小窗也是桌面，用户要的是折射效果。 */
    try {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
      if (matchMedia('(pointer: coarse)').matches) return true;
    } catch (e) {}
    return false;
  }
  function bigEnough(el) {
    var r = el.getBoundingClientRect();
    return r.width * r.height >= 24000 && r.width >= 180;
  }


  /* 玻璃皮肤的「磨砂强度」滑杆 = 玻璃浓度，直接喂给 Glasswork 的 --density：
     0 → 薄玻璃（tint 8%），30 → 厚玻璃（tint 26%），深色 20%→46%。 */
  function densityFromSlider() {
    var n = 14;
    try {
      var el = document.getElementById('setFrostPx');
      if (el) n = +el.value;
    } catch (e) {}
    if (!isFinite(n)) n = 14;
    n = Math.max(0, Math.min(30, n));
    return n / 30;
  }
  function syncDensity() {
    var d = densityFromSlider();
    document.documentElement.style.setProperty('--gw-density', d.toFixed(3));
    var lab = document.getElementById('setFrostPxLabel');
    var val = document.getElementById('setFrostPxVal');
    if (glassOn()) {
      if (lab) lab.textContent = '玻璃浓度';
      if (val) val.textContent = Math.round(d * 100) + '%';
    } else if (lab) {
      lab.textContent = '磨砂强度';
    }
  }

  function unmountAll() {
    mounted.forEach(function (h) {
      try { h && h.destroy && h.destroy(); } catch (e) {}
    });
    mounted.clear();
    Array.prototype.forEach.call(document.querySelectorAll('.gwl'), function (el) {
      el.classList.remove('gwl');
    });
  }

  function mount(el, mod) {
    el.classList.add('gwl');
    if (!mod) return;
    try {
      mounted.set(el, mod.liquidGlass(el, { rim: 40, edge: 1.1, power: 2.6, dispersion: 0.15 }));
    } catch (e) { /* 折射失败就只剩材质，不影响可读 */ }
  }

  function apply() {
    timer = 0;
    syncDensity();
    if (!glassOn()) { unmountAll(); return; }

    /* 材质（底色 + 边缘光）窄屏也要有，否则小窗一缩就退回旧皮肤的实色；
       只有「折射」这一层按设备能力关掉。 */
    var wantLens = !cheapDevice();
    var all = Array.prototype.slice.call(document.querySelectorAll(SEL));
    var lensList = all.filter(bigEnough).slice(0, MAX);
    var lensSet = new Set(lensList);

    /* 明确不该再挂折射的（变小了 / 换设备了）先拆掉 */
    mounted.forEach(function (h, el) {
      if (!wantLens || !lensSet.has(el) || !document.contains(el)) {
        try { h && h.destroy && h.destroy(); } catch (e) {}
        mounted.delete(el);
      }
    });

    all.forEach(function (el) {
      if (wantLens && lensSet.has(el)) return;
      el.classList.add('gwl');
      el.removeAttribute('data-kind');
    });

    if (wantLens && !lensMod && !lensFail) {
      import('./glass-lens.js').then(function (m) {
        lensMod = m;
        apply();
      }).catch(function () { lensFail = true; });
    }

    var wantDark = !light();
    lensList.forEach(function (el) {
      if (wantLens && lensMod) {
        if (!mounted.has(el)) mount(el, lensMod);
        var d = el.getAttribute('data-kind') === 'dark';
        if (d !== wantDark) {
          el.setAttribute('data-kind', wantDark ? 'dark' : 'light');
          var h = mounted.get(el);
          try { h && h.refresh && h.refresh(); } catch (e) {}
        }
      } else {
        el.classList.add('gwl');
        el.removeAttribute('data-kind');
      }
    });
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(apply, 220);
  }

  function boot() {
    schedule();
    new MutationObserver(schedule).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-style']
    });
    new MutationObserver(schedule).observe(document.body, {
      attributes: true, attributeFilter: ['class']
    });
    var view = document.getElementById('view');
    if (view) new MutationObserver(schedule).observe(view, { childList: true, subtree: true });
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('hashchange', schedule);
    var sld = document.getElementById('setFrostPx');
    if (sld) sld.addEventListener('input', function () { syncDensity(); });
    syncDensity();
  }

  window.GW = { refresh: schedule, off: function () { unmountAll(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
