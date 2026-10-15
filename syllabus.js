/* ============================================================
   syllabus.js —— 考纲覆盖度自查（方案六）
   把「自己导入的知识库」当考纲：让 AI 抽出考点清单（可缓存，花钱只花这一次），
   再纯本地比对题库 + 作答记录，回答那个问题：
       考纲里有哪些考点，我还没出题 / 还没做过？
   每个空白考点旁边一个「让 AI 出题」，直接把缺口补上（接方案三的命题通道）。
   数据：qbank.syllabus.v1 = { "<知识库id>": { points:[{name,hint}], ts, chars } }
   ============================================================ */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  var S_KEY = 'qbank.syllabus.v1';
  var PER_BATCH = 12;         /* 一次喂几段资料 */
  var CH_MAX = 420;           /* 每段最多多少字（太长就截） */
  var SIM_MIN = 0.25;         /* 兜底口径：2-gram Jaccard 阈值 */
  var GEN_N = 3;              /* 每个考点出几道题 */

  var SYL = {};
  var VIEW = { kbId: null, filter: 'all', open: null };
  var PTS = { running: false, ctl: null, done: 0, total: 0, note: '', err: null };
  var GEN = { running: false, ctl: null, point: null, text: '', parsed: null, note: '', err: null, open: false };

  function rd() {
    try { SYL = (typeof readLS === 'function') ? (readLS(S_KEY, {}) || {}) : (JSON.parse(localStorage.getItem(S_KEY)) || {}); } catch (e) { SYL = {}; }
  }
  function save() {
    if (typeof mergeWrite === 'function') return mergeWrite(S_KEY, SYL, 'syl');
    return writeLS(S_KEY, SYL);
  }
  function kbAll() { try { return (typeof kbList === 'function') ? kbList() : []; } catch (e) { return []; } }
  /* 站点自带的知识库是 kb.js 后来动态挂上 知识库.js 才有的（第一次要读几 MB 的文件）。
     考纲页先开、库后到的时候，空下拉会一直空着 —— 所以等它一会儿，来了一本就重画一次。 */
  var kbTimer = null;
  function retryKb(n) {
    if (kbTimer) clearTimeout(kbTimer);
    if (n > 20) return;
    kbTimer = setTimeout(function () {
      if (kbAll().length) {
        kbTimer = null;
        try { if (typeof route === 'function' && route().name === 'syllabus') renderSyllabus(); } catch (e) {}
      } else retryKb(n + 1);
    }, 1000);
  }
  function kbName(id) {
    var k = kbAll().filter(function (x) { return String(x.id) === String(id); })[0];
    return k ? (k.name || k.id) : id;
  }
  function cur() {
    var id = VIEW.kbId || (kbAll()[0] || {}).id || null;
    return id ? SYL[id] : null;
  }
  function points() { var c = cur(); return (c && c.points) ? c.points : []; }

  /* ---------- 覆盖判定（纯本地，不花钱） ---------- */
  function grams(s) {
    s = String(s || '').replace(/\s+/g, '').toLowerCase();
    var out = [];
    for (var i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  }
  function jac(a, b) {
    var A = {}, B = {}, n = 0;
    a.forEach(function (g) { A[g] = 1; });
    b.forEach(function (g) { B[g] = 1; });
    Object.keys(A).forEach(function (g) { if (B[g]) n++; });
    var u = Object.keys(A).length + Object.keys(B).length - n;
    return u ? n / u : 0;
  }
  function qText(q) {
    return String(q.stem || '') + ' ' + (q.options || []).join(' ') + ' ' + String(q.explain || '');
  }
  function hitByTag(list, name) {
    for (var i = 0; i < list.length; i++) {
      var t = String(list[i] || '');
      if (t === name || t.indexOf(name) >= 0 || name.indexOf(t) >= 0) return true;
    }
    return false;
  }
  /* 性能：老写法是「每个考点 × 每道题」都重新算一遍 2-gram，题库上千题、考点几十个时
     进这一页要卡好几秒。现在分三层：
       ① 题目侧缓存 QC：每题「题干 + 选项 + 解析」的 2-gram 集合 + 作答 + 标签，只建一次
       ② 结果缓存 CC：覆盖度结果按签名缓存（签名 = 清单版本 + 题库 + 作答 + 标签）
       ③ 签名一变才重算；工作量大就分片算（页面先出来，那一块自己补上） */
  var SYNC_COST = 20000;        /* 考点数 × 题数 小于它就同步算，省得闪一下 */
  var CHUNK_PTS = 6;            /* 分片算：一片几个考点 */
  var QC = { sig: '', items: null, tags: false };
  var CC = { sig: '', data: null, ms: 0, how: '' };

  function nowMs() { try { return performance.now(); } catch (e) { return Date.now(); } }
  /* 2-gram 集合（对象查表 O(1)，比数组省得多） */
  function gset(s) {
    s = String(s || '').replace(/\s+/g, '').toLowerCase();
    var g = {}, n = 0;
    for (var i = 0; i < s.length - 1; i++) { var x = s.slice(i, i + 2); if (!g[x]) { g[x] = 1; n++; } }
    return { g: g, n: n };
  }
  function jacSet(a, b) {
    var n = 0;
    for (var x in a.g) { if (b.g[x]) n++; }
    var u = a.n + b.n - n;
    return u ? n / u : 0;
  }
  function qCount() {
    var n = 0;
    try { (typeof baseBanks === 'function' ? baseBanks() : []).forEach(function (b) { n += (b.questions || []).length; }); } catch (e) {}
    return n;
  }
  /* 题库签名：题数 + 文本长度和（改题干 / 选项 / 解析也算「变了」）。只读字符串长度，很便宜 */
  function bankSig() {
    var s = '';
    try {
      (typeof baseBanks === 'function' ? baseBanks() : []).forEach(function (b) {
        var qs = b.questions || [], len = 0;
        for (var i = 0; i < qs.length; i++) {
          var q = qs[i];
          len += String(q.stem || '').length + String((q.options || []).join('')).length + String(q.explain || '').length;
        }
        s += b.id + ':' + qs.length + ':' + len + ';';
      });
    } catch (e) {}
    return s;
  }
  function ansSig() {
    var n = 0, mx = 0;
    try {
      var a = (typeof ANS !== 'undefined' && ANS) ? ANS : {};
      for (var k in a) { n++; var t = (a[k] && a[k].ts) || 0; if (t > mx) mx = t; }
    } catch (e) {}
    return n + ':' + mx;
  }
  function tagCnt() { try { return Object.keys((window.TAGS && window.TAGS.data()) || {}).length; } catch (e) { return 0; } }
  function covSig(bs) {
    var c = cur();
    return [VIEW.kbId || '', (c && c.ts) || 0, points().length, bs, ansSig(), tagCnt()].join('|');
  }
  function itemsFor(bs) {
    if (QC.sig === bs && QC.items) return QC.items;
    var items = [];
    try {
      (typeof baseBanks === 'function' ? baseBanks() : []).forEach(function (b) {
        (b.questions || []).forEach(function (q) {
          var k = (typeof kOf === 'function') ? kOf(b, q) : (b.id + '#' + q.id);
          var a = (typeof ANS !== 'undefined' && ANS) ? ANS[k] : null;
          items.push({ q: q, k: k, g: gset(qText(q)), done: !!(a && !a.redo), ok: !!(a && a.ok), wrong: a ? (a.wrong || 0) : 0 });
        });
      });
    } catch (e) {}
    var hasTags = false;
    try { hasTags = !!(window.TAGS && Object.keys(window.TAGS.data() || {}).length); } catch (e) {}
    QC = { sig: bs, items: items, tags: hasTags };
    return items;
  }
  function rowOf(p, items, hasTags) {
    var name = String(p.name || '').trim();
    var pg = gset(name + ' ' + String(p.hint || ''));
    var hits = [];
    for (var i = 0; i < items.length; i++) {
      var x = items[i], byTag = false;
      if (hasTags) { try { byTag = hitByTag(window.TAGS.of(x.k), name); } catch (e) {} }
      if (byTag) { hits.push({ x: x, how: 'tag' }); continue; }
      var s = jacSet(pg, x.g);                      /* 兜底口径一直算：没标签的题也能被题干相似度捞到 */
      if (s >= SIM_MIN) hits.push({ x: x, how: 'sim', s: s });
    }
    var done = 0, ok = 0, wrong = 0, tagHit = 0;
    hits.forEach(function (h) {
      if (h.how === 'tag') tagHit++;
      if (h.x.done) { done++; if (h.x.ok) ok++; }
      wrong += h.x.wrong || 0;
    });
    var acc = done ? Math.round(ok / done * 100) : null;
    var status = !hits.length ? '空白' : ((done && acc < 50) || wrong > 0 ? '薄弱' : '已覆盖');
    if (!hits.length) status = '空白';
    else if (wrong > 0 && (acc == null || acc < 60)) status = '薄弱';
    else if (acc != null && acc < 50) status = '薄弱';
    else status = '已覆盖';
    return {
      name: name, hint: String(p.hint || ''), n: hits.length, tagHit: tagHit, done: done, ok: ok,
      wrong: wrong, acc: acc, status: status, keys: hits.map(function (h) { return h.x.k; })
    };
  }
  function finishRows(rows, total) {
    var order = { '空白': 0, '薄弱': 1, '已覆盖': 2 };
    rows.sort(function (a, b) {
      return order[a.status] - order[b.status] || (a.acc == null ? -1 : a.acc) - (b.acc == null ? -1 : b.acc) || a.name.localeCompare(b.name, 'zh');
    });
    var sum = { all: rows.length, blank: 0, weak: 0, ok: 0 };
    rows.forEach(function (r) { if (r.status === '空白') sum.blank++; else if (r.status === '薄弱') sum.weak++; else sum.ok++; });
    return { rows: rows, sum: sum, hasTags: QC.tags, total: total, ms: 0, how: 'calc' };
  }
  function coverage() {
    var bs = bankSig(), sig = covSig(bs);
    if (CC.sig === sig && CC.data) { CC.how = 'cache'; CC.data.how = 'cache'; CC.data.ms = CC.ms; return CC.data; }
    var items = itemsFor(bs), list = points(), t0 = nowMs();
    var rows = [];
    for (var i = 0; i < list.length; i++) rows.push(rowOf(list[i], items, QC.tags));
    var data = finishRows(rows, items.length);
    CC = { sig: sig, data: data, ms: Math.round(nowMs() - t0), how: 'calc' };
    data.ms = CC.ms; data.how = 'calc';
    return data;
  }
  /* 大工作量走这里：一片一片算，中途还能报进度 */
  function coverageChunked(onDone, onStep) {
    var bs = bankSig(), sig = covSig(bs);
    if (CC.sig === sig && CC.data) { CC.how = 'cache'; CC.data.how = 'cache'; CC.data.ms = CC.ms; onDone(CC.data); return; }
    var items = itemsFor(bs), list = points(), hasTags = QC.tags;
    var rows = [], i = 0, t0 = nowMs();
    (function step() {
      var end = Math.min(i + CHUNK_PTS, list.length);
      for (; i < end; i++) rows.push(rowOf(list[i], items, hasTags));
      if (i < list.length) { if (onStep) onStep(Math.round(i / (list.length || 1) * 100)); setTimeout(step, 0); return; }
      var data = finishRows(rows, items.length);
      CC = { sig: sig, data: data, ms: Math.round(nowMs() - t0), how: 'calc' };
      data.ms = CC.ms; data.how = 'calc';
      onDone(data);
    })();
  }

  /* ---------- Step 1：抽考点清单 ---------- */
  function parsePoints(txt) {
    var t = String(txt || '');
    function tryParse(s) {
      try {
        var v = JSON.parse(s);
        if (Array.isArray(v)) return v;
        if (v && Array.isArray(v.points)) return v.points;
      } catch (e) {}
      return null;
    }
    var v = tryParse(t);
    if (!v) { var m = t.match(/\[[\s\S]*\]/); if (m) v = tryParse(m[0]); }
    if (!v) {
      /* 兜底：一行一个「考点名：说明」或「考点名」 */
      v = t.split(/\r?\n/).map(function (ln) {
        ln = ln.replace(/^\s*[-*\d.、)）]+\s*/, '').replace(/["“”',]/g, '').trim();
        if (!ln || ln.length > 40) return null;
        var mm = ln.split(/[:：]/);
        return { name: (mm[0] || '').trim(), hint: (mm[1] || '').trim() };
      }).filter(Boolean);
    }
    if (!v) return null;
    var out = [], seen = {};
    v.forEach(function (x) {
      var name = '', hint = '';
      if (typeof x === 'string') name = x;
      else if (x && typeof x === 'object') { name = x.name || x.point || x.title || ''; hint = x.hint || x.desc || x.note || ''; }
      name = String(name || '').replace(/[\s,，、;；]+/g, ' ').trim().slice(0, 24);
      hint = String(hint || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!name || name.length < 2) return;
      var key = name;
      if (seen[key]) { if (hint && seen[key].hint.length < hint.length) seen[key].hint = hint; return; }
      seen[key] = { name: name, hint: hint };
      out.push(seen[key]);
    });
    return out.length ? out : null;
  }
  function chunksOf(id) {
    var mem = (typeof KB_MEM !== 'undefined' && KB_MEM) ? KB_MEM[id] : null;
    if (!mem || !mem.docs) return [];
    var out = [];
    mem.docs.forEach(function (d) {
      (d.chunks || []).forEach(function (c) {
        var t = String(c && c.t || '').trim();
        if (!t) return;
        if (t.length > CH_MAX) t = t.slice(0, CH_MAX);
        out.push({ doc: d.name || '', h: (c && c.h) || '', t: t });
      });
    });
    return out;
  }
  async function genPoints() {
    if (PTS.running) return;
    var id = VIEW.kbId || (kbAll()[0] || {}).id;
    if (!id) { PTS.note = '还没有知识库：先去「AI 与知识库」导入资料'; paint(); return; }
    var cfg = null;
    try { cfg = (typeof aiCfg === 'function') ? aiCfg() : null; } catch (e) { cfg = null; }
    if (!(cfg && cfg.model && (cfg.base || cfg.preset === 'ollama')) || typeof aiChat !== 'function') {
      PTS.note = '还没配 AI：先去「AI 与知识库」配一个服务';
      paint();
      if (typeof toast === 'function') toast('还没配 AI：先去「AI 与知识库」配一下');
      return;
    }
    PTS.running = true; PTS.note = ''; PTS.err = null; PTS.done = 0; PTS.total = 0;
    PTS.ctl = ('AbortController' in window) ? new AbortController() : null;
    paint();
    try {
      if (typeof kbEnsure === 'function') { PTS.note = '正在把资料读进内存…'; paint(); await kbEnsure(id); }
      var chs = chunksOf(id);
      if (!chs.length) { PTS.note = '这个库里没有可用的正文（是空的？）'; PTS.running = false; paint(); return; }
      var batches = [];
      for (var i = 0; i < chs.length; i += PER_BATCH) batches.push(chs.slice(i, i + PER_BATCH));
      PTS.total = batches.length;
      var sys = (typeof aiSysText === 'function') ? aiSysText() : '你是一位医学考试的教研老师。';
      var all = [];
      for (var bi = 0; bi < batches.length; bi++) {
        if (!PTS.running) break;
        PTS.done = bi; paint();
        var body = batches[bi].map(function (c) {
          return (c.h ? '【标题】' + c.h + '\n' : '') + c.t;
        }).join('\n\n');
        var prompt = '下面是一份医学资料的分片，可能带小标题（【标题】）。\n'
          + '请提炼出其中出现的**考点**，每个考点：2–8 字的名词 + 一句话说明（20 字内）。\n'
          + '只输出 JSON，不要解释、不要代码块围栏：\n[{"name":"炎症的机制","hint":"白三烯/C5a 介导趋化"}]\n\n'
          + '【资料】\n' + body;
        try {
          var txt = await aiChat([{ role: 'system', content: sys }, { role: 'user', content: prompt }],
            function () {}, PTS.ctl ? PTS.ctl.signal : undefined);
          var ps = parsePoints(txt);
          if (ps) all = all.concat(ps);
        } catch (e) {
          var stopped = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
          if (stopped) { PTS.note = '已停止：已经抽到的会留着'; break; }
        }
      }
      /* 去重合并（同名合并 hint） */
      var seen = {}, merged = [];
      all.forEach(function (p) {
        if (seen[p.name]) { if (p.hint && (seen[p.name].hint || '').length < p.hint.length) seen[p.name].hint = p.hint; return; }
        seen[p.name] = { name: p.name, hint: p.hint || '' };
        merged.push(seen[p.name]);
      });
      if (!merged.length) { PTS.note = '这一轮没抽到考点（模型没按 JSON 输出？换个模型或再点一次）'; }
      else {
        var kb = kbAll().filter(function (x) { return String(x.id) === String(id); })[0] || {};
        SYL[id] = { points: merged, ts: Date.now(), chars: kb.chars || 0, batches: batches.length };
        save();
        PTS.note = '抽到 ' + merged.length + ' 个考点（' + batches.length + ' 批）。可以手工增删改，之后随时重算覆盖度。';
      }
    } catch (e) {
      PTS.note = '出错：' + ((e && e.message) || e);
    } finally {
      PTS.running = false; PTS.ctl = null; PTS.done = PTS.total; paint();
      if (typeof render === 'function') { try { render(); } catch (e) {} }
    }
  }
  function stopPoints() {
    if (!PTS.running) return;
    PTS.running = false;
    try { if (PTS.ctl) PTS.ctl.abort(); } catch (e) {}
    PTS.note = '已停止';
    paint();
  }

  /* ---------- Step 4：给（空白）考点出题 ---------- */
  function genSysText() {
    var base = (typeof aiSysText === 'function') ? aiSysText() : '你是一位医学考试的命题老师。';
    return base + '\n\n【本次任务】你是命题老师。围绕我给的考点出 ' + GEN_N + ' 道题。\n要求：\n'
      + '1) 每题都要紧扣这个考点，问法要像考试题；\n'
      + '2) 每题都要给正确选项和简短解析；\n'
      + '3) 严格按下面的纯文本格式输出，不要表格、不要代码块、不要额外解释：\n'
      + '# 考点题\n\n1. 题干…\nA. …\nB. …\nC. …\nD. …\n答案：X\n解析：…';
  }
  function pointCtx(p) {
    var id = VIEW.kbId || (kbAll()[0] || {}).id;
    var out = [];
    try {
      var mem = (typeof KB_MEM !== 'undefined' && KB_MEM) ? KB_MEM[id] : null;
      var gs = grams(p.name + ' ' + (p.hint || ''));
      var cand = [];
      if (mem && mem.docs) {
        mem.docs.forEach(function (d) {
          (d.chunks || []).forEach(function (c) {
            var s = jac(gs, grams((c.h || '') + ' ' + c.t));
            if (s > 0.02) cand.push({ s: s, t: (c.h ? '【' + c.h + '】' : '') + String(c.t).slice(0, 380) });
          });
        });
      }
      cand.sort(function (a, b) { return b.s - a.s; });
      out = cand.slice(0, 4).map(function (x) { return x.t; });
    } catch (e) {}
    return out.join('\n\n');
  }
  async function genFor(p) {
    if (GEN.running) return;
    var cfg = null;
    try { cfg = (typeof aiCfg === 'function') ? aiCfg() : null; } catch (e) { cfg = null; }
    if (!(cfg && cfg.model && (cfg.base || cfg.preset === 'ollama')) || typeof aiChat !== 'function') {
      GEN.note = '还没配 AI：先去「AI 与知识库」配一个服务';
      paint();
      if (typeof toast === 'function') toast('还没配 AI：先去「AI 与知识库」配一下');
      return;
    }
    GEN.running = true; GEN.text = ''; GEN.parsed = null; GEN.err = null; GEN.point = p.name; GEN.open = true;
    GEN.note = '正在出题…'; GEN.ctl = ('AbortController' in window) ? new AbortController() : null;
    paint();
    var ctx = pointCtx(p);
    var prompt = '【考点】' + p.name + (p.hint ? '（' + p.hint + '）' : '') + '\n'
      + (ctx ? '【参考资料（来自我的知识库）】\n' + ctx + '\n' : '')
      + '【题数】' + GEN_N;
    try {
      var txt = await aiChat([{ role: 'system', content: genSysText() }, { role: 'user', content: prompt }],
        function (full) { GEN.text = full || ''; paint(); }, GEN.ctl ? GEN.ctl.signal : undefined);
      GEN.text = txt || GEN.text;
    } catch (e) {
      var stopped = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      if (!stopped) GEN.note = '出错：' + ((e && e.message) || e);
    } finally {
      GEN.running = false; GEN.ctl = null;
    }
    var parsed = null;
    try {
      var r = (typeof parseInput === 'function') ? parseInput(GEN.text, '考点题') : { error: '解析模块没加载' };
      if (r && !r.error && r.bank && (r.bank.questions || []).length) {
        parsed = r.bank.questions.map(function (q, i) { return (typeof normalizeQ === 'function') ? normalizeQ(q, i + 1) : q; });
      } else GEN.note = (r && r.error) || '没解析出题（模型没按格式写）';
    } catch (e) { GEN.note = (e && e.message) || '解析出错'; }
    GEN.parsed = parsed;
    if (parsed && parsed.length) GEN.note = '出了 ' + parsed.length + ' 道（存成新题库就能直接做）';
    paint();
  }
  function stopGen() {
    if (!GEN.running) return;
    try { if (GEN.ctl) GEN.ctl.abort(); } catch (e) {}
    GEN.running = false; GEN.note = '已停止';
    paint();
  }
  function saveGen() {
    var qs = GEN.parsed || [];
    if (!qs.length) { if (typeof toast === 'function') toast('还没有可存的题'); return; }
    var title = '考点 · ' + String(GEN.point || '新题').slice(0, 12);
    var n = 0;
    if (window.VARIANT && typeof window.VARIANT.saveBankFromQuestions === 'function') {
      n = window.VARIANT.saveBankFromQuestions(title, qs, { subtitle: '自建题库 · 考点覆盖 · ' + qs.length + ' 题', idPrefix: 'local-syl-' });
    }
    if (n === false) return;
    GEN.note = '已存成新题库：' + title + '（首页「全部题库」里能看到，标着「自建」）';
    GEN.parsed = null; GEN.text = '';
    paint();
    if (typeof render === 'function') { try { render(); } catch (e) {} }
  }

  /* ---------- 页面 ---------- */
  function paint() {
    var s = document.getElementById('sylState');
    if (s) s.textContent = PTS.running ? (PTS.total ? '第 ' + PTS.done + '/' + PTS.total + ' 批…' : (PTS.note || '正在准备…')) : (PTS.note || '');
    var stop = document.getElementById('sylStop');
    if (stop) stop.style.display = PTS.running ? '' : 'none';
    var box = document.getElementById('sylGenBox');
    if (box) box.innerHTML = genBoxHtml();
  }
  function genBoxHtml() {
    if (!GEN.open) return '';
    var cards = '';
    if (GEN.parsed && GEN.parsed.length) {
      cards = '<div class="vcard"><div class="vhead2">出了 ' + GEN.parsed.length + ' 道 · <b>' + esc(GEN.point || '') + '</b></div>'
        + GEN.parsed.map(function (q, i) {
          var opts = (q.options || []).map(function (o, j) {
            var L = 'ABCDEFGH'[j], right = (q.answer || []).indexOf(L) >= 0;
            return '<div class="vopt' + (right ? ' r' : '') + '"><b>' + L + '</b> ' + esc(o) + '</div>';
          }).join('');
          return '<div class="vcard-i"><div class="vstem">' + (i + 1) + '. ' + esc(q.stem || '') + '</div>' + opts
            + (q.explain ? '<div class="vexp">' + esc(q.explain) + '</div>' : '') + '</div>';
        }).join('')
        + '<div class="tools"><button class="btn tiny primary" data-sylsave="1">存成新题库（' + GEN.parsed.length + ' 题）</button>'
        + '<button class="btn tiny" data-sylgen="1">再来 3 道</button>'
        + '<button class="btn tiny" data-sylgenclose="1">收起</button></div></div>';
    } else if (GEN.text) {
      cards = '<div class="vcard"><div class="vraw">' + esc(GEN.text) + '</div>'
        + '<div class="tools"><button class="btn tiny" data-sylgen="1">再试一次</button>'
        + '<button class="btn tiny" data-sylgenclose="1">收起</button></div></div>';
    }
    return '<div class="card syl-gen">'
      + '<div class="tools" style="margin-top:0"><b>考点出题</b><span class="mini-tag">' + esc(GEN.point || '') + '</span>'
      + '<span class="spacer-grow"></span>'
      + (GEN.running ? '<button class="btn tiny" data-sylgenstop="1">停止</button>' : '')
      + '<span class="tl">' + esc(GEN.note || '') + '</span></div>'
      + cards + '</div>';
  }
  function statsFor(id) {
    var k = kbAll().filter(function (x) { return String(x.id) === String(id); })[0];
    return k || { id: id, name: id };
  }
  function pageHtml() {
    var list = kbAll();
    if (!list.length) {
      return '<div class="card"><div class="note">还没有知识库。<br>考纲覆盖度自查要用「自己的资料」当考纲：先去 '
        + '<a href="#/kb">AI 与知识库</a> 导入几份资料（PDF / Word / txt 都行），再回来抽考点。</div></div>';
    }
    var sel = VIEW.kbId || list[0].id;
    VIEW.kbId = sel;
    var kb = statsFor(sel);
    var cache = SYL[sel];
    var stale = !!(cache && cache.chars && kb.chars && String(cache.chars) !== String(kb.chars));
    /* 覆盖度：命中缓存就直接画；工作量小就同步算（省得闪一下）；太大就先出页面、分片算 */
    var cov = null, covLazy = false;
    if (cache && (cache.points || []).length) {
      var bs0 = bankSig(), sig0 = covSig(bs0);
      if (CC.sig === sig0 && CC.data) { CC.how = 'cache'; CC.data.how = 'cache'; CC.data.ms = CC.ms; cov = CC.data; }
      else if (points().length * qCount() <= SYNC_COST) cov = coverage();
      else covLazy = true;
    }
    var head = '<div class="card">'
      + '<div class="tools" style="margin-top:0"><b>考纲（用哪个资料库）</b>'
      + '<select class="inp" id="sylKb" style="max-width:280px">' + list.map(function (k) {
        return '<option value="' + esc(k.id) + '"' + (String(k.id) === String(sel) ? ' selected' : '') + '>'
          + esc(k.name || k.id) + '（' + (k.chars ? Math.round(k.chars / 10000) + ' 万字' : (k.chunks || 0) + ' 段') + '）</option>';
      }).join('') + '</select>'
      + '<button class="btn tiny primary" id="sylGen">' + (cache && (cache.points || []).length ? '重新抽考点' : '抽考点清单') + '</button>'
      + '<button class="btn tiny" id="sylStop" style="display:none">停止</button>'
      + '<span class="spacer-grow"></span><span class="tl" id="sylState">' + esc(PTS.note || '') + '</span></div>'
      + '<div class="small muted" style="margin:6px 0 0">抽考点要调 AI（按 12 段一批，几十万字大概十几到几十批），'
      + '**只花这一次钱**，结果存在本机、跟着导出备份走。覆盖判定是纯本地的，随时重算不花钱。</div>'
      + (stale ? '<div class="note" style="margin-top:8px">这个知识库的内容好像变了（字数从 ' + cache.chars + ' 变成 ' + kb.chars
        + '）。清单可能过期，要重算吗？<button class="btn tiny" data-sylgen="0">重算</button></div>' : '')
      + '</div>';
    if (!cache || !(cache.points || []).length) {
      return head + '<div class="card syl-genbox" id="sylGenBox">' + genBoxHtml() + '</div>'
        + '<div class="card"><div class="note">还没有考点清单：点上面的「抽考点清单」，AI 会读完这个库、'
        + '提炼出考点（2–8 字名词 + 一句说明）。抽完你可以手工增删改。</div></div>';
    }
    return head
      + '<h2 class="sec">覆盖度</h2>'
      + (cov ? covCardHtml(cov)
        : '<div class="card" id="sylCov"><div class="note" id="sylCovNote">正在算覆盖度…（考点多、题库大的时候要几秒；'
          + '页面先用着，算完这块自己出来）</div></div>')
      + '<div class="card syl-genbox" id="sylGenBox">' + genBoxHtml() + '</div>'
      + pointsEditHtml()
      + bottomCardHtml();
  }
  /* 覆盖度那一块（同步算完、分片算完、改筛选重画，都走这里） */
  function covCardHtml(c) {
    var filter = VIEW.filter;
    var rows = c.rows.filter(function (r) {
      if (filter === 'blank') return r.status === '空白';
      if (filter === 'weak') return r.status === '薄弱';
      return true;
    });
    var table = rows.length ? rows.map(function (r) {
      var badge = r.status === '空白' ? '<span class="st-badge blank">空白</span>'
        : (r.status === '薄弱' ? '<span class="st-badge weak">薄弱</span>' : '<span class="st-badge ok">已覆盖</span>');
      return '<div class="syl-row"' + (r.status === '空白' ? ' data-blank="1"' : '') + '>'
        + '<div class="syl-name"><b>' + esc(r.name) + '</b>' + (r.hint ? '<span class="small muted"> ' + esc(r.hint) + '</span>' : '') + '</div>'
        + '<div class="syl-num">' + (r.n ? r.n + ' 题' : '—') + (r.tagHit ? '<span class="small muted">（标签 ' + r.tagHit + '）</span>' : '') + '</div>'
        + '<div class="syl-num">' + (r.acc == null ? '—' : r.acc + '%') + (r.done ? '<span class="small muted">/' + r.done + ' 答</span>' : '') + '</div>'
        + '<div class="syl-num">' + (r.wrong ? '<span class="mini-tag bad">错 ' + r.wrong + '</span>' : '—') + '</div>'
        + '<div>' + badge + '</div>'
        + '<div class="syl-act">'
        + '<button class="btn tiny' + (r.status === '空白' ? ' primary' : '') + '" data-sylmk="' + esc(r.name) + '">让 AI 出题</button>'
        + (r.n ? '<button class="btn tiny" data-sylgo="' + esc(r.name) + '">去刷</button>' : '')
        + '<button class="btn tiny" data-syldel="' + esc(r.name) + '" title="从清单里删掉这个考点">删</button>'
        + '</div></div>';
    }).join('') : '<div class="note">这个筛选下没有考点。</div>';
    var speed = c.how === 'cache'
      ? '覆盖度用的是上次的结果（改作答 / 标签 / 清单会自动重算）'
      : '覆盖度算了 ' + (c.ms || 0) + ' ms（之后重进这一页不用再算）';
    return '<div class="card" id="sylCov">'
      + '<div class="tools" style="margin-top:0">'
      + '<span class="mini-tag">共 ' + c.sum.all + ' 个考点</span>'
      + '<span class="mini-tag bad">空白 ' + c.sum.blank + '</span>'
      + '<span class="mini-tag">薄弱 ' + c.sum.weak + '</span>'
      + '<span class="mini-tag ok">已覆盖 ' + c.sum.ok + '</span>'
      + '<span class="spacer-grow"></span>'
      + '<button class="btn tiny' + (filter === 'all' ? ' primary' : '') + '" data-sylf="all">全部</button>'
      + '<button class="btn tiny' + (filter === 'blank' ? ' primary' : '') + '" data-sylf="blank">只看空白</button>'
      + '<button class="btn tiny' + (filter === 'weak' ? ' primary' : '') + '" data-sylf="weak">只看薄弱</button>'
      + '</div>'
      + '<div class="small muted" style="margin:6px 0 8px">口径：先用你打的考点标签命中；没标签的题用「题干 + 选项 + 解析」的 2-gram 相似度（≥ '
      + Math.round(SIM_MIN * 100) + '%）兜底。空白置顶。题库共 ' + c.total + ' 道题。<span id="sylCovMs">' + speed + '</span></div>'
      + '<div class="syl-head"><div>考点</div><div class="syl-num">覆盖题数</div><div class="syl-num">我的正确率</div><div class="syl-num">错次</div><div>状态</div><div class="syl-act">操作</div></div>'
      + table
      + '</div>';
  }
  /* 底部那张卡：手工加一个 / 批量粘贴一串 */
  function bottomCardHtml() {
    return (VIEW.bulk ? bulkBoxHtml() : '')
      + '<div class="card"><div class="tools" style="margin-top:0">'
      + '<button class="btn tiny" data-syladd="1">手工加一个考点</button>'
      + '<button class="btn tiny" data-sylbulk="1">批量导入考点（粘贴一串）</button>'
      + '<span class="spacer-grow"></span><span class="small muted">清单算过就不重复花钱；重算会覆盖手工改动</span></div></div>';
  }
  function bulkBoxHtml() {
    return '<div class="card" id="sylBulkBox">'
      + '<div class="small muted" style="margin:0 0 6px">一行一个考点，两种写法都行：<code>慢阻肺</code> 或 <code>慢阻肺：持续气流受限、FEV1/FVC&lt;70%</code>。'
      + '带序号（<code>1.</code>）、项目符号（<code>-</code>）、引号都会自动去掉；和清单里重名的会跳过。</div>'
      + '<textarea class="inp" id="sylBulkIn" rows="8" style="width:100%;font-family:inherit" '
      + 'placeholder="慢阻肺：持续气流受限&#10;心力衰竭&#10;3. 酸碱平衡：血气分析判断失代偿"></textarea>'
      + '<div class="tools" style="margin-top:8px">'
      + '<button class="btn tiny primary" data-sylbulkok="1">导入这些考点</button>'
      + '<button class="btn tiny" data-sylbulkclose="1">取消</button>'
      + '<span class="spacer-grow"></span><span class="tl" id="sylBulkState"></span></div></div>';
  }
  /* 粘贴解析：一行一个「名字」或「名字：说明」 */
  function parseBulk(text) {
    var out = [], seen = {};
    String(text || '').split(/\r?\n/).forEach(function (ln) {
      ln = String(ln).replace(/^\s*(?:[-*·•—+]+|\d+[.、)）]|\(\d+\)|（\d+）)\s*/, '')
        .replace(/^[\s"“”'‘’]+/, '').replace(/[\s"“”'‘’]+$/, '').trim();
      if (!ln) return;
      var name = ln, hint = '';
      var m = ln.match(/^(.{2,24}?)\s*[:：]\s*(.+)$/) || ln.match(/^(.{2,24}?)\s+[-—–]\s*(.+)$/)
        || ln.match(/^(.{2,24}?)\t+(.+)$/) || ln.match(/^(.{2,24}?)\s{2,}(.+)$/);
      if (m) { name = m[1]; hint = m[2]; }
      name = String(name).replace(/[\s,，、;；]+/g, ' ').trim().slice(0, 24);
      hint = String(hint).replace(/\s+/g, ' ').trim().slice(0, 60);
      if (name.length < 2) return;
      var key = name.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ name: name, hint: hint });
    });
    return out;
  }
  function pointsEditHtml() {
    return '<details class="fold" style="margin-top:10px"><summary>考点清单（' + points().length + ' 个，可以手工增删改）</summary>'
      + '<div class="card"><div class="vocab-box">' + points().map(function (p) {
        return '<button class="vocab-chip on" data-sylpdel="' + esc(p.name) + '" title="点一下删掉这个考点">' + esc(p.name) + '</button>';
      }).join('') + '</div></div></details>';
  }
  function renderSyllabus() {
    var v = document.getElementById('view');
    if (!v) return;
    try { if (typeof $ === 'function') { $('appTitle').textContent = '考纲覆盖自查'; $('stat').textContent = ''; $('bar').style.width = '0%'; } } catch (e) {}
    v.innerHTML = pageHtml();
    /* 事件只绑一次：以前每次重画都再 addEventListener 一遍，点一下会连锁重画好几次（越点越卡） */
    if (!v.getAttribute('data-sylbound')) { bindPage(v); v.setAttribute('data-sylbound', '1'); }
    paint();
    if (!kbAll().length) retryKb(0);
    if (document.getElementById('sylCovNote')) kickCov();
  }
  /* 覆盖度太大了：分片算完再补上那一块（页面已经能用，不卡） */
  function kickCov() {
    if (VIEW.covBusy) return;
    VIEW.covBusy = true;
    coverageChunked(function (data) {
      VIEW.covBusy = false;
      var box = document.getElementById('sylCov');
      var here = false;
      try { here = (typeof route === 'function') && route().name === 'syllabus'; } catch (e) {}
      if (box && here) box.outerHTML = covCardHtml(data);
    }, function (pct) {
      var n = document.getElementById('sylCovNote');
      if (n) n.textContent = '正在算覆盖度… ' + pct + '%（页面先用着，算完这块自己出来）';
    });
  }
  function bindPage(v) {
    if (!v) return;
    v.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'sylKb') { VIEW.kbId = e.target.value; renderSyllabus(); }
    });
    v.addEventListener('click', function (e) {
      if (e.target.closest('#sylGen') || e.target.closest('[data-sylgen="0"]')) { genPoints(); return; }
      if (e.target.closest('#sylStop')) { stopPoints(); return; }
      var f = e.target.closest('[data-sylf]');
      if (f) { VIEW.filter = f.getAttribute('data-sylf'); renderSyllabus(); return; }
      var mk = e.target.closest('[data-sylmk]');
      if (mk) {
        var name = mk.getAttribute('data-sylmk');
        var p = points().filter(function (x) { return x.name === name; })[0] || { name: name };
        GEN.open = true; GEN.parsed = null; GEN.text = ''; GEN.note = '';
        genFor(p);
        return;
      }
      var go2 = e.target.closest('[data-sylgo]');
      if (go2) {
        var t = go2.getAttribute('data-sylgo');
        if (typeof go === 'function') {
          go('#/search');
          setTimeout(function () { if (typeof tagOpenInSearch === 'function') tagOpenInSearch(t); }, 60);
        }
        return;
      }
      if (e.target.closest('[data-sylgen="1"]')) {
        var p2 = points().filter(function (x) { return x.name === GEN.point; })[0] || { name: GEN.point };
        genFor(p2); return;
      }
      if (e.target.closest('[data-sylgenstop]')) { stopGen(); return; }
      if (e.target.closest('[data-sylsave]')) { saveGen(); return; }
      if (e.target.closest('[data-sylgenclose]')) { GEN.open = false; paint(); return; }
      if (e.target.closest('[data-sylbulk]')) {
        VIEW.bulk = true; renderSyllabus();
        setTimeout(function () {
          var ta = document.getElementById('sylBulkIn');
          if (ta) { try { ta.focus(); } catch (e2) {} }
        }, 30);
        return;
      }
      if (e.target.closest('[data-sylbulkclose]')) { VIEW.bulk = false; renderSyllabus(); return; }
      if (e.target.closest('[data-sylbulkok]')) {
        var ta2 = document.getElementById('sylBulkIn');
        var id4 = VIEW.kbId || (kbAll()[0] || {}).id;
        if (!ta2 || !id4) return;
        var picks = parseBulk(ta2.value);
        var st1 = document.getElementById('sylBulkState');
        if (!picks.length) { if (st1) st1.textContent = '没认出考点：每行写一个「名称」或「名称：说明」'; return; }
        var cache4 = SYL[id4] = SYL[id4] || { points: [], ts: Date.now(), chars: 0 };
        var have = {}, added2 = 0, skip = 0;
        (cache4.points || []).forEach(function (x) { have[String(x.name || '').toLowerCase()] = 1; });
        picks.forEach(function (x) {
          var key2 = x.name.toLowerCase();
          if (have[key2]) { skip++; return; }
          have[key2] = 1; cache4.points.push(x); added2++;
        });
        cache4.ts = Date.now();
        VIEW.bulk = false;
        save();
        renderSyllabus();
        if (typeof toast === 'function') toast('导入 ' + added2 + ' 个考点' + (skip ? '（跳过 ' + skip + ' 个重名的）' : ''));
        return;
      }
      if (e.target.closest('[data-syladd]')) {
        var nm = prompt('加一个考点（2–8 字名词）：');
        if (!nm) return;
        var hint = prompt('一句话说明（可留空）：') || '';
        var id = VIEW.kbId || (kbAll()[0] || {}).id;
        if (!id) return;
        var cache = SYL[id] = SYL[id] || { points: [], ts: Date.now(), chars: 0 };
        cache.points.push({ name: String(nm).trim().slice(0, 24), hint: String(hint).trim().slice(0, 60) });
        cache.ts = Date.now();
        save(); renderSyllabus(); return;
      }
      var pd = e.target.closest('[data-sylpdel]');
      if (pd) {
        var id2 = VIEW.kbId || (kbAll()[0] || {}).id;
        var name2 = pd.getAttribute('data-sylpdel');
        if (SYL[id2]) {
          SYL[id2].points = (SYL[id2].points || []).filter(function (x) { return x.name !== name2; });
          SYL[id2].ts = Date.now(); save();
        }
        renderSyllabus(); return;
      }
      var dl = e.target.closest('[data-syldel]');
      if (dl) {
        var id3 = VIEW.kbId || (kbAll()[0] || {}).id;
        var name3 = dl.getAttribute('data-syldel');
        if (!confirm('把「' + name3 + '」从考点清单里删掉？（只是不看了，不影响题库和标签）')) return;
        if (SYL[id3]) {
          SYL[id3].points = (SYL[id3].points || []).filter(function (x) { return x.name !== name3; });
          SYL[id3].ts = Date.now(); save();
        }
        renderSyllabus(); return;
      }
    });
  }

  rd();
  window.renderSyllabus = renderSyllabus;
  window.SYLLABUS = {
    render: renderSyllabus, gen: genPoints, stop: stopPoints, cov: coverage, parse: parsePoints,
    parseBulk: parseBulk,
    data: function () { return SYL; }, reload: function () { rd(); CC.sig = ''; },
    mergeIn: function (obj) {          /* 云同步用：同一个知识库谁的清单新用谁的 */
      if (!obj || typeof obj !== 'object') return 0;
      var n = 0;
      Object.keys(obj).forEach(function (id) {
        var a = SYL[id], b = obj[id];
        if (!b || !b.points) return;
        if (!a || (+b.ts || 0) > (+a.ts || 0)) { SYL[id] = b; n++; }
      });
      if (n) { save(); CC.sig = ''; }
      return n;
    },
    pick: function (id) { VIEW.kbId = id; }, view: VIEW
  };
})();
