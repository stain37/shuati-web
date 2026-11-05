/* ===== 全局快捷键补强 keys.js =====
   只补「原生没覆盖到」的几处，不去抢 app.js 已有的快捷键（A–H / Enter 提交 / ←→ / J K / S / O / ? / g 前缀）。

   1) Esc：没东西可关时 = 返回上一页（等同左上角 ← 返回）
   2) Tab / Shift+Tab：答题页在选项之间切换焦点
   3) Enter：侧栏搜索框里 = 打开第一条结果；弹窗里 = 点主按钮（输入框内仍是换行）
   4) Ctrl/Cmd+Enter：多行输入里也能提交（换行还是 Enter）
*/
(function () {
  'use strict';

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function isTyping(t) {
    if (!t) return false;
    var tag = t.tagName || '';
    return /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || !!t.isContentEditable;
  }
  function routeName() {
    try { return (typeof route === 'function') ? (route() || {}).name || '' : ''; }
    catch (e) { return ''; }
  }
  function back() {
    var h = location.hash || '';
    if (!h || h === '#/' || h === '#') return false;
    try {
      if (history.length > 1) { history.back(); return true; }
    } catch (e) {}
    if (typeof go === 'function') { go('#/'); return true; }
    return false;
  }
  /* 有没有「一按 Esc 就该关掉」的浮层：有就交给页面自己关，不要顺带返回上一页 */
  function overlayOpen() {
    try {
      if (document.querySelector('.mask.show, #pipLayer .pip-win')) return true;
      if (document.querySelector('.sim-mask.show')) return true;
      if (document.body.classList.contains('qside-drawer')) {
        var st = window.SIDE && window.SIDE.state ? window.SIDE.state() : null;
        if (!st || st.open) return true;
      }
      var m = $('qsMenu');
      if (m && m.offsetParent !== null) return true;
    } catch (e) {}
    return false;
  }

  /* ---------- 1) Esc：清空输入 → 关浮层 → 返回上一页 ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (e.defaultPrevented) return;
    var t = e.target;
    if (isTyping(t)) {
      /* 输入框里：有字先清空（搜到一半反悔），没字再失焦 */
      if (t.value) {
        t.value = '';
        try { t.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) {}
        e.preventDefault();
        return;
      }
      t.blur();
      return;
    }
    if (overlayOpen()) return;            /* 让页面自己的 Esc 逻辑去关 */
    if (back()) e.preventDefault();
  }, true);

  /* ---------- 2) Tab / Shift+Tab：答题页切换选项 ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
    var rn = routeName();
    if (rn !== 'quiz' && rn !== 'exam') return;
    if (isTyping(e.target)) return;
    var opts = Array.prototype.slice.call(document.querySelectorAll('.opts .opt'));
    if (opts.length < 2) return;
    var cur = document.activeElement;
    var i = opts.indexOf(cur);
    /* 只在「没焦点 / 焦点在选项上」时接管；焦点在顶栏按钮等地方时保留原生 Tab */
    if (i < 0 && cur && cur !== document.body) return;
    e.preventDefault();
    var n = opts.length;
    var next = i < 0 ? (e.shiftKey ? opts[n - 1] : opts[0])
      : opts[(i + (e.shiftKey ? -1 : 1) + n) % n];
    try { next.focus({ preventScroll: false }); } catch (err) { next.focus(); }
  }, true);

  /* ---------- 3) Enter：侧栏搜索打开第一条 / 弹窗点主按钮 ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    var t = e.target;
    if (!t) return;

    /* 侧栏搜索框：回车直接进第一条（题库或文件夹） */
    if (t.id === 'qsQ') {
      var row = document.querySelector('#qsList .qs-row') || document.querySelector('#qsList .qs-ch');
      if (row) { e.preventDefault(); row.click(); }
      return;
    }
    /* 侧栏搜索结果里按回车 = 打开当前行 */
    if (t.classList && t.classList.contains('qs-row')) {
      e.preventDefault();
      t.click();
      return;
    }
    /* 输入框 / 多行文本里回车一律保持原义（换行、或页面自己的提交） */
    if (t.tagName === 'TEXTAREA') return;
    if (isTyping(t)) return;

    /* 弹窗：焦点不在按钮上时，回车 = 点主按钮（确认） */
    var mask = document.querySelector('.mask.show');
    if (!mask) return;
    if (t.tagName === 'BUTTON' || t.tagName === 'A') return;
    var primary = mask.querySelector('.actions .btn.primary, .actions .btn.pri, .shead .btn.primary');
    if (primary) { e.preventDefault(); primary.click(); }
  }, true);   /* 捕获阶段：侧栏输入框自己的 keydown 会 stopPropagation，冒泡收不到 */

  /* ---------- 4) Ctrl/Cmd+Enter：多行输入里提交 ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
    var t = e.target;
    if (!t || t.tagName !== 'TEXTAREA') return;
    var mask = document.querySelector('.mask.show');
    if (!mask) return;
    var primary = mask.querySelector('.actions .btn.primary, .actions .btn.pri');
    if (primary) { e.preventDefault(); primary.click(); }
  }, false);

  /* ---------- 让侧栏的行可以被键盘选中（Tab 到它 + 回车打开） ---------- */
  (function tagRows() {
    function tag() {
      try {
        Array.prototype.forEach.call(document.querySelectorAll('#qsList .qs-row:not([tabindex])'), function (r) {
          r.setAttribute('tabindex', '0');
        });
      } catch (e) {}
    }
    tag();
    if ('MutationObserver' in window) {
      var box = document.getElementById('qsList');
      if (box) new MutationObserver(tag).observe(box, { childList: true, subtree: true });
    }
  })();
})();
