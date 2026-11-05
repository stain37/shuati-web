/* ============================================================
   fxs.js — 20 个动效规格的接线层（2026-11-05 / web267）
   fxs.css 提供 @keyframes 与 fx- 类；这里负责「什么时候加类」：
     01 slide-swap    → 答题页换题时 .qcard 左右滑动
     03 stagger       → 换页时列表/网格子项错开入场（只播一次）
     07 bounce-in     → 收藏星标点亮时弹一下
     18 scale-out     → 关闭弹窗（hideMask 前先播 220ms 缩小淡出）
     14 spinner-dots  → 对话「正在思考」补三点动画
   注意：本文件与既有 fx.js（交卷彩带）无关，别互相覆盖。
   ============================================================ */
(function () {
  'use strict';
  if (window.FXS) return;

  function reduced() {
    try {
      if (document.body && document.body.classList.contains('reduce-motion')) return true;
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }
  function g(name) { try { return (0, eval)(name); } catch (e) { return null; } }

  var lastSig = '', lastQId = '', lastIdx = -1, lastFav = null, stagUntil = 0;

  /* ---------- 01 换题：左右滑动 ---------- */
  /* 站点里 QZ.cur 是「当前题目 id 字符串」，题目对象要从 bankById(...).questions 里找 */
  function curBank() { try { var QZ = g('QZ'); return QZ && QZ.bankId ? g('bankById')(QZ.bankId) : null; } catch (e) { return null; } }
  function curQ() {
    var QZ = g('QZ'); if (!QZ || !QZ.cur) return null;
    var bank = curBank();
    if (!bank || !bank.questions) return null;
    for (var i = 0; i < bank.questions.length; i++) if (bank.questions[i].id === QZ.cur) return bank.questions[i];
    return null;
  }
  function curIdx() {
    var QZ = g('QZ'); var bank = curBank();
    if (!QZ || !bank || !bank.questions) return 0;
    for (var i = 0; i < bank.questions.length; i++) if (bank.questions[i].id === QZ.cur) return i;
    return 0;
  }
  function swapQuestion() {
    var q = curQ();
    if (!q) return;
    var qid = q.id || '';
    var idx = curIdx();
    var card = document.querySelector('#view .qcard');
    if (!card) { lastQId = qid; lastIdx = idx; return; }
    if (!lastQId) { lastQId = qid; lastIdx = idx; card.classList.add('fx-q-enter'); return; }
    if (qid === lastQId) return;
    var dir = idx >= lastIdx ? 'next' : 'prev';
    lastQId = qid; lastIdx = idx;
    if (reduced()) return;
    card.classList.remove('fx-swap-next', 'fx-swap-prev', 'fx-q-enter');
    void card.offsetWidth;
    card.classList.add(dir === 'next' ? 'fx-swap-next' : 'fx-swap-prev');
    var clear = function () { card.classList.remove('fx-swap-next', 'fx-swap-prev'); };
      card.addEventListener('animationend', clear, { once: true });
      setTimeout(clear, 1400);
  }

  /* ---------- 03 错开入场（只在换页时播一次） ---------- */
  /* 站点里真正的列表/网格容器：顶层卡片、KPI 行、工具行、知识库行、目录树、折叠区、标签统计 */
  var STAG_SEL = '#view > .card:not(.qcard), #view .stats, #view .tools, #kbRows, #nbTree, #view .fold-body, #view .tag-stats-sub';
  function markStagger() {
    if (reduced()) return;
    var boxes = document.querySelectorAll(STAG_SEL);
    for (var b = 0; b < boxes.length; b++) {
      var box = boxes[b];
      if (box.classList.contains('qcard')) continue;   /* 题目卡有换题滑动，不叠错开 */
      if (box.dataset.fxsStag === '1') continue;
      box.dataset.fxsStag = '1';
      box.classList.add('fx-stagger');
      var kids = box.children;
      if (kids.length < 3) { box.classList.remove('fx-stagger'); box.dataset.fxsStag = ''; continue; }
      for (var i = 0; i < kids.length && i < 10; i++) kids[i].style.setProperty('--fx-i', String(i));
      (function (el) { setTimeout(function () { if (el.dataset) el.dataset.fxsStag = ''; }, 1500); })(box);
    }
  }

  /* ---------- 07 收藏星标点亮 ---------- */
  function starBounce() {
    var QZ = g('QZ');
    if (!QZ || !QZ.q) return;
    var bank = QZ.bank || null;
    var key = bank ? (bank.id + '#' + QZ.q.id) : QZ.q.id;
    var now = null;
    try {
      var raw = localStorage.getItem('qbank.fav.v1');
      var obj = raw ? JSON.parse(raw) : {};
      now = !!obj[key] || !!obj[QZ.q.id];
    } catch (e) { now = null; }
    if (now === null) return;
    if (lastFav !== null && now !== lastFav && now) {
      var btn = document.querySelector('#view .fav-btn');
      if (btn && !reduced()) {
        btn.classList.remove('fx-bounce'); void btn.offsetWidth; btn.classList.add('fx-bounce');
        var clr = function () { btn.classList.remove('fx-bounce'); };
      btn.addEventListener('animationend', clr, { once: true });
      setTimeout(clr, 1400);
      }
    }
    lastFav = now;
  }

  /* ---------- 14 「正在思考」三点 ---------- */
  function dots() {
    if (reduced()) return;
    var st = document.querySelectorAll('.chat-status:not([data-fxs-dots])');
    for (var i = 0; i < st.length; i++) {
      var el = st[i];
      el.setAttribute('data-fxs-dots', '1');
      if (el.querySelector('.fx-dots')) continue;
      var dot = el.querySelector('.ch-dot');
      if (!dot) continue;
      var box = document.createElement('span');
      box.className = 'fx-dots';
      box.innerHTML = '<i></i><i></i><i></i>';
      dot.parentNode.insertBefore(box, dot);
      dot.style.display = 'none';
    }
  }

  function afterRender() {
    var hash = location.hash || '#/';
    var QZ = g('QZ');
    var isQuiz = !!(QZ && (QZ.cur || QZ.bankId)) &&
      (hash.indexOf('#/bank') === 0 || hash.indexOf('#/quiz') === 0 || hash.indexOf('#/paper') === 0);
    var sig = isQuiz ? ('quiz:' + ((QZ.bank && QZ.bank.id) || '')) : hash;
    var changed = sig !== lastSig;
    if (changed) { lastSig = sig; stagUntil = Date.now() + 1400; }   /* 异步渲染的页在 1.4s 内持续补标记 */

    if (isQuiz) swapQuestion();
    else { lastQId = ''; lastIdx = -1; }

    try { (window.FXS.log = window.FXS.log || []).push(sig + '|' + changed); if (window.FXS.log.length > 40) window.FXS.log.shift(); } catch (e) {}
    if (Date.now() < stagUntil) markStagger();
    starBounce();
    dots();
  }

  function start() {
    var view = document.getElementById('view');
    if (!view) return;
    var pending = false;
    var mo = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; try { afterRender(); } catch (e) {} });
    });
    /* subtree:true —— 页面有时是「重画某个子节点」而不是换掉整个 #view */
    mo.observe(view, { childList: true, subtree: true });
    /* 异步渲染的页（知识库要等 IndexedDB、统计要算数据）补几次重扫 */
    window.addEventListener('hashchange', function () {
      [40, 160, 420, 900].forEach(function (ms) {
        setTimeout(function () { try { afterRender(); } catch (e) {} }, ms);
      });
    });
    try { afterRender(); } catch (e) {}
  }

  window.FXS = { refresh: afterRender, reduced: reduced };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
