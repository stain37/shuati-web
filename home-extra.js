/* home-extra.js —— 首页「最近 30 天」条形 + 今日学习看板
   看板数据：qbank.home.board.v2 = { d, t: { id: { status: 'todo'|'doing'|'done', checked: bool } } }
   旧版 qbank.home.board.v1（按列存 pos）会在读取时自动迁移。
   手势：4px 阈值仲裁（触屏 8px / 长按 250ms），hotspot 不参与拖拽。 */
(function () {
  'use strict';
  var BOARD_KEY = 'qbank.home.board.v2';
  var OLD_KEY = 'qbank.home.board.v1';
  var STATUS = ['todo', 'doing', 'done'];
  var COL_NAME = ['待开始', '进行中', '已完成'];

  function ls(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return dayKey(new Date()); }

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

  /* ---------- 数据 ---------- */
  function cardsDue() {
    var s = ls('qbank.cards.sched.v1', {}) || {};
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
  var CUSTOM_KEY = 'qbank.home.board.custom.v1';
  var HIDE_KEY = 'qbank.home.board.hide.v1';
  function customTasks() {
    var a = ls(CUSTOM_KEY, []);
    return Array.isArray(a) ? a : [];
  }
  function saveCustom(a) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(a)); } catch (e) {} }
  function hiddenIds() {
    var a = ls(HIDE_KEY, []);
    return Array.isArray(a) ? a : [];
  }
  function saveHidden(a) { try { localStorage.setItem(HIDE_KEY, JSON.stringify(a)); } catch (e) {} }

  function taskDefs() {
    var rv = reviewDue(), cd = cardsDue();
    /* TASK-01：大任务拆成 2–4 个小步，做完一步勾一步；系统任务打「系统」标 */
    var rsubs = [];
    if (rv) {
      var per = 8, n = Math.min(4, Math.ceil(rv / per));
      for (var i = 0; i < n; i++) {
        var a = i * per + 1, b = Math.min(rv, (i + 1) * per);
        rsubs.push({ id: 'r' + i, label: '第 ' + (i + 1) + ' 组 · ' + (b - a + 1) + ' 道（' + a + '–' + b + '）' });
      }
    }
    var csubs = [];
    if (cd) {
      var n2 = Math.min(3, Math.max(1, Math.ceil(cd / 20)));
      for (var j = 0; j < n2; j++) csubs.push({ id: 'c' + j, label: '第 ' + (j + 1) + ' 批 · 约 ' + Math.ceil(cd / n2) + ' 张' });
    }
    return [
      { id: 'review', sys: 1, subject: '复习', title: '每日复习', meta: rv ? rv + ' 道到期' : '今天没有到期', href: '#/wrong', ico: '🔁', estimate: rv ? Math.min(30, rv * 2) : 0, autoDone: rv === 0, subs: [] },
      { id: 'cards', sys: 1, subject: '考点卡', title: '背考点卡', meta: cd ? cd + ' 张待背' : '都背完了', href: '#/cards', ico: '🃏', estimate: cdc(cd), autoDone: cd === 0, subs: csubs },
      { id: 'kp', subject: '知识点', title: '整理 / 练知识点', meta: '从最弱的子树出 30 题', href: '#/kp', ico: '🧩', estimate: 20, autoDone: false, subs: [{ id: 'k0', label: '看一眼盲区（没挂卡的考点）' }, { id: 'k1', label: '从最弱子树出 30 题' }] },
      { id: 'redo', sys: 1, subject: '错题', title: '错题重做 20 题', meta: '只看做错过的，答对就订正', href: '#/wrong', ico: '📕', estimate: 12, autoDone: false, subs: [] },
      { id: 'rand', subject: '套卷', title: '随机 30 题', meta: '抽一遍当热身', href: '#/bank', ico: '🎲', estimate: 15, autoDone: false, subs: [] },
      { id: 'notes', subject: '笔记', title: '复习知识点笔记', meta: '把标记过的笔记过一遍', href: '#/notes', ico: '📒', estimate: 10, autoDone: false, subs: [] }
    ].concat(customTasks().map(function (c) {
      return { id: c.id, subject: c.subject || '自定义', title: c.title, meta: c.meta || '自己加的', href: c.href || '', ico: c.ico || '📌', estimate: c.min || 0, autoDone: false, subs: [], custom: 1 };
    })).filter(function (t) { return !hiddenIds().length || hiddenIds().indexOf(t.id) < 0; });
  }
  function cdc(n) { return n ? Math.min(40, n * 2) : 0; }

  function boardState() {
    var b = ls(BOARD_KEY, null);
    if (b && b.d === today() && b.t && typeof b.t === 'object') return b;
    var out = { d: today(), t: {} };
    var old = ls(OLD_KEY, null);
    if (old && old.d === today() && old.pos) {
      Object.keys(old.pos).forEach(function (id) {
        var c = Number(old.pos[id]) || 0;
        out.t[id] = { status: STATUS[c] || 'todo', checked: c === 2 };
      });
    }
    return out;
  }
  function saveBoard(b) { try { localStorage.setItem(BOARD_KEY, JSON.stringify(b)); } catch (e) {} }
  function entry(b, id) { return b.t[id] || (b.t[id] = { status: 'todo', checked: false }); }

  /* ---------- 渲染 ---------- */
  function subsHtml(t, e) {
    var subs = (t && t.subs) || [];
    if (!subs.length) return '';
    var done = e.subs || {};
    var n = subs.filter(function (x) { return done[x.id]; }).length;
    return '<div class="bd-steps" role="group" aria-label="小步骤">'
      + '<div class="bd-steph"><span>小步</span><b>' + n + ' / ' + subs.length + '</b></div>'
      + subs.map(function (x) {
          return '<button class="bd-step' + (done[x.id] ? ' on' : '') + '" type="button" data-sub="' + x.id + '">'
            + '<i aria-hidden="true"></i><span>' + x.label + '</span></button>';
        }).join('')
      + '</div>';
  }

  function cardHtml(t, e) {
    var checked = e.checked || t.autoDone;
    var dueSoon = t.dueAt && t.dueAt > Date.now() && t.dueAt - Date.now() < 3 * 3600e3 && e.status !== 'done';
    var pr = t.progress;
    var prog = pr && pr.total ? Math.round(pr.done / pr.total * 100) : 0;
    return '<div class="bd-card' + (e.status === 'done' ? ' done' : '') + '" data-id="' + t.id + '" data-hash="' + t.href + '" tabindex="0" role="button" aria-label="' + t.title + '">'
      + '<button class="bd-send" type="button" tabindex="-1" aria-label="快捷改状态">⋯</button>'
      + '<div class="bd-l1"><i class="bd-dot' + (checked ? ' on' : '') + '" aria-hidden="true"></i><u class="bd-subj">' + t.subject + '</u><span class="bd-ico">' + t.ico + '</span></div>'
      + '<div class="bd-tx"><b>' + t.title + (t.sys ? '<em class="bd-sys" title="系统按你的复习计划生成">系统</em>' : '') + '</b><span>' + t.meta + '</span></div>'
      + subsHtml(t, e)
      + (dueSoon ? '<em class="bd-due">剩余 ' + Math.max(1, Math.round((t.dueAt - Date.now()) / 36e5)) + 'h</em>' : '')
      + (t.estimate ? '<span class="bd-est">' + t.estimate + 'min</span>' : '')
      + (pr && pr.total ? '<span class="bd-bar"><i style="width:' + prog + '%"></i></span>' : '')
      + '<i class="bd-tick" aria-hidden="true"></i></div>';
  }

  function boardHtml() {
    var b = boardState(), ts = taskDefs();
    var by = { todo: [], doing: [], done: [] };
    ts.forEach(function (t) { var e = entry(b, t.id); by[e.status === 'doing' ? 'doing' : e.status === 'done' ? 'done' : 'todo'].push({ t: t, e: e }); });
    var folded = false;
    try { folded = localStorage.getItem('qbank.home.board.fold.v1') === '1'; } catch (e0) {}
    var head = '<div class="bd-hd"><div><b>今日任务</b></div>'
      + '<button class="bd-fold" type="button" data-bd-fold aria-expanded="' + (folded ? 'false' : 'true') + '" title="' + (folded ? '展开' : '收起') + '">' + (folded ? '▸' : '▾') + '</button>'
      + '<button class="bd-add" type="button" data-add-task title="加一张自己的任务卡">＋ 加任务</button></div>';
    var body = ['todo', 'doing', 'done'].map(function (st, ci) {
      var items = by[st];
      var inner = items.length ? items.map(function (x) { return cardHtml(x.t, x.e); }).join('')
        : '<div class="bd-empty">' + (ci === 1 ? '<b>⌛</b><span>专注当下</span>' : ci === 2 ? '<b>🏆</b><span>今日战利品</span>' : '<b>☕</b><span>今天没排事</span>') + '</div>';
      return '<div class="bd-col' + (items.length ? '' : ' is-empty') + '" data-col="' + ci + '" data-st="' + st + '" role="list" aria-label="' + COL_NAME[ci] + '">'
        + '<div class="bd-ch"><span>' + COL_NAME[ci] + '</span><b>' + items.length + '</b></div>' + inner + '</div>';
    }).join('');
    return head + '<div class="bd-bd' + (folded ? ' is-fold' : '') + '">' + body + '</div>';
  }

  var renderedFor = null;
  function render(box) {
    if (!box) return;
    var sig = location.hash + '|' + box.clientWidth;
    if (box.dataset.sig === sig && box.innerHTML) return;
    box.dataset.sig = sig;
    box.innerHTML = '<div class="hm30 card-soft">' + barsHtml() + '</div>' + '<div class="bd">' + boardHtml() + '</div>';
    bind(box);
  }
  function render2(box) { box.dataset.sig = ''; render(box); }

  /* ---------- 手势：4px 仲裁 + hotspot ---------- */
  function bind(box) {
    var fb = box.querySelector('[data-bd-fold]');
    if (fb) fb.addEventListener('click', function () {
      var on = true;
      try { on = localStorage.getItem('qbank.home.board.fold.v1') === '1'; } catch (e0) {}
      try { localStorage.setItem('qbank.home.board.fold.v1', on ? '0' : '1'); } catch (e1) {}
      box.dataset.sig = ''; render(box);
    });
    var bd = box.querySelector('.bd-bd');
    box.querySelectorAll('.bd-card').forEach(function (el) { bindCard(box, el); });
    var add = box.querySelector('[data-add-task]');
    if (add) add.addEventListener('click', function (ev) { ev.stopPropagation(); addTaskFlow(box); });
    if (bd) bindCols(box, bd);
  }

  function toggleSub(box, id, subId) {
    var b = boardState(), e = entry(b, id);
    e.subs = e.subs || {};
    if (e.subs[subId]) delete e.subs[subId]; else e.subs[subId] = 1;
    saveBoard(b);
    box.dataset.sig = '';
    render(box);
  }

  function bindCard(box, el) {
    var down = null, drag = null, timer = 0;

    var raf = 0, last = null;
    function paint() {
      raf = 0;
      if (!drag || !last) return;
      drag.el.style.transform = 'translate3d(' + last.x + 'px,' + last.y + 'px,0) rotate(2deg) scale(1.02)';
    }
    function startDrag(ev) {
      drag = { el: el, id: el.dataset.id };
      el.classList.add('lift');
      el.style.touchAction = 'none';
      var bd = el.closest('.bd-bd'); if (bd) bd.classList.add('dragging');
      if (ev && ev.pointerId != null) { el.style.pointerEvents = 'none'; try { el.setPointerCapture(ev.pointerId); } catch (e0) {} }
    }
    function cancelDrag() {
      clearTimeout(timer);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (drag) {
        drag.el.classList.remove('lift');
        drag.el.style.transform = ''; drag.el.style.pointerEvents = ''; drag.el.style.touchAction = '';
        var bd = drag.el.closest('.bd-bd'); if (bd) bd.classList.remove('dragging');
      }
      drag = null; down = null; last = null;
      box.querySelectorAll('.bd-col.hot').forEach(function (c) { c.classList.remove('hot'); });
    }

    el.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 && ev.pointerType === 'mouse') return;
      if (ev.target.closest('.bd-send')) { openMenu(box, el, ev); return; }
      var sb = ev.target.closest('.bd-step');
      if (sb) { toggleSub(box, el.dataset.id, sb.dataset.sub); return; }
      down = { x: ev.clientX, y: ev.clientY, moved: false, touch: ev.pointerType === 'touch' };
      el.style.touchAction = down.touch ? 'pan-y' : '';
      if (down.touch) timer = setTimeout(function () { if (down && !drag) startDrag(null, true); }, 250);
    });

    el.addEventListener('pointermove', function (ev) {
      if (!down || ev.pointerId == null) return;
      var dx = ev.clientX - down.x, dy = ev.clientY - down.y;
      var th = down.touch ? 8 : 4;
      if (!drag && Math.abs(dx) + Math.abs(dy) > th) { clearTimeout(timer); startDrag(ev); }
      if (!drag) return;
      last = { x: dx, y: dy };
      if (!raf) raf = requestAnimationFrame(paint);
      var under = document.elementFromPoint(ev.clientX, ev.clientY);
      var col = under && under.closest ? under.closest('.bd-col') : null;
      box.querySelectorAll('.bd-col').forEach(function (c) { c.classList.toggle('hot', c === col); });
    });

    el.addEventListener('pointerup', function (ev) {
      clearTimeout(timer);
      if (drag) {
        var under = document.elementFromPoint(ev.clientX, ev.clientY);
        var col = under && under.closest ? under.closest('.bd-col') : null;
        var id = drag.id;
        cancelDrag();
        if (col) setStatus(box, id, col.dataset.st);
        return;
      }
      var clicked = down && !down.moved;
      down = null;
      if (clicked) { var h = el.dataset.hash; if (h) location.hash = h; }
    });

    el.addEventListener('pointercancel', cancelDrag);
    el.addEventListener('keydown', function (ev) {
      var b = boardState(), e = entry(b, el.dataset.id), idx = STATUS.indexOf(e.status);
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        var next = STATUS[Math.max(0, Math.min(2, idx + (ev.key === 'ArrowRight' ? 1 : -1)))];
        setStatus(box, el.dataset.id, next);
        var again = box.querySelector('.bd-card[data-id="' + el.dataset.id + '"]');
        if (again) again.focus();
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault(); var h = el.dataset.hash; if (h) location.hash = h;
      }
    });
  }

  function closeSheet(box) {
    var sh = box.querySelector('.bd-sheet');
    if (sh) sh.remove();
  }
  function addTaskFlow(box) {
    closeSheet(box);
    var sh = document.createElement('div');
    sh.className = 'bd-sheet';
    sh.innerHTML = '<div class="bd-sheet-c" role="dialog" aria-label="加一张任务卡">'
      + '<div class="bd-sh-h"><b>加一张任务卡</b><button type="button" class="bd-sh-x" aria-label="关闭">✕</button></div>'
      + '<input class="bd-sh-in" maxlength="40" placeholder="要做什么？例如：背 30 个英文缩写">'
      + '<div class="bd-sh-lb">点开去哪儿</div>'
      + '<div class="bd-chips" data-pick="href">'
      + '<button type="button" data-h="" class="on">不跳转</button>'
      + '<button type="button" data-h="#/wrong">错题本</button>'
      + '<button type="button" data-h="#/cards">考点卡</button>'
      + '<button type="button" data-h="#/kp">知识点</button>'
      + '<button type="button" data-h="#/notes">笔记</button></div>'
      + '<div class="bd-sh-lb">图标</div>'
      + '<div class="bd-chips" data-pick="ico">'
      + '<button type="button" data-i="📌" class="on">📌</button>'
      + '<button type="button" data-i="🔁">🔁</button>'
      + '<button type="button" data-i="🃏">🃏</button>'
      + '<button type="button" data-i="🧩">🧩</button>'
      + '<button type="button" data-i="📕">📕</button>'
      + '<button type="button" data-i="🎲">🎲</button>'
      + '<button type="button" data-i="📒">📒</button></div>'
      + '<div class="bd-sh-b"><button type="button" class="bd-sh-cancel">取消</button>'
      + '<button type="button" class="bd-sh-ok" disabled>加入看板</button></div></div>';
    box.querySelector('.bd').appendChild(sh);
    var inp = sh.querySelector('.bd-sh-in'), ok = sh.querySelector('.bd-sh-ok');
    var href = '', ico = '📌';
    inp.focus();
    inp.addEventListener('input', function () { ok.disabled = !inp.value.trim(); });
    inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ok.disabled) ok.click(); });
    sh.querySelectorAll('.bd-chips').forEach(function (row) {
      row.addEventListener('click', function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        row.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        if (row.dataset.pick === 'href') href = b.dataset.h || '';
        else ico = b.dataset.i || '📌';
      });
    });
    sh.addEventListener('click', function (ev) { if (ev.target === sh) closeSheet(box); });
    sh.querySelector('.bd-sh-x').addEventListener('click', function () { closeSheet(box); });
    sh.querySelector('.bd-sh-cancel').addEventListener('click', function () { closeSheet(box); });
    ok.addEventListener('click', function () {
      var title = inp.value.trim();
      if (!title) return;
      var a = customTasks();
      a.push({ id: 'u_' + Date.now().toString(36), title: title, href: href, ico: ico, subject: '自定义', meta: href ? '点开直达' : '自己加的', min: 10 });
      saveCustom(a);
      closeSheet(box);
      box.dataset.sig = ''; render(box);
    });
  }

  function bindCols(box, bd) {
    if (window.__bdDeleg) return;
    window.__bdDeleg = 1;
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('.bd-menu button');
      if (!b) return;
      ev.stopPropagation();
      var host = b.closest('#homeExtra');
      closeMenu(host);
      var id = b.dataset.for;
      if (b.dataset.del) {
        saveCustom(customTasks().filter(function (c) { return c.id !== id; }));
        host.dataset.sig = ''; render(host);
        return;
      }
      if (b.dataset.hide) {
        var hs = hiddenIds(); if (hs.indexOf(id) < 0) hs.push(id); saveHidden(hs);
        host.dataset.sig = ''; render(host);
        return;
      }
      setStatus(host, id, b.dataset.st);
    });
    document.addEventListener('pointerdown', function (ev) {
      if (!ev.target.closest('.bd-menu') && !ev.target.closest('.bd-send')) {
        var host = ev.target.closest('#homeExtra');
        if (host) closeMenu(host);
      }
    });
  }

  function openMenu(box, el, ev) {
    ev.preventDefault(); ev.stopPropagation();
    closeMenu(box);
    var b = boardState(), e = entry(b, el.dataset.id);
    var id = el.dataset.id;
    var opts = [['doing', '移入进行中'], ['done', '标记完成'], ['todo', '放回待开始']].filter(function (o) { return o[0] !== e.status; });
    var menu = document.createElement('div');
    menu.className = 'bd-menu';
    var isCustom = /^u_/.test(id);
    menu.innerHTML = opts.map(function (o) { return '<button type="button" data-for="' + id + '" data-st="' + o[0] + '">' + o[1] + '</button>'; }).join('')
      + (isCustom
        ? '<button type="button" class="bd-del" data-for="' + id + '" data-del="1">删除这张卡</button>'
        : '<button type="button" class="bd-del" data-for="' + id + '" data-hide="1">从看板隐藏</button>');
    var r = el.getBoundingClientRect(), host = el.closest('.bd-col').getBoundingClientRect();
    menu.style.left = Math.min(r.right - host.left - 150, host.width - 160) + 'px';
    menu.style.top = (r.top - host.top + 8) + 'px';
    el.closest('.bd-col').appendChild(menu);
  }
  function closeMenu(box) { box.querySelectorAll('.bd-menu').forEach(function (m) { m.remove(); }); }

  function setStatus(box, id, st) {
    if (STATUS.indexOf(st) < 0) return;
    var b = boardState(), e = entry(b, id);
    e.status = st;
    if (st === 'done') e.checked = true;
    saveBoard(b);
    render2(box);
  }

  /* 首页由 app.js 渲染时没有 #homeExtra 占位，这里自己建一个（插在 hero 之后） */
  function ensureBox() {
    var box = document.getElementById('homeExtra');
    if (box) return box;
    var view = document.getElementById('view');
    if (!view) return null;
    var hero = view.querySelector('.hero');
    if (!hero) return null;
    box = document.createElement('div');
    box.id = 'homeExtra';
    box.className = 'home-extra';
    hero.parentNode.insertBefore(box, hero.nextSibling);
    return box;
  }

  function scan() {
    var box = ensureBox();
    if (box) render(box);
  }
  if (document.readyState !== 'loading') scan();
  document.addEventListener('DOMContentLoaded', scan);
  window.addEventListener('resize', scan);
  new MutationObserver(function () {
    if (window.__homeExtraT) return;
    window.__homeExtraT = setTimeout(function () { window.__homeExtraT = 0; scan(); }, 60);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
