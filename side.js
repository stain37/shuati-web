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

  var S = { open: true, q: '', closed: {}, ai: false, scope: 'both', logic: 'or', selmode: false, sel: {}, star: {} };
  var MT = { q: '', terms: [] };      /* 当前匹配上下文（paint 里算一次，catHtml 复用） */
  (function () {
    var v = ls(KEY, null);
    if (v && typeof v === 'object') {
      S.open = v.open !== false;
      S.closed = v.closed && typeof v.closed === 'object' ? v.closed : {};
      S.ai = !!v.ai;
      S.scope = (v.scope === 'cat' || v.scope === 'bank') ? v.scope : 'both';
      S.logic = v.logic === 'and' ? 'and' : 'or';
      S.star = v.star && typeof v.star === 'object' ? v.star : {};
      (function migStar() {                    /* 多方案：老 key 是 c:<目录>，归到默认方案 */
        var out = {}, ch = false;
        Object.keys(S.star).forEach(function (k) {
          if (k.indexOf('c:') === 0 && k.split(':').length === 2) { out['c:default:' + k.slice(2)] = S.star[k]; ch = true; }
          else out[k] = S.star[k];
        });
        if (ch) { S.star = out; save(); }
      })();
      S.sel = v.sel && typeof v.sel === 'object' ? v.sel : {};
      S.selmode = !!v.selmode;
    } else S.open = true;
    if (!wide()) S.open = false;
  })();

  /* ---------- 数据 ---------- */
  function tagScheme() { try { return !!(window.SCM && SCM.tagMode && SCM.tagMode()); } catch (e) { return false; } }
  /* 「按小标签分」的方案：侧栏列的是题目（来自 CAT.dirBanks 的题目行），不是题库 */
  function banks() {
    /* 考点方案：这里没有题库 —— 考点只是分类视图。
       （以前把每个考点的题都铺成行，几百个考点就卡死了，web656 去掉） */
    if (tagScheme()) return [];
    try { return (typeof baseBanks === 'function') ? baseBanks().slice() : []; } catch (e) { return []; }
  }
  function cats() {
    try {
      /* 考点方案：侧栏永远显示考点树（CAT 可能正停在「真实题库树」，那是管理器自己的事） */
      if (tagScheme() && window.SCM && SCM.cats) return SCM.cats() || [];
      return (window.CAT && CAT.all) ? (CAT.all() || []) : [];
    } catch (e) { return []; }
  }
  function kids(pid) {
    try {
      if (!(tagScheme() && window.SCM && SCM.cats)) { if (window.CAT && CAT.kids) return CAT.kids(pid) || []; }
    } catch (e) {}
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
      + '<button type="button" class="qs-ico" id="qsSel" title="多选：批量移动 / 删除">☑</button>'
      + '<button type="button" class="qs-ico" id="qsNew" title="新建 / 导入题库">＋</button>'
      + '<button type="button" class="qs-ico" id="qsClose" title="收起侧栏（Alt+Q）">«</button></div>'
      + '<div class="qs-scb"><span class="qs-sl">方案</span>'
      + '<select id="qsScheme" class="qs-selscheme" title="同一批题库，换一套文件夹方案"></select>'
      + '<button type="button" class="qs-ico qs-ico-sm" id="qsSchemeNew" title="新建方案（复制当前方案的文件夹）">＋</button>'
      + '<button type="button" class="qs-ico qs-ico-sm" id="qsSyncTags" title="把新打的考点标签一键同步进当前方案（考点方案用）">↻</button>'
      + '<button type="button" class="qs-ico qs-ico-sm" id="qsSchemeMore" title="重命名 / 删除 / 设为默认方案">⋯</button></div>'
      + '<div class="qs-search"><label class="qs-find"><i>⌕</i><input id="qsQ" type="text" placeholder="搜题库 / 文件夹…" autocomplete="off" enterkeyhint="search"></label>'
      + '<button type="button" class="qs-ai" id="qsAi" title="AI 模糊：记不清名字也能找到"><span>✨</span></button></div>'
      + '<div class="qs-opts">'
      + '<label title="搜哪一类">搜 '
      + '<select id="qsScope" class="qs-sel">'
      + '<option value="both">两个都搜</option><option value="cat">只搜文件夹</option><option value="bank">只搜题库</option>'
      + '</select></label>'
      + '<label title="并集＝命中任意一个词就算；交集＝每个词都得命中（更准）">'
      + '<select id="qsLogic" class="qs-sel">'
      + '<option value="or">并集</option><option value="and">交集</option>'
      + '</select></label>'
      + '</div>'
      + '<div class="qs-ainote" id="qsAiNote" hidden></div>'
      + '<div class="qs-list" id="qsList"></div>'
      + '<div class="qs-bulk" id="qsBulk" hidden><span id="qsBulkN">已选 0</span>'
      + '<button type="button" data-b="all" title="把当前列表里显示的题库和文件夹全选上">全选</button>'
      + '<button type="button" data-b="none">清空</button>'
      + '<button type="button" data-b="move">移动到…</button>'
      + '<button type="button" data-b="addsch">加入方案…</button>'
      + '<button type="button" data-b="del" class="danger">删除</button>'
      + '<button type="button" data-b="off">取消</button></div>'
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
    bindScheme();
    $('qsSel').onclick = function () {
      S.selmode = !S.selmode;
      S.sel = {};
      try { if (typeof toast === 'function') toast(S.selmode ? '多选模式：点行就是选中，底部可批量移动/删除' : '已退出多选', 1400, 'ok'); } catch (e) {}
      paint();
    };
    $('qsBulk').onclick = function (e) {
      var b = e.target.closest('[data-b]'); if (!b) return;
      var act = b.getAttribute('data-b');
      if (act === 'all' || act === 'none') {
      var want = act === 'all';
      S.sel = {};
      if (want) {
        document.querySelectorAll('#qsList [data-ck]').forEach(function (el) {
          var k = el.getAttribute('data-ck'); if (k) S.sel[k] = 1;
        });
      }
      save(); paint();
      return;
    }
    if (act === 'move') bulkMove();
      else if (act === 'addsch') bulkAddScheme();
      else if (act === 'del') bulkDelete();
      else if (act === 'off') { S.selmode = false; S.sel = {}; paint(); }
    };
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
    (function () {
      var sc = $('qsScope'), lg = $('qsLogic');
      if (sc) { sc.value = S.scope; sc.onchange = function () { S.scope = sc.value; save(); paint(); }; }
      if (lg) { lg.value = S.logic; lg.onchange = function () { S.logic = lg.value; save(); paint(); }; }
    })();
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
  /* ---- AI 纠错 + 扩词（一次请求，带权重，结果缓存） ---- */
  var AIQ = { q: '', fixed: '', fixes: [], terms: [], wmap: {}, at: 0 };
  var tmrQ = 0, qAbort = null;
  function aiqCache() { try { return JSON.parse(localStorage.getItem('qbank.side.aiq.v1') || '{}'); } catch (e) { return {}; } }
  function aiqSave(k, v) {
    try {
      var m = aiqCache(); m[k] = v;
      var ks = Object.keys(m);
      if (ks.length > 300) delete m[ks[0]];
      localStorage.setItem('qbank.side.aiq.v1', JSON.stringify(m));
    } catch (e) {}
  }
  function aiqParse(txt) {
    var t = String(txt || '').replace(/```[a-zA-Z]*/g, '').trim();
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  }
  function aiqApply(q, o) {
    if (!o) return;
    var terms = [], wmap = {};
    var arr = o.terms || o.words || [];
    for (var i = 0; i < arr.length && terms.length < 14; i++) {
      var it = arr[i], w = 0.8;
      if (typeof it === 'string') { it = { t: it }; }
      var t = String((it && it.t) || '').trim();
      if (!t) continue;
      var ww = parseFloat(it.w);
      if (isFinite(ww) && ww > 0) w = Math.max(0.3, Math.min(1, ww));
      if (wmap[t]) continue;
      terms.push(t); wmap[t] = w;
    }
    AIQ = { q: q, intent: String(o.intent || '').slice(0, 60), fixed: String(o.fixed || ''), fixes: (o.fixes || []).slice(0, 3), terms: terms, wmap: wmap, at: Date.now() };
    try { if (o.fixed && String(o.fixed).trim() && String(o.fixed).trim() !== q) AIQ.fixed = String(o.fixed).trim(); } catch (e) {}
    aiqSave(q, { intent: AIQ.intent, fixed: AIQ.fixed, fixes: AIQ.fixes, terms: AIQ.terms, wmap: AIQ.wmap, at: AIQ.at });
  }
  function aiFix(q) {
    if (!S.ai || q.length < 2) return;
    var c = aiqCache()[q];
    if (c) { aiqApply(q, { intent: c.intent || '', fixed: c.fixed, fixes: c.fixes, terms: c.terms.map(function (t) { return { t: t, w: (c.wmap || {})[t] || 0.8 }; }) }); return; }
    clearTimeout(tmrQ);
    tmrQ = setTimeout(function () {
      if (MT.q !== q) return;
      if (typeof aiChat !== 'function') return;
      try { if (qAbort && qAbort.abort) qAbort.abort(); } catch (e) {}
      try { qAbort = new AbortController(); } catch (e) { qAbort = null; }
      var sys = '你是题库检索助手。用户输入的是要搜索的关键词，可能有错别字、拼音缩写、口语说法。'
        + '第一步先用一句话说出用户到底想找什么（哪怕是错别字/拼音缩写/口语，也要猜出真实意图），'
        + '第二步按这个意图把查询词规范成医学教材里的说法，第三步给出 8~12 个相关检索词（同义词、近义表述、子概念、英文缩写）。'
        + '只输出 JSON，不要解释：{"intent":"用户想找什么（≤30 字，用标准说法）","fixed":"规范化后的检索词（≤20 字）","fixes":["错→对"],"terms":[{"t":"词","k":"同义|近义表述|子概念|英文缩写","w":0.4~1.0}]}';
      var usr = '用户的搜索词：' + q;
      try {
        aiChat([{ role: 'system', content: sys }, { role: 'user', content: usr }], null,
          qAbort ? qAbort.signal : undefined, { stream: false, temp: 0.2, maxTokens: 700 })
          .then(function (txt) {
            var o = aiqParse(txt);
            if (!o) return;
            aiqApply(q, o);
            try { if (MT.q === q) paint(); } catch (e) {}
          })['catch'](function () {});
      } catch (e) {}
    }, 400);
  }

  /* 归一化：全角→半角、去空白/常见标点、小写（中文原样保留） */
  function nz(t) {
    var s = String(t || ''), out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xFF01 && c <= 0xFF5E) c -= 0xFEE0;
      else if (c === 0x3000) c = 32;
      var ch = String.fromCharCode(c).toLowerCase();
      if (/[\s,.;:!?、，。；：！？·\-—_/\\'"()\[\]{}<>《》【】「」『』]/.test(ch)) continue;
      out += ch;
    }
    return out;
  }
  /* 宽松匹配：子串 / 连续子序列（跳字）/ 二元组覆盖 ≥0.6 */
  function loose(h, q) {
    if (!q) return true;
    var at = h.indexOf(q);
    if (at >= 0) return true;
    if (q.length >= 3) {
      var i = 0;
      for (var k = 0; k < h.length && i < q.length; k++) if (h.charAt(k) === q.charAt(i)) i++;
      if (i === q.length) return true;
    }
    if (q.length >= 2) {
      var hit = 0, total = 0;
      for (var a = 0; a < q.length - 1; a++) { total++; if (h.indexOf(q.substr(a, 2)) >= 0) hit++; }
      if (total && hit / total >= 0.6) return true;
    }
    return false;
  }
  /* 相似度：查询的字在题干里「凑得够齐」就算命中（不管顺序），
     用来补「AI 扩展词只有十来个、换个说法就搜不到」的短板 */
  function simHit(h, q, need) {
    var n = q.length;
    if (!n || !h) return false;
    var want = Math.max(2, Math.ceil(n * (need || 0.75)));
    if (want > n) want = n;
    var first = q.charAt(0), step = n > 8 ? 2 : 1;
    for (var i = 0; i < h.length; i += step) {
      if (h.charAt(i) !== first) continue;
      var win = h.substr(i, Math.max(80, n * 12)), seen = {}, got = 0;
      for (var a = 0; a < n; a++) {
        var ch = q.charAt(a);
        if (seen[ch]) continue;
        if (win.indexOf(ch) >= 0) { seen[ch] = 1; got++; }
      }
      if (got >= want) return true;
    }
    return false;
  }
  function hitOne(h, q) { return loose(h, q) || simHit(h, q); }
  function termScore(h, t) {
    if (loose(h, t)) return 1;
    if (simHit(h, t)) return 0.7;
    return 0;
  }
  /* 搜索词拆成「词」：空格 / 逗号 / 顿号 / 分号 / 斜杠 */
  function qTokens(q) {
    return String(q || '').split(/[\s,，、;；\/]+/).map(function (t) { return t.trim(); })
      .filter(function (t) { return !!t; });
  }
  /* 单个词能不能命中这段文本：字面 / 抠字 / 顺序无关 + 该词对应的 AI 纠错与扩展词 */
  function hitNeedle(h, n) {
    if (!n) return true;
    if (hitOne(h, n)) return true;
    if (AIQ.q === MT.q && AIQ.fixed) {
      var f = nz(AIQ.fixed);
      if (f && hitOne(h, f)) return true;
    }
    var best = 0;
    for (var i = 0; i < MT.terms.length; i++) {
      var t = nz(MT.terms[i]);
      if (!t) continue;
      if (t.indexOf(n) < 0 && n.indexOf(t) < 0) continue;   /* 只算跟这个词有关的扩展 */
      var s0 = termScore(h, t) * ((MT.wmap && MT.wmap[MT.terms[i]]) || 0.8);
      if (s0 > best) best = s0;
    }
    return best >= 0.5;
  }
  function hits(hay) {
    var q = MT.q;
    if (!q) return true;
    var h = nz(hay);
    if (!h) return false;
    var toks = (MT.toks && MT.toks.length) ? MT.toks : [q];
    if (MT.logic === 'and') {                    /* 交集：每个词都得命中 */
      for (var i = 0; i < toks.length; i++) {
        if (!hitNeedle(h, nz(toks[i]))) return false;
      }
      return true;
    }
    /* 并集：整串命中，或任意一个词命中 */
    var qn = nz(q);
    if (qn && hitNeedle(h, qn)) return true;
    for (var j = 0; j < toks.length; j++) {
      var tj = nz(toks[j]);
      if (tj && tj !== qn && hitOne(h, tj)) return true;
    }
    return false;
  }

  /* 题库搜索文本：标题 + 目录路径 + 前 40 条题干（各 60 字），懒缓存 */
  var hayCache = {};
  function bankHay(b) {
    var k = b && b.id;
    if (!k) return String(b && b.title || '');
    if (hayCache[k]) return hayCache[k];
    var txt = String(b.title || '') + ' ' + catPath(b.cat).join(' ');
    try {
      var qs = (b.questions || []).slice(0, 40), parts = [];
      for (var i = 0; i < qs.length; i++) {
        var it = qs[i] || {};
        parts.push(String(it.stem || '').slice(0, 60));
        var op = it.options || [];
        for (var j = 0; j < op.length && j < 8; j++) parts.push(String(op[j] || '').slice(0, 20));
      }
      if (parts.length) txt += ' ' + parts.join(' ');
    } catch (e) {}
    hayCache[k] = txt;
    return txt;
  }
  /* ---------- 渲染 ---------- */
  function rowHtml(b, depth) {
    var s = statOf(b), cur = curBankId() === b.id;
    var sk = 'b:' + b.id, sel = S.sel[sk] === 1;
    return '<div class="qs-row' + (cur ? ' on' : '') + (sel ? ' sel' : '') + '" data-bank="' + E(b.id) + '" draggable="true" '
      + 'style="--qs-ind:' + (10 + depth * 18) + 'px;--qs-d:' + Math.min(depth, 4) + '">'
      + (S.selmode ? '<i class="qs-ck' + (sel ? ' on' : '') + '" data-ck="' + E(sk) + '"></i>' : '')
      + '<span class="qs-dot' + (b.source === 'local' ? ' loc' : '') + '"></span>'
      + '<div class="qs-main"><b title="' + E(b.title) + '">' + E(b.title) + '</b>'
      + '<span class="qs-meta">' + s.n + ' 题 · 已答 ' + s.done + (s.wr ? ' · <i class="warn">错 ' + s.wr + '</i>' : '') + '</span>'
      + schBadge(b)
      + '<i class="qs-bar"><b style="width:' + Math.max(0, Math.min(100, s.pct)).toFixed(1) + '%"></b></i></div>'
      + '<button type="button" class="qs-star' + ((S.star || {})[sk] === 1 ? ' on' : '') + '" data-star="' + E(sk) + '" title="标星（常驻在最上面）">'
      + ((S.star || {})[sk] === 1 ? '★' : '☆') + '</button>'
      + '<button type="button" class="qs-more" data-more="' + E(b.id) + '" title="更多">⋯</button>'
      + '</div>';
  }

  /* 递归：一个目录 = 一行标题 + 子目录 + 里面的题库 */
  function catHtml(c, depth, bm, q, hit) {
    var kidsArr = kids(c.id);
    var ownBanks = (bm[c.id] || []);
    var qLow = q;
    var sc = MT.scope || 'both';
    function keepBank(b) {
      if (!qLow) return true;
      if (sc === 'cat') return false;         /* 只搜文件夹：题库不按自己名字算命中 */
      return hits(bankHay(b));
    }
    var shownBanks = ownBanks.filter(keepBank);
    var subHtml = '';
    var subCount = 0;
    kidsArr.forEach(function (k) {
      var before = hit.n;
      var h = catHtml(k, depth + 1, bm, q, hit);
      if (h) { subHtml += h; subCount += (hit.n - before); }
    });
    var selfHit = !!qLow && sc !== 'bank' && hits(String(c.title));
    if (selfHit) hit.c = (hit.c || 0) + 1;
    /* 只搜文件夹且命中了：把里面所有题库都摊出来（不再按题目内容过滤） */
    if (qLow && sc === 'cat' && selfHit && !shownBanks.length) shownBanks = ownBanks;
    var show;
    if (!qLow) show = true;
    else if (sc === 'cat') show = selfHit || subCount > 0;
    else if (sc === 'bank') show = shownBanks.length > 0 || subCount > 0;
    else show = selfHit || shownBanks.length > 0 || subCount > 0;
    if (!show) return '';
    hit.n += shownBanks.length;
    var folded = !!S.closed[c.id] && !qLow;
    var total = ownBanks.length + kidsArr.length;
    var isTagC = String(c.id).indexOf('tgcat:') === 0 || String(c.id).indexOf('tgb:') === 0;
    return '<div class="qs-cat' + (folded ? ' folded' : '') + '" data-cat="' + E(c.id) + '">'
      + '<button type="button" class="qs-ch" data-fold="' + E(c.id) + '" data-drop="' + E(c.id) + '" '
      + 'style="--qs-ind:' + (6 + depth * 18) + 'px;--qs-d:' + Math.min(depth, 4) + '" draggable="true">'
      + (S.selmode ? '<i class="qs-ck' + (S.sel['c:' + c.id] === 1 ? ' on' : '') + '" data-ck="c:' + E(c.id) + '"></i>' : '')
      + '<i class="qs-caret">' + (total ? '▾' : '·') + '</i><i class="qs-folder">📁</i>'
      + '<span class="qs-ct' + (isTagC ? ' qs-ct-open' : '') + '"'
      + (isTagC ? ' data-open="' + E(c.id) + '" title="点一下打开（里面就是题）"' : ' title="' + E(c.title) + '"')
      + '>' + E(c.title) + '</span>'
      + '<em>' + (function () {
        if (!tagScheme()) return shownBanks.length || '';
        try {
          if (String(c.id).indexOf('tgcat:') === 0) {
            var ts = (window.SCM && SCM.tagStatOf) ? SCM.tagStatOf(c.id) : null;
            return ts ? (ts.n || '') : '';
          }
          return kidsArr.length || '';
        } catch (eT) { return ''; }
      })() + '</em>'
      + '<span class="qs-star' + ((S.star || {})[catKey(c.id)] === 1 ? ' on' : '') + '" data-star="' + E(catKey(c.id)) + '" title="标星（常驻）">'
      + ((S.star || {})[catKey(c.id)] === 1 ? '★' : '☆') + '</span>'
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
    else if (MT.q && AIQ.q === MT.q && (AIQ.intent || AIQ.fixed)) {
      var head = AIQ.intent ? ('✨ 我理解你想找：' + AIQ.intent) : ('✨ AI 纠错：「' + MT.q + '」→「' + AIQ.fixed + '」');
      var tail = (AIQ.fixed && AIQ.fixed !== MT.q && AIQ.intent) ? ('（原词「' + MT.q + '」→「' + AIQ.fixed + '」）') : '';
      el.textContent = head + tail + ' · 扩展 ' + AIQ.terms.length + ' 词：' + AIQ.terms.slice(0, 5).join('、');
    }
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
    MT.toks = qTokens(q);
    MT.logic = S.logic;
    MT.scope = S.scope;
    MT.terms = aiTerms(q);
    MT.wmap = {};
    if (AIQ.q === q && AIQ.terms.length) {
      for (var i0 = 0; i0 < AIQ.terms.length; i0++) {
        var t0 = AIQ.terms[i0];
        MT.wmap[t0] = AIQ.wmap[t0] || 0.8;
        if (MT.terms.indexOf(t0) < 0) MT.terms.push(t0);
      }
    }
    if (S.ai && q.length >= 2 && AIQ.q !== q) aiFix(q);
    if (S.ai && q.length >= 2 && !MT.terms.length) aiSchedule(q);
    aiNote(q);
    var bm = bankMap();
    var hit = { n: 0, c: 0 };
    var html = starBlockHtml();
    kids(null).forEach(function (c) { html += catHtml(c, 0, bm, q, hit); });
    var rootBanks = (bm[''] || []).filter(function (b) {
      if (!q) return true;
      if (S.scope === 'cat') return false;
      return hits(bankHay(b));
    });
    if (rootBanks.length) {
      html += '<div class="qs-cat qs-rootcat" data-cat=""><button type="button" class="qs-ch" data-drop="" '
        + 'style="--qs-ind:6px"><i class="qs-caret">·</i><i class="qs-folder">🏠</i>'
        + '<span class="qs-ct">未分类</span><em>' + rootBanks.length + '</em></button>'
        + (rootBanks.length >= 2 ? '<button type="button" class="qs-ai-cls" id="qsClassify" title="让 AI 把未分类的题库归到文件夹里（可自己写要求）">✨ 一键分类</button>' : '')
        + '<div class="qs-cbody">' + rootBanks.map(function (b) { return rowHtml(b, 0); }).join('') + '</div></div>';
    }
    box.innerHTML = html || '<div class="qs-empty"><b>没有题库</b><span>点右上角 ＋ 新建或导入</span></div>';

    var allB = banks();
    var nq = allB.reduce(function (a, b) { return a + (b.questions ? b.questions.length : 0); }, 0);
    var nDone = 0;
    allB.forEach(function (b) { nDone += statOf(b).done; });
    var tagTot = null;
    if (tagScheme()) {
      try { tagTot = (window.SCM && SCM.tagTotal) ? SCM.tagTotal() : null; } catch (eT0) { tagTot = null; }
      if (tagTot) { nq = tagTot.q; nDone = tagTot.done; }
    }
    var st = $('qsStat');
    if (st) {
      var nCat = hit.c || 0, nBank = hit.n + rootBanks.length;
      var hitTxt = S.scope === 'cat' ? ('命中 ' + nCat + ' 个文件夹')
        : S.scope === 'bank' ? ('命中 ' + nBank + ' 个题库')
          : ('命中 ' + nCat + ' 个文件夹 · ' + nBank + ' 个题库');
      st.innerHTML = (q ? hitTxt : (tagScheme()
        ? ('共 ' + ((tagTot && tagTot.tags) || (CAT.all() || []).filter(function (c) { return String(c.id).indexOf('tgcat:') === 0; }).length) + ' 个考点 · ' + nq + ' 题')
        : ('共 ' + allB.length + ' 个题库 · ' + nq + ' 题')))
        + '<span class="qs-pd">已答 ' + nDone + '</span>';
    }
    var bar = $('qsBulk');
    if (bar) {
      var nSel = selCount();
      bar.hidden = !(S.selmode && nSel > 0);
      var bn = $('qsBulkN');
      if (bn) bn.textContent = '已选 ' + nSel;
    }
    var selBtn = $('qsSel');
    if (selBtn) { selBtn.classList.toggle('on', !!S.selmode); selBtn.setAttribute('aria-pressed', S.selmode ? 'true' : 'false'); }
    paintSchemes();
  }

  /* ---------- 方案（同一批题库，换一套文件夹） ---------- */
  function sid() { try { return (window.SCM && SCM.current) ? SCM.current() : 'default'; } catch (e) { return 'default'; } }
  function catKey(id) { return 'c:' + sid() + ':' + id; }
  function schemeName(id) {
    try {
      var l = SCM.list() || [];
      for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i].name;
    } catch (e) {}
    return id;
  }
  function paintSchemes() {
    var sel = $('qsScheme');
    if (!sel || !window.SCM) return;
    var cur = sid();
    var html = (SCM.list() || []).map(function (s) {
      return '<option value="' + E(s.id) + '"' + (s.id === cur ? ' selected' : '') + '>' + E(s.name) + '</option>';
    }).join('');
    if (sel.innerHTML !== html) sel.innerHTML = html;
    try { sel.value = cur; } catch (e) {}
  }
  function schemeReload() {
    try { if (CAT.reload) CAT.reload(); } catch (e) {}
    try { if (CAT.render) CAT.render(); } catch (e) {}
    paint();
  }
  function schemeSwitch(id) {
    if (!window.SCM || !id || id === sid()) return;
    var ok = false;
    try { ok = SCM.switchTo(id); } catch (e) { ok = false; }
    if (!ok) return;
    S.q = '';
    try { var q = $('qsQ'); if (q) q.value = ''; } catch (e) {}
    schemeReload();
    try { toast('已切到方案：' + SCM.curName(), 1500, 'ok'); } catch (e) {}
  }
  function askText(o) {
    if (window.BFUI && BFUI.prompt) return BFUI.prompt(o);
    var v = window.prompt(o.label || '名称', o.value || '');
    return Promise.resolve(v == null ? null : v);
  }
  function schemeNew() {
    if (!window.SCM) return;
    var n = (SCM.list() || []).length + 1;
    askText({ title: '新建方案', label: '方案名称（新建是空白的：没有文件夹，题库还是那一批，自己往里拖）', value: '方案 ' + n,
      test: function (x) { return x && String(x).trim() ? '' : '名字不能为空'; } }).then(function (v) {
      if (v == null) return;
      var id = SCM.create(v);
      if (!id) return;
      schemeSwitch(id);
    });
  }
  function schemeMore() {
    if (!window.SCM) return;
    var isDef = sid() === SCM.DEF;
    var isTag = false, curBig = false;
    try {
      var sp = SCM.schemeOf ? SCM.schemeOf() : null;
      isTag = !!(SCM.tagMode && SCM.tagMode());
      curBig = !!(sp && sp.big);
    } catch (e0) {}
    qsModal({
      title: '方案：' + E(SCM.curName()),
      html: '<div class="qs-tgs"><button type="button" class="qs-tg" data-t="ren">重命名当前方案</button>'
        + '<button type="button" class="qs-tg" data-t="reset">⟲ 一键恢复默认状态（按考点重建）</button>'
        + '<button type="button" class="qs-tg" data-t="tagnew">＋ 按小标签自动分（读现有考点标签）</button>'
        + (isTag ? '<button type="button" class="qs-tg" data-t="big">' + (curBig ? '☑ 再按大标签分一层（生理/生化/内外科…）' : '☐ 再按大标签分一层（生理/生化/内外科…）') + '</button>' : '')
        + (SCM.defaultId && SCM.defaultId() === SCM.current()
            ? '<button type="button" class="qs-tg" data-t="undefault">☆ 取消默认（下次打开用上次的）</button>'
            : '<button type="button" class="qs-tg" data-t="default">★ 设为默认方案（每次打开都用它）</button>')
        + '<button type="button" class="qs-tg" data-t="sync">↻ 同步新标签到当前方案</button>'
        + '<button type="button" class="qs-tg" data-t="exp">⬇ 导出当前方案（.scheme.json）</button>'
        + '<button type="button" class="qs-tg" data-t="imp">⬆ 从文件导入方案</button>'
        + (isDef ? '' : '<button type="button" class="qs-tg" data-t="del">删除当前方案（题库不受影响）</button>')
        + '</div>'
        + '<div class="small muted" style="margin-top:8px">导出的文件里只有<b>文件夹结构和每个题库放在哪个文件夹</b>；题目本体在题库里，不跟着走。</div>',
      buttons: [{ t: '关闭', val: null }],
      onPick: function (t) { return { ok: true, act: t }; }
    }).then(function (r) {
      if (!r || !r.ok) return;
      if (r.act === 'ren') {
        askText({ title: '重命名方案', label: '新名称', value: SCM.curName() }).then(function (v) {
          if (v == null || !String(v).trim()) return;
          SCM.rename(SCM.current(), v); paintSchemes();
          try { toast('已改名', 1200, 'ok'); } catch (e) {}
        });
      } else if (r.act === 'reset') {
        var cf2 = (window.BFUI && BFUI.confirm) ? BFUI.confirm.bind(BFUI) : function (o) { return Promise.resolve(window.confirm(o.title)); };
        cf2({ title: '恢复默认状态（按考点分）？', danger: true, okText: '恢复',
          html: '会把<b>所有分类方案</b>删掉，然后按你题库里现有的考点标签，重建一套「考点分类」并设为默认。<br>题库、题目、作答记录、错题本、收藏都不受影响。' }).then(function (ok2) {
            if (!ok2) return;
            var nid = '';
            try { nid = SCM.resetToTags ? SCM.resetToTags('考点分类') : ''; } catch (e) {}
            schemeReload();
            try {
              var tags = (SCM.smallTags ? SCM.smallTags() : []).length;
              toast(nid ? ('已恢复：新建「考点分类」' + tags + ' 个小标签文件夹，并设为默认') : '没恢复成功：题库里可能还没有考点标签', 3200, nid ? 'ok' : '');
            } catch (e) {}
          });
      } else if (r.act === 'tagnew') {
        askText({ title: '按小标签建方案', label: '方案名称（按题目现在的小考点标签自动建文件夹；没有小标签的题不分类）', value: '考点分类 ' + ((SCM.list() || []).length),
          test: function (x) { return x && String(x).trim() ? '' : '名字不能为空'; } }).then(function (v) {
          if (v == null) return;
          var nid = SCM.makeTagScheme(v, false);
          if (!nid) return;
          schemeReload();
          var tags = (SCM.smallTags ? SCM.smallTags() : []).length;
          try { toast('已建「' + SCM.curName() + '」：' + tags + ' 个小标签文件夹，里面直接是题目；想按大标签再分一层，点方案右边的 ⋯', 4200, 'ok'); } catch (e) {}
        });
      } else if (r.act === 'big') {
        var on = !curBig;
        SCM.setBig(SCM.current(), on);
        schemeReload();
        try { toast(on ? '已按大标签分两层：大标签 › 小标签 › 题目' : '已改回平铺：小标签 › 题目', 2600, 'ok'); } catch (e) {}
      } else if (r.act === 'default') {
        SCM.setDefault(SCM.current());
        schemeReload();
        try { toast('已设为默认：「' + SCM.curName() + '」，以后打开就用它', 2600, 'ok'); } catch (e) {}
      } else if (r.act === 'undefault') {
        SCM.setDefault('');
        schemeReload();
        try { toast('已取消默认方案', 1800, 'ok'); } catch (e) {}
      } else if (r.act === 'sync') {
        var a0 = SCM.syncTagTree ? SCM.syncTagTree() : 0;
        schemeReload();
        try { toast(a0 ? ('补了 ' + a0 + ' 个新标签文件夹') : '没有新标签，文件夹已是最新', 2000, 'ok'); } catch (e) {}
      } else if (r.act === 'exp') {
        schemeExport();
      } else if (r.act === 'imp') {
        schemeImport();
      } else if (r.act === 'del') {
        var cf = (window.BFUI && BFUI.confirm) ? BFUI.confirm.bind(BFUI) : function (o) { return Promise.resolve(window.confirm(o.title)); };
        cf({ title: '删除方案「' + SCM.curName() + '」？', html: '只删这套文件夹结构，题库和作答记录都不会删。', okText: '删除', danger: true }).then(function (ok) {
          if (!ok) return;
          try { SCM.remove(SCM.current()); } catch (e) {}
          S.q = ''; try { var q = $('qsQ'); if (q) q.value = ''; } catch (e) {}
          schemeReload();
          try { toast('已删除方案，回到默认方案', 1600, 'ok'); } catch (e) {}
        });
      }
    });
  }
  /* ---------- 方案导出 / 导入 ---------- */
  function schemeExport() {
    if (!window.SCM || !SCM.exportCur) return;
    try {
      var data = SCM.exportCur();
      var txt = JSON.stringify(data, null, 2);
      var nm = String(data.name || '方案').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40);
      var blob = new Blob([txt], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = nm + '.scheme.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { a.remove(); URL.revokeObjectURL(url); } catch (e) {} }, 400);
      toast('已导出「' + data.name + '」：' + (data.cats || []).length + ' 个文件夹 · ' + Object.keys(data.banks || {}).length + ' 个题库', 2600, 'ok');
    } catch (e) {
      toast('导出失败：' + e.message, 2600, 'bad');
    }
  }
  function schemeImport() {
    if (!window.SCM || !SCM.importData) return;
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var obj = null;
        try { obj = JSON.parse(String(rd.result || '')); } catch (e) { toast('这个文件不是 JSON：' + e.message, 3000, 'bad'); return; }
        var res = null;
        try { res = SCM.importData(obj); } catch (e2) { toast('导入失败：' + e2.message, 3000, 'bad'); return; }
        if (!res || res.error) { toast('导入失败：' + ((res && res.error) || '文件不认识'), 3200, 'bad'); return; }
        schemeSwitch(res.id);
        var extra = res.dropped ? ('，另有 ' + res.dropped + ' 个题库在本机找不到，已跳过') : '';
        try {
          toast('已导入「' + res.name + '」：' + res.cats + ' 个文件夹 · ' + res.banks + ' 个题库对上了' + extra, 3600, 'ok');
        } catch (e3) {}
      };
      rd.readAsText(f, 'utf-8');
    };
    inp.click();
  }
  function pickScheme(title) {
    var cur = sid();
    var rows = (SCM.list() || []).filter(function (s) { return s.id !== cur; }).map(function (s) {
      return '<button type="button" class="qs-tg" data-t="' + E(s.id) + '">📁 ' + E(s.name) + '</button>';
    });
    if (!rows.length) {
      try { toast('只有一个方案，先点左上角 ＋ 新建一个', 2000); } catch (e) {}
      return Promise.resolve({ ok: false });
    }
    return qsModal({
      title: title || '选方案', html: '<div class="qs-tgs">' + rows.join('') + '</div>',
      buttons: [{ t: '取消', val: null }],
      onPick: function (id) { return { ok: true, sid: id }; }
    }).then(function (v) { return v && v.ok ? v : { ok: false }; });
  }
  function bulkAddScheme() {
    var l = selList();
    if (!l.bank.length) { try { toast('先勾选题库（文件夹请用文件夹 ⋯ 菜单）', 2000); } catch (e) {} return; }
    pickScheme('把 ' + l.bank.length + ' 个题库加进哪个方案？').then(function (r) {
      if (!r || !r.ok) return;
      l.bank.forEach(function (id) { try { SCM.setCatOf(id, '', r.sid); } catch (e) {} });
      S.sel = {};
      afterEdit('已加进「' + schemeName(r.sid) + '」的顶层');
    });
  }
  function schBadge(b) {
    try {
      if (!window.SCM || !SCM.schemesOfBank) return '';
      var arr = SCM.schemesOfBank(b.id) || [];
      if (arr.length < 2) return '';
      var names = arr.map(function (x) { return x.name; }).join('、');
      return '<span class="qs-sch" data-sch="' + E(b.id) + '" title="出现在 ' + arr.length + ' 个方案：' + E(names) + '">×' + arr.length + '</span>';
    } catch (e) { return ''; }
  }
  function showBankSchemes(bid) {
    if (!window.SCM) return;
    var arr = SCM.schemesOfBank(bid) || [];
    if (!arr.length) return;
    var cur = sid();
    var rows = arr.map(function (s) {
      return '<button type="button" class="qs-tg" data-t="' + E(s.id) + '">'
        + (s.id === cur ? '✓ ' : '') + '📁 ' + E(s.name)
        + '<span class="qs-tg-sub">' + E((CAT.get && CAT.get(s.cat) ? CAT.get(s.cat).title : '顶层')) + '</span></button>';
    }).join('');
    qsModal({
      title: '这个题库在 ' + arr.length + ' 个方案里', html: '<div class="qs-tgs">' + rows + '</div>',
      buttons: [{ t: '关闭', val: null }],
      onPick: function (id) { return { ok: true, sid: id }; }
    }).then(function (r) {
      if (!r || !r.ok || r.sid === sid()) return;
      schemeSwitch(r.sid);
    });
  }
  function bindScheme() {
    var sel = $('qsScheme');
    if (sel) sel.onchange = function () { schemeSwitch(this.value); };
    var nw = $('qsSchemeNew'); if (nw) nw.onclick = schemeNew;
    var mo = $('qsSchemeMore'); if (mo) mo.onclick = schemeMore;
    var sy = $('qsSyncTags'); if (sy) sy.onclick = function () {
      if (!window.SCM) return;
      var isTag = false;
      try { isTag = !!(SCM.tagMode && SCM.tagMode()); } catch (e0) {}
      if (!isTag) { try { toast('当前不是考点方案：先切到「考点分类」再点 ↻', 2400); } catch (e) {} return; }
      var n = 0;
      try { n = SCM.syncTagTree ? SCM.syncTagTree() : 0; } catch (e) {}
      schemeReload();
      try { toast(n ? ('同步完了：补了 ' + n + ' 个新文件夹') : '同步完了：没有新标签，文件夹已是最新', 2000, 'ok'); } catch (e) {}
    };
    paintSchemes();
  }

  /* ---------- 多选 / 星标 / 批量操作 ---------- */
  function selList() {
    var bank = [], cat = [];
    Object.keys(S.sel || {}).forEach(function (k) {
      if (S.sel[k] !== 1) return;
      if (k.indexOf('b:') === 0) bank.push(k.slice(2));
      else if (k.indexOf('c:') === 0) cat.push(k.slice(2));
    });
    return { bank: bank, cat: cat };
  }
  function selCount() { var l = selList(); return l.bank.length + l.cat.length; }
  function selToggle(k) {
    if (!k) return;
    if (S.sel[k] === 1) delete S.sel[k]; else S.sel[k] = 1;
    if (!selCount()) { /* 空选就留在多选模式，方便继续点 */ }
  }
  function starToggle(k) {
    if (!k) return;
    if ((S.star || {})[k] === 1) delete (S.star || {})[k]; else (S.star || {})[k] = 1;
    save();
    try { if (typeof toast === 'function') toast((S.star || {})[k] === 1 ? '已标星，常驻最上面' : '已取消星标', 1200, 'ok'); } catch (e) {}
  }

  function qsModal(opts) {
    return new Promise(function (res) {
      var mask = document.createElement('div');
      mask.className = 'qs-mask';
      var btns = (opts.buttons || []).map(function (b, i) {
        return '<button type="button" class="qs-mb ' + (b.cls || '') + '" data-v="' + i + '">' + b.t + '</button>';
      }).join('');
      mask.innerHTML = '<div class="qs-modal"><div class="qs-mt">' + opts.title + '</div>'
        + '<div class="qs-mc">' + (opts.html || '') + '</div>'
        + '<div class="qs-mf">' + btns + '</div></div>';
      document.body.appendChild(mask);
      var closed = false;
      function done(v) { if (closed) return; closed = true; mask.remove(); res(v); }
      mask.addEventListener('click', function (e) {
        if (e.target === mask) return done(null);
        var b = e.target.closest('.qs-mb');
        if (b) return done(opts.buttons[+b.dataset.v].val);
        var t = e.target.closest('.qs-tg');
        if (t && opts.onPick) return done(opts.onPick(t.getAttribute('data-t') || null));
      });
      var onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); done(null); document.removeEventListener('keydown', onKey, true); } };
      document.addEventListener('keydown', onKey, true);
    });
  }

  /* 选目标文件夹（排除自己跟自己的子孙） */
  function pickTarget(exCats) {
    var ex = {};
    (exCats || []).forEach(function (id) {
      ex[id] = 1;
      try { (CAT.descIds(id) || []).forEach(function (d) { ex[d] = 1; }); } catch (e) {}
    });
    var rows = ['<button type="button" class="qs-tg" data-t="">🏠 顶层（不放进文件夹）</button>'];
    (function walk(pid, d) {
      kids(pid).forEach(function (c) {
        if (ex[c.id]) return;
        rows.push('<button type="button" class="qs-tg" data-t="' + E(c.id) + '" style="--qs-ind:' + (8 + d * 16) + 'px">'
          + '<span class="qs-tg-ind"></span>📁 ' + E(c.title) + '</button>');
        walk(c.id, d + 1);
      });
    })(null, 0);
    return qsModal({
      title: '移动到…', html: '<div class="qs-tgs">' + rows.join('') + '</div>',
      buttons: [{ t: '取消', val: null }],
      onPick: function (cid) { return { ok: true, cid: cid || null }; }
    }).then(function (v) { return v && v.ok ? v : { ok: false }; });
  }

  function afterEdit(msg) {
    try { if (CAT.save) CAT.save(); } catch (e) {}
    try { if (CAT.render) CAT.render(); } catch (e) {}
    save(); paint();
    if (msg) { try { if (typeof toast === 'function') toast(msg, 1600, 'ok'); } catch (e) {} }
  }

  function bulkMove() {
    var l = selList();
    if (!l.bank.length && !l.cat.length) return;
    pickTarget(l.cat).then(function (r) {
      if (!r.ok) return;
      l.bank.forEach(function (id) { try { CAT.moveBank(id, r.cid); } catch (e) {} });
      l.cat.forEach(function (id) { try { CAT.move(id, r.cid); } catch (e) {} });
      S.sel = {};
      afterEdit('已移动 ' + (l.bank.length + l.cat.length) + ' 项');
    });
  }

  function catSubtree(id) {
    var out = { cats: [id], banks: [] };
    (function walk(cid) {
      banks().forEach(function (b) { if ((b.cat || null) === cid) out.banks.push(b.id); });
      kids(cid).forEach(function (k) { out.cats.push(k.id); walk(k.id); });
    })(id);
    return out;
  }
  function purgeCats(ids) {
    var set = {};
    ids.forEach(function (i) { set[i] = 1; });
    var arr = (CAT.all && CAT.all()) || [];
    for (var i = arr.length - 1; i >= 0; i--) if (set[arr[i].id]) arr.splice(i, 1);
  }

  function doDelBanks(ids) {
    var r = null;
    try { r = CAT.deleteBanks(ids); } catch (e) { r = null; }
    afterEdit('已删除 ' + ((r && r.n) || ids.length) + ' 个题库');
    S.sel = {};
  }

  function bulkDelete() {
    var l = selList();
    if (!l.bank.length && !l.cat.length) return;
    var ask = (window.BFUI && BFUI.confirm) ? BFUI.confirm.bind(BFUI) : function (o) { return Promise.resolve(window.confirm(o.title)); };
    if (!l.cat.length) {
      ask({
        title: '删除 ' + l.bank.length + ' 个题库？',
        html: '题库连同作答记录、收藏、自定义解析一起删掉，<b>不可恢复</b>。',
        okText: '删除', danger: true
      }).then(function (ok) { if (ok) doDelBanks(l.bank); });
      return;
    }
    var nBankInside = 0;
    l.cat.forEach(function (id) { var t = catSubtree(id); nBankInside += t.banks.length; });
    qsModal({
      title: '删除 ' + l.cat.length + ' 个文件夹' + (l.bank.length ? ' + ' + l.bank.length + ' 个题库' : '') + '？',
      html: '<div class="qs-ask">这些文件夹里一共有 <b>' + nBankInside + ' 个题库</b>。你想怎么删？</div>',
      buttons: [
        { t: '取消', val: 'no' },
        { t: '只删文件夹（题库上移）', val: 'shell', cls: 'ghost' },
        { t: '连里面的题库一起删', val: 'deep', cls: 'danger' }
      ]
    }).then(function (v) {
      if (!v || v === 'no') return;
      var allBanks = l.bank.slice();
      var shellCats = [];
      l.cat.forEach(function (id) {
        var c = CAT.get ? CAT.get(id) : null, pid = c ? (c.parent || null) : null;
        var sub = catSubtree(id);
        if (v === 'deep') {
          sub.banks.forEach(function (b) { allBanks.push(b); });
          shellCats = shellCats.concat(sub.cats);
        } else {
          banks().forEach(function (b) { if ((b.cat || null) === id) { try { CAT.moveBank(b.id, pid); } catch (e) {} } });
          kids(id).forEach(function (k) { try { CAT.move(k.id, pid); } catch (e) {} });
          shellCats.push(id);
        }
      });
      var uniq = {}, list = [];
      allBanks.forEach(function (b) { if (!uniq[b]) { uniq[b] = 1; list.push(b); } });
      var deleted = 0;
      if (list.length) { try { var r = CAT.deleteBanks(list); deleted = (r && r.n) || list.length; } catch (e) {} }
      purgeCats(shellCats);
      S.sel = {};
      afterEdit('已删除 ' + shellCats.length + ' 个文件夹' + (deleted ? ' · ' + deleted + ' 个题库' : ''));
    });
  }

  /* 星标常驻区：星标文件夹只显示一行（点走进管理器），星标题库直接摊平显示 */
  function starBlockHtml() {
    var keys = Object.keys(S.star || {}).filter(function (k) { return (S.star || {})[k] === 1; });
    if (!keys.length) return '';
    var bmap = {};
    banks().forEach(function (b) { bmap[b.id] = b; });
    var cc = [], bb = [];
    var PRE = 'c:' + sid() + ':';
    keys.forEach(function (k) {
      if (k.indexOf('b:') === 0) { var b = bmap[k.slice(2)]; if (b) bb.push(b); }
      else if (k.indexOf(PRE) === 0) { var c = CAT.get ? CAT.get(k.slice(PRE.length)) : null; if (c) cc.push(c); }
    });
    if (!cc.length && !bb.length) return '';
    var closed = !!S.starClosed;
    var rows = cc.map(function (c) {
      return '<div class="qs-starrow"><button type="button" class="qs-ch qs-staritem" data-open="' + E(c.id) + '" style="--qs-ind:6px;--qs-d:0">'
        + '<i class="qs-caret">\u203a</i><i class="qs-folder">📁</i>'
        + '<span class="qs-ct" title="' + E(c.title) + '">' + E(c.title) + '</span>'
        + '<span class="qs-star on" data-star="' + E(catKey(c.id)) + '" title="\u53d6\u6d88\u661f\u6807">\u2605</span></button></div>';
    }).join('');
    var brows = bb.map(function (b) { return rowHtml(b, 0); }).join('');
    return '<div class="qs-cat qs-stars' + (closed ? ' closed' : '') + '" data-starblock="1">'
      + '<div class="qs-sh qs-shstar" data-starfold="1" title="点一下折叠 / 展开常驻区">'
      + '<i class="qs-caret">' + (closed ? '\u203a' : '\u02c5') + '</i>'
      + '<span>\u2b50 \u5e38\u9a7b</span><em>' + (cc.length + bb.length) + '</em></div>'
      + '<div class="qs-cbody"' + (closed ? ' style="display:none"' : '') + '>' + rows + brows + '</div></div>';
  }

  /* 点考点文件夹（tgcat:）→ 直接跳这个考点的答题界面，从第 1 题开始。
     返回 true 表示已经跳走了；大标签（tgb:）没有单一题集，返回 false 交给调用方。 */
  function openTagFolder(cid) {
    try {
      var sid = String(cid || '');
      if (sid.indexOf('tgcat:') !== 0) return false;
      if (!(window.SCM && SCM.tgBankId)) return false;
      var tag = decodeURIComponent(sid.slice(6));
      var bid = SCM.tgBankId(tag);
      if (!bid) return false;
      try {
        if (typeof QZ === 'object' && QZ) {
          QZ.bankId = bid; QZ.filter = 'all'; QZ.subject = ''; QZ.order = null; QZ.rw = null; QZ.cur = null;
        }
      } catch (eQZ) {}
      if (typeof setOpen === 'function') setOpen(false);
      if (typeof go === 'function') go('#/bank/' + encodeURIComponent(bid));
      else location.hash = '#/bank/' + encodeURIComponent(bid);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- 点击 ---------- */
  function onListClick(e) {
    var cls = e.target.closest('#qsClassify');
    if (cls) { e.stopPropagation(); clsOpen(); return; }
    var sch = e.target.closest('.qs-sch');
    if (sch) { e.stopPropagation(); showBankSchemes(sch.getAttribute('data-sch')); return; }
    var ck = e.target.closest('[data-ck]');
    if (ck) { e.stopPropagation(); selToggle(ck.getAttribute('data-ck')); paint(); return; }
    var star = e.target.closest('[data-star]');
    if (star) { e.stopPropagation(); starToggle(star.getAttribute('data-star')); paint(); return; }
    var opn = e.target.closest('[data-open]');
    if (opn) {
      e.stopPropagation();
      var opnId = opn.getAttribute('data-open');
      /* 考点文件夹（名字点一下）→ 直接进这个考点的答题界面 */
      if (/^(tgcat:|tgb:)/.test(String(opnId)) && openTagFolder(opnId)) { return; }
      try { if (CAT.openDir) CAT.openDir(opnId); } catch (er) {}
      if (typeof go === 'function') go('#/');
      if (typeof setOpen === 'function') setOpen(false);
      return;
    }
    var sf = e.target.closest('[data-starfold]');
    if (sf) { e.stopPropagation(); S.starClosed = !S.starClosed; save(); paint(); return; }
    var cm = e.target.closest('[data-cm]');
    if (cm) { e.stopPropagation(); catMenu(cm.dataset.cm, cm); return; }
    var fold = e.target.closest('[data-fold]');
    if (fold) {
      var cid = fold.dataset.fold;
      /* 考点文件夹：点整行 → 直接进这个考点的答题界面（不是回首页管理器） */
      if (/^(tgcat:|tgb:)/.test(String(cid)) && !e.target.closest('.qs-caret') && !S.selmode) {
        e.stopPropagation();
        if (openTagFolder(cid)) return;
        /* 大标签（tgb:）没有单一题集：退回打开文件夹看子考点 */
        try { if (CAT.openDir) CAT.openDir(cid); } catch (er) {}
        if (typeof go === 'function') go('#/');
        if (typeof setOpen === 'function') setOpen(false);
        return;
      }
      if (S.selmode) { selToggle('c:' + cid); paint(); return; }
      S.closed[cid] = !S.closed[cid]; save();
      var block = fold.closest('.qs-cat');
      if (block) block.classList.toggle('folded', !!S.closed[cid]);
      return;
    }
    var more = e.target.closest('[data-more]');
    if (more) { e.stopPropagation(); menu(more.dataset.more, more); return; }
    var row = e.target.closest('[data-bank]');
    if (row) {
      if (S.selmode) { selToggle('b:' + row.dataset.bank); paint(); return; }
      openBank(row.dataset.bank);
    }
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
      + '<button type="button" data-m="addsch">里面的题库加进其它方案…</button>'
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
      } else if (act === 'addsch') {
        var sub = catSubtree(cid);
        if (!sub.banks.length) { try { toast('这个文件夹里没有题库', 1500); } catch (e) {} return; }
        pickScheme('把 ' + sub.banks.length + ' 个题库加进哪个方案？').then(function (r) {
          if (!r || !r.ok) return;
          sub.banks.forEach(function (bid) { try { SCM.setCatOf(bid, '', r.sid); } catch (e) {} });
          try { toast('已加进「' + schemeName(r.sid) + '」的顶层（原方案里也还在）', 2000, 'ok'); } catch (e) {}
        });
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

  /* ---------- ✨ 一键 AI 分类（只处理「未分类」里的题库） ---------- */
  var CLS_BUILD = 'b299';
  var CLS = { open: false, step: 'ask', req: '', groups: null, busy: false, err: '', note: '' };

  function clsUncat() {
    return banks().filter(function (b) { return !b.cat && !b.paper; });
  }
  function clsSample(b) {
    var out = [];
    (b.questions || []).slice(0, 3).forEach(function (q) {
      var t = String((q && q.stem) || '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t.length > 56 ? t.slice(0, 56) + '…' : t);
    });
    return out;
  }
  /* 导入时间（给 AI 分组用）：YYYY-MM-DD；没记录就空串 */
  function clsDay(ts) {
    var t = +ts || 0;
    if (!t) return '';
    var d = new Date(t);
    if (isNaN(d.getTime())) return '';
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function clsCfg() {
    try { return (typeof aiCfg === 'function' ? aiCfg() : {}) || {}; } catch (e) { return {}; }
  }
  function clsAiReady() {
    return typeof aiChat === 'function';
  }

  function clsMount() {
    if ($('clsMask')) return;
    var d = document.createElement('div');
    d.id = 'clsMask';
    d.className = 'mask cls-mask';
    d.innerHTML = '<div class="sheet cls-sheet" role="dialog" aria-modal="true">'
      + '<div class="cls-head"><b>✨ 一键 AI 分类</b>'
      + '<button type="button" class="btn cls-x" id="clsClose" title="关闭">✕</button></div>'
      + '<div class="cls-body" id="clsBody"></div>'
      + '<div class="cls-foot" id="clsFoot"></div>'
      + '</div>';
    document.body.appendChild(d);
    d.addEventListener('pointerdown', function (e) { if (e.target === d) clsCloseFn(); });
    d.addEventListener('click', function (e) {
      var id = e.target && e.target.id;
      if (id === 'clsClose') { clsCloseFn(); return; }
      if (id === 'clsRun') { clsRun(); return; }
      var eg = e.target && e.target.closest ? e.target.closest('.cls-eg') : null;
      if (eg) {
        var ta = $('clsReq');
        var v = eg.getAttribute('data-eg') || '';
        if (ta) { ta.value = v; }
        CLS.req = v;
        try { localStorage.setItem('qbank.cls.req.v1', v); } catch (e2) {}
        if (ta) ta.focus();
        return;
      }
      if (id === 'clsBack') { CLS.step = 'ask'; clsRender(); return; }
      if (id === 'clsApply') { clsApply(); return; }
    });
  }

  function clsOpen() {
    if (CLS.open && CLS.step === 'busy') {
      var mm = $('clsMask');
      if (mm) mm.classList.add('show');
      return;
    }
    var list = clsUncat();
    if (!list.length) {
      if (typeof toast === 'function') toast('没有「未分类」的题库了', 1600, 'ok');
      return;
    }
    clsMount();
    CLS.open = true;
    CLS.step = 'ask';
    CLS.err = '';
    CLS.note = '';
    CLS.groups = null;
    CLS.banks = list;
    CLS.req = '';
    try { CLS.req = localStorage.getItem('qbank.cls.req.v1') || ''; } catch (e) {}
    /* 老版本把「按科目分开…」当成默认值存进了 localStorage，这里识别并清掉，
       让默认回到"按内容自然分"，不预设内外科这种分法 */
    if (/^按科目分开：内科、外科、病理、生理、生化、人文/.test(CLS.req)) CLS.req = '';
    if (wide()) setOpen(true);
    $('clsMask').classList.add('show');
    clsRender();
    setTimeout(function () { var t = $('clsReq'); if (t) t.focus(); }, 60);
  }

  function clsCloseFn() {
    CLS.open = false;
    var m = $('clsMask');
    if (m) m.classList.remove('show');
  }

  function clsRender() {
    var body = $('clsBody'), foot = $('clsFoot');
    if (!body || !foot) return;
    var n = CLS.banks.length;
    if (CLS.step === 'ask') {
      body.innerHTML = '<p class="cls-hint">现在有 <b>' + n + '</b> 个题库还没归到文件夹里。'
        + '下面写你想要的分法（分几组、哪些放一起都行），AI 会照这个分。</p>'
        + '<textarea id="clsReq" class="cls-req" rows="3" placeholder="不填也行：默认按内容主题自然分组。也可以指定，例：按系统分 5 组；按考试年份分；每 3 个题库拼一组">'
        + E(CLS.req) + '</textarea>'
        + '<div class="cls-egs">'
        + '<button type="button" class="cls-eg" data-eg="按系统分：心血管、呼吸、消化、泌尿、内分泌、神经；其余归「其他」">按系统分</button>'
        + '<button type="button" class="cls-eg" data-eg="按考试年份分：年份相近的放一组，组名就用年份">按年份分</button>'
        + '<button type="button" class="cls-eg" data-eg="按题量分：每组大约 3 个题库，组名用一两个词概括内容">按题量分</button>'
        + '<button type="button" class="cls-eg" data-eg="">清空</button>'
        + '</div>'
        + '<p class="cls-hint dim">AI 只看题库名和几道题的开头，不会改题目内容；分完可以再手动拖。</p>'
        + (CLS.err ? '<p class="cls-err">' + E(CLS.err) + '</p>' : '');
      foot.innerHTML = '<span class="spacer-grow"></span>'
        + '<button type="button" class="btn" id="clsClose">取消</button>'
        + '<button type="button" class="btn primary" id="clsRun">✨ 让 AI 分一下</button>';
      return;
    }
    if (CLS.step === 'busy') {
      body.innerHTML = '<p class="cls-hint">✨ 正在读 ' + n + ' 个题库的标题和题目开头，想怎么分…</p>'
        + '<div class="cls-busy"><i></i><i></i><i></i></div>'
        + '<p class="cls-hint dim"><span class="cls-wait">已等 0 秒</span>；一般 3～15 秒，没配模型或服务没开的话会马上报错。</p>';
      foot.innerHTML = '<span class="spacer-grow"></span><button type="button" class="btn" id="clsClose">取消</button>';
      return;
    }
    /* preview */
    var gs = CLS.groups || [];
    var byId = {};
    CLS.banks.forEach(function (b) { byId[b.id] = b; });
    body.innerHTML = (CLS.err ? '<p class="cls-err">' + E(CLS.err) + '</p>' : '')
      + (CLS.note ? '<p class="cls-hint dim">' + E(CLS.note) + '</p>' : '')
      + (gs.length ? '' : '<p class="cls-hint">AI 没能分好，可以改改要求再来一次。</p>')
      + gs.map(function (g, i) {
        var names = (g.banks || []).map(function (id) { return byId[id] ? byId[id].title : ('?' + id); });
        return '<div class="cls-g" data-g="' + i + '">'
          + '<div class="cls-gh"><input class="cls-gn" data-gn="' + i + '" value="' + E(g.name) + '" maxlength="14">'
          + '<em>' + names.length + ' 个</em>'
          + '<label class="cls-gx"><input type="checkbox" data-gon="' + i + '"' + (g.skip ? '' : ' checked') + '> 要这组</label></div>'
          + '<div class="cls-gb">' + names.map(function (x) { return '<span class="cls-bn">' + E(x) + '</span>'; }).join('') + '</div>'
          + '</div>';
      }).join('');
    foot.innerHTML = '<span class="spacer-grow"></span>'
      + '<button type="button" class="btn" id="clsBack">改要求</button>'
      + '<button type="button" class="btn" id="clsClose">取消</button>'
      + '<button type="button" class="btn primary" id="clsApply"' + (gs.length ? '' : ' disabled') + '>应用到侧栏</button>';
  }

  function clsJSON(t) {
    try { return JSON.parse(t); } catch (e) {}
    var s = t.replace(/^\s*\uFEFF/, '');
    var m = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
    if (m) { try { return JSON.parse(m[1].trim()); } catch (e2) {} }
    for (var st = 0; st < s.length; st++) {
      var c0 = s.charAt(st);
      if (c0 !== '{' && c0 !== '[') continue;
      var open = c0, close = c0 === '{' ? '}' : ']', depth = 0, inStr = false, q = 0, esc = false;
      for (var i = st; i < s.length; i++) {
        var ch = s.charAt(i);
        if (inStr) {
          if (esc) { esc = false; continue; }
          if (ch === '\\') { esc = true; continue; }
          if (ch === q) inStr = false;
          continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; q = ch; continue; }
        if (ch === open) depth++;
        else if (ch === close) {
          depth--;
          if (depth === 0) {
            var cand = s.slice(st, i + 1).replace(/'/g, '"').replace(/,\s*([}\])])/g, '$1');
            try { return JSON.parse(cand); } catch (e3) {}
            break;
          }
        }
      }
    }
    return null;
  }

  /* 模型偶尔会把 JSON 写超长被截断（结尾没闭合）——把已经写完整的 {name, banks} 片段捞出来 */
  function clsSalvage(t) {
    var s = String(t || '');
    var out = [], re = /"name"\s*:\s*"([^"]{1,40})"/g, m, marks = [];
    while ((m = re.exec(s))) marks.push({ name: m[1], at: m.index + m[0].length });
    for (var i = 0; i < marks.length; i++) {
      var seg = s.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : s.length);
      var bi = seg.search(/"banks"\s*:/);
      if (bi < 0) continue;
      var arrStart = seg.indexOf('[', bi);
      if (arrStart < 0) continue;
      var arrSeg = seg.slice(arrStart + 1);
      var end = arrSeg.indexOf(']');
      if (end >= 0) arrSeg = arrSeg.slice(0, end);
      var ids = [], ir = /"([^"\s,]{3,80})"/g, im;
      while ((im = ir.exec(arrSeg))) ids.push(im[1]);
      if (!ids.length) ids = arrSeg.split(',').map(function (x) { return x.replace(/["'\s]/g, ''); }).filter(Boolean);
      if (ids.length) out.push({ name: marks[i].name.trim(), banks: ids });
    }
    return out.length ? { groups: out } : null;
  }

  function clsParse(txt) {
    var raw = String(txt || '');
    CLS.raw = raw.slice(0, 600);
    var j = clsJSON(raw);
    if (!j) return clsSalvage(raw);
    CLS.rawLen = raw.length;
    // 兼容多种形状：{groups:[{name,banks}]} / [{name,banks}] / {name:[ids]} / {分组:[…]}
    var groups = [];
    var arr = null;
    if (!Array.isArray(j) && j && j.name && (j.banks || j.ids || j.items || j.题库)) {
      // 只捞到一个 {name, banks} 片段：当成单组
      arr = [j];
    } else if (Array.isArray(j)) arr = j;
    else if (Array.isArray(j.groups)) arr = j.groups;
    else if (Array.isArray(j['分组']) || Array.isArray(j.folders) || Array.isArray(j.result)) arr = j['分组'] || j.folders || j.result;
    else if (j && typeof j === 'object') { arr = []; for (var k in j) if (Object.prototype.hasOwnProperty.call(j, k) && Array.isArray(j[k])) arr.push({ name: k, banks: j[k] }); }
    if (!arr) return null;
    for (var gi = 0; gi < arr.length; gi++) {
      var g = arr[gi] || {};
      var name = String(g.name || g.title || g.folder || g['分组名'] || g['文件夹'] || '').trim();
      if (!name) continue;
      var bs = g.banks || g.ids || g.items || g.题库 || [];
      if (!Array.isArray(bs)) bs = [bs];
      groups.push({ name: name.slice(0, 20), banks: bs.map(function (x) { return String(x).trim(); }).filter(Boolean) });
    }
    var expect = (raw.match(/"name"\s*:/g) || []).length;
    if (expect > groups.length) {
      var sg0 = clsSalvage(raw);
      if (sg0 && sg0.groups.length >= groups.length) return sg0;
    }
    if (groups.length && groups.length === 1 && /^(banks|ids|items|题库)$/i.test(groups[0].name)) {
      /* 只解析出 {"banks":[…]}, 没拿到组名——退回按原文抢救 */
      return clsSalvage(raw);
    }
    return groups.length ? { groups: groups } : null;
  }

  function clsRun() {
    var ta = $('clsReq');
    var req = (ta && ta.value || '').trim();
    CLS.req = req;   /* 清空就是「不指定」：走中性默认分法，不要回填上次的要求 */
    /* 用户没写要求：不预设分法，让 AI 按内容自然分 */
    var reqForAi = (CLS.req || '').trim()
      || '你没有特别要求就按内容主题自然分组：把考同一系统/同一主题的题库放在一起，每组 2~6 个；'
         + '组名简短（4~8 个字，例如「心血管」「呼吸」「围手术期」），拿不准的留在未分类。';
    try { localStorage.setItem('qbank.cls.req.v1', CLS.req); } catch (e) {}
    if (!clsAiReady()) { CLS.err = '这个站没加载 AI 模块（ai.js），没法自动分。'; CLS.step = 'ask'; clsRender(); return; }
    var cfg = clsCfg();
    if (!cfg.model) { CLS.err = '还没配模型：去「设置 → AI 服务」填好模型再来（分完还能手动拖，不急）。'; CLS.step = 'ask'; clsRender(); return; }
    if (CLS.running) { return; }
    CLS.running = true;
    CLS.err = ''; CLS.step = 'busy'; clsRender();

    var list = CLS.banks;
    var lines = list.map(function (b, i) {
      var ex = clsSample(b);
      var born = clsDay(b.createdAt);
      return (i + 1) + '. id=' + b.id + ' | 《' + b.title + '》 | ' + (b.questions ? b.questions.length : 0) + ' 题'
        + (born ? ' | 导入于 ' + born : '')
        + (ex.length ? ' | 题目开头：' + ex.join(' / ') : '');
    }).join('\n');
    var sys = '你是题库整理助手。用户给你一批还没归类的题库（id 与信息）和他想要的分类方式。'
      + '你只负责按他的要求把它们分到若干文件夹里，并且只输出一个 JSON 对象，不要任何解释、不要代码块。';
    var usr = '用户的分法要求：' + reqForAi + '\n\n题库清单：\n' + lines
      + '\n（每行里的「导入于 YYYY-MM-DD」是这个题库导入本机的时间；'
      + '如果用户想按导入时间/批次分（例如「这个月的单独一组」「按学期分」），就用这个时间判断；没有这项的是早期导入、时间不详。）'
      + '\n\n只输出这个格式：{"groups":[{"name":"文件夹名","banks":["id1","id2"]}]}'
      + '\n要求：name 是新建文件夹的名字（≤12 个字，不要 emoji、不要带编号）；'
      + 'banks 只能填上面清单里出现过的 id；同一个题库只能出现在一组里；'
      + '拿不准或不符合任何一组的，就别放进任何 group（会留在未分类）。';

    /* 上一轮还没结束就再点：先掐掉旧的，避免两个请求抢面板 */
    try { if (CLS.ctl && CLS.ctl.abort) CLS.ctl.abort(); } catch (e) {}
    var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    CLS.ctl = ctl;
    var t0 = Date.now(), got = 0;
    var tick = setInterval(function () {
      var w = document.querySelector('.cls-wait');
      if (!w) return;
      var sec = Math.round((Date.now() - t0) / 1000);
      w.textContent = '已等 ' + sec + ' 秒' + (got ? '，已收到 ' + got + ' 字' : '')
        + (sec >= 15 ? '（模型思考中，最多等 150 秒）' : '');
    }, 500);
    var timer = setTimeout(function () {
      try { if (ctl) ctl.abort(); } catch (e) {}
      if (!CLS._timedOut) {
        CLS._timedOut = true;
        try { toast('等了 150 秒模型还没回，已停下', 2600, 'bad'); } catch (e) {}
      }
    }, 150000);
    var MSGS = [{ role: 'system', content: sys }, { role: 'user', content: usr }];
    var MODEL_NAME = '';
    try { MODEL_NAME = String((typeof aiCfg === 'function' && aiCfg().model) || ''); } catch (e) {}
    var TOK = 6000;   /* 只是上限，不按上限计费 */
    var SIG = ctl ? ctl.signal : undefined;
    /* 先走流式：能立刻看到"已收到 N 字"，也避免非流式在慢服务上一直干等 */
    Promise.resolve()
      .then(function () {
        var acc = '';
        return aiChat(MSGS, function (full) { got = String(full || acc || '').length; acc = full; }, SIG, { stream: true, temp: 0.2, maxTokens: TOK })
          .then(function (full) {
            var t = String(full || acc || '');
            if (t.trim()) return t;
            /* 流式也空：再用非流式、并且不给 max_tokens（有些服务商把预算算得很怪） */
            return aiChat(MSGS, null, SIG, { stream: false }).then(function (t2) {
              var t3 = String(t2 || '');
              if (t3.trim()) return t3;
              var e2 = new Error('模型返回了空内容');
              e2.body = 'empty';
              throw e2;
            });
          });
      })
      .then(function (txt) {
        clearTimeout(timer); clearInterval(tick); CLS._timedOut = false; CLS.running = false;
        var data = clsParse(txt);
        if (data && data.groups) {
          // 模型有时把 id 写成序号（1、2、3）——按清单顺序还原成真 id
          var idxMap = {};
          CLS.banks.forEach(function (b, i) { idxMap[String(i + 1)] = b.id; });
          data.groups.forEach(function (g) {
            g.banks = (g.banks || []).map(function (v) {
              var k = String(v).trim().replace(/^#/, '').replace(/[|:：].*$/, '');
              if (CLS.banks.some(function (b) { return b.id === k; })) return k;
              return idxMap[k] || k;
            });
          });
        }
        if (!data || !data.groups || !data.groups.length) { console.warn('[classify] 模型原文:', CLS.raw); throw new Error('AI 的回答不是预期的 JSON（共 ' + String(CLS.raw || '').length + ' 字，结尾：'
              + String(CLS.raw || '').slice(-80) + '）[' + CLS_BUILD + ']'); }
        var byId = {};
        list.forEach(function (b) { byId[b.id] = 1; });
        var used = {};
        var gs = [];
        data.groups.forEach(function (g) {
          var name = String((g && g.name) || '').trim().slice(0, 14);
          if (!name) return;
          var ids = (g.banks || []).filter(function (id) {
            if (!byId[id] || used[id]) return false;
            used[id] = 1; return true;
          });
          if (ids.length) gs.push({ name: name, banks: ids });
        });
        if (!gs.length) throw new Error('AI 没给出可用的分组');
        CLS.groups = gs;
        var rest = list.length - Object.keys(used).length;
        CLS.note = 'AI 分了 ' + gs.length + ' 组，共 ' + Object.keys(used).length + ' 个题库'
          + (rest > 0 ? '，还有 ' + rest + ' 个留在未分类' : '') + '。名字可以直接改。';
        CLS.step = 'preview';
        clsRender();
      })
      .catch(function (e) {
        clearTimeout(timer); clearInterval(tick); CLS.running = false;
        var wasTimeout = CLS._timedOut === true; CLS._timedOut = false;
        if (wasTimeout) {
          CLS.err = '等了 150 秒模型还没回，先停下了。拿 20 多个题库去分时，推理型模型常常要一两分钟：可以少选几个未分类的题库、或换个更快的模型（设置 → AI 服务），或过一会儿再试。[' + CLS_BUILD + ']';
          CLS.step = 'ask';
          clsRender();
          return;
        }
        if (e && e.body === 'empty') {
          CLS.err = '没分成功：模型一个字都没回（已试 3 次：非流式 / 流式 / 不给上限）。可能是这家服务商只放思考过程、或限流/额度用尽。换个模型（设置 → AI 服务）再试。[' + CLS_BUILD + ']';
          CLS.step = 'ask';
          clsRender();
          return;
        }
        var msg = '';
        try {
          msg = (typeof aiErrInfo === 'function' && e) ? (aiErrInfo(e).msg || '') : '';
          var hint = (typeof aiErrInfo === 'function' && e) ? (aiErrInfo(e).hint || '') : '';
          msg = msg ? (msg + (hint ? ' · ' + hint : '')) : '';
        } catch (x) {}
        if (!msg) msg = (e && e.message) ? e.message : 'AI 没回话';
        CLS.err = '没分成功：' + msg;
        CLS.step = 'ask';
        clsRender();
      });
  }

  function clsApply() {
    var gs = CLS.groups || [];
    var body = $('clsBody');
    if (!gs.length || !body) return;
    var picked = [];
    gs.forEach(function (g, i) {
      var on = body.querySelector('[data-gon="' + i + '"]');
      var nm = body.querySelector('[data-gn="' + i + '"]');
      var name = (nm && nm.value || g.name || '').trim().slice(0, 14);
      if (on && !on.checked) return;
      if (!name) return;
      picked.push({ name: name, banks: g.banks.slice() });
    });
    if (!picked.length) { CLS.err = '一组都没选，先勾上要的组。'; clsRender(); return; }
    var undo = { cats: [], banks: [] };
    var moved = 0;
    picked.forEach(function (g) {
      var cid = null;
      /* 已经有同名的一级文件夹就直接用它，别再建一个重复的 */
      try {
        var same = kids(null).filter(function (c) { return String(c.title || '').trim() === g.name; })[0];
        if (same) cid = same.id;
      } catch (e) {}
      var isNew = false;
      if (!cid) {
        try { cid = CAT.create(null, g.name); isNew = true; } catch (e) { cid = null; }
      }
      if (!cid) return;
      if (isNew) undo.cats.push(cid);
      g.banks.forEach(function (id) {
        var b = null;
        try { b = banks().filter(function (x) { return x.id === id; })[0]; } catch (e) {}
        undo.banks.push({ id: id, cat: b ? (b.cat || null) : null });
        try { if (CAT.moveBank(id, cid)) moved++; } catch (e) {}
      });
    });
    try { CAT.save(); } catch (e) {}
    CLS.open = false; clsCloseFn();
    setTimeout(function () { try { paint(); } catch (e) {} try { if (window.CAT && CAT.render) CAT.render(); } catch (e) {} }, 40);
    if (typeof toast === 'function') {
      toast('AI 把 ' + moved + ' 个题库分成了 ' + picked.length + ' 组', 5200, 'ok', {
        label: '撤销',
        fn: function () {
          try {
            undo.banks.forEach(function (x) { try { CAT.moveBank(x.id, x.cat); } catch (e) {} });
            try { CAT.save(); } catch (e) {}
            try { if (CAT.delEmpty) CAT.delEmpty(undo.cats.slice()); } catch (e) {}
            try { if (CAT.save) CAT.save(); } catch (e) {}
            paint();
            if (window.CAT && CAT.render) CAT.render();
          } catch (e) {}
          if (typeof toast === 'function') toast('已撤销分类', 1400, 'ok');
        }
      });
    }
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
    /* web313：#view 的 MutationObserver 已经会在每次重画后 refresh()，
       hashchange 再挂一个只会让侧栏在「导航时」白画一遍（实测每次导航整棵侧栏重写 2 次）。
       侧栏只关心题库/文件夹数据，数据变了自有 refresh()/storage 事件兜底，所以这里不再监听 hashchange。 */
    window.addEventListener('storage', function (e) { if (e.key && e.key.indexOf('qbank.') === 0) refresh(); });
  }

  window.SIDE = {
    paint: paint,
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    toggle: function () { setOpen(!S.open); },
    newFolder: newFolder,
    classify: clsOpen,
    classifyState: function () { return { open: CLS.open, step: CLS.step, n: (CLS.banks || []).length }; },
    moveTo: moveBankTo,
    state: function () { return { open: S.open, q: S.q, wide: wide(), drag: DRAG }; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
