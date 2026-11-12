/* home-extra.js —— 首页「最近 30 天」条形 + 今日学习看板（拖拽）
   数据全部读现有 localStorage，不新增题库数据；看板顺序按天存 qbank.home.board.v1 */
(function () {
  'use strict';
  var BOARD_KEY = 'qbank.home.board.v1';

  function ls(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function dayKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  /* ---------- 最近 30 天 ---------- */
  function days30() {
    var ANS = ls('qbank.answers.v2', {}) || {};
    var cnt = {};
    Object.keys(ANS).forEach(function (k) {
      var a = ANS[k]; if (!a || !a.ts) return;
      var d = new Date(a.ts); cnt[dayKey(d)] = (cnt[dayKey(d)] || 0) + 1;
    });
    var out = [], base = new Date(); base.setHours(0, 0, 0, 0);
    for (var i = 29; i >= 0; i--) {
      var ts = base.getTime() - i * 86400000, d = new Date(ts);
      out.push({ ts: ts, n: cnt[dayKey(d)] || 0, label: (d.getMonth() + 1) + '/' + d.getDate() });
    }
    return out;
  }

  function barsHtml() {
    var ds = days30(), max = 1, total = 0, active = 0;
    ds.forEach(function (x) { if (x.n > max) max = x.n; total += x.n; if (x.n > 0) active++; });
    var bars = ds.map(function (x, i) {
      var h = x.n ? Math.max(10, Math.round(x.n / max * 100)) : 6;
      var lv = x.n === 0 ? 0 : x.n <= 2 ? 1 : x.n <= 5 ? 2 : x.n <= 10 ? 3 : 4;
      return '<i class="hm30-b" data-l="' + lv + '" style="height:' + h + '%;--i:' + i + '" title="' + x.label + ' · ' + x.n + ' 题"></i>';
    }).join('');
    var todayN = ds[ds.length - 1].n;
    var pill = todayN ? '<u class="hm30-pill ok">今天已练 ' + todayN + ' 题</u>' : '<u class="hm30-pill">今天还没练</u>';
    return '<div class="hm30-hd"><div><b>最近 30 天</b><span class="hm30-sub">共 ' + total + ' 题 · 活跃 ' + active + ' 天</span></div>' + pill + '</div>'
      + '<div class="hm30-bars" role="img" aria-label="最近 30 天每天做题数">' + bars + '</div>'
      + '<div class="hm30-ax"><span>30 天前</span><span>今天</span></div>';
  }

  /* ---------- 今日看板 ---------- */
  function cardsDue() {
    var s = ls('qbank.cards.sched.v1', {}) || {};
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var now = Date.now() / 1000, out = 0;
    Object.keys(s).forEach(function (k) {
      var st = s[k]; if (!st) return;
      if (st.type == null || st.type === 0) out++;
      else if (st.type === 2) { if (st.due <= 0) out++; }
      else if (st.due && st.due <= now) out++;
    });
    return out;
  }
  function reviewDue() {
    try {
      if (window.SRS && typeof SRS.dueList === 'function') return SRS.dueList().length;
    } catch (e) {}
    var s = ls('qbank.srs.v1', {}) || {};
    return Object.keys(s).length;
  }
  function tasks() {
    var t = [];
    var rv = reviewDue();
    t.push({ id: 'review', title: '复习到期的错题', meta: rv ? rv + ' 道到期' : '今天没有到期', href: '#/wrong', ico: '🔁' });
    var cd = cardsDue();
    t.push({ id: 'cards', title: '背考点卡', meta: cd ? cd + ' 张待背' : '都背完了', href: '#/cards', ico: '🃏' });
    t.push({ id: 'kp', title: '整理 / 练知识点', meta: '从最弱的子树出 30 题', href: '#/kp', ico: '🧩' });
    return t;
  }
  function boardState() {
    var b = ls(BOARD_KEY, null);
    if (!b || b.d !== today()) b = { d: today(), pos: {} };
    return b;
  }
  function saveBoard(b) { try { localStorage.setItem(BOARD_KEY, JSON.stringify(b)); } catch (e) {} }

  function boardHtml() {
    var b = boardState(), ts = tasks();
    var cols = ['待开始', '进行中', '已完成'];
    var by = [[], [], []];
    ts.forEach(function (t) { var p = b.pos[t.id]; by[p == null ? 0 : p].push(t); });
    var head = '<div class="bd-hd"><div><b>今天做什么</b><span class="bd-sub">拖动卡片改状态 · 点一下直接去</span></div></div>';
    var body = cols.map(function (name, ci) {
      var items = by[ci].map(function (t) {
        return '<div class="bd-card' + (ci === 2 ? ' done' : '') + '" data-id="' + t.id + '" data-hash="' + t.href + '" tabindex="0" role="button" aria-label="' + t.title + '">'
          + '<span class="bd-ico">' + t.ico + '</span><div class="bd-tx"><b>' + t.title + '</b><span>' + t.meta + '</span></div>'
          + '<i class="bd-tick" aria-hidden="true"></i></div>';
      }).join('');
      return '<div class="bd-col" data-col="' + ci + '" role="list" aria-label="' + name + '"><div class="bd-ch"><span>' + name + '</span><b>' + by[ci].length + '</b></div>' + items + '</div>';
    }).join('');
    return head + '<div class="bd-bd">' + body + '</div>';
  }

  /* ---------- 渲染与交互 ---------- */
  var renderedFor = null;
  function render(box) {
    if (!box) return;
    var sig = location.hash + '|' + box.clientWidth;
    if (box.dataset.sig === sig && box.innerHTML) return;
    box.dataset.sig = sig;
    box.innerHTML = '<div class="hm30 card-soft">' + barsHtml() + '</div>' + '<div class="bd">' + boardHtml() + '</div>';
    bind(box);
  }

  function bind(box) {
    var cards = box.querySelectorAll('.bd-card');
    cards.forEach(function (el) {
      var down = null;
      el.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return;
        down = { x: ev.clientX, y: ev.clientY, el: el, moved: false };
        el.setPointerCapture && el.setPointerCapture(ev.pointerId);
      });
      el.addEventListener('pointermove', function (ev) {
        if (!down || ev.pointerId == null) return;
        var dx = ev.clientX - down.x, dy = ev.clientY - down.y;
        if (!down.moved && Math.abs(dx) + Math.abs(dy) > 6) { down.moved = true; el.classList.add('lift'); }
        if (down.moved) el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(3deg) scale(1.03)';
      });
      el.addEventListener('pointerup', function (ev) {
        if (!down) return;
        var moved = down.moved; down = null;
        el.classList.remove('lift'); el.style.transform = '';
        if (!moved) { if (el.dataset.hash) location.hash = el.dataset.hash; return; }
        var under = document.elementFromPoint(ev.clientX, ev.clientY);
        var col = under && under.closest ? under.closest('.bd-col') : null;
        if (!col) return;
        var b = boardState();
        b.pos[el.dataset.id] = Number(col.dataset.col);
        saveBoard(b);
        render2(box);
      });
      el.addEventListener('keydown', function (ev) {
        var b = boardState(), cur = b.pos[el.dataset.id] || 0, next = cur;
        if (ev.key === 'ArrowRight') next = Math.min(2, cur + 1);
        else if (ev.key === 'ArrowLeft') next = Math.max(0, cur - 1);
        else if (ev.key === 'Enter' || ev.key === ' ') { if (el.dataset.hash) location.hash = el.dataset.hash; ev.preventDefault(); return; }
        else return;
        ev.preventDefault();
        b.pos[el.dataset.id] = next; saveBoard(b); render2(box);
        var again = box.querySelector('.bd-card[data-id="' + el.dataset.id + '"]');
        if (again) again.focus();
      });
    });
  }
  function render2(box) { box.dataset.sig = ''; render(box); }

  function scan() {
    var box = document.getElementById('homeExtra');
    if (box) render(box);
  }
  if (document.readyState !== 'loading') scan();
  document.addEventListener('DOMContentLoaded', scan);
  new MutationObserver(function () {
    if (window.__homeExtraT) return;
    window.__homeExtraT = setTimeout(function () { window.__homeExtraT = 0; scan(); }, 60);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
