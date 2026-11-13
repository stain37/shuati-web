/* Lucian UX/UI Prompt #011 · MIT License (c) 2026 Seokwoooo · https://lucianlabs.dev/uxui-prompt/#011
   刷题站落点：知识点管理页（#/kp）右下角的「＋」浮钮——展开四个新建/导入动作，
   点完菜单收起、底部浮出一条状态。动作直接触发页面原有的按钮，不复制业务逻辑。 */
(function () {
  'use strict';
  if (window.UX011) return;
  window.UX011 = 1;

  var rm = false;
  try { rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e0) {}

  var ITEMS = [
    { k: 'new', txt: '新建知识点', c: 'linear-gradient(140deg,#8B6CFF,#5B6CFF)', note: '已打开新建表单',
      ic: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5V8h4M12.5 12v5M10 14.5h5"/>' },
    { k: 'fromtags', txt: '导入题库标签', c: 'linear-gradient(140deg,#22C3A6,#119C72)', note: '开始导入题库标签',
      ic: '<path d="M4 7h16v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M9 7V5h6v2"/>' },
    { k: 'impcsv', txt: '导入 CSV', c: 'linear-gradient(140deg,#5B8CFF,#3D6BFF)', note: '选择 CSV 文件',
      ic: '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M5 18h14"/>' },
    { k: 'export', txt: '导出', c: 'linear-gradient(140deg,#FFC24B,#F59E0B)', note: '正在导出知识点',
      ic: '<path d="M12 19V9M8 13l4-4 4 4"/><path d="M5 5h14"/>' }
  ];

  var host = null, fab = null, note = null, noteT = null, t = 0;

  function onKp() { return /^#\/kp\b/.test(location.hash || ''); }

  function build() {
    host = document.createElement('div');
    host.className = 'u011';
    host.innerHTML = '<span class="u011-halo" aria-hidden="true"></span>';
    ITEMS.forEach(function (it, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'u011-it';
      b.style.cssText = '--i:' + i + ';--x:' + [-(i * 62) + 0][0] + 'px';
      b.dataset.do = it.k;
      b.innerHTML = '<i aria-hidden="true"><svg viewBox="0 0 24 24">' + it.ic + '</svg></i><span>' + it.txt + '</span>';
      b.style.setProperty('--c', it.c);
      var ARC = [[-22, -110], [-68, -90], [-100, -52], [-114, -4]];
      b.style.setProperty('--x', ARC[i][0] + 'px');
      b.style.setProperty('--y', ARC[i][1] + 'px');
      host.appendChild(b);
    });
    fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'u011-fab';
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-label', '新建或导入');
    fab.innerHTML = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M14 6v16M6 14h16"/></svg>';
    host.appendChild(fab);
    note = document.createElement('p');
    note.className = 'u011-note';
    note.setAttribute('role', 'status');
    note.innerHTML = '<i aria-hidden="true"></i><span></span>';
    host.appendChild(note);
    noteT = note.querySelector('span');
    document.body.appendChild(host);
    bind();
  }

  function setOpen(v) {
    host.classList.toggle('is-open', v);
    fab.setAttribute('aria-expanded', String(v));
    fab.setAttribute('aria-label', v ? '收起' : '新建或导入');
    Array.prototype.forEach.call(host.querySelectorAll('.u011-it'), function (b) { b.tabIndex = v ? 0 : -1; });
  }

  function fire(k) {
    var target = null;
    if (k === 'new') target = document.querySelector('[data-kpu="new"]');
    else if (k === 'impcsv') target = document.querySelector('[data-kpu="impcsv"]');
    else if (k === 'fromtags') target = document.querySelector('[data-kpu="fromtags"]');
    else if (k === 'export') target = document.querySelector('[data-kpu="export"]');
    if (target) target.click();
    else if (window.toast) toast('这个页面还没准备好，稍等一秒再试');
  }

  function bind() {
    fab.addEventListener('click', function () { setOpen(!host.classList.contains('is-open')); });
    Array.prototype.forEach.call(host.querySelectorAll('.u011-it'), function (b) {
      b.addEventListener('click', function () {
        var it = ITEMS.filter(function (x) { return x.k === b.dataset.do; })[0] || {};
        b.classList.remove('is-picked'); void b.offsetWidth; b.classList.add('is-picked');
        clearTimeout(t);
        t = setTimeout(function () {
          setOpen(false);
          fire(b.dataset.do);
          if (rm) { note.classList.add('is-on'); noteT.textContent = it.note || '完成'; return; }
          noteT.textContent = it.note || '完成';
          note.classList.add('is-on');
          t = setTimeout(function () { note.classList.remove('is-on'); }, 1800);
        }, rm ? 0 : 240);
      });
    });
    host.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && host.classList.contains('is-open')) { e.preventDefault(); setOpen(false); fab.focus(); }
    });
    if (!window.__ux011Doc) {
      window.__ux011Doc = 1;
      document.addEventListener('pointerdown', function (e) {
        if (host && host.classList.contains('is-open') && !host.contains(e.target)) setOpen(false);
      });
    }
  }

  function sync() {
    if (!onKp()) { if (host) { host.remove(); host = null; } return; }
    if (!host) build();
  }
  window.addEventListener('hashchange', function () { setTimeout(sync, 120); });
  sync();
  document.addEventListener('click', function () { setTimeout(sync, 150); }, true);
})();
