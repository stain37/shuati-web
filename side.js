/* ===== 题库侧栏 side.js（文件管理器式：多层文件夹 / 新建文件夹 / 长按拖动归类） =====
   固定左侧：搜索 / 目录树（可多级折叠）/ 题库行（题数·已答·正确率）/ ⋯ 菜单
   宽屏（≥1100px）把正文整体右移；窄屏变成抽屉 + 左下悬浮按钮。
   拖动：桌面直接拖；触屏长按 420ms 拿起，松手落在哪个文件夹就归到哪。
   状态存 qbank.side.v1。 */
(function () {
  'use strict';

  var KEY = 'qbank.side.v1';
  var WIDE = '(min-width:1100px)';
  var LP_MS = 420;                       /* 触屏长按拿起 */

  function ls(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function E(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function wide() { try { return window.matchMedia(WIDE).matches; } catch (e) { return false; } }

  var S = { open: true, q: '', closed: {}, ai: false };
  var MT = { q: '', terms: [] };      /* 当前匹配上下文（paint 里算一次，catHtml 复用） */
  (function () {
    var v = ls(KEY, null);
    if (v && typeof v === 'object') {
      S.open = v.open !== false;
      S.closed = v.closed && typeof v.closed === 'object' ? v.closed : {};
      S.ai = !!v.ai;
    } else S.open = true;
    if (!wide()) S.open = false;
  })();

  /* ---------- 数据 ---------- */
  function banks() { try { return (typeof baseBanks === 'function') ? baseBanks().slice() : []; } catch (e) { return []; } }
  function cats() { try { return (window.CAT && CAT.all) ? (CAT.all() || []) : []; } catch (e) { return []; } }
  function kids(pid) {
    try { if (window.CAT && CAT.kids) return CAT.kids(pid) || []; } catch (e) {}
    return cats().filter(function (c) { return (c.parent || null) === (pid || null); });
  }
  function catPath(cid) {
    if (!cid || !window.CAT || !CAT.path) return [];
    try { return (CAT.path(cid) || []).map(function (c) { return (CAT.get(c) || {}).title || ''; }).filter(Boolean); } catch (e) { return []; }
  }
  function statOf(b) { try { return window.CAT && CAT.bankStat ? CAT.bankStat(b) : { n: b.questions.length, done: 0, acc: 0, pct: 0, wr: 0 }; } catch (e) { return { n: b.questions.length, done: 0, acc: 0, pct: 0, wr: 0 }; } }
  function curBankId() { try { return (typeof QZ === 'object' && QZ) ? QZ.bankId : null; } catch (e) { return null; } }

  /* 目录 id → 该目录直属题库（保留题库原有顺序） */
  function bankMap() {
    var m = {};
    banks().forEach(function (b) {
      var k = b.cat || '';
      (m[k] = m[k] || []).push(b);
    });
    Object.keys(m).forEach(function (k) {
      m[k].sort(function (a, b) {
        var ao = (a.ord == null ? 1e9 : +a.ord), bo = (b.ord == null ? 1e9 : +b.ord);
        return ao === bo ? String(a.title).localeCompare(String(b.title), 'zh') : ao - bo;
      });
    });
    return m;
  }

  /* ---------- DOM ---------- */
  function mount() {
    if ($('qSide')) return;
    var a = document.createElement('aside');
    a.id = 'qSide';
    a.className = 'qside';
    a.setAttribute('aria-label', '题库侧栏');
    a.innerHTML =
      '<div class="qs-head"><span class="qs-brand">📚 题库</span><span class="spacer-grow"></span>'
      + '<button type="button" class="qs-ico" id="qsDir" title="新建文件夹">📁＋</button>'
      + '<button type="button" class="qs-ico" id="qsNew" title="新建 / 导入题库">＋</button>'
      + '<button type="button" class="qs-ico" id="qsClose" title="收起侧栏（Alt+Q）">«</button></div>'
      + '<div class="qs-search"><label class="qs-find"><i>⌕</i><input id="qsQ" type="text" placeholder="搜题库 / 文件夹…" autocomplete="off" enterkeyhint="search"></label>'
      + '<button type="button" class="qs-ai" id="qsAi" title="AI 模糊：记不清名字也能找到"><span>✨</span></button></div>'
      + '<div class="qs-ainote" id="qsAiNote" hidden></div>'
      + '<div class="qs-list" id="qsList"></div>'
      + '<div class="qs-foot"><span id="qsStat"></span><button type="button" class="qs-all" id="qsAll">全部题库 ›</button></div>';
    document.body.appendChild(a);

    var mask = document.createElement('div');
    mask.id = 'qSideMask';
    mask.className = 'qside-mask';
    mask.onclick = function () { setOpen(false); };
    document.body.appendChild(mask);

    var tab = document.createElement('button');
    tab.id = 'qsTab';
    tab.type = 'button';
    tab.className = 'qs-tab';
    tab.title = '题库侧栏（Alt+Q）';
    tab.innerHTML = '<span>📚</span>';
    tab.onclick = function () { setOpen(true); };
    document.body.appendChild(tab);

    $('qsDir').onclick = function () { newFolder(null); };
    $('qsNew').onclick = function () { if (typeof go === 'function') go('#/import'); };
    $('qsClose').onclick = function () { setOpen(false); };
    $('qsAll').onclick = function () { if (typeof go === 'function') go('#/'); };
    $('qsAi').onclick = function () {
      S.ai = !S.ai; save();
      this.classList.toggle('on', S.ai);
      this.setAttribute('aria-pressed', S.ai ? 'true' : 'false');
      lastAIQ = ''; paint();
    };
    $('qsAi').classList.toggle('on', !!S.ai);
    $('qsAi').setAttribute('aria-pressed', S.ai ? 'true' : 'false');
    $('qsQ').addEventListener('input', function (e) { S.q = e.target.value || ''; paint(); });
    $('qsQ').addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') { e.target.value = ''; S.q = ''; paint(); }
    });
    var list = $('qsList');
    list.addEventListener('click', onListClick);
    list.addEventListener('dragstart', onDragStart);
    list.addEventListener('dragend', function () { endDrag(); });
    list.addEventListener('dragover', onDragOver);
    list.addEventListener('dragleave', function (e) { var d = e.target.closest && e.target.closest('[data-drop]'); if (d) d.classList.remove('drop-on'); });
    list.addEventListener('drop', onDrop);
    /* 触屏：长按拿起 */
    list.addEventListener('pointerdown', onPress, { passive: true });
    list.addEventListener('pointermove', onPressMove, { passive: false });
    list.addEventListener('pointerup', onPressEnd);
    list.addEventListener('pointercancel', function () { cancelPress(); endDrag(); });

    if (!window.__qsKey) {
      window.__qsKey = 1;
      window.addEventListener('keydown', function (e) {
        if (e.altKey && (e.key === 'q' || e.key === 'Q')) { e.preventDefault(); setOpen(!S.open); }
      });
      window.addEventListener('resize', function () { apply(); });
    }
  }

  function setOpen(v) {
    S.open = !!v; save(); apply(); paint();
    if (S.open) { try { var i = $('qsQ'); if (i) i.focus({ preventScroll: true }); } catch (e) {} }
  }
  function apply() {
    document.body.classList.toggle('qside-open', !!S.open && wide());
    document.body.classList.toggle('qside-drawer', !!S.open && !wide());
    document.body.classList.toggle('qside-closed', !S.open);
  }

  /* ---------- 匹配（本地 + AI 扩展词） ---------- */
  function aiTerms(q) {
    if (!S.ai || !q) return [];
    try { return (typeof window.qaiTerms === 'function') ? (window.qaiTerms(q) || []) : []; } catch (e) { return []; }
  }
  function hits(hay) {
    var q = MT.q;
    if (!q) return true;
    var h = String(hay || '').toLowerCase();
    if (h.indexOf(q) >= 0) return true;
    for (var i = 0; i < MT.terms.length; i++) {
      var t = String(MT.terms[i] || '').toLowerCase();
      if (t && h.indexOf(t) >= 0) return true;
    }
    return false;
  }

  /* ---------- 渲染 ---------- */
  function rowHtml(b, depth) {
    var s = statOf(b), cur = curBankId() === b.id;
    return '<div class="qs-row' + (cur ? ' on' : '') + '" data-bank="' + E(b.id) + '" draggable="true" '
      + 'style="--qs-ind:' + (10 + depth * 14) + 'px">'
      + '<span class="qs-dot' + (b.source === 'local' ? ' loc' : '') + '"></span>'
      + '<div class="qs-main"><b title="' + E(b.title) + '">' + E(b.title) + '</b>'
      + '<span class="qs-meta">' + s.n + ' 题 · 已答 ' + s.done + (s.wr ? ' · <i class="warn">错 ' + s.wr + '</i>' : '') + '</span>'
      + '<i class="qs-bar"><b style="width:' + Math.max(0, Math.min(100, s.pct)).toFixed(1) + '%"></b></i></div>'
      + '<button type="button" class="qs-more" data-more="' + E(b.id) + '" title="更多">⋯</button>'
      + '</div>';
  }

  /* 递归：一个目录 = 一行标题 + 子目录 + 里面的题库 */
  function catHtml(c, depth, bm, q, hit) {
    var kidsArr = kids(c.id);
    var ownBanks = (bm[c.id] || []);
    var qLow = q;
    function keepBank(b) {
      if (!qLow) return true;
      return hits(String(b.title) + ' ' + catPath(b.cat).join(' '));
    }
    var shownBanks = ownBanks.filter(keepBank);
    var subHtml = '';
    var subCount = 0;
    kidsArr.forEach(function (k) {
      var before = hit.n;
      var h = catHtml(k, depth + 1, bm, q, hit);
      if (h) { subHtml += h; subCount += (hit.n - before); }
    });
    var selfHit = !!qLow && hits(String(c.title));
    var show = !qLow || selfHit || shownBanks.length || subCount;
    if (!show) return '';
    hit.n += shownBanks.length;
    var folded = !!S.closed[c.id] && !qLow;
    var total = ownBanks.length + kidsArr.length;
    return '<div class="qs-cat' + (folded ? ' folded' : '') + '" data-cat="' + E(c.id) + '">'
      + '<button type="button" class="qs-ch" data-fold="' + E(c.id) + '" data-drop="' + E(c.id) + '" '
      + 'style="--qs-ind:' + (6 + depth * 14) + 'px" draggable="true">'
      + '<i class="qs-caret">' + (total ? '▾' : '·') + '</i><i class="qs-folder">📁</i>'
      + '<span class="qs-ct" title="' + E(c.title) + '">' + E(c.title) + '</span>'
      + '<em>' + (shownBanks.length || '') + '</em>'
      + '<span class="qs-cmore" data-cm="' + E(c.id) + '" title="文件夹操作">⋯</span>'
      + '</button>'
      + '<div class="qs-cbody">' + subHtml + shownBanks.map(function (b) { return rowHtml(b, depth + 1); }).join('') + '</div>'
      + '</div>';
  }

  var tmrAI = 0, lastAIQ = '', aiAt = 0, aiMute = 0;
  function aiNote(q) {
    var el = $('qsAiNote');
    if (!el) return;
    if (!S.ai) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    if (q.length < 2) el.textContent = '✨ AI 模糊已开：输 2 个字以上，AI 会一起找同义说法';
    else if (MT.terms.length) el.textContent = '✨ AI 又想到 ' + MT.terms.length + ' 个说法：' + MT.terms.slice(0, 6).join('、');
    else if (aiMute === q) el.textContent = '✨ AI 没给出扩展词（可能没配模型 / 服务没开），已只按字面找';
    else if (aiAt && Date.now() - aiAt > 6000) el.textContent = '✨ AI 还没回话…（可到「设置 → AI 服务」看模型通不通）';
    else el.textContent = '✨ AI 正在按意思扩展检索词…';
  }
  function aiSchedule(q) {
    if (lastAIQ === q) return;
    lastAIQ = q; aiAt = Date.now(); aiMute = '';
    setTimeout(function () {
      try {
        if (MT.q === q && !(window.qaiTerms ? (window.qaiTerms(q) || []).length : 0)) aiMute = q;
      } catch (e) {}
      if (MT.q === q) paint();
    }, 5000);
    try { if (typeof window.qaiExpandAny === 'function') window.qaiExpandAny(q); } catch (e) {}
    clearTimeout(tmrAI);
    tmrAI = setTimeout(function () { paint(); }, 900);
    tmrAI = setTimeout(function () { paint(); }, 2600);
  }

  function paint() {
    apply();
    var box = $('qsList');
    if (!box) return;
    if (DRAG) return;                        /* 拖动中别整片重画，节点会被换掉 */
    var q = (S.q || '').trim().toLowerCase();
    MT.q = q;
    MT.terms = aiTerms(q);
    if (S.ai && q.length >= 2 && !MT.terms.length) aiSchedule(q);
    aiNote(q);
    var bm = bankMap();
    var hit = { n: 0 };
    var html = '';
    kids(null).forEach(function (c) { html += catHtml(c, 0, bm, q, hit); });
    var rootBanks = (bm[''] || []).filter(function (b) {
      if (!q) return true;
      return hits(String(b.title) + ' ' + catPath(b.cat).join(' '));
    });
    if (rootBanks.length) {
      html += '<div class="qs-cat qs-rootcat" data-cat=""><button type="button" class="qs-ch" data-drop="" '
        + 'style="--qs-ind:6px"><i class="qs-caret">·</i><i class="qs-folder">🏠</i>'
        + '<span class="qs-ct">未分类</span><em>' + rootBanks.length + '</em></button>'
        + '<div class="qs-cbody">' + rootBanks.map(function (b) { return rowHtml(b, 0); }).join('') + '</div></div>';
    }
    box.innerHTML = html || '<div class="qs-empty"><b>没有题库</b><span>点右上角 ＋ 新建或导入</span></div>';

    var allB = banks();
    var nq = allB.reduce(function (a, b) { return a + (b.questions ? b.questions.length : 0); }, 0);
    var nDone = 0;
    allB.forEach(function (b) { nDone += statOf(b).done; });
    var st = $('qsStat');
    if (st) st.innerHTML = (q ? '命中 ' + (hit.n + rootBanks.length) + ' 个' : '共 ' + allB.length + ' 个题库 · ' + nq + ' 题') + '<span class="qs-pd">已答 ' + nDone + '</span>';
  }

  /* ---------- 点击 ---------- */
  function onListClick(e) {
    var cm = e.target.closest('[data-cm]');
    if (cm) { e.stopPropagation(); catMenu(cm.dataset.cm, cm); return; }
    var fold = e.target.closest('[data-fold]');
    if (fold) {
      var cid = fold.dataset.fold;
      S.closed[cid] = !S.closed[cid]; save();
      var block = fold.closest('.qs-cat');
      if (block) block.classList.toggle('folded', !!S.closed[cid]);
      return;
    }
    var more = e.target.closest('[data-more]');
    if (more) { e.stopPropagation(); menu(more.dataset.more, more); return; }
    var row = e.target.closest('[data-bank]');
    if (row) openBank(row.dataset.bank);
  }

  function openBank(id) {
    if (!id) return;
    if (typeof go === 'function') go('#/bank/' + id);
    if (!wide()) setOpen(false);
  }

  /* ---------- 文件夹操作 ---------- */
  function newFolder(parent) {
    var v = window.prompt(parent ? '新文件夹名（建在这个文件夹里）' : '新文件夹名', '新文件夹');
    if (v == null) return;
    v = String(v).trim();
    if (!v) return;
    var id = null;
    try { id = CAT.create(parent || null, v); } catch (e) { id = null; }
    if (!id) { if (typeof toast === 'function') toast('建文件夹失败：分类模块没加载', 1800, 'bad'); return; }
    try { if (CAT.save) CAT.save(); } catch (e) {}
    try { if (CAT.render) CAT.render(); } catch (e) {}
    if (parent) S.closed[parent] = false;
    save(); paint();
    if (typeof toast === 'function') toast('已新建文件夹：' + v, 1500, 'ok');
  }

  function catMenu(cid, anchor) {
    closeMenu();
    var m = document.createElement('div');
    m.className = 'qs-menu';
    m.id = 'qsMenu';
    m.innerHTML = '<button type="button" data-m="sub">新建子文件夹</button>'
      + '<button type="button" data-m="ren">重命名文件夹</button>'
      + '<button type="button" class="danger" data-m="del">删除文件夹</button>';
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = Math.max(8, Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 4)) + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left)) + 'px';
    m.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-m]'); if (!t) return;
      var act = t.dataset.m; closeMenu();
      var c = CAT.get ? CAT.get(cid) : null;
      if (act === 'sub') newFolder(cid);
      else if (act === 'ren') {
        var v = window.prompt('文件夹名', (c && c.title) || ''); if (v == null) return;
        v = String(v).trim(); if (!v) return;
        try { CAT.rename(cid, v); CAT.save && CAT.save(); CAT.render && CAT.render(); } catch (e) {}
        paint();
      } else if (act === 'del') {
        var ask = (window.BFUI && BFUI.confirm) ? BFUI.confirm.bind(BFUI) : function (o) { return Promise.resolve(window.confirm(o.title)); };
        ask({ title: '删除文件夹？', html: '只删这个文件夹本身，里面的题库会被移到上一层，不会被删掉。', okText: '删除', danger: true }).then(function (ok) {
          if (!ok) return;
          try {
            var c2 = CAT.get(cid); var pid = c2 ? (c2.parent || null) : null;
            banks().forEach(function (b) { if ((b.cat || null) === cid) { try { CAT.moveBank(b.id, pid); } catch (e) {} } });
            kids(cid).forEach(function (k) { try { CAT.move(k.id, pid); } catch (e) {} });
            var list = CAT.all() || []; for (var i = list.length - 1; i >= 0; i--) if (list[i].id === cid) list.splice(i, 1);
            if (CAT.save) CAT.save(); if (CAT.render) CAT.render();
          } catch (e) {}
          paint();
        });
      }
    });
    armMenuClose();
  }

  function closeMenu() { var m = $('qsMenu'); if (m) m.remove(); }
  function armMenuClose() {
    setTimeout(function () {
      document.addEventListener('pointerdown', function h(ev) {
        if ($('qsMenu') && !ev.target.closest('#qsMenu')) { closeMenu(); document.removeEventListener('pointerdown', h); }
      }, true);
    }, 0);
  }

  /* ---------- 题库 ⋯ 菜单 ---------- */
  function menu(bid, anchor) {
    var b = null;
    banks().forEach(function (x) { if (x.id === bid) b = x; });
    if (!b) return;
    closeMenu();
    var m = document.createElement('div');
    m.className = 'qs-menu';
    m.id = 'qsMenu';
    m.innerHTML = '<button type="button" data-m="open">打开题库</button>'
      + '<button type="button" data-m="wrong">只做错题</button>'
      + '<button type="button" data-m="rand">随机 30 题</button>'
      + '<button type="button" data-m="move">移动到文件夹…</button>'
      + (b.source === 'local' ? '<button type="button" data-m="rename">重命名</button>' : '')
      + '<button type="button" class="danger" data-m="del">删除题库</button>';
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    var top = Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 4);
    m.style.top = Math.max(8, top) + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left - 120)) + 'px';
    m.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-m]');
      if (!t) return;
      var act = t.dataset.m;
      closeMenu();
      if (act === 'open') openBank(bid);
      else if (act === 'wrong') { if (typeof go === 'function') go('#/bank/' + bid + '?f=wrong'); if (!wide()) setOpen(false); }
      else if (act === 'rand') { if (typeof go === 'function') go('#/bank/' + bid + '?f=all&rand=30'); if (!wide()) setOpen(false); }
      else if (act === 'move') pickFolder(function (cid) { moveBankTo(bid, cid); });
      else if (act === 'rename') renameBank(b);
      else if (act === 'del') delBank(b);
    });
    armMenuClose();
  }

  /* 选文件夹（移动用）：把现有目录摊平成一个列表 */
  function pickFolder(cb) {
    var flat = [];
    (function walk(pid, depth) {
      kids(pid).forEach(function (c) { flat.push({ id: c.id, title: c.title, depth: depth }); walk(c.id, depth + 1); });
    })(null, 0);
    var m = document.createElement('div');
    m.className = 'qs-menu qs-pick';
    m.id = 'qsMenu';
    m.innerHTML = '<button type="button" data-pick="">🏠 未分类（根目录）</button>'
      + flat.map(function (f) {
        return '<button type="button" data-pick="' + E(f.id) + '"><span style="padding-left:' + (f.depth * 10) + 'px">📁 ' + E(f.title) + '</span></button>';
      }).join('');
    document.body.appendChild(m);
    m.style.top = '80px';
    m.style.left = '16px';
    m.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-pick]'); if (!t) return;
      var v = t.dataset.pick; closeMenu(); cb(v || null);
    });
    armMenuClose();
  }

  function moveBankTo(bid, cid) {
    try { CAT.moveBank(bid, cid || null); } catch (e) {}
    try { if (CAT.save) CAT.save(); if (CAT.render) CAT.render(); } catch (e) {}
    if (cid) S.closed[cid] = false;
    save(); paint();
    if (typeof toast === 'function') {
      var c = cid && CAT.get ? CAT.get(cid) : null;
      toast('已移到「' + (c ? c.title : '未分类') + '」', 1400, 'ok');
    }
  }

  /* ---------- 桌面拖拽 ---------- */
  var DRAG = null;
  function dragInfo(el) {
    var bk = el.closest('[data-bank]'), ct = el.closest('[data-cat]');
    if (bk) return { type: 'bank', id: bk.dataset.bank };
    if (ct && ct.dataset.cat) return { type: 'cat', id: ct.dataset.cat };
    return null;
  }
  function onDragStart(e) {
    var row = e.target.closest && e.target.closest('[data-bank]');
    if (!row) { e.preventDefault(); return; }         /* 只允许拖题库（目录拖动交给长按菜单，避免误操作） */
    DRAG = dragInfo(row);
    if (!DRAG) return;
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', DRAG.id); } catch (err) {}
    row.classList.add('qs-drag');
  }
  function onDragOver(e) {
    if (!DRAG) return;
    var t = e.target.closest && e.target.closest('[data-drop]');
    if (!t) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
    t.classList.add('drop-on');
  }
  function onDrop(e) {
    var t = e.target.closest && e.target.closest('[data-drop]');
    if (!t || !DRAG) return;
    e.preventDefault();
    var cid = t.dataset.drop || null;
    var d = DRAG; endDrag();
    if (d.type === 'bank') moveBankTo(d.id, cid);
  }
  function endDrag() {
    DRAG = null;
    document.querySelectorAll('.qs-drag,.drop-on').forEach(function (x) { x.classList.remove('qs-drag', 'drop-on'); });
  }

  /* ---------- 触屏长按拖动 ---------- */
  var P = { t: 0, x: 0, y: 0, row: null, armed: null };
  function cancelPress() { clearTimeout(P.t); P.t = 0; P.row = null; if (P.armed) { P.armed.classList.remove('qs-drag'); P.armed = null; } }
  function onPress(e) {
    if (e.pointerType === 'mouse') return;             /* 鼠标走原生 HTML5 拖拽 */
    var row = e.target.closest && e.target.closest('[data-bank]');
    if (!row) return;
    cancellation();
    function cancellation() { cancelPress(); P.x = e.clientX; P.y = e.clientY; P.row = row; }
    P.t = setTimeout(function () {
      P.t = 0;
      P.armed = row;
      row.classList.add('qs-drag');
      try { navigator.vibrate && navigator.vibrate(12); } catch (err) {}
    }, LP_MS);
  }
  function onPressMove(e) {
    if (!P.t && !P.armed) return;
    var dx = Math.abs(e.clientX - P.x), dy = Math.abs(e.clientY - P.y);
    if (P.t && (dx > 8 || dy > 8)) { cancelPress(); return; }   /* 手指先动了 = 用户在滚列表 */
    if (!P.armed) return;
    e.preventDefault();
    document.querySelectorAll('.drop-on').forEach(function (x) { x.classList.remove('drop-on'); });
    var hit = document.elementFromPoint(e.clientX, e.clientY);
    var t = hit && hit.closest && hit.closest('[data-drop]');
    if (t) t.classList.add('drop-on');
  }
  function onPressEnd(e) {
    if (P.t) { cancelPress(); return; }
    if (!P.armed) return;
    var row = P.armed;
    var hit = document.elementFromPoint(e.clientX, e.clientY);
    var t = hit && hit.closest && hit.closest('[data-drop]');
    var bid = row.dataset.bank;
    var cid = t ? (t.dataset.drop || null) : null;
    var ok = !!t;
    cancelPress(); endDrag();
    if (ok) { moveBankTo(bid, cid); paint(); }
  }

  /* ---------- 重命名 / 删除题库 ---------- */
  function saveLocalBanks() {
    try { writeLS(LS.banks, LOCAL); } catch (e) {}
    try { if (typeof invalidateBanks === 'function') invalidateBanks(); } catch (e) {}
    try { if (window.CAT && CAT.render) CAT.render(); } catch (e) {}
    paint();
  }

  function renameBank(b) {
    var v = window.prompt('题库名称', b.title);
    if (v == null) return;
    v = String(v).trim();
    if (!v || v === b.title) return;
    var hit = null;
    LOCAL.forEach(function (x) { if (x.id === b.id) hit = x; });
    if (!hit) return;
    hit.title = v;
    saveLocalBanks();
    if (typeof toast === 'function') toast('已改名：' + v, 1600, 'ok');
    if (curBankId() === b.id && typeof render === 'function') render();
  }

  function delBank(b) {
    var ask = (window.BFUI && BFUI.confirm) ? BFUI.confirm.bind(BFUI) : function (o) { return Promise.resolve(window.confirm(o.title)); };
    ask({ title: '删除题库？', html: '《' + E(b.title) + '》的 ' + b.questions.length + ' 道题会一起删掉，作答记录也一起清。', okText: '删除', danger: true })
      .then(function (ok) {
        if (!ok) return;
        if (window.CAT && CAT.deleteBanks) CAT.deleteBanks([b.id]);
        else {
          LOCAL = LOCAL.filter(function (x) { return x.id !== b.id; });
          saveLocalBanks();
        }
        if (typeof toast === 'function') toast('已删除《' + b.title + '》', 1800, 'bad');
        setTimeout(paint, 60);
      });
  }

  /* ---------- 刷新钩子 ---------- */
  var tmr = 0;
  function refresh() { clearTimeout(tmr); tmr = setTimeout(function () { apply(); paint(); }, 80); }

  function boot() {
    mount(); apply(); paint();
    try {
      var v = $('view');
      if (v && window.MutationObserver && !window.__qsMo) {
        window.__qsMo = new MutationObserver(refresh);
        window.__qsMo.observe(v, { childList: true });
      }
    } catch (e) {}
    window.addEventListener('hashchange', function () { setTimeout(function () { apply(); paint(); }, 120); });
    window.addEventListener('storage', function (e) { if (e.key && e.key.indexOf('qbank.') === 0) refresh(); });
  }

  window.SIDE = {
    paint: paint,
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    toggle: function () { setOpen(!S.open); },
    newFolder: newFolder,
    moveTo: moveBankTo,
    state: function () { return { open: S.open, q: S.q, wide: wide(), drag: DRAG }; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
