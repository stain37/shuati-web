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
  function hits(hay) {
    var q = MT.q;
    if (!q) return true;
    var h = nz(hay), qn = nz(q);
    if (!qn) return true;
    if (hitOne(h, qn)) return true;                   /* 本地直接命中，最高优先 */
    if (AIQ.q === q && AIQ.fixed) {                   /* AI 纠错后的词 */
      var f = nz(AIQ.fixed);
      if (f && qn.indexOf(f) < 0 && hitOne(h, f)) return true;
    }
    var best = 0;
    for (var i = 0; i < MT.terms.length; i++) {
      var t = nz(MT.terms[i]);
      if (!t) continue;
      var s0 = termScore(h, t) * ((MT.wmap && MT.wmap[MT.terms[i]]) || 0.8);
      if (s0 > best) best = s0;
    }
    return best >= 0.5;                              /* 扩展词要够相关才算命中 */
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
    var hit = { n: 0 };
    var html = '';
    kids(null).forEach(function (c) { html += catHtml(c, 0, bm, q, hit); });
    var rootBanks = (bm[''] || []).filter(function (b) {
      if (!q) return true;
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
    var st = $('qsStat');
    if (st) st.innerHTML = (q ? '命中 ' + (hit.n + rootBanks.length) + ' 个' : '共 ' + allB.length + ' 个题库 · ' + nq + ' 题') + '<span class="qs-pd">已答 ' + nDone + '</span>';
  }

  /* ---------- 点击 ---------- */
  function onListClick(e) {
    var cls = e.target.closest('#qsClassify');
    if (cls) { e.stopPropagation(); clsOpen(); return; }
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

  /* ---------- ✨ 一键 AI 分类（只处理「未分类」里的题库） ---------- */
  var CLS_BUILD = 'b298';
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
      return (i + 1) + '. id=' + b.id + ' | 《' + b.title + '》 | ' + (b.questions ? b.questions.length : 0) + ' 题'
        + (ex.length ? ' | 题目开头：' + ex.join(' / ') : '');
    }).join('\n');
    var sys = '你是题库整理助手。用户给你一批还没归类的题库（id 与信息）和他想要的分类方式。'
      + '你只负责按他的要求把它们分到若干文件夹里，并且只输出一个 JSON 对象，不要任何解释、不要代码块。';
    var usr = '用户的分法要求：' + reqForAi + '\n\n题库清单：\n' + lines
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
    window.addEventListener('hashchange', function () { setTimeout(function () { apply(); paint(); }, 120); });
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
