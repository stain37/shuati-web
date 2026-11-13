/* Lucian UX/UI Prompt #010 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#010
   刷题站落点：错题本复习条「开始复习（N 题）」——主按钮执行当前方式，右侧箭头展开
   另外两种复习方式（复习选中 / 全部到期不限上限）；执行时按钮里跑进度条，完成变绿打勾。 */
(function () {
  'use strict';
  if (window.UX010) return;
  window.UX010 = 1;

  var rm = false;
  try { rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e0) {}

  var host = null, root = null, main = null, caret = null, lab = null, menu = null, live = null;
  var opts = [], action = null, busyT = 0;

  function orig() { return document.getElementById('wRevAll'); }
  function origSel() { return document.getElementById('wRevSel'); }
  function capSel() { return document.getElementById('wRevCap'); }

  function optHtml(o) {
    return '<li role="none"><button type="button" class="u010x-opt" role="menuitemradio" data-act="' + o.k + '" data-label="' + o.label + '">' +
      '<span class="u010x-oi" style="background:' + o.c + '">' + o.ic + '</span>' +
      '<span class="u010x-ot"><b>' + o.label + '</b><small>' + o.sub + '</small></span>' +
      '<span class="u010x-chk" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.2 2.2L9.5 3.6"/></svg></span>' +
      '</button></li>';
  }

  function build(btn) {
    var n = btn.textContent.replace(/^\s*开始复习/, '').trim() || '';
    host = document.createElement('div');
    host.className = 'u010x';
    host.dataset.open = '0';
    host.innerHTML =
      '<div class="u010x-grp">' +
        '<button type="button" class="u010x-main">' +
          '<span class="u010x-ic" aria-hidden="true">' +
            '<svg class="u010x-go" viewBox="0 0 24 24"><path d="M5 12h12M12 6l6 6-6 6"/></svg>' +
            '<svg class="u010x-spin" viewBox="0 0 24 24"><path d="M12 4a8 8 0 1 0 8 8"/></svg>' +
            '<svg class="u010x-ok" viewBox="0 0 24 24"><path d="M5.5 12.5l4.2 4.2L18.5 8"/></svg>' +
          '</span>' +
          '<span class="u010x-labs"><span class="u010x-lab"></span></span>' +
          '<span class="u010x-bar" aria-hidden="true"></span>' +
        '</button>' +
        '<span class="u010x-div" aria-hidden="true"></span>' +
        '<button type="button" class="u010x-caret" aria-haspopup="menu" aria-expanded="false" aria-label="选择复习方式"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9.5l5.5 5.5 5.5-5.5"/></svg></button>' +
      '</div>' +
      '<ul class="u010x-menu" role="menu" aria-label="复习方式">' +
        optHtml({ k: 'all', label: '开始复习' + n, sub: '按「今天最多」的数量', c: 'linear-gradient(140deg,#5B8CFF,#3D6BFF)', ic: '<svg viewBox="0 0 24 24"><path d="M5 12h12M12 6l6 6-6 6"/></svg>' }) +
        optHtml({ k: 'sel', label: '复习选中的题', sub: '在列表里勾选过的题', c: 'linear-gradient(140deg,#22C3A6,#0EA5E9)', ic: '<svg viewBox="0 0 24 24"><path d="M4.5 12.5l4 4L19 6.5"/></svg>' }) +
        optHtml({ k: 'nocap', label: '全部到期', sub: '忽略上限，一次做完', c: 'linear-gradient(140deg,#FFB547,#FF7A59)', ic: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>' }) +
      '</ul>' +
      '<span class="u010x-live" aria-live="polite"></span>';

    btn.style.display = 'none';
    btn.parentNode.insertBefore(host, btn);

    main = host.querySelector('.u010x-main');
    caret = host.querySelector('.u010x-caret');
    lab = host.querySelector('.u010x-lab');
    menu = host.querySelector('.u010x-menu');
    live = host.querySelector('.u010x-live');
    opts = Array.prototype.slice.call(host.querySelectorAll('.u010x-opt'));
    document.body.appendChild(menu);          /* 挂到 body：卡片有 overflow 会裁掉下拉 */

    action = 'all';
    setLabel(n ? '开始复习' + n : '开始复习');
    markOpts();

    caret.addEventListener('click', function () { setOpen(host.dataset.open !== '1', true); });
    main.addEventListener('click', run);
    opts.forEach(function (o, i) {
      o.addEventListener('click', function () {
        action = o.dataset.act;
        setLabel(o.dataset.label);
        markOpts();
        setOpen(false);
        caret.focus({ preventScroll: true });
      });
      o.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (d) { e.preventDefault(); opts[(i + d + opts.length) % opts.length].focus(); }
      });
    });
    host.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && host.dataset.open === '1') { e.preventDefault(); setOpen(false); caret.focus({ preventScroll: true }); }
    });
  }

  function markOpts() {
    opts.forEach(function (o) { o.setAttribute('aria-checked', String(o.dataset.act === action)); });
  }
  function setLabel(t) { if (lab && lab.textContent !== t) lab.textContent = t; }
  function placeMenu() {
    if (!menu || !host) return;
    var r = host.querySelector('.u010x-grp').getBoundingClientRect();
    var w = Math.min(260, window.innerWidth - 24);
    menu.style.width = w + 'px';
    var left = r.right - w;
    if (left < 12) left = 12;
    menu.style.left = left + 'px';
    menu.style.right = 'auto';
    menu.style.top = (r.bottom + 8) + 'px';
  }

  function setOpen(v, focus) {
    if (v) placeMenu();
    host.dataset.open = v ? '1' : '0';
    menu.classList.toggle('is-on', !!v);
    caret.setAttribute('aria-expanded', String(v));
    opts.forEach(function (o) { o.tabIndex = v ? 0 : -1; });
    if (v && focus) setTimeout(function () { var c = opts.filter(function (o) { return o.dataset.act === action; })[0] || opts[0]; c.focus({ preventScroll: true }); }, 30);
  }

  function fire() {
    if (action === 'all') { var b = orig(); if (b) b.click(); return; }
    if (action === 'sel') { var s = origSel(); if (s && !s.disabled) s.click(); else if (window.toast) toast('先在列表里勾几道题'); return; }
    if (action === 'nocap') {
      var c = capSel();
      if (c) { c.value = '0'; c.dispatchEvent(new Event('change', { bubbles: true })); }
      setTimeout(function () { var b2 = orig(); if (b2) b2.click(); }, 60);
    }
  }

  function run() {
    if (host.dataset.state === 'busy') return;
    setOpen(false);
    host.dataset.state = 'busy';
    live.textContent = '正在生成复习卷';
    setTimeout(fire, rm ? 0 : 320);
    clearTimeout(busyT);
    busyT = setTimeout(function () {
      host.dataset.state = 'done';
      live.textContent = '已生成';
      setTimeout(function () {
        host.dataset.state = 'idle';
        var n = orig() ? ('（' + (orig().textContent.match(/\d+/) || [''])[0] + ' 题）') : '';
        live.textContent = '';
      }, rm ? 900 : 2400);
    }, rm ? 200 : 1100);
  }

  function mount() {
    var b = orig();
    if (!b || !b.parentNode) return;
    if (root && root.isConnected && host && host.isConnected) {
      /* 已挂载：数量变了就更新标签 */
      var t = b.textContent.replace(/^\s*开始复习/, '').trim();
      if (t && action === 'all') setLabel('开始复习' + t);
      return;
    }
    root = b.parentNode;
    Array.prototype.forEach.call(document.querySelectorAll('.u010x'), function (e) {
      if (e !== host) { try { e.remove(); } catch (e0) {} }
    });
    build(b);
  }

  var raf = 0;
  function boot() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      if (!/^#\/wrong/.test(location.hash || '')) return;
      mount();
    });
  }
  document.addEventListener('pointerdown', function (e) {
    if (!host || host.dataset.open !== '1') return;
    if (host.contains(e.target) || (menu && menu.contains(e.target))) return;
    setOpen(false);
  }, true);
  window.addEventListener('resize', function () { if (host && host.dataset.open === '1') placeMenu(); });
  window.addEventListener('scroll', function () { if (host && host.dataset.open === '1') placeMenu(); }, { passive: true });

  window.addEventListener('hashchange', function () { setTimeout(function () { host = null; root = null; boot(); }, 150); });
  document.addEventListener('click', function () { setTimeout(boot, 80); }, true);
  try { new MutationObserver(function () { boot(); }).observe(document.body, { childList: true }); } catch (e0) {}
  setTimeout(boot, 400);
})();
