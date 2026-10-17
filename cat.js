/* ============================================================
   刷题站 · 题库目录（大目录 / 子目录）cat.js
   ————————————————————————————————————————————————
   解决的问题：原来首页只有一个平铺的题库列表，题一多就没法看；
   而且自建题库只存在浏览器里（localStorage），换地址、清缓存就没了。

   这里做的事：
     1) 分类树：分类可以无限层级嵌套（大目录 → 子目录 → …），
        分类可以新建 / 改名 / 移动 / 删除，题库可以放进分类、在分类间移动；
     2) 目录导航：首页变成「文件夹 + 题库」的目录视图，带面包屑、
        搜索框（只搜当前目录）、返回上一级；
     3) 题库文件：把「自建题库 + 分类」存成本机文件（见 bf.js），
        下次打开一键读回来，不再受浏览器存储限制。

   存储：
     qbank.cats.v1   分类树 [{ id, title, parent, order }]（parent 为 null 即顶层）
     题库对象上的 b.cat 字段 = 所属分类 id（null / 不存在 = 根目录）
   兼容：没有 CAT 数据时不会自动改任何东西；导入 / 导出会带上分类。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 常量与状态 ---------- */
  var CAT_KEY = 'qbank.cats.v1';
  var CUR_KEY = 'qbank.curcat.v1';       // 上次停留的目录，刷新后回到原处
  var CONFIRM_KEY = 'qbank.catconfirm.v1'; // 「移动题库会改哪些东西」是否已提示过

  var CAT = null;                        // [{ id, title, parent, order }]
  var CUR = null;                        // 当前目录 id（null = 根）
  var CUR_SET = false;                   // 本次打开页面是否已确定过目录（避免被存档顶回去）
  var QUERY = '';                        // 当前目录内的搜索词
  var DRAG = null;                       // { type:'cat'|'bank', id, banks:[], cats:[], batch } —— 批量模式下带的是一批
  var LOCK = false;                      // 正在写数据，避免重复触发
  var BATCH = null;                      // 批量管理：null = 关闭；开启时 { sel: { 题库id: 1 } }

  /* ---------- 小工具（都在 app.js 里，但这里做一次安全取值） ---------- */
  function T(msg, ms) {
    if (typeof toast === 'function') { try { toast(msg, ms); return; } catch (e) {} }
    if (window.console) console.log('[刷题站]', msg);
  }
  function E(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function TITLE(c) { return (c && c.title) ? String(c.title) : '未命名分类'; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid(prefix) {
    var s = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
    var id = (prefix || 'cat') + '-' + s;
    var n = 0;
    while (CAT && CAT.some(function (c) { return c.id === id; })) { id = (prefix || 'cat') + '-' + s + '-' + (++n); }
    return id;
  }
  function bankList() { return (typeof baseBanks === 'function') ? baseBanks() : []; }
  function bankOf(id) { return (typeof bankById === 'function') ? bankById(id) : null; }
  function catsAll() { ensure(); return CAT; }
  function notifyFile() { try { if (window.BF && BF.autoSync) BF.autoSync(); } catch (e) {} }

  /* ---------- 读取 / 整理 / 保存 ---------- */
  function readRaw() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(CAT_KEY)); } catch (e) { v = null; }
    if (!Array.isArray(v)) return [];
    return v.filter(function (c) { return c && typeof c === 'object'; }).map(function (c, i) {
      return {
        id: String(c.id || ('cat-' + (i + 1))),
        title: String(c.title == null ? '未命名分类' : c.title),
        parent: (c.parent == null || c.parent === '' || c.parent === 'root') ? null : String(c.parent),
        order: (c.order == null ? i : +c.order || 0)
      };
    });
  }

  /* 整理：去重 id、父节点必须存在、断开环形引用（父指向自己的后代） */
  function normalize() {
    var seen = {}, i, c, changed = false;
    for (i = 0; i < CAT.length; i++) {
      c = CAT[i];
      if (seen[c.id]) { c.id = uid(); changed = true; }
      seen[c.id] = 1;
    }
    var byId = {};
    CAT.forEach(function (x) { byId[x.id] = x; });
    CAT.forEach(function (x) {
      if (x.parent && !byId[x.parent]) { x.parent = null; changed = true; }
      if (x.parent === x.id) { x.parent = null; changed = true; }
    });
    /* 从每个节点往上走，走超过 CAT.length 步说明成环，断在最上面那个节点 */
    CAT.forEach(function (x) {
      var p = x.parent, steps = 0;
      while (p && steps++ <= CAT.length) {
        if (p === x.id) { x.parent = null; changed = true; break; }
        p = byId[p] ? byId[p].parent : null;
      }
    });
    /* 没有父节点的兄弟顺序重排成 0,1,2…（留着大间隔也不影响） */
    return changed;
  }

  function compact() {
    var groups = {};
    CAT.forEach(function (c) { var k = c.parent || '__root__'; (groups[k] = groups[k] || []).push(c); });
    Object.keys(groups).forEach(function (k) {
      groups[k].sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.title).localeCompare(String(b.title), 'zh'); });
      groups[k].forEach(function (c, i) { c.order = i; });
    });
  }

  function ensure() {
    if (CAT) return CAT;
    CAT = readRaw();
    normalize();
    compact();
    return CAT;
  }

  function saveCats(opts) {
    opts = opts || {};
    if (LOCK && !opts.force) return;
    LOCK = true;
    try {
      normalize(); compact();
      try { localStorage.setItem(CAT_KEY, JSON.stringify(CAT)); } catch (e) { T('分类没存下（浏览器存储满了）'); }
      writeBanksIfNeeded();
      if (typeof invalidateBanks === 'function') { /* 分类不参与题库缓存，这里不用清 */ }
      notifyFile();
    } finally { LOCK = false; }
    if (!opts.quiet) repaint();
  }

  function writeBanksIfNeeded() {
    try { if (typeof LOCAL !== 'undefined' && typeof writeLS === 'function') writeLS('qbank.local.v2', LOCAL); } catch (e) {}
  }

  /* ---------- 树查询 ---------- */
  function byId(id) { ensure(); return CAT.find(function (c) { return c.id === id; }) || null; }
  function kids(pid) {
    ensure();
    var p = pid == null ? null : pid;
    return CAT.filter(function (c) { return (c.parent || null) === p; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.title).localeCompare(String(b.title), 'zh'); });
  }
  function pathOf(id) {
    ensure();
    var out = [], seen = {}, cur = id, steps = 0;
    while (cur && steps++ < 200) {
      var c = byId(cur);
      if (!c || seen[c.id]) break;
      seen[c.id] = 1;
      out.unshift(c);
      cur = c.parent || null;
    }
    return out;
  }
  function descIds(id) {
    ensure();
    if (!id) return CAT.map(function (c) { return c.id; });
    var out = [], stack = [id];
    while (stack.length) {
      var cur = stack.pop();
      kids(cur).forEach(function (k) { out.push(k.id); stack.push(k.id); });
    }
    return out;
  }
  /* bank 是否在目录 id 下（id 为 null = 根目录：只算直接放在根目录的） */
  function inDir(b, id) { return (b.cat || null) === (id || null); }
  function dirBanks(id) { return bankList().filter(function (b) { return inDir(b, id); }); }

  /* 搜索：词里含分隔符就按「目录/子目录/题库名」逐段匹配 */
  function matchSegs(str, segs) {
    var s = String(str).toLowerCase(), i = 0;
    for (var k = 0; k < segs.length; k++) {
      var p = s.indexOf(segs[k], i);
      if (p < 0) return false;
      i = p + segs[k].length;
    }
    return true;
  }
  function catMatches(c, segs, deep) {
    if (matchSegs(TITLE(c), segs)) return true;
    if (!deep) return false;
    function any(list) {
      for (var i = 0; i < list.length; i++) {
        if (matchSegs(TITLE(list[i]), segs)) return true;
        if (any(kids(list[i].id))) return true;
      }
      return false;
    }
    return any(kids(c.id));
  }
  function searchAll(segs) {
    ensure();
    var out = { cats: [], banks: [] };
    CAT.forEach(function (c) { if (catMatches(c, segs, false)) out.cats.push(c); });
    bankList().forEach(function (b) {
      var node = b.cat ? byId(b.cat) : null;
      var crumb = pathOf(node ? node.id : null).map(TITLE).join(' ');
      if (matchSegs(b.title, segs) || matchSegs(crumb + ' ' + b.title, segs)) out.banks.push(b);
    });
    out.cats.sort(function (a, b) { return TITLE(a).localeCompare(TITLE(b), 'zh'); });
    out.banks.sort(function (a, b) { return String(a.title).localeCompare(String(b.title), 'zh'); });
    return out;
  }

  /* ---------- 目录里的题库统计（含子目录汇总） ---------- */
  function bankStat(b) {
    var n = b.questions.length, done = 0, ok = 0, wr = 0;
    b.questions.forEach(function (q) {
      var k = kOf(b, q), a = ANS[k];
      if (a && !a.redo) { done++; if (a.ok) ok++; }
      if (a && (a.wrong || 0) > 0) wr++;
    });
    return { n: n, done: done, ok: ok, wr: wr, pct: n ? done / n * 100 : 0, acc: done ? Math.round(ok / done * 100) : 0 };
  }
  function subStat(cid) {
    var acc = { banks: 0, q: 0, done: 0, ok: 0, wr: 0, cats: 0 };
    function walk(id) {
      kids(id).forEach(function (k) {
        acc.cats++;
        dirBanks(k.id).forEach(function (b) {
          var s = bankStat(b);
          acc.banks++; acc.q += s.n; acc.done += s.done; acc.ok += s.ok; acc.wr += s.wr;
        });
        walk(k.id);
      });
    }
    walk(cid);
    /* 直属题库也一起算进来，卡片上显示的是「这个目录里的全部题」 */
    dirBanks(cid).forEach(function (b) {
      var s = bankStat(b);
      acc.banks++; acc.q += s.n; acc.done += s.done; acc.ok += s.ok; acc.wr += s.wr;
    });
    return acc;
  }

  /* ---------- 改数据 ---------- */
  function createCat(parent, title, order) {
    ensure();
    var id = uid('cat');
    CAT.push({ id: id, title: (title || '新分类').trim() || '新分类', parent: parent || null, order: (order == null ? 1e6 : order) });
    return id;
  }
  function renameCat(id, title) {
    var c = byId(id); if (!c) return;
    c.title = String(title || '').trim() || c.title;
  }
  /* 从题库文件 / 全部数据备份里带入分类：同 id 就地更新，新 id 追加。
     不能简单地「已存在就跳过」——那样同一个分类会在树里出现两次。 */
  function importCats(rows) {
    ensure();
    var seen = {}, added = 0, upd = 0;
    CAT.forEach(function (c) { seen[c.id] = 1; });
    (rows || []).forEach(function (c) {
      if (!c || !c.id) return;
      c = { id: String(c.id), title: String(c.title || '未命名分类'), parent: (c.parent == null ? null : String(c.parent)), order: (c.order == null ? 999 : (+c.order || 0)) };
      if (!seen[c.id]) { CAT.push(c); seen[c.id] = 1; added++; return; }
      var t = CAT.filter(function (x) { return x.id === c.id; })[0];
      if (t) { t.title = c.title; t.parent = c.parent; t.order = c.order; upd++; }
    });
    /* 父目录不存在（文件里少带了）就挂到顶层，别让分类变成看不见的孤儿 */
    CAT.forEach(function (c) { if (c.parent && !CAT.some(function (x) { return x.id === c.parent; })) c.parent = null; });
    if (added || upd) { saveCats(); }
    return { added: added, updated: upd };
  }
  function isDesc(rootId, id) { return rootId === id || descIds(rootId).indexOf(id) >= 0; }
  function moveCat(id, newParent, beforeId) {
    var c = byId(id); if (!c) return false;
    if (newParent && !byId(newParent)) return false;
    if (isDesc(id, newParent)) return false;      // 不能把目录塞进自己的子目录
    c.parent = newParent || null;
    placeNear(c, beforeId);
    return true;
  }
  /* 把 node 排到 beforeId 前面（beforeId 为空 = 排到最后） */
  function placeNear(node, beforeId) {
    var sibs = kids(node.parent).filter(function (x) { return x.id !== node.id; });
    if (!beforeId) {
      var last = sibs[sibs.length - 1];
      node.order = last ? (last.order || 0) + 1 : 0;
      return;
    }
    var idx = sibs.findIndex(function (x) { return x.id === beforeId; });
    if (idx < 0) { node.order = (sibs.length ? (sibs[sibs.length - 1].order || 0) + 1 : 0); return; }
    var after = sibs[idx], prev = idx > 0 ? sibs[idx - 1] : null;
    if (!prev) node.order = (after.order || 0) - 1;
    else node.order = ((prev.order || 0) + (after.order || 0)) / 2;
  }
  /* 原始对象 vs 规范化副本：allBanks()/bankById() 返回的是 normalizeBank() 造的
     新对象（缓存 _bankCache 里），改它不会写回 localStorage。
     分类和排序必须改 LOCAL 里的那一份，否则刷新就「重置」了。 */
  function toLocal(id) {
    if (typeof LOCAL === 'undefined' || !Array.isArray(LOCAL)) return null;
    return LOCAL.filter(function (x) { return x.id === id; })[0] || null;
  }
  /* 内置题库的原始对象在 window.__BANKS__ 里，改副本同样不会生效 */
  function toRaw(id) {
    var raw = toLocal(id);
    if (raw) return raw;
    try {
      var BI = window.__BANKS__;
      if (Array.isArray(BI)) return BI.filter(function (x) { return x && x.id === id; })[0] || null;
    } catch (e) {}
    return null;
  }
  function syncBankToLocal(id) {
    var raw = toLocal(id);
    if (!raw) return false;
    var b = bankOf(id);
    if (b) {
      raw.cat = b.cat == null ? null : b.cat;
      if (b.ord == null) delete raw.ord; else raw.ord = b.ord;
    }
    try { if (typeof writeLS === 'function') writeLS('qbank.local.v2', LOCAL); } catch (e) {}
    notifyFile();
    return true;
  }
  function moveBank(id, dir, beforeId) {
    var b = bankOf(id); if (!b || b.paper) return false;
    b.cat = dir || null;
    var sibs = dirBanks(dir).filter(function (x) { return x.id !== id; });
    if (!beforeId) {
      var last = sibs[sibs.length - 1];
      b.ord = last ? (+last.ord || 0) + 1 : 0;
    } else {
      var idx = sibs.findIndex(function (x) { return x.id === beforeId; });
      var after = idx >= 0 ? sibs[idx] : null;
      b.ord = after ? ((idx > 0 ? (+sibs[idx - 1].ord || 0) : (after.ord || 0) - 1) + (after.ord || 0)) / 2 : (sibs.length ? (+sibs[sibs.length - 1].ord || 0) + 1 : 0);
    }
    syncBankToLocal(id);          // 立刻写回原始题库对象，刷新后位置还在
    var raw = toRaw(id);          // 内置题库不在 LOCAL 里，得改 __BANKS__ 里的那一份
    if (raw) {
      raw.cat = b.cat == null ? null : b.cat;
      if (b.ord == null) delete raw.ord; else raw.ord = b.ord;
    }
    return true;
  }

  /* ---------- 批量管理：一次处理多个题库（移动 / 删除 / 导出） ----------
     打开后首页的题库卡片变成可多选，底部出现一条固定的操作条；
     目录卡片照常点进去，多一个「选中本目录题库」的按钮，可以整目录勾选。 */
  function batOn() { return !!BATCH; }
  function batSel(id) { return !!(BATCH && BATCH.sel[id]); }
  function batCount() { return BATCH ? Object.keys(BATCH.sel).length : 0; }
  function batBanks() {
    if (!BATCH) return [];
    return Object.keys(BATCH.sel).map(function (id) { return bankOf(id); })
      .filter(function (b) { return b && !b.paper; });
  }
  function batToggle(id) {
    if (!BATCH || !id) return;
    if (BATCH.sel[id]) delete BATCH.sel[id]; else BATCH.sel[id] = 1;
  }
  /* 7.5 目录也进批量：框选 / 全选 / 反选都能选到目录。
     批量模式下【单击目录 = 选中，双击 = 进去】（跟资源管理器一个规矩）——
     这样既能有单个目录的选中入口，又不会把「进目录接着选」这条路由堵死。 */
  function batSelC(id) { return !!(BATCH && BATCH.cat && BATCH.cat[id]); }
  function batToggleC(id) {
    if (!BATCH || !id) return;
    if (!BATCH.cat) BATCH.cat = {};
    if (BATCH.cat[id]) delete BATCH.cat[id]; else BATCH.cat[id] = 1;
  }
  function batCatCount() { return (BATCH && BATCH.cat) ? Object.keys(BATCH.cat).length : 0; }
  function batCatList() {
    if (!BATCH || !BATCH.cat) return [];
    return Object.keys(BATCH.cat).map(function (id) { return byId(id); }).filter(function (c) { return !!c; });
  }
  function visibleCats() {
    if (QUERY.trim()) {
      var segs = QUERY.toLowerCase().split(/[\/\s>›→]+/).filter(function (s) { return s; });
      var r = searchAll(segs.length ? segs : [QUERY.toLowerCase()]);
      return r.cats || [];
    }
    return kids(CUR);
  }
  function batStat() {
    var bs = batBanks(), q = 0, builtin = 0, local = 0;
    bs.forEach(function (b) { q += b.questions.length; if (b.source === 'local') local++; else builtin++; });
    return { n: bs.length, q: q, local: local, builtin: builtin };
  }
  /* 当前页面上「看得见」的题库：搜索时是搜索结果，否则是当前目录里的 */
  function visibleBanks() {
    if (QUERY.trim()) {
      var segs = QUERY.toLowerCase().split(/[\/\s>›→]+/).filter(function (s) { return s; });
      var r = searchAll(segs.length ? segs : [QUERY.toLowerCase()]);
      return r.banks.filter(function (b) { return !b.paper; });
    }
    return dirBanks(CUR).filter(function (b) { return !b.paper; });
  }
  function batchBarHtml() {
    if (!BATCH) return '';
    var s = batStat(), vis = visibleBanks().length;
    return '<div class="nb-bspace"></div>'
      + '<div class="nb-bbatch" id="nbBatchBar">'
      + '<div class="bb-txt">已选 <b>' + s.n + '</b> 个题库' + (batCatCount() ? ' · <b>' + batCatCount() + '</b> 个目录' : '') + ' · 共 ' + s.q + ' 题'
      + '<span class="small muted">单击题库 / 目录选中，双击目录进去接着选，空白处可拉框框选；'
      + (s.builtin ? '内置题库 ' + s.builtin + ' 个不能删除' : '现在选中的都能删、能移') + '</span></div>'
      + '<div class="bb-btns">'
      + '<button class="btn small" data-act="bAll">全选本页（' + vis + '）</button>'
      + '<button class="btn small" data-act="bInv">反选</button>'
      + '<button class="btn small" data-act="bMove">移动到…</button>'
      + '<button class="btn small danger" data-act="bDel">删除</button>'
      + '<button class="btn small" data-act="bExport">导出</button>'
      + '<button class="btn small primary" data-act="batchExit">退出批量</button>'
      + '</div></div>';
  }

  /* ---------- 面包屑 / 返回上一级 ---------- */
  function crumbHtml() {
    var p = pathOf(CUR);
    var parts = ['<a class="nb-crumb" data-crumb="" href="#/">🏠 全部题库</a>'];
    p.forEach(function (c, i) {
      var last = i === p.length - 1;
      parts.push('<span class="nb-sep">›</span>');
      parts.push('<a class="nb-crumb' + (last ? ' on' : '') + '" data-crumb="' + E(c.id) + '" href="#/">' + E(TITLE(c)) + '</a>');
    });
    return parts.join('');
  }

  /* ---------- 渲染 ---------- */
  var ICON_FOLDER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>';
  var ICON_BANK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6z" opacity=".35"/><path d="M14 2v6h6"/></svg>';

  function catCardHtml(c, inSearch) {
    var s = subStat(c.id);
    var sub = kids(c.id);
    var crumb = inSearch ? pathOf(c.id).slice(0, -1).map(TITLE).join(' › ') : '';
    return '<div class="nb-card nb-dir" data-cat="' + E(c.id) + '" draggable="true" title="双击或点名称进入：' + E(TITLE(c)) + '">'
      + '<span class="nb-ic">' + ICON_FOLDER + '</span>'
      + '<div class="nb-info">'
      + '<div class="nb-name">' + E(TITLE(c))
      + (sub.length ? '<span class="pill">' + sub.length + ' 个子目录</span>' : '')
      + '</div>'
      + '<div class="nb-meta">'
      + (crumb ? '在 ' + E(crumb) + '　·　' : '')
      + s.banks + ' 个题库　' + s.q + ' 题　已答 ' + s.done
      + (s.wr ? '　<span class="warn">错题 ' + s.wr + '</span>' : '')
      + (s.done ? '　正确率 ' + Math.round(s.ok / s.done * 100) + '%' : '')
      + '</div>'
      + '<div class="prog"><i style="width:' + (s.q ? (s.done / s.q * 100).toFixed(1) : 0) + '%"></i></div>'
      + '</div>'
      + '<div class="nb-acts">'
      + '<button class="btn tiny" data-act="open" data-id="' + E(c.id) + '">打开</button>'
      + (batOn() ? '<button class="btn tiny" data-act="batchDir" data-id="' + E(c.id) + '">选中本目录题库</button>' : '')
      + '<button class="btn tiny" data-act="menu" data-id="' + E(c.id) + '">⋯</button>'
      + '</div></div>';
  }

  function bankCardHtml(b, inSearch) {
    var s = bankStat(b);
    var crumb = inSearch ? pathOf(b.cat || null).map(TITLE).join(' › ') : '';
    var pick = batOn(), on = pick && batSel(b.id);
    return '<div class="nb-card nb-bank' + (on ? ' nb-on' : '') + '" data-bank="' + E(b.id) + '" draggable="true">'
      + (pick ? '<span class="nb-box' + (on ? ' on' : '') + '" aria-hidden="true"></span>' : '')
      + '<span class="nb-ic">' + ICON_BANK + '</span>'
      + '<div class="nb-info">'
      + '<div class="nb-name">' + E(b.title)
      + (b.source === 'local' ? '<span class="pill local">自建</span>' : '<span class="pill">内置</span>')
      + '</div>'
      + '<div class="nb-meta">'
      + (crumb ? '在 ' + E(crumb) + '　·　' : '')
      + (b.subtitle ? E(b.subtitle) + '　' : '')
      + b.questions.length + ' 题　已答 ' + s.done
      + (s.wr ? '　<span class="warn">错题 ' + s.wr + '</span>' : '')
      + '　正确率 ' + s.acc + '%'
      + '</div>'
      + '<div class="prog"><i style="width:' + s.pct.toFixed(1) + '%"></i></div>'
      + '</div>'
      + '<div class="nb-acts">'
      + (pick
        ? '<span class="small muted">' + (on ? '✔ 已选中，再点一下取消' : '点这张卡片选中它') + '</span>'
        : ('<button class="btn tiny primary" data-act="start" data-id="' + E(b.id) + '">' + (s.done ? '继续' : '开始') + '</button>'
          + '<button class="btn tiny" data-act="wrong" data-id="' + E(b.id) + '">错题 ' + s.wr + '</button>'
          + '<button class="btn tiny" data-act="rand" data-id="' + E(b.id) + '">随机 30</button>'
          + '<button class="btn tiny" data-act="move" data-id="' + E(b.id) + '">移动</button>'
          + '<button class="btn tiny" data-act="more" data-id="' + E(b.id) + '">⋯</button>'))
      + '</div></div>';
  }

  function toolbarHtml() {
    return '<div class="nb-bar">'
      + '<input id="nbSearch" class="nb-search" type="search" placeholder="搜索目录 / 题库名（也可以用「目录名 题库名」）" value="' + E(QUERY) + '">'
      + '</div>';
  }

  function emptyHint() {
    return '<div class="card"><div class="empty">'
      + '这个目录还是空的。<br>点「＋ 新建分类」建一个大目录 / 子目录，'
      + '或点「＋ 新建 / 导入题库」把题目放进来。<br>'
      + '<span class="small muted">也可以把题库 JSON 文件直接拖到网页上导入。</span>'
      + '</div></div>';
  }

  function homeHtml() {
    ensure();
    var bk = typeof baseBanks === 'function' ? baseBanks() : [];
    var papers = (typeof allBanks === 'function' ? allBanks() : bk).filter(function (b) { return b.paper; });
    var totalQ = 0, totalDone = 0, totalOk = 0, wrongN = 0, dueN = 0;
    bk.forEach(function (b) { b.questions.forEach(function (q) {
      totalQ++;
      var k = kOf(b, q), a = ANS[k];
      if (a && !a.redo) { totalDone++; if (a.ok) totalOk++; }
      if (a && (a.wrong || 0) > 0) wrongN++;
      if (typeof isDue === 'function' && isDue(k)) dueN++;
    }); });
    var favN = Object.keys(FAV).filter(function (k) { return FAV[k]; }).length;
    var TODAY = typeof todayStats === 'function' ? todayStats() : { dNum: 0, dOk: 0, streak: 0, weekN: 0 };
    var srsCap = (typeof srsCfg === 'function') ? (+srsCfg().daily || 0) : 0;

    var last = typeof lastPos === 'function' ? lastPos() : null;
    var resumeHtml = '';
    if (last) {
      var lp = pathOf(last.bank.cat || null).map(TITLE).join(' › ');
      resumeHtml = '<div class="resume">'
        + '<div class="rinfo">'
        + '<div class="rtitle">' + E(last.bank.title) + (lp ? ' <span class="small muted">' + E(lp) + '</span>' : '') + '</div>'
        + '<div class="rmeta">上次做到 第 ' + (last.idx + 1) + ' / ' + last.n + ' 题 · 已答 ' + last.done
        + ' · 正确率 ' + (last.done ? Math.round(last.ok / last.done * 100) : 0) + '%'
        + (last.ts ? ' · ' + fmtTime(last.ts) : '') + '</div>'
        + '<div class="prog"><i style="width:' + (last.n ? Math.round(last.done / last.n * 100) : 0) + '%"></i></div>'
        + '</div><button class="btn primary" id="toResume" data-act="resume">继续刷题</button></div>';
    }

    /* §8 视觉 v2 铺开：首页 Bento（继续刷题大卡 + 今日复习圆环 + 今天 + 热力图 + 快捷入口）。
       数字全来自已有数据（ANS / FAV / todayStats / heatStats），不新增存储；动作全用现有 data-act。 */
    var bentoHtml = '';
    (function () {
      var hmWeeks = Math.max(12, Math.min(53, Math.floor((document.documentElement.clientWidth - 80) / 17)));   /* 桌面铺满一整年（53 周），窄屏按宽度少一些 */
      var hm = (typeof heatStats === 'function') ? heatStats(hmWeeks) : { cells: [], total: 0, weeks: hmWeeks };
      var hmLabel = hmWeeks >= 50 ? '近一年' : (hmWeeks >= 24 ? '近半年' : '近 ' + hmWeeks + ' 周');
      var cap = (srsCap && dueN > srsCap) ? srsCap : dueN;
      var p = (TODAY.dNum + dueN) ? Math.round(TODAY.dNum / (TODAY.dNum + dueN) * 100) : 0;
      var dOf = function (ts) { var d = new Date(ts); return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日'; };
      var cells = hm.cells.map(function (c) {
        return '<i class="hm-c" data-l="' + c.l + '" title="' + dOf(c.ts) + ' · ' + c.n + ' 题"></i>';
      }).join('');
      var res = resumeHtml || ('<div class="resume"><div class="rinfo"><div class="rtitle">还没有题库</div>'
        + '<div class="rmeta">建一个自建题库，或者从文件 / 文件夹导入现有的</div></div>'
        + '<button class="btn primary" data-act="newbank">＋ 新建 / 导入题库</button></div>');
      bentoHtml = '<div class="vbento">'
        + '<div class="vb-card span2 vb-resume">' + res + '</div>'
        + '<div class="vb-card vb-ring">'
        + '<div class="ring-wrap">'
        + '<svg class="ring" viewBox="0 0 44 44" aria-hidden="true">'
        + '<circle class="rg-bg" cx="22" cy="22" r="18"></circle>'
        + '<circle class="rg-fg" cx="22" cy="22" r="18" style="--p:' + p + '"></circle>'
        + '</svg>'
        + '<div class="vb-ring-n"><b>' + dueN + '</b><span>待复习</span></div>'
        + '</div>'
        + '<button class="btn small' + (dueN ? ' primary' : '') + '" data-act="review"' + (dueN ? ' data-n="' + cap + '"' : ' data-n="0"') + '>开始复习</button>'
        + '</div>'
        + '<div class="vb-card vb-today">'
        + '<div class="vb-cap">今天</div>'
        + '<div class="vb-big"><b>' + TODAY.dNum + '</b><span>已答</span></div>'
        + '<div class="vb-line">正确率 <b>' + (TODAY.dNum ? Math.round(TODAY.dOk / TODAY.dNum * 100) : 0) + '%</b></div>'
        + '<div class="vb-line">近 7 天 <b>' + TODAY.weekN + '</b> 题</div>'
        + '</div>'
        + '<div class="vb-card span2 vb-heat">'
        + '<div class="vb-cap">' + hmLabel + '<span class="vb-cap-n">共 ' + hm.total + ' 题</span></div>'
        + '<div class="hm">' + (cells || '<i class="hm-c" data-l="0"></i>') + '</div>'
        + '<div class="hm-legend"><span class="small muted">少</span>'
        + '<i class="hm-c" data-l="0"></i><i class="hm-c" data-l="1"></i><i class="hm-c" data-l="2"></i>'
        + '<i class="hm-c" data-l="3"></i><i class="hm-c" data-l="4"></i>'
        + '<span class="small muted">多</span></div>'
        + '</div>'
        + '<div class="vb-card span2 vb-quick">'
        + '<button class="vb-q" data-act="go" data-hash="#/search"><span class="vb-q-i">⌕</span>搜索全部</button>'
        + '<button class="vb-q" data-act="go" data-hash="#/stats"><span class="vb-q-i">▤</span>学习统计</button>'
        + '<button class="vb-q" data-act="go" data-hash="#/wrong"><span class="vb-q-i">✗</span>错题本</button>'
        + '<button class="vb-q" data-act="go" data-hash="#/fav"><span class="vb-q-i">★</span>收藏</button>'
        + '</div>'
        + '</div>';
    })();

    var paperList = papers.map(function (b) {
      var done = 0, ok = 0;
      b.questions.forEach(function (q) { var a = ANS[kOf(b, q)]; if (a && !a.redo) { done++; if (a.ok) ok++; } });
      return '<div class="card bank paper-card"><div class="info">'
        + '<div class="name">' + E(b.title) + '<span class="pill paper">' + (b.exam ? '模拟考试' : '临时套卷') + '</span></div>'
        + '<div class="meta">' + b.questions.length + ' 题　已做 ' + done + '　正确率 ' + (done ? Math.round(ok / done * 100) : 0) + '%</div>'
        + '<div class="prog"><i style="width:' + (b.questions.length ? done / b.questions.length * 100 : 0) + '%"></i></div>'
        + '</div><div class="acts">'
        + '<button class="btn primary" data-act="start" data-id="' + E(b.id) + '">' + (done ? '继续' : '开始') + (b.exam ? '考试' : '做题') + '</button>'
        + '<button class="btn danger" data-act="delpaper" data-id="' + E(b.id) + '">删除' + (b.exam ? '试卷' : '套卷') + '</button>'
        + '</div></div>';
    }).join('');

    var body;
    if (QUERY.trim()) {
      var segs = QUERY.toLowerCase().split(/[\/\s>›→]+/).filter(function (s) { return s; });
      var r = searchAll(segs.length ? segs : [QUERY.toLowerCase()]);
      var sic = r.cats.map(function (c) { return catIconHtml(c); }).join('')
        + r.banks.map(function (b) { return bankIconHtml(b); }).join('');
      var scr = r.cats.map(function (c) { return catRowHtml(c, true); }).join('');
      var sbr = r.banks.map(function (b) { return bankRowHtml(b, true); }).join('');
      var sdet = detailsHtml(r.cats, r.banks, true);
      body = sechead('搜索「' + E(QUERY) + '」的结果')
        + ((sic || sdet) ? viewWrap(sic, scr + sbr, sdet) : '<div class="card"><div class="empty">没找到。可以试试目录名、题库名的一部分，或者用「目录名/题库名」的写法。</div></div>');
    } else {
      var dirs = kids(CUR), bs = dirBanks(CUR);
      var curTitle = CUR ? TITLE(byId(CUR)) : '全部题库';
      var bsorted = bs.slice().sort(sortBank);
      var icons = dirs.map(function (c) { return catIconHtml(c); }).join('')
        + bsorted.map(function (b) { return bankIconHtml(b); }).join('');
      var rows = dirs.map(function (c) { return catRowHtml(c, false); }).join('')
        + bsorted.map(function (b) { return bankRowHtml(b, false); }).join('');
      var det = detailsHtml(dirs, bsorted, false);
      var agg = CUR ? subStat(CUR) : null;
      body = sechead(E(curTitle))
        + (agg ? '<div class="small muted" style="margin:-4px 0 10px">本目录共 ' + agg.cats + ' 个子目录 · ' + agg.banks + ' 个题库 · ' + agg.q + ' 题 · 已答 ' + agg.done + '</div>' : '')
        + ((icons || det) ? viewWrap(icons, rows, det) : emptyHint());
    }

    return ''
      + '<div class="hero">'
      + '<h1>刷题站</h1>'
      + '<p>选择题即时判分，选错立刻出解析。题库可以按「大目录 / 子目录」分类摆放，拖一下就能移动；自建题库能存成本机文件，换电脑、清缓存都不怕。</p>'
      + '<div class="hstat">'
      + '<button class="hs" data-act="expandAll" title="展开 / 收起目录树"><b>' + bk.length + '</b>个题库</button>'
      + '<button class="hs" data-act="go" data-hash="#/stats" title="学习统计"><b>' + totalQ + '</b>道题</button>'
      + '<button class="hs" data-act="go" data-hash="#/stats" title="学习统计"><b>' + totalDone + '</b>已答</button>'
      + '<button class="hs" data-act="go" data-hash="#/stats" title="学习统计"><b>' + (totalDone ? Math.round(totalOk / totalDone * 100) : 0) + '%</b>正确率</button>'
      + '<button class="hs" data-act="go" data-hash="#/wrong" title="打开错题本"><b>' + wrongN + '</b>错题</button>'
      + '<button class="hs" data-act="go" data-hash="#/fav" title="打开收藏"><b>' + favN + '</b>收藏</button>'
      + '<button class="hs' + (dueN ? '' : ' off') + '" data-act="review"' + (dueN ? '' : ' data-n="0"') + ' title="' + (dueN ? '开始今日复习' : '今天没有该复习的题') + '"><b>' + dueN + '</b>待复习</button>'
      + '</div>'
      + '<div class="hstat today">'
      + '<button class="hs" data-act="go" data-hash="#/stats" title="学习统计 · 今天的量"><b>' + TODAY.dNum + '</b>今日已答</button>'
      + '<button class="hs" data-act="go" data-hash="#/stats" title="学习统计 · 今天的正确率"><b>' + (TODAY.dNum ? Math.round(TODAY.dOk / TODAY.dNum * 100) : 0) + '%</b>今日正确率</button>'
      + '<button class="hs" data-act="go" data-hash="#/stats" title="学习统计 · 连续刷题天数"><b>' + TODAY.streak + '</b>连续天数</button>'
      + '<button class="hs" data-act="go" data-hash="#/stats" title="学习统计 · 最近 7 天"><b>' + TODAY.weekN + '</b>近 7 天</button>'
      + '</div></div>'
      + bentoHtml
      + ((typeof firstGuideHtml === 'function') ? firstGuideHtml() : '')
      + '<div class="nb-nav" id="nbNav">'
      + '<div class="nb-crumbs">' + crumbHtml() + '</div>'
      + '<div class="nb-navbtns">'
      + (CUR ? '<button class="btn small" data-act="up">↑ 上一级</button>' : '')
      + '<button class="btn small" data-act="expandAll">展开 / 收起目录树</button>'
      + (DRAG ? '<button class="btn small primary" data-act="dropshow">放到这里</button><button class="btn small" data-act="dropcancel">取消移动</button>' : '')
      + '</div>'
      + '<div id="nbTree" class="nb-tree" style="display:none"></div>'
      + '</div>'
      + '<div class="toolbar main">'
      + '<button class="btn primary" data-act="newbank">＋ 新建 / 导入题库</button>'
      + (dueN ? '<button class="btn primary" id="toReview" data-act="review" data-n="' + (srsCap && dueN > srsCap ? srsCap : dueN) + '">今日复习 ' + (srsCap && dueN > srsCap ? srsCap + ' / ' + dueN : dueN) + ' 题</button>' : '')
      + '<button class="btn" id="toRand" data-act="randall">随机抽 30 题</button>'
      + '</div>'
      + '<div class="toolbar sub">'
      + '<button class="btn" id="toWrong" data-act="go" data-hash="#/wrong">错题本' + (wrongN ? '（' + wrongN + (dueN ? ' · 待复习' + dueN : '') + '）' : '') + '</button>'
      + '<button class="btn" id="toFav" data-act="go" data-hash="#/fav">收藏' + (favN ? '（' + favN + '）' : '') + '</button>'
      + '<button class="btn" id="toSearch" data-act="go" data-hash="#/search">搜索全部<span class="kbd">/</span></button>'
      + '<button class="btn" id="toStats" data-act="go" data-hash="#/stats">学习统计</button>'
      + '<button class="btn" id="toHelp" data-act="help">快捷键<span class="kbd">?</span></button>'
      + '<button class="btn" data-act="newcat">＋ 新建分类</button>'
      + (BATCH
        ? '<button class="btn primary" data-act="batchExit">退出批量（已选 ' + batCount() + '）</button>'
        : '<button class="btn" data-act="batch">批量管理题库</button>')
      + '</div>'
      + toolbarHtml()
      + '<div class="card chat-entry" id="chatEntry">'
      + '<div class="ce-t">💬 AI 对话 <span class="small muted">出题 / 问知识点 / 分析我的题库</span></div>'
      + '<div class="ce-d small muted">选好知识库，输入知识点就能出题；也可以把题库卡片 / 目录拖到这个卡片上，或者点「选题库」——它会带上你的作答记录总结易错点。</div>'
      + '<div class="ce-acts"><button class="btn primary" data-act="go" data-hash="#/chat">打开对话</button>'
      + '<span class="small muted">能直接拖题库 / 目录 / 题库文件 / 整个文件夹上来</span></div>'
      + '</div>'
      + body
      + (paperList ? '<h2 class="sec">临时套卷</h2>' + paperList : '')
      + '<div id="bfBoot"></div>'
      + '<div class="card" style="margin-top:16px">'
      + '<div class="name" style="font-weight:700;margin-bottom:6px">数据备份</div>'
      + '<div class="small muted" style="margin-bottom:10px">作答记录、错题、收藏、自定义解析存在本机浏览器里；题库和分类可以另存成本机文件（见上面的「本机题库文件」）。</div>'
      + (typeof backupHint === 'function' ? backupHint() : '')
      + '<div class="row-inline">'
      + '<button class="btn" id="expAll">导出全部数据</button>'
      + '<button class="btn" id="impAll">导入数据（恢复）</button>'
      + '<input type="file" id="impAllFile" accept=".json" style="display:none">'
      + '</div></div>'
      + '<div id="storeUse" class="small muted" style="margin:10px 2px 0">正在统计占用…</div>'
      + batchBarHtml();
  }

  function sortBank(a, b) {
    return (+a.ord || 0) - (+b.ord || 0) || String(a.title).localeCompare(String(b.title), 'zh');
  }

  /* 目录树（侧边/顶部折叠）：整个分类结构一次看全 */
  /* ---------- 7.2 视图（照 Windows 资源管理器 / macOS 访达 的两个轴来） ----------
     ① 视图类型：icon 图标 / list 列表 / details 详细信息（表格，表头可点排序）
     ② 图标大小：xl 超大 / lg 大 / md 中 / sm 小（只在「图标」视图下出现）
     分别存 qbank.view.v1 / qbank.iconsize.v1，刷新记住。 */
  var VIEW_KEY = 'qbank.view.v1';
  var SIZE_KEY = 'qbank.iconsize.v1';
  var VIEW_TYPES = ['icon', 'list', 'details'];
  var ICON_SIZES = ['xl', 'lg', 'md', 'sm'];
  function viewMode() {
    var v = '';
    try { v = localStorage.getItem(VIEW_KEY) || ''; } catch (e) {}
    if (v === 'cards' || v === 'lg' || v === 'md' || v === 'sm') v = 'icon';   /* 老数据：以前那几档卡片 */
    return VIEW_TYPES.indexOf(v) >= 0 ? v : 'icon';
  }
  function setViewMode(m) {
    try { localStorage.setItem(VIEW_KEY, VIEW_TYPES.indexOf(m) >= 0 ? m : 'icon'); } catch (e) {}
  }
  function iconSize() {
    var v = '';
    try { v = localStorage.getItem(SIZE_KEY) || ''; } catch (e) {}
    return ICON_SIZES.indexOf(v) >= 0 ? v : 'md';
  }
  function setIconSize(m) {
    try { localStorage.setItem(SIZE_KEY, ICON_SIZES.indexOf(m) >= 0 ? m : 'md'); } catch (e) {}
  }
  /* 详细信息表格的排序：点表头切列 / 升降序 */
  var DETAIL_SORT = { key: 'name', dir: 1 };
  function sortDetail(key) {
    if (DETAIL_SORT.key === key) DETAIL_SORT.dir = -DETAIL_SORT.dir;
    else { DETAIL_SORT.key = key; DETAIL_SORT.dir = 1; }
  }
  function viewToggleHtml() {
    var v = viewMode();
    var T = [
      ['icon', '图标（像访达：图标在上、名字在下）', '▦'],
      ['list', '列表（紧凑，一条一行）', '☰'],
      ['details', '详细信息（表格，点表头排序）', '▤']
    ];
    var view = '<div class="nb-view" role="group" aria-label="视图切换">' + T.map(function (x) {
      return '<button class="vb' + (v === x[0] ? ' on' : '') + '" data-act="view" data-v="' + x[0] + '" aria-pressed="' + (v === x[0]) + '" title="' + x[1] + '">' + x[2] + '</button>';
    }).join('') + '</div>';
    /* 图标大小只在「图标」视图下出现（跟资源管理器一样） */
    if (v !== 'icon') return view;
    var cur = iconSize();
    var M = [['xl', '超大', 'sq sq-xl'], ['lg', '大', 'sq sq-lg'], ['md', '中', 'sq sq-md'], ['sm', '小', 'sq sq-sm']];
    return '<span class="nb-vwrap">' + view + '<span class="nb-isize" role="group" aria-label="图标大小">' + M.map(function (x) {
      return '<button class="vb' + (cur === x[0] ? ' on' : '') + '" data-act="isize" data-v="' + x[0] + '" aria-pressed="' + (cur === x[0]) + '" title="图标大小：' + x[1] + '"><i class="' + x[2] + '"></i></button>';
    }).join('') + '</span></span>';
  }
  function sechead(title) { return '<div class="sechead"><h2 class="sec">' + title + '</h2>' + viewToggleHtml() + '</div>'; }
  function catRowHtml(c, inSearch) {
    var s = subStat(c.id);
    var crumb = inSearch ? pathOf(c.parent || null).map(TITLE).join(' › ') : '';
    return '<div class="nb-lrow nb-ldir' + (batSelC(c.id) ? ' nb-on' : '') + '" data-trow="' + E(c.id) + '" draggable="true">'
      + '<span class="nb-lic">' + ICON_FOLDER + '</span>'
      + '<div class="nb-linfo"><div class="nb-lname">' + E(TITLE(c)) + '</div>'
      + '<div class="nb-lmeta">' + (crumb ? '在 ' + E(crumb) + '　·　' : '') + s.banks + ' 个题库 · ' + s.q + ' 题 · 已答 ' + s.done + '</div></div>'
      + '<div class="nb-lacts">'
      + '<button class="btn tiny" data-act="open" data-id="' + E(c.id) + '">打开</button>'
      + '<button class="btn tiny" data-act="menu" data-id="' + E(c.id) + '">⋯</button>'
      + '</div></div>';
  }
  function bankRowHtml(b, inSearch) {
    var s = bankStat(b);
    var crumb = inSearch ? pathOf(b.cat || null).map(TITLE).join(' › ') : '';
    var pick = batOn(), on = pick && batSel(b.id);
    return '<div class="nb-lrow nb-lbank' + (on ? ' nb-on' : '') + '" data-bank="' + E(b.id) + '" draggable="true">'
      + '<span class="nb-lic">' + ICON_BANK + '</span>'
      + '<div class="nb-linfo"><div class="nb-lname">' + E(b.title)
      + (b.source === 'local' ? '<span class="pill local">自建</span>' : '<span class="pill">内置</span>')
      + '</div>'
      + '<div class="nb-lmeta">' + (crumb ? '在 ' + E(crumb) + '　·　' : '')
      + b.questions.length + ' 题　已答 ' + s.done
      + (s.wr ? '　<span class="warn">错题 ' + s.wr + '</span>' : '')
      + '　正确率 ' + s.acc + '%</div>'
      + '<div class="prog"><i style="width:' + s.pct.toFixed(1) + '%"></i></div>'
      + '</div>'
      + '<div class="nb-lacts">'
      + (pick
        ? '<span class="small muted">' + (on ? '✔ 已选中' : '点这行选中') + '</span>'
        : ('<button class="btn tiny primary" data-act="start" data-id="' + E(b.id) + '">' + (s.done ? '继续' : '开始') + '</button>'
          + '<button class="btn tiny" data-act="wrong" data-id="' + E(b.id) + '">错题 ' + s.wr + '</button>'
          + '<button class="btn tiny" data-act="move" data-id="' + E(b.id) + '">移动</button>'
          + '<button class="btn tiny" data-act="more" data-id="' + E(b.id) + '">⋯</button>'))
      + '</div></div>';
  }
  /* 图标视图：图标在上、名字在下（像访达的图标视图）。
     用 .nb-dir / .nb-bank 两个类，bind() 里现成的点击/双击就能用，不用额外绑。 */
  function catIconHtml(c) {
    var s = subStat(c.id);
    return '<div class="nb-icon nb-dir' + (batSelC(c.id) ? ' nb-on' : '') + '" data-cat="' + E(c.id) + '" draggable="true" title="' + E(TITLE(c)) + (batOn() ? '（单击选中 / 双击进入）' : '（双击或点名字进入）') + '">'
      + '<span class="nb-iic">' + ICON_FOLDER + '</span>'
      + '<span class="nb-iname">' + E(TITLE(c)) + '</span>'
      + '<span class="nb-imeta">' + s.banks + ' 个库 · ' + s.q + ' 题</span>'
      + '<span class="nb-ibar"><i style="width:' + (s.q ? (s.done / s.q * 100).toFixed(1) : 0) + '%"></i></span>'
      + '</div>';
  }
  function bankIconHtml(b) {
    var s = bankStat(b), pick = batOn(), on = pick && batSel(b.id);
    return '<div class="nb-icon nb-bank' + (on ? ' nb-on' : '') + '" data-bank="' + E(b.id) + '" draggable="true" title="' + E(b.title) + '（' + b.questions.length + ' 题）">'
      + '<span class="nb-iic">' + ICON_BANK + '</span>'
      + '<span class="nb-iname">' + E(b.title) + '</span>'
      + '<span class="nb-imeta">' + b.questions.length + ' 题 · ' + s.acc + '%</span>'
      + '<span class="nb-ibar"><i style="width:' + s.pct.toFixed(1) + '%"></i></span>'
      /* 图标视图也得有个「⋯」：速刷 / 背题 / 模拟考试三个入口都在这个菜单里。
         平时淡出，鼠标停上去（或键盘 Tab 到）才实，免得图标视图看着太闹。 */
      + (pick ? '' : '<button class="nb-more" data-act="more" data-id="' + E(b.id) + '" title="更多：速刷 / 背题 / 模拟考试 / 移动 / 导出…">⋯</button>')
      + '</div>';
  }

  /* 详细信息：表格 + 表头可点排序（像资源管理器的「详细信息」） */
  function detailItems(dirs, banks, inSearch) {
    var items = [];
    (dirs || []).forEach(function (c) {
      var s = subStat(c.id);
      items.push({ kind: 'dir', id: c.id, name: TITLE(c), type: '目录',
        q: s.q, done: s.done, acc: s.done ? Math.round(s.ok / s.done * 100) : 0, wr: s.wr,
        crumb: inSearch ? pathOf(c.parent || null).map(TITLE).join(' › ') : '' });
    });
    (banks || []).forEach(function (b) {
      var s = bankStat(b);
      items.push({ kind: 'bank', id: b.id, name: b.title, type: b.source === 'local' ? '自建' : '内置',
        q: b.questions.length, done: s.done, acc: s.acc, wr: s.wr,
        crumb: inSearch ? pathOf(b.cat || null).map(TITLE).join(' › ') : '' });
    });
    var K = DETAIL_SORT.key, D = DETAIL_SORT.dir;
    items.sort(function (a, b2) {
      if (K === 'name') return String(a.name).localeCompare(String(b2.name), 'zh') * D;
      if (K === 'type') return String(a.type).localeCompare(String(b2.type), 'zh') * D;
      return ((a[K] || 0) - (b2[K] || 0)) * D;
    });
    return items;
  }
  function detailsHtml(dirs, banks, inSearch) {
    var items = detailItems(dirs, banks, inSearch);
    if (!items.length) return '';
    var S = DETAIL_SORT;
    function th(key, label) {
      var on = S.key === key;
      return '<th class="' + (on ? 'on' : '') + '" data-act="sort" data-v="' + key + '" title="点一下按「' + label + '」排序（再点一下倒过来）">'
        + label + (on ? (S.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>';
    }
    var rows = items.map(function (it) {
      var attr = it.kind === 'dir' ? ('data-cat="' + E(it.id) + '"') : ('data-bank="' + E(it.id) + '"');
      var acts = it.kind === 'dir'
        ? '<button class="btn tiny" data-act="open" data-id="' + E(it.id) + '">打开</button><button class="btn tiny" data-act="menu" data-id="' + E(it.id) + '">⋯</button>'
        : '<button class="btn tiny primary" data-act="start" data-id="' + E(it.id) + '">' + (it.done ? '继续' : '开始') + '</button><button class="btn tiny" data-act="more" data-id="' + E(it.id) + '">⋯</button>';
      var on = it.kind === 'dir' ? batSelC(it.id) : batSel(it.id);
      return '<tr class="nb-drow nb-' + it.kind + (on ? ' nb-on' : '') + '" ' + attr + ' draggable="true">'
        + '<td class="nb-dname"><span class="nb-dic">' + (it.kind === 'dir' ? ICON_FOLDER : ICON_BANK) + '</span>'
        + '<span class="nb-dtext">' + E(it.name) + (it.crumb ? '<span class="small muted">　在 ' + E(it.crumb) + '</span>' : '') + '</span></td>'
        + '<td class="small muted">' + it.type + '</td>'
        + '<td class="num">' + it.q + '</td>'
        + '<td class="num">' + it.done + '</td>'
        + '<td class="num">' + (it.done ? it.acc + '%' : '—') + '</td>'
        + '<td class="num' + (it.wr ? ' warn' : '') + '">' + (it.wr || '—') + '</td>'
        + '<td class="nb-dacts">' + acts + '</td>'
        + '</tr>';
    }).join('');
    return '<table class="nb-table"><thead><tr>'
      + th('name', '名称') + th('type', '类型') + th('q', '题目数') + th('done', '已答') + th('acc', '正确率') + th('wr', '错题')
      + '<th>操作</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* 按当前视图包一层：图标 / 列表 / 详细信息（三套都从同一份数据来） */
  function viewWrap(iconHtml, listHtml, detHtml) {
    var v = viewMode();
    if (v === 'details') return '<div class="nb-details">' + detHtml + '</div>';
    if (v === 'list') return '<div class="nb-list">' + listHtml + '</div>';
    return '<div class="nb-icons nb-icons-' + iconSize() + '">' + iconHtml + '</div>';
  }

  function treeHtml() {
    ensure();
    function walk(pid, depth) {
      var out = '';
      kids(pid).forEach(function (c) {
        out += '<div class="nb-trow" data-trow="' + E(c.id) + '" style="padding-left:' + (depth * 14) + 'px">'
          + '<button class="btn tiny" data-act="open" data-id="' + E(c.id) + '">' + E(TITLE(c)) + '</button>'
          + '<span class="small muted">' + dirBanks(c.id).length + ' 个题库</span>'
          + '</div>';
        out += walk(c.id, depth + 1);
      });
      return out;
    }
    var loose = dirBanks(null).length;
    return '<div class="nb-trow nb-trow-root' + (CUR ? '' : ' on') + '" data-trow="" style="padding-left:0">' + '<button class="btn tiny' + (CUR ? '' : ' primary') + '" data-act="open" data-id="">全部题库（根目录）</button>'
      + '<span class="small muted">' + loose + ' 个题库</span></div>'
      + walk(null, 1);
  }

  /* ---------- 渲染入口：替换首页 ============
     由 app.js 的 renderHome() 在最后调用（见 catRenderHook）。
     策略：先让原首页正常渲染（它的统计 / 数据备份按钮都还在），
     然后把 .hero 到「数据备份」卡片之间的内容整段换成目录视图。 */
  function catRenderHook() {
    ensure();
    var view = document.getElementById('view');
    if (!view) return;
    var hero = view.querySelector('.hero');
    if (!hero) return;                       // 不是首页结构：不动
    var old = document.getElementById('nbHome');
    if (old) old.remove();                   // 重画时先把上一次的目录视图撤掉
    /* 记住停留的目录：只有本次打开页面还没定过位置时才读存档，
       否则会把 openDir() 刚设好的目录又顶回旧的 */
    if (!CUR_SET) {
      try {
        var stored = JSON.parse(localStorage.getItem(CUR_KEY));
        CUR = (stored && typeof stored.id === 'string') ? stored.id : null;
      } catch (e) { CUR = null; }
      CUR_SET = true;
    }
    if (CUR && !byId(CUR)) CUR = null;

    var holder = document.createElement('div');
    holder.id = 'nbHome';
    holder.innerHTML = homeHtml();
    hero.parentNode.insertBefore(holder, hero);
    hookHome();
    /* 旧的平铺列表 / 常用按钮行 / 我的题库标题 / 空状态，全部撤掉 */
    var nodes = Array.prototype.slice.call(view.children);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n === holder) continue;
      /* 首页里属于 app.js 的旧统计卡 / 列表 / 按钮行 / 空状态：一律撤掉。
         新的 hero、按钮行、目录视图都在 holder 里，不会误删。 */
      n.remove();
    }
    /* 兜底：只留 holder 和我们自己那块「数据备份」（含导出/导入按钮）。
       app.js 原首页的同名卡片是「会生成、但没人寻址」的，留着就会重复，所以这里显式清掉。 */
    var spare = [];
    Array.prototype.slice.call(document.querySelectorAll('#view .card')).forEach(function (c) {
      if (holder.contains(c)) return;                  // 我们自己的备份卡在 holder 里
      if (c.querySelector('#expAll') || c.querySelector('#impAll')) spare.push(c);
    });
    spare.forEach(function (c) { c.remove(); });
    /* 没有 #storeUse（app.js 那行被删了）就补一个，paintStorageUse() 要往里写占用 */
    if (typeof paintStorageUse === 'function' && !document.getElementById('storeUse')) {
      var su = document.createElement('div');
      su.id = 'storeUse';
      su.className = 'small muted';
      su.style.margin = '10px 2px 0';
      holder.appendChild(su);
    }
    bind(holder);
    if (typeof BF !== 'undefined' && BF.boot) BF.boot();
  }

  /* ---------- 事件绑定（都在 holder 内，重渲染后重新绑一次） ---------- */
  function bind(host) {
    var search = host.querySelector('#nbSearch');
    if (search) {
      search.addEventListener('input', function () {
        QUERY = search.value;
        clearTimeout(bind._t);
        bind._t = setTimeout(function () { repaint(); }, 220);
      });
      search.addEventListener('keydown', function (e) { if (e.key === 'Enter') { QUERY = search.value; repaint(); } });
    }
    host.querySelectorAll('[data-crumb]').forEach(function (a) {
      a.onclick = function (e) { e.preventDefault(); openDir(a.dataset.crumb || null); };
    });
    host.querySelectorAll('[data-trow]').forEach(function (row) {
      row.onclick = function () {
        var inTree = !!(row.closest && row.closest('#nbTree'));
        /* 移动模式：点目录行 = 放进这个目录（目录树里的行除外，那是导航） */
        if (DRAG && !inTree) { dropInto(row.dataset.trow); return; }
        /* 批量模式：列表里的目录行也是「单击选中」（目录树 #nbTree 里的行除外，那是导航） */
        if (BATCH && row.dataset.trow && !inTree) { batToggleC(row.dataset.trow); repaint(); return; }
        openDir(row.dataset.trow);
      };
    });
    /* 7.1 目录树点不动：`#nbTree` 初始是空的，树节点是点「展开 / 收起目录树」
       （doAct('expandAll') → treeHtml()）之后才注入的，那些节点赶不上上面那轮绑定。
       这里给容器挂**一次**委托（用 __trowBound 防重复），以后注入多少节点都能点。 */
    var tree = host.querySelector('#nbTree');
    if (tree && !tree.__trowBound) {
      tree.__trowBound = true;
      tree.addEventListener('click', function (e) {
        var row = e.target.closest ? e.target.closest('[data-trow]') : null;
        if (row && tree.contains(row)) { openDir(row.dataset.trow); return; }
        var act = e.target.closest ? e.target.closest('[data-act="open"]') : null;
        if (act && tree.contains(act) && act.dataset.id !== undefined) { openDir(act.dataset.id); }
      });
    }
    /* 兜底：万一还有别处（例如 app.js 自己那版首页）渲染出 data-start / data-delpaper 的按钮，
       也补上事件 —— 这两个属性以前没人读，套卷卡片上的「开始做题 / 删除套卷」点不动就是这么来的 */
    host.querySelectorAll('[data-delpaper]').forEach(function (el) {
      if (el.onclick) return;
      el.onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        if (typeof deletePaper === 'function') deletePaper(el.dataset.delpaper);
      };
    });
    host.querySelectorAll('[data-start]').forEach(function (el) {
      if (el.onclick) return;
      el.onclick = function (e) { e.preventDefault(); e.stopPropagation(); startBankWrapped(el.dataset.start); };
    });
    host.querySelectorAll('[data-act]').forEach(function (el) {
      el.onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        doAct(el.dataset.act, el.dataset.id, el, host);
      };
    });
    /* 再按 id 绑一遍：这一排按钮不管谁先渲染都能点 */
    var BY_ID = { toWrong: '#/wrong', toFav: '#/fav', toSearch: '#/search', toStats: '#/stats' };
    Object.keys(BY_ID).forEach(function (id) {
      var el = host.querySelector('#' + id);
      if (el && !el.onclick) el.onclick = function () { if (typeof go === 'function') go(BY_ID[id]); };
    });
    /* 数据备份卡里的「导出全部数据 / 导入数据（恢复）」：这张卡是我们自己重画的，
       app.js 原来绑好的那份节点已经被上面撤掉了，所以必须在这里补绑，否则点了没反应 */
    var exA = host.querySelector('#expAll');
    if (exA && !exA.onclick) exA.onclick = function () { if (typeof exportAllData === 'function') exportAllData(); };
    var imA = host.querySelector('#impAll');
    var imF = host.querySelector('#impAllFile');
    if (imA && imF && !imA.onclick) imA.onclick = function () { imF.click(); };
    if (imF && !imF.onchange && typeof importAllData === 'function') imF.onchange = function (e) { importAllData(e); };
    /* 双击 / 单击卡片：进入目录、开始刷题 */
    host.querySelectorAll('.nb-dir').forEach(function (row) {
      row.addEventListener('dblclick', function () { if (!DRAG) openDir(row.dataset.cat); });
      row.addEventListener('click', function (e) {
        if (e.target.closest('[data-act]')) return;
        if (e.detail > 1) return;
        if (dragSticky()) return;              // 长按选中后，这一下点击不算「打开」
        /* 移动模式：点目录 = 放进这个目录（长按选中之后，「拖进分类」在触屏上就靠这一下） */
        if (DRAG) { e.preventDefault(); dropInto(row.dataset.cat); return; }
        /* 批量模式：单击 = 选中这个目录，双击才是进去（跟资源管理器一样） */
        if (BATCH) { batToggleC(row.dataset.cat); repaint(); return; }
        openDir(row.dataset.cat);
      });
    });
    host.querySelectorAll('.nb-bank').forEach(function (row) {
      row.addEventListener('dblclick', function () {
        if (DRAG) return;
        if (BATCH) { batToggle(row.dataset.bank); repaint(); return; }
        startBankWrapped(row.dataset.bank);
      });
      row.addEventListener('click', function (e) {
        if (e.target.closest('[data-act]')) return;
        if (e.detail > 1) return;
        if (DRAG) { T('移动模式：点目录卡片放进它，或点上面的「放到这里」选目标'); return; }
        if (BATCH) { batToggle(row.dataset.bank); repaint(); return; }   // 批量模式下点卡片 = 选中 / 取消
        if (dragSticky()) return;
        startBankWrapped(row.dataset.bank);
      });
    });
    /* 列表视图的题库行 / 详细信息表格的行：跟图标视图同一套点击规矩
       （以前这些行本体没绑点击，只有角落那几个按钮能点） */
    host.querySelectorAll('.nb-lbank, .nb-drow').forEach(function (row) {
      if (row.__nbRowBound) return;
      row.__nbRowBound = true;
      row.addEventListener('click', function (e) {
        if (e.target.closest('[data-act]')) return;
        var ref = cardRefOf(row);
        if (!ref) return;
        if (DRAG) {
          if (ref.kind === 'cat') dropInto(ref.id);
          else T('移动模式：点目录行放进它，或点上面的「放到这里」选目标目录');
          return;
        }
        if (BATCH) { if (ref.kind === 'cat') batToggleC(ref.id); else batToggle(ref.id); repaint(); return; }
        if (ref.kind === 'cat') openDir(ref.id); else startBankWrapped(ref.id);
      });
    });
    attachDrag(host);
    attachMarquee(host);
  }

  function startBankWrapped(id) {
    QUERY = '';
    if (typeof startBank === 'function') startBank(id);
  }

  /* 方案九：⏱ 模拟考试 —— 只给题库卡片加一个入口，`exam.js` 一行不改。
     题数 × 60 秒（西综 180 题 / 180 分钟那个口径），打乱顺序后交给 makePaper，
     它会自己跳 #/exam/。 */
  function startExam(id) {
    var b = bankOf(id); if (!b || !b.questions.length) return;
    var keys = b.questions.map(function (q) { return kOf(b, q); });
    for (var i = keys.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = keys[i]; keys[i] = keys[j]; keys[j] = t;
    }
    if (typeof makePaper === 'function') makePaper(b.title + ' · 模拟考试', keys, { exam: true, duration: keys.length * 60 });
  }

  function openDir(id) {
    ensure();
    if (id && !byId(id)) id = null;
    CUR = id || null;
    CUR_SET = true;
    QUERY = '';
    try { localStorage.setItem(CUR_KEY, JSON.stringify({ id: CUR, ts: Date.now() })); } catch (e) {}
    repaint();
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
  }

  /* 内部重画：调 app.js 的全局 render 重画首页（不能叫 render，否则同名自我递归） */
  function repaint() {
    try { if (typeof window.render === 'function') window.render(); } catch (e) {}
  }

  /* ---------- 菜单与动作 ---------- */
  function doAct(act, id, el, host) {
    switch (act) {
      case 'open': openDir(id || null); break;
      /* 7.2 视图切换：卡片 ▦ / 列表 ☰（存 qbank.view.v1，刷新记住） */
      case 'view': setViewMode(el && el.dataset ? el.dataset.v : 'icon'); repaint(); break;
      case 'isize': setIconSize(el && el.dataset ? el.dataset.v : 'md'); repaint(); break;
      case 'sort': sortDetail(el && el.dataset ? el.dataset.v : 'name'); repaint(); break;
      case 'up': openDir(byId(CUR) ? byId(CUR).parent : null); break;
      case 'newcat': askNewCat(); break;
      case 'newbank': if (typeof go === 'function') go('#/import'); break;
      case 'start': startBankWrapped(id); break;
      /* 临时套卷 / 模拟试卷的删除（app.js 的 deletePaper，会清掉套卷作答并记墓碑） */
      case 'delpaper': if (typeof deletePaper === 'function') deletePaper(id); break;
      case 'wrong': if (typeof QZ !== 'undefined') QZ.filter = 'wrong'; startBankWrapped(id); break;
      case 'rand': if (typeof randomPaper === 'function') randomPaper([bankOf(id)], 30); break;
      case 'move': askMoveBank(id); break;
      /* 批量管理 */
      case 'batch': BATCH = { sel: {}, cat: {} }; DRAG = null; LOCK = false; T('批量管理：单击题库 / 目录选中，双击目录进去接着选'); repaint(); break;
      case 'batchExit': BATCH = null; repaint(); break;
      case 'batchDir': batPickDir(id); break;
      case 'bAll': if (!BATCH) break; visibleBanks().forEach(function (b) { BATCH.sel[b.id] = 1; }); visibleCats().forEach(function (c) { BATCH.cat[c.id] = 1; }); repaint(); break;
      case 'bInv': if (!BATCH) break; visibleBanks().forEach(function (b) { if (BATCH.sel[b.id]) delete BATCH.sel[b.id]; else BATCH.sel[b.id] = 1; }); visibleCats().forEach(function (c) { if (BATCH.cat[c.id]) delete BATCH.cat[c.id]; else BATCH.cat[c.id] = 1; }); repaint(); break;
      case 'bMove': askBatchMove(); break;
      case 'bDel': askBatchDel(); break;
      case 'bExport': batchExport(); break;
      case 'more': bankMenu(id); break;
      case 'menu': catMenu(id); break;
      case 'dropshow': askMoveByPick(); break;
      case 'dropcancel': DRAG = null; LOCK = false; repaint(); break;
      /* 首页那排按钮：走这里跳转，不靠 app.js 在 renderHome 里的 id 绑定
         （它绑的是被我们替换掉的那一排，绑完那些节点就被撤了，所以以前点不动） */
      case 'go': if (typeof go === 'function' && el && el.dataset.hash) go(el.dataset.hash); break;
      case 'resume': var lp2 = (typeof lastPos === 'function') ? lastPos() : null; if (lp2) startBankWrapped(lp2.bank.id); break;
      case 'review': if (typeof startReview === 'function') startReview(+(el && el.dataset.n) || 60); break;
      case 'randall': if (typeof randomPaper === 'function') randomPaper(bankList(), 30); break;
      case 'help': if (typeof showHelp === 'function') showHelp(); break;
      case 'expandAll':
        var t = host.querySelector('#nbTree');
        if (t) { var open = t.style.display === 'none'; t.style.display = open ? 'block' : 'none'; if (open) t.innerHTML = treeHtml() + '<div class="small muted" style="margin-top:6px">点一个目录就能跳过去（含它下面的子目录）。</div>'; }
        break;
      default: break;
    }
  }

  function askNewCat() {
    var parent = CUR;
    var pTxt = parent ? pathOf(parent).map(TITLE).join(' › ') : '根目录（顶层）';
    BFUI.prompt({
      title: '新建分类',
      label: '分类名称（可以随时改名）',
      placeholder: '例如：药理 / 第一章 总论',
      hint: '将创建在：' + pTxt + '。想要子目录，先进到那个目录里再点「＋ 新建分类」。',
      choices: parent ? [{ label: '建在根目录（顶层）', value: '__ROOT__' }] : [],
      test: function (v) { return v ? '' : '名称不能为空'; }
    }).then(function (v) {
      if (v == null) return;
      if (v === '__ROOT__') { CUR = null; askNewCatRoot(); return; }
      var nid = createCat(parent, v);
      saveCats({ quiet: false });
      T('已新建分类「' + v + '」');
      if (nid) openDir(nid);
    });
  }
  function askNewCatRoot() {
    BFUI.prompt({
      title: '新建分类（建在根目录）',
      label: '分类名称',
      placeholder: '例如：西医综合',
      test: function (v) { return v ? '' : '名称不能为空'; }
    }).then(function (v) {
      if (v == null) return;
      createCat(null, v);
      saveCats();
      T('已新建分类「' + v + '」');
    });
  }

  function catMenu(id) {
    var c = byId(id); if (!c) return;
    var pTxt = pathOf(id).map(TITLE).join(' › ');
    /* 整棵子树（自己 + 所有子孙目录）里的题库，用于「连题库一起删」的数量提示 */
    var treeIds = [id].concat(descIds(id));
    var inTree = {}; treeIds.forEach(function (x) { inTree[x] = 1; });
    var treeBanks = bankList().filter(function (b) { return b.cat != null && inTree[b.cat]; });
    var deepLocal = treeBanks.filter(function (b) { return b.source === 'local'; });
    var deepQ = 0; deepLocal.forEach(function (b) { deepQ += b.questions.length; });
    var direct = dirBanks(id).length;
    BFUI.pick({
      title: c.title,
      desc: '位置：' + pTxt + '　·　' + kids(id).length + ' 个子目录 · ' + direct + ' 个题库（直属）'
        + (treeBanks.length > direct ? '　·　含子目录共 ' + treeBanks.length + ' 个题库' : ''),
      items: [
        { value: 'open', label: '打开这个目录' },
        { value: 'aichat', label: '💬 让 AI 分析这个目录', note: '把这个目录（含子目录）里的题库一起分析' },
        { value: 'rename', label: '重命名' },
        { value: 'newsub', label: '在这里新建子目录' },
        { value: 'move', label: '移动到其它目录…' },
        { value: 'deldeep', label: '🔥 删除目录（连同里面的题库）', note: deepLocal.length ? ('删 ' + deepLocal.length + ' 个题库 / ' + deepQ + ' 题，不可恢复') : '里面没有自建题库' },
        { value: 'del', label: '只删目录，题库移到上一级', note: '不删题库' }
      ]
    }).then(function (v) {
      if (v === 'open') openDir(id);
      else if (v === 'aichat') { if (window.CHAT) CHAT.openCat(id); else T('对话模块没加载'); }
      else if (v === 'rename') {
        BFUI.prompt({ title: '重命名分类', label: '新名称', value: c.title, test: function (x) { return x ? '' : '名称不能为空'; } })
          .then(function (nv) { if (nv == null) return; renameCat(id, nv); saveCats(); T('已改名为「' + nv + '」'); });
      } else if (v === 'newsub') {
        BFUI.prompt({ title: '在「' + c.title + '」里新建子目录', label: '子目录名称', test: function (x) { return x ? '' : '名称不能为空'; } })
          .then(function (nv) { if (nv == null) return; createCat(id, nv); saveCats(); T('已新建子目录「' + nv + '」'); });
      } else if (v === 'move') askMoveCat(id);
      else if (v === 'deldeep') askDelCatDeep(id);
      else if (v === 'del') askDelCat(id);
    });
  }

  function askMoveCat(id) {
    var bad = descIds(id);
    var items = [{ value: '__ROOT__', label: '🏠 顶层（移出所有目录）' }];
    catsAll().forEach(function (c) {
      if (bad.indexOf(c.id) >= 0) return;
      items.push({ value: c.id, label: pathOf(c.id).map(TITLE).join(' › '), note: dirBanks(c.id).length + ' 个题库' });
    });
    BFUI.pick({ title: '把「' + TITLE(byId(id)) + '」移动到…', desc: '不能移动到自己或自己的子目录里。', items: items })
      .then(function (v) {
        if (v == null) return;
        var ok = moveCat(id, v === '__ROOT__' ? null : v);
        if (!ok) { T('不能移动到自己的子目录里'); return; }
        saveCats();
        T('已移动');
      });
  }

  function askDelCat(id) {
    var c = byId(id); if (!c) return;
    var subs = kids(id), bs = dirBanks(id);
    var parent = c.parent || null;
    BFUI.confirm({
      title: '删除分类「' + c.title + '」？',
      html: '删除后：<br>'
        + '· ' + subs.length + ' 个子目录会移到' + (parent ? '上一级目录' : '顶层') + '<br>'
        + '· ' + bs.length + ' 个题库会移到' + (parent ? '上一级目录' : '顶层') + '<br>'
        + '<span class="muted">题目本身和作答记录不会丢，只是换个位置放。</span>',
      okText: '删除分类',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      /* 先把内容挪走，再删节点，保证没有孤儿 */
      subs.forEach(function (k) { k.parent = parent; });
      bs.forEach(function (b) {
        b.cat = parent;
        var raw = toRaw(b.id);
        if (raw) raw.cat = parent;
        syncBankToLocal(b.id);
      });
      CAT = CAT.filter(function (x) { return x.id !== id; });
      if (CUR === id) CUR = parent;
      if (typeof invalidateBanks === 'function') invalidateBanks();
      saveCats();
      T('已删除分类，内容已移到' + (parent ? '上一级' : '顶层'));
    });
  }

  /* 真删题库（只删自建）：作答记录 / 收藏 / 自定义解析 + 墓碑一起清，返回删掉的题数 */
  function purgeBanks(list) {
    var qn = 0;
    (list || []).forEach(function (b) {
      if (!b || b.source !== 'local') return;
      b.questions.forEach(function (q) {
        var k = kOf(b, q);
        delete ANS[k]; delete FAV[k]; delete NOTES[k];
        tombAdd('ans', k); tombAdd('fav', k); tombAdd('note', k);
        qn++;
      });
      if (typeof LOCAL !== 'undefined' && Array.isArray(LOCAL)) {
        LOCAL = LOCAL.filter(function (x) { return x.id !== b.id; });
      }
      try { localStorage.removeItem('qbank.last.' + b.id); } catch (e) {}
    });
    if (qn) {
      if (typeof invalidateBanks === 'function') invalidateBanks();
      try { if (typeof writeLS === 'function') writeLS('qbank.local.v2', LOCAL); } catch (e) {}
      if (typeof saveAns === 'function') saveAns();
      if (typeof saveFav === 'function') saveFav();
      if (typeof saveNotes === 'function') saveNotes();
      notifyFile();
    }
    return qn;
  }

  /* 删除目录（连内容一起删）：自己 + 所有子孙目录 + 子树里所有题库，一次清干净 */
  function askDelCatDeep(id) {
    var c = byId(id); if (!c) return;
    var ids = [id].concat(descIds(id));
    var set = {}; ids.forEach(function (x) { set[x] = 1; });
    var all = bankList().filter(function (b) { return b.cat != null && set[b.cat]; });
    var dels = all.filter(function (b) { return b.source === 'local'; });
    var keep = all.filter(function (b) { return b.source !== 'local'; });
    var qn = 0; dels.forEach(function (b) { qn += b.questions.length; });
    var upTxt = c.parent ? '上一级目录' : '顶层';
    var names = dels.slice(0, 8).map(function (b) { return E(b.title); }).join('、') + (dels.length > 8 ? ' 等 ' + dels.length + ' 个' : '');
    BFUI.confirm({
      title: '删除目录「' + c.title + '」，连同里面的题库？',
      html: (dels.length
          ? '会删除 <b>' + dels.length + ' 个题库 / ' + qn + ' 题</b>：<br><span class="small">' + names + '</span><br>'
          : '这个目录（含子目录）里没有可删除的自建题库。<br>')
        + '目录本身也会删掉 ' + ids.length + ' 个（含 ' + (ids.length - 1) + ' 个子目录）。<br>'
        + '它们下面所有题目的作答记录、收藏、自定义解析会一起清掉，<b>不可恢复</b>。'
        + (keep.length ? '<div class="small muted" style="margin-top:6px">另有 ' + keep.length + ' 个内置题库不能删，会移到' + upTxt + '。</div>' : ''),
      okText: '全部删除',
      danger: true
    }).then(function (ok) {
      if (!ok) return;
      var n = purgeBanks(dels);
      /* 内置题库不能删：挪到上一级免得成孤儿（必须改原始对象，副本改了不生效） */
      keep.forEach(function (b) {
        b.cat = c.parent || null;
        var raw = toRaw(b.id);
        if (raw) raw.cat = c.parent || null;
        syncBankToLocal(b.id);
      });
      CAT = CAT.filter(function (x) { return !set[x.id]; });                            // 整棵子树一起删
      if (CUR && set[CUR]) CUR = c.parent || null;
      if (typeof invalidateBanks === 'function') invalidateBanks();
      saveCats();
      try { if (typeof writeLS === 'function') writeLS('qbank.local.v2', LOCAL); } catch (e) {}
      notifyFile();
      T('已删除 ' + ids.length + ' 个目录、' + dels.length + ' 个题库（' + n + ' 题）'
        + (keep.length ? '，' + keep.length + ' 个内置题库已移到' + upTxt : ''));
      repaint();
    });
  }

  /* 移动题库：先选目标目录（含搜索），再决定是否连带作答记录 */
  function askMoveBank(id) {
    var b = bankOf(id); if (!b) return;
    if (b.paper) { T('临时套卷不能移动'); return; }
    var items = [{ value: '__ROOT__', label: '🏠 顶层（根目录）' }];
    catsAll().forEach(function (c) {
      items.push({ value: c.id, label: pathOf(c.id).map(TITLE).join(' › '), note: dirBanks(c.id).length + ' 个题库' });
    });
    /* 允许顺手新建一个目录 */
    items.unshift({ value: '__NEW__', label: '＋ 新建一个分类再放进去…' });
    BFUI.pick({ title: '把「' + b.title + '」移动到…', desc: '选题库要放进的目录。', items: items })
      .then(function (v) {
        if (v == null) return;
        if (v === '__NEW__') {
          BFUI.prompt({ title: '新建分类', label: '分类名称', placeholder: '例如：药理 / 抗菌药' })
            .then(function (name) {
              if (name == null) return;
              var nid = createCat(CUR, name);
              applyMoveBank(id, nid);
            });
          return;
        }
        applyMoveBank(id, v === '__ROOT__' ? null : v);
      });
  }
  function applyMoveBank(id, dir) {
    var b = bankOf(id);
    if (!moveBank(id, dir)) { T('移动失败'); return; }
    saveBankOrder();
    var where = dir ? pathOf(dir).map(TITLE).join(' › ') : '顶层';
    T('已把「' + b.title + '」移到 ' + where);
    repaint();
  }
  function saveBankOrder() {
    try {
      if (typeof LOCAL !== 'undefined' && Array.isArray(LOCAL)) {
        LOCAL.forEach(function (raw) {                 // 把缓存里的 cat/ord 全部同步回原始对象
          if (!raw || !raw.id) return;
          var b = null;
          try { b = bankOf(raw.id); } catch (e) { b = null; }
          if (!b) return;
          raw.cat = b.cat == null ? null : b.cat;
          if (b.ord == null) delete raw.ord; else raw.ord = b.ord;
        });
      }
      if (typeof writeLS === 'function') writeLS('qbank.local.v2', LOCAL);
    } catch (e) {}
    if (typeof invalidateBanks === 'function') invalidateBanks();
    notifyFile();
  }

  /* 拖拽移动（用「先选中、再点目标」的两步法，手机上比长按拖好按）；
     批量模式下带的是一批（选中的题库 + 目录）。 */
  function askMoveByPick() {
    if (!DRAG) return;
    var banks = (DRAG.banks || []).slice(), cats = (DRAG.cats || []).slice();
    if (!banks.length && !cats.length && DRAG.id) {
      if (DRAG.type === 'cat') cats = [DRAG.id]; else banks = [DRAG.id];
    }
    var banned = {};
    cats.forEach(function (cid) { banned[cid] = 1; descIds(cid).forEach(function (d) { banned[d] = 1; }); });
    var items = [{ value: '__ROOT__', label: '🏠 顶层（根目录）' }];
    catsAll().forEach(function (c) {
      if (banned[c.id]) return;
      items.push({ value: c.id, label: pathOf(c.id).map(TITLE).join(' › '), note: dirBanks(c.id).length + ' 个题库' });
    });
    var n = banks.length + cats.length;
    BFUI.pick({ title: n > 1 ? ('把选中的 ' + n + ' 项移动到…') : '移动到…', items: items }).then(function (v) {
      if (v == null) return;
      dropInto(v === '__ROOT__' ? null : v);
    });
  }

  function bankMenu(id) {
    var b = bankOf(id); if (!b) return;
    var isLocal = b.source === 'local';
    var items = [
      { value: 'start', label: '开始 / 继续刷题' },
      { value: 'aichat', label: '💬 让 AI 分析这个题库', note: '带上你的作答记录，总结易错点 / 知识点' },
      { value: 'qlist', label: '🗂 题目管理：看题 / 删题', note: isLocal ? '一张张读题，勾选后批量删掉不要的题' : '内置题库只能看，不能删' },
      { value: 'modeSpeed', label: '⚡ 速刷模式', note: '判完自动跳下一题' },
      { value: 'modeRecite', label: '📖 背题模式', note: '直接看答案 + 解析，不记作答' },
      { value: 'modeExam', label: '⏱ 模拟考试', note: b.questions.length + ' 题 · 限时 ' + b.questions.length + ' 分钟' },
      { value: 'move', label: '移动到其它目录…' },
      { value: 'export', label: '导出这个题库（JSON）' }
    ];
    if (isLocal) {
      items.push({ value: 'rename', label: '改名 / 改说明' });
      items.push({ value: 'edit', label: '编辑题目内容' });
      items.push({ value: 'del', label: '删除题库', note: '不可恢复' });
    }
    BFUI.pick({ title: b.title, desc: pathOf(b.cat || null).map(TITLE).join(' › ') + '　·　' + b.questions.length + ' 题', items: items })
      .then(function (v) {
        if (v === 'start') startBankWrapped(id);
        else if (v === 'aichat') { if (window.CHAT) CHAT.openBank(id); else T('对话模块没加载'); }
        else if (v === 'qlist') { if (typeof go === 'function') go('#/qlist/' + id); }
        else if (v === 'modeSpeed') { if (typeof setLook === 'function') setLook('quizMode', 'speed'); startBankWrapped(id); }
        else if (v === 'modeRecite') { if (typeof setLook === 'function') setLook('quizMode', 'recite'); startBankWrapped(id); }
        else if (v === 'modeExam') startExam(id);
        else if (v === 'move') askMoveBank(id);
        else if (v === 'export') { if (typeof exportBank === 'function') exportBank(b); }
        else if (v === 'rename') askRenameBank(id);
        else if (v === 'edit') editBank(id);
        else if (v === 'del') askDelBank(id);
      });
  }

  function askRenameBank(id) {
    var b = bankOf(id); if (!b) return;
    BFUI.prompt({ title: '改名', label: '题库名称', value: b.title, test: function (v) { return v ? '' : '名称不能为空'; } })
      .then(function (v) {
        if (v == null) return;
        b.title = v;
        saveBankOrder();
        T('已改名');
        repaint();
      });
  }
  function editBank(id) {
    var b = bankOf(id); if (!b) return;
    if (typeof SS !== 'undefined') {
      SS.set('editing', b.id);
      SS.set('importText', JSON.stringify({ id: b.id, title: b.title, subtitle: b.subtitle, questions: b.questions }, null, 2));
    }
    if (typeof go === 'function') go('#/import');
  }
  function askDelBank(id) {
    var b = bankOf(id); if (!b) return;
    BFUI.confirm({
      title: '删除题库「' + b.title + '」？',
      html: '该题库的作答记录、收藏、自定义解析也会一起清掉，<b>不可恢复</b>。',
      okText: '删除', danger: true
    }).then(function (ok) {
      if (!ok) return;
      b.questions.forEach(function (q) {
        var k = kOf(b, q);
        delete ANS[k]; delete FAV[k]; delete NOTES[k];
        tombAdd('ans', k); tombAdd('fav', k); tombAdd('note', k);
      });
      if (typeof LOCAL !== 'undefined') LOCAL = LOCAL.filter(function (x) { return x.id !== b.id; });
      try { localStorage.removeItem('qbank.last.' + b.id); } catch (e) {}
      if (typeof invalidateBanks === 'function') invalidateBanks();
      try { if (typeof writeLS === 'function') writeLS('qbank.local.v2', LOCAL); } catch (e) {}
      if (typeof saveAns === 'function') saveAns();
      if (typeof saveFav === 'function') saveFav();
      if (typeof saveNotes === 'function') saveNotes();
      notifyFile();
      T('已删除');
      repaint();
    });
  }

  /* ---------- 批量动作 ---------- */
  function batPickDir(cid) {
    if (!BATCH) return;
    var ids = [cid].concat(descIds(cid));
    var n = 0;
    ids.forEach(function (d) {
      dirBanks(d).forEach(function (b) {
        if (b.paper || BATCH.sel[b.id]) return;
        BATCH.sel[b.id] = 1; n++;
      });
    });
    T(n ? ('已选中 ' + n + ' 个题库') : '这个目录里没有还没选的题库');
    repaint();
  }
  function askBatchMove() {
    if (!BATCH) return;
    var bs = batBanks(), cs = batCatList();
    if (!bs.length && !cs.length) { T('先选中要移动的题库 / 目录'); return; }
    /* 目标里排掉「选中的目录自己 + 它的子目录」，否则会把目录塞进自己里面 */
    var banned = {};
    cs.forEach(function (c) { banned[c.id] = 1; descIds(c.id).forEach(function (d) { banned[d] = 1; }); });
    var items = [{ value: '__ROOT__', label: '🏠 顶层（根目录）' }];
    catsAll().forEach(function (c) {
      if (banned[c.id]) return;
      items.push({ value: c.id, label: pathOf(c.id).map(TITLE).join(' › '), note: dirBanks(c.id).length + ' 个题库' });
    });
    var desc = bs.slice(0, 4).map(function (b) { return b.title; }).join('、')
      + (bs.length > 4 ? ' 等 ' + bs.length + ' 个题库' : '')
      + (cs.length ? (bs.length ? '、' : '') + cs.slice(0, 4).map(TITLE).join('、') + (cs.length > 4 ? ' 等 ' + cs.length + ' 个目录' : '') : '');
    BFUI.pick({ title: '把这些移动到…', desc: desc, items: items }).then(function (v) {
      if (v == null) return;
      var dir = v === '__ROOT__' ? null : v;
      var n = 0;
      bs.forEach(function (b) { if (moveBank(b.id, dir)) n++; });
      cs.forEach(function (c) { if (moveCat(c.id, dir)) n++; });
      saveBankOrder();
      try { saveCats(); } catch (e) {}
      BATCH = null;
      T('已移动 ' + n + ' 项到 ' + (dir ? pathOf(dir).map(TITLE).join(' › ') : '顶层'));
      repaint();
    });
  }
  function askBatchDel() {
    if (!BATCH) return;
    var bs = batBanks(), cs = batCatList();
    if (!bs.length && !cs.length) { T('先选中要删除的题库 / 目录'); return; }
    var dels = bs.filter(function (b) { return b.source === 'local'; });
    var skip = bs.length - dels.length;
    /* 目录只删【空目录】（没有子目录、也没直接挂题库）—— 避免“删个目录连题库一起没了”这种不可逆事故 */
    var cdels = cs.filter(function (c) { return !kids(c.id).length && !dirBanks(c.id).length; });
    var cskip = cs.length - cdels.length;
    if (!dels.length && !cdels.length) { T(skip ? '内置题库不能删除' : '选中的目录都不是空的（先清空里面再删）'); return; }
    var names = dels.slice(0, 8).map(function (b) { return E(b.title); }).join('、') + (dels.length > 8 ? ' 等 ' + dels.length + ' 个' : '');
    var cnames = cdels.slice(0, 8).map(function (c) { return E(TITLE(c)); }).join('、') + (cdels.length > 8 ? ' 等 ' + cdels.length + ' 个' : '');
    BFUI.confirm({
      title: '删除选中的 ' + dels.length + ' 个题库' + (cdels.length ? ' + ' + cdels.length + ' 个空目录' : '') + '？',
      html: (dels.length ? names + '<br>它们下面所有题目的作答记录、收藏、自定义解析也会一起清掉，' : '')
        + (cdels.length ? '目录：' + cnames + '<br>' : '')
        + '<b>不可恢复</b>。'
        + (skip || cskip ? '<div class="small muted" style="margin-top:6px">'
          + (skip ? '另有 ' + skip + ' 个内置题库会跳过（不能删）。' : '')
          + (cskip ? (skip ? ' ' : '') + '另有 ' + cskip + ' 个非空目录会跳过（先清空里面再删）。' : '')
          + '</div>' : ''),
      okText: '全部删除', danger: true
    }).then(function (ok) {
      if (!ok) return;
      var qn = 0;
      dels.forEach(function (b) {
        b.questions.forEach(function (q) {
          var k = kOf(b, q);
          delete ANS[k]; delete FAV[k]; delete NOTES[k];
          tombAdd('ans', k); tombAdd('fav', k); tombAdd('note', k);
          qn++;
        });
        if (typeof LOCAL !== 'undefined') LOCAL = LOCAL.filter(function (x) { return x.id !== b.id; });
        try { localStorage.removeItem('qbank.last.' + b.id); } catch (e) {}
      });
      /* 空目录删掉（只从分类表里摘掉；里面本来就是空的，没有子目录也没题库） */
      cdels.forEach(function (c) {
        for (var i = CAT.length - 1; i >= 0; i--) { if (CAT[i].id === c.id) CAT.splice(i, 1); }
      });
      try { saveCats(); } catch (e) {}
      if (typeof invalidateBanks === 'function') invalidateBanks();
      try { if (typeof writeLS === 'function') writeLS('qbank.local.v2', LOCAL); } catch (e) {}
      if (typeof saveAns === 'function') saveAns();
      if (typeof saveFav === 'function') saveFav();
      if (typeof saveNotes === 'function') saveNotes();
      notifyFile();
      BATCH = null;
      T('已删除 ' + dels.length + ' 个题库（' + qn + ' 题）' + (cdels.length ? ' + ' + cdels.length + ' 个空目录' : '') + (skip ? '，跳过 ' + skip + ' 个内置题库' : '') + (cskip ? '，跳过 ' + cskip + ' 个非空目录' : ''));
      repaint();
    });
  }
  function batchExport() {
    if (!BATCH) return;
    var bs = batBanks();
    if (!bs.length) { T('先点题库卡片选中要导出的题库'); return; }
    var raw = [], catIds = {}, qn = 0;
    bs.forEach(function (b) {
      qn += b.questions.length;
      raw.push({ id: b.id, title: b.title, subtitle: b.subtitle, source: b.source, cat: b.cat == null ? null : b.cat, ord: b.ord, questions: b.questions });
      pathOf(b.cat || null).forEach(function (c) { catIds[c.id] = 1; });
    });
    var catsOut = [];
    catsAll().forEach(function (c) { if (catIds[c.id]) catsOut.push({ id: c.id, title: c.title, parent: c.parent == null ? null : c.parent, order: +c.order || 0 }); });
    var tsTag = '';
    try { tsTag = (typeof stamp === 'function') ? stamp() : String(Date.now()); } catch (e) { tsTag = String(Date.now()); }
    if (typeof download !== 'function') { T('这个浏览器不支持直接保存文件'); return; }
    download('刷题站-题库-' + raw.length + '个-' + tsTag + '.json',
      JSON.stringify({ app: 'shuati', version: 2, exported: new Date().toISOString(), note: '刷题站·批量导出 ' + raw.length + ' 个题库', banks: raw, cats: catsOut, answers: {}, favs: {}, notes: {}, fixes: {}, papers: [] }),
      'application/json');
    T('已导出 ' + raw.length + ' 个题库（' + qn + ' 题）');
  }

  /* ---------- 拖拽 ---------- */
  /* 长按选中的那一刻会立刻重画，紧接着手指抬起产生的 click 会落在新节点上：
     用这个时间戳把「刚选中」的 600ms 内的点击忽略掉，免得一长按就跳进题库。 */
  var DRAG_AT = 0;
  function dragSticky() { return !!DRAG && (Date.now() - DRAG_AT) < 600; }
  function setDrag(d) { DRAG = d; DRAG_AT = Date.now(); }
  /* 卡片 → { kind:'bank'|'cat', id }。图标 / 列表 / 详细信息三种视图的字段名不一样，这里统一 */
  function cardRefOf(el) {
    if (!el || !el.dataset) return null;
    if (el.dataset.bank) return { kind: 'bank', id: el.dataset.bank };
    if (el.dataset.cat) return { kind: 'cat', id: el.dataset.cat };
    if (el.dataset.trow && el.classList && el.classList.contains('nb-ldir')) return { kind: 'cat', id: el.dataset.trow };
    return null;
  }
  /* 开始拖时带上「一批」：批量模式下拖一个已选中的条目 = 把选中的一起搬走 */
  function dragSet(ref) {
    var banks = [], cats = [];
    if (ref.kind === 'bank') banks = [ref.id]; else cats = [ref.id];
    var batch = false;
    if (BATCH) {
      var isSel = (ref.kind === 'bank' && batSel(ref.id)) || (ref.kind === 'cat' && batSelC(ref.id));
      if (isSel) {
        banks = Object.keys(BATCH.sel || {}).filter(function (x) { var b = bankOf(x); return !!(b && !b.paper); });
        cats = Object.keys(BATCH.cat || {}).filter(function (x) { return !!byId(x); });
        batch = true;
      }
    }
    return { type: ref.kind, id: ref.id, banks: banks, cats: cats, batch: batch };
  }
  function dragCount() { return DRAG ? ((DRAG.banks || []).length + (DRAG.cats || []).length) : 0; }
  /* 点空白处就取消选中，避免一直卡在移动模式（弹窗里点目标不算「点空白」，否则「放到这里」选完就失效） */
  document.addEventListener('click', function (e) {
    if (!DRAG) return;
    if (e.target.closest && (e.target.closest('.nb-card') || e.target.closest('[data-act]') || e.target.closest('.mask'))) return;
    DRAG = null;
    repaint();
  });
  /* ---------- 7.4 框选（拉方框批量选）：批量模式下，在空白处拖着拉出一个方框，
     框住哪个题库就选哪个（像 Windows 资源管理器 / 访达）。
     · 只在鼠标下生效（触屏还是滚动 / 长按，不抢手势）
     · 点在题/目录/按钮上不拉框，交给原来的点击选中
     · 默认【替换】当前选择；按住 Ctrl / ⌘ / Shift 是【追加】
     · 拉框过程中框到的先高亮预览（.nb-hit），松手才真的写进 BATCH.sel */
  function attachMarquee(host) {
    if (!BATCH) return;
    var box = host.querySelector('.nb-icons, .nb-list, .nb-details');
    if (!box || box.dataset.marq) return;
    box.dataset.marq = '1';
    var marq = null, sx = 0, sy = 0, additive = false, moved = false;

    function paint(clientX, clientY) {
      var x = Math.min(sx, clientX), y = Math.min(sy, clientY);
      var w = Math.abs(clientX - sx), h = Math.abs(clientY - sy);
      if (!moved && (w > 4 || h > 4)) { moved = true; document.body.classList.add('nbm'); }
      if (!moved) return;
      marq.style.left = x + 'px';
      marq.style.top = y + 'px';
      marq.style.width = w + 'px';
      marq.style.height = h + 'px';
      var r = { l: x, t: y, r: x + w, b: y + h };
      box.querySelectorAll('.nb-bank, .nb-dir, .nb-lbank, .nb-ldir, .nb-drow').forEach(function (el) {
        var b = el.getBoundingClientRect();
        el.classList.toggle('nb-hit', !(b.right < r.l || b.left > r.r || b.bottom < r.t || b.top > r.b));
      });
    }

    function finish() {
      if (!marq) return;
      if (marq.parentNode) marq.parentNode.removeChild(marq);
      marq = null;
      document.body.classList.remove('nbm');
      if (!moved) return;
      var hb = [], hc = [];
      box.querySelectorAll('.nb-hit').forEach(function (el) {
        el.classList.remove('nb-hit');
        var ref = cardRefOf(el);
        if (!ref) return;
        if (ref.kind === 'bank') hb.push(ref.id); else hc.push(ref.id);
      });
      if (!BATCH) return;
      if (!BATCH.cat) BATCH.cat = {};
      if (!additive) {
        Object.keys(BATCH.sel).forEach(function (k) { delete BATCH.sel[k]; });
        Object.keys(BATCH.cat).forEach(function (k) { delete BATCH.cat[k]; });
      }
      hb.forEach(function (id) { BATCH.sel[id] = 1; });
      hc.forEach(function (id) { BATCH.cat[id] = 1; });
      if (!hb.length && !hc.length) T('没框到东西');
      else T('框选了 ' + hb.length + ' 个题库' + (hc.length ? ' · ' + hc.length + ' 个目录' : '') + '（共 ' + batCount() + ' 个题库）');
      repaint();
    }

    box.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      var t = e.target;
      if (t.closest('[data-act]')) return;
      if (t.closest('.nb-bank, .nb-dir, .nb-lbank, .nb-ldir, .nb-drow')) return;
      sx = e.clientX; sy = e.clientY; moved = false;
      additive = !!(e.ctrlKey || e.metaKey || e.shiftKey);
      marq = document.createElement('div');
      marq.className = 'nb-marquee';
      document.body.appendChild(marq);
      try { box.setPointerCapture(e.pointerId); } catch (err) {}
    });
    box.addEventListener('pointermove', function (e) { if (marq) paint(e.clientX, e.clientY); });
    box.addEventListener('pointerup', finish);
    box.addEventListener('pointercancel', finish);
  }

  function attachDrag(host) {
    var cards = host.querySelectorAll('.nb-card[draggable="true"], .nb-icon[draggable="true"], .nb-lrow[draggable="true"], .nb-drow[draggable="true"]');
    cards.forEach(function (card) {
      var ref = cardRefOf(card);
      if (!ref) return;
      /* 桌面：HTML5 拖放 */
      card.addEventListener('dragstart', function (e) {
        setDrag(dragSet(ref));
        try { e.dataTransfer.setData('text/plain', ref.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
      /* 触摸：长按 350ms 进入移动模式（批量模式下只有已选中的条目能长按，免得误触） */
      var lp = null, sx = 0, sy = 0;
      card.addEventListener('pointerdown', function (e) {
        if (e.target.closest('[data-act]') || e.target.closest('input')) return;
        if (e.pointerType === 'mouse') return;
        if (BATCH && !((ref.kind === 'bank' && batSel(ref.id)) || (ref.kind === 'cat' && batSelC(ref.id)))) return;
        sx = e.clientX; sy = e.clientY;
        lp = setTimeout(function () {
          lp = null;
          setDrag(dragSet(ref));
          card.classList.add('dragging');
          if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) {} }
          T('已选中 ' + dragCount() + ' 项，点「放到这里」选目标目录');
          repaint();
        }, 350);
      });
      card.addEventListener('pointermove', function (e) {
        if (!lp) return;
        if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) { clearTimeout(lp); lp = null; }
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
        card.addEventListener(ev, function () { if (lp) { clearTimeout(lp); lp = null; } });
      });
    });
    /* 拖动时的高亮与放下：题库 / 目录 / 面包屑都算「目标」——
       拖到目录上 = 放进那个目录，拖到题库上 = 放进它所在的目录，拖到面包屑 = 放进那一层 */
    host.querySelectorAll('.nb-card, .nb-icon, .nb-lrow, .nb-drow, .nb-crumb').forEach(function (el) {
      if (el.__nbDropBound) return;
      el.__nbDropBound = true;
      el.addEventListener('dragover', function (e) {
        if (!DRAG || targetDirOf(el) === undefined) return;
        e.preventDefault();
        el.classList.add('drop-tgt');
      });
      el.addEventListener('dragleave', function () { el.classList.remove('drop-tgt'); });
      el.addEventListener('drop', function (e) {
        el.classList.remove('drop-tgt');
        if (!DRAG) return;
        var dir = targetDirOf(el);
        if (dir === undefined) return;
        e.preventDefault();
        e.stopPropagation();
        dropInto(dir);
      });
    });
    /* 空白处放下 = 移到当前目录 */
    if (!host._nbDropBound) {
      host._nbDropBound = true;
      host.addEventListener('dragover', function (e) { if (DRAG) e.preventDefault(); });
      host.addEventListener('drop', function (e) {
        if (!DRAG) return;
        e.preventDefault();
        dropInto(CUR);
      });
    }
  }
  /* 这个元素能当放置目标吗：返回目录 id（null = 顶层），undefined = 不是目标 */
  function targetDirOf(el) {
    if (!el || !el.dataset) return undefined;
    if (el.classList && el.classList.contains('nb-crumb')) return el.dataset.crumb || null;
    var ref = cardRefOf(el);
    if (!ref) return undefined;
    if (ref.kind === 'cat') return ref.id;
    var b = bankOf(ref.id);
    return (b && b.cat) || null;
  }
  function dropInto(dir) {
    if (!DRAG) return;
    var banks = (DRAG.banks || []).slice(), cats = (DRAG.cats || []).slice();
    if (!banks.length && !cats.length && DRAG.id) {
      if (DRAG.type === 'cat') cats = [DRAG.id]; else banks = [DRAG.id];
    }
    var n = 0, blocked = 0;
    banks.forEach(function (bid) { try { if (moveBank(bid, dir)) n++; } catch (e) {} });
    cats.forEach(function (cid) { try { if (moveCat(cid, dir)) n++; else blocked++; } catch (e) { blocked++; } });
    var batch = !!DRAG.batch;
    DRAG = null;
    LOCK = false;
    if (!n) { T(blocked ? '不能把目录移动到它自己的子目录里' : '没有可移动的项目'); repaint(); return; }
    saveBankOrder();
    if (batch && BATCH) { BATCH.sel = {}; if (BATCH.cat) BATCH.cat = {}; }
    T('已移动 ' + n + ' 项到 ' + (dir ? pathOf(dir).map(TITLE).join(' › ') : '顶层'));
    saveCats();
  }

  /* ---------- 点击顶栏「刷题站」回根目录 ---------- */
  function hookHome() {
    if (hookHome._done) return;
    hookHome._done = true;
    var t = document.getElementById('appTitle');
    if (t && !t._nbHome) {
      t._nbHome = true;
      t.addEventListener('click', function () { CUR = null; QUERY = ''; DRAG = null; });
    }
    var btn = document.getElementById('btnHome');
    if (btn && !btn._nbHome) {
      btn._nbHome = true;
      btn.addEventListener('click', function () { CUR = null; QUERY = ''; DRAG = null; });
    }
  }

  /* ---------- 空目录清理（批量导入后顺手用） ---------- */
  /* 空目录 = 自己以及所有子目录里，一个题库都没有 */
  function emptyDirIds() {
    ensure();
    var all = bankList();
    return CAT.filter(function (c) {
      var ids = [c.id].concat(descIds(c.id));
      return !all.some(function (b) { return ids.indexOf(b.cat) >= 0; });
    }).map(function (c) { return c.id; });
  }
  /* 真正删掉这些目录节点（里面的题库本来就没有），返回删掉的目录数 */
  function deleteDirs(ids) {
    ensure();
    if (!ids || !ids.length) return 0;
    var set = {};
    ids.forEach(function (x) { set[x] = 1; });
    var n = CAT.filter(function (c) { return set[c.id]; }).length;
    CAT = CAT.filter(function (c) { return !set[c.id]; });
    if (CUR && set[CUR]) CUR = null;
    saveCats();
    try { invalidateBanks(); } catch (e) {}
    notifyFile();
    try { if (typeof window.render === 'function') window.render(); } catch (e) {}
    return n;
  }
  function askDelEmpty(silentWhenNone) {
    var ids = emptyDirIds();
    if (!ids.length) { if (!silentWhenNone) T('没有空目录，每个目录里都有题库。'); return Promise.resolve(0); }
    return BFUI.confirm({
      title: '清掉 ' + ids.length + ' 个空目录？',
      html: '这些目录（含它们下面的空子目录）里一个题库都没有，删掉不会动到任何题目、作答记录和收藏。',
      okText: '清掉空目录',
      danger: true
    }).then(function (ok) {
      if (!ok) return 0;
      var n = deleteDirs(ids);
      T('已清掉 ' + n + ' 个空目录');
      return n;
    });
  }

  /* ---------- 题目管理页（#/qlist/<题库id>）：一张张读题、勾选批量删题 ----------
     入口：题库卡片「⋯」菜单 →「🗂 题目管理：看题 / 删题」。
     只对自建题库开放删除（内置题库是只读文件）；删除走 app.js 的 delBankQuestion()，
     作答 / 收藏 / 解析 / 标签会一起清干净。 */
  var QL = null;                          // { bankId, sel:{题号:1}, q:'' }
  function qlIsLocal(bankId) {
    try { return !!(typeof LOCAL !== 'undefined' && Array.isArray(LOCAL) && LOCAL.some(function (x) { return x && x.id === bankId; })); }
    catch (e) { return false; }
  }
  function qlistRender(bankId) {
    var view = document.getElementById('view');
    if (!view) return;
    var bank = bankOf(bankId);
    var appT = document.getElementById('appTitle');
    if (appT) appT.textContent = bank ? ('题目管理 · ' + bank.title) : '题目管理';
    if (!QL || QL.bankId !== bankId) QL = { bankId: bankId, sel: {}, q: '' };
    if (!bank) {
      view.innerHTML = '<div class="card"><div class="empty">找不到这个题库（可能已经被删掉了）。</div>'
        + '<div class="actions" style="margin-top:10px"><button class="btn" id="qlBack">‹ 回题库列表</button></div></div>';
      var bb0 = document.getElementById('qlBack');
      if (bb0) bb0.onclick = function () { if (typeof go === 'function') go('#/'); };
      return;
    }
    var local = qlIsLocal(bankId);
    view.innerHTML = ''
      + '<div class="card ql-head">'
      +   '<div class="ql-top">'
      +     '<button class="btn small" id="qlBack" title="回题库列表">‹ 返回</button>'
      +     '<button class="btn small" id="qlStart" title="直接开始刷这个题库">开始刷题</button>'
      +     '<span class="spacer-grow"></span>'
      +     '<span class="small muted">' + (local ? '自建题库' : '内置题库（只读，不能删题）') + '</span>'
      +   '</div>'
      +   '<h2 class="ql-title">' + E(bank.title) + '</h2>'
      +   '<div class="small muted ql-sub" id="qlSub"></div>'
      +   (local ? '<div class="ql-hint small muted">一张张读：<b>点卡片左上角的方框（或卡片顶行）选中</b>不要的题，再点「删除选中」；也可以点每张卡片右上角的「删除」单独删。删除会连这道题的作答记录、收藏、解析一起清掉，不可恢复。</div>' : '')
      + '</div>'
      + '<div class="card ql-bar">'
      +   '<input id="qlSearch" class="nb-search" type="search" placeholder="在题干 / 选项 / 解析里搜（比如某个关键词）" value="' + E(QL.q) + '">'
      +   (local
            ? '<button class="btn small" data-ql="selAll">全选（筛出来的）</button>'
              + '<button class="btn small" data-ql="selInv">反选</button>'
              + '<button class="btn small" data-ql="selNone">清空选择</button>'
              + '<button class="btn small danger" data-ql="delSel">删除选中</button>'
            : '')
      +   '<span class="spacer-grow"></span>'
      +   '<span class="small muted" id="qlCnt"></span>'
      + '</div>'
      + '<div id="qlBody"></div>';
    var back = document.getElementById('qlBack');
    if (back) back.onclick = function () { if (typeof go === 'function') go('#/'); };
    var st = document.getElementById('qlStart');
    if (st) st.onclick = function () { startBankWrapped(bankId); };
    var search = document.getElementById('qlSearch');
    if (search) {
      search.addEventListener('input', function () {
        QL.q = search.value;
        clearTimeout(qlistRender._t);
        qlistRender._t = setTimeout(function () { qlPaint(); }, 200);
      });
      search.addEventListener('keydown', function (e) { if (e.key === 'Enter') { QL.q = search.value; qlPaint(); } });
    }
    view.querySelectorAll('[data-ql]').forEach(function (el) {
      el.onclick = function () {
        var act = el.dataset.ql;
        if (act === 'selAll') { qlListed().forEach(function (it) { QL.sel[it.q.id] = 1; }); qlPaint(); }
        else if (act === 'selNone') { QL.sel = {}; qlPaint(); }
        else if (act === 'selInv') { qlListed().forEach(function (it) { if (QL.sel[it.q.id]) delete QL.sel[it.q.id]; else QL.sel[it.q.id] = 1; }); qlPaint(); }
        else if (act === 'delSel') qlDelSelection();
      };
    });
    qlPaint();
  }
  /* 列表：按搜索词过滤后的 [{ q, i }]（i = 在题库里的原下标） */
  function qlListed() {
    var bank = bankOf(QL.bankId);
    if (!bank) return [];
    var needle = (QL.q || '').trim().toLowerCase();
    var out = [];
    bank.questions.forEach(function (q, i) {
      if (needle) {
        var hay = (String(q.stem || '') + ' ' + (q.options || []).join(' ') + ' ' + String(q.explain || '')).toLowerCase();
        if (hay.indexOf(needle) < 0) return;
      }
      out.push({ q: q, i: i });
    });
    return out;
  }
  function qlPaint() {
    var bank = bankOf(QL.bankId);
    var box = document.getElementById('qlBody');
    if (!bank || !box) return;
    var local = qlIsLocal(QL.bankId);
    var listed = qlListed();
    var sub = document.getElementById('qlSub');
    if (sub) {
      var s = bankStat(bank);
      var crumb = pathOf(bank.cat || null).map(TITLE).join(' › ');
      sub.innerHTML = (crumb ? '位置：' + E(crumb) + '　·　' : '')
        + '共 <b>' + bank.questions.length + '</b> 题　已答 ' + s.done + (s.wr ? '　<span class="warn">错题 ' + s.wr + '</span>' : '')
        + (listed.length !== bank.questions.length ? '　·　筛出 ' + listed.length + ' 题' : '');
    }
    var cnt = document.getElementById('qlCnt');
    var selN = Object.keys(QL.sel).length;
    if (cnt) cnt.innerHTML = selN ? ('已选 <b>' + selN + '</b> 题') : (local ? '勾选题目后可批量删除' : '只读浏览');
    box.innerHTML = listed.length
      ? listed.map(function (it) { return qlCardHtml(bank, it.q, it.i, local); }).join('')
      : '<div class="card"><div class="empty">' + (bank.questions.length ? '没有匹配的题目，换个关键词试试。' : '这个题库已经空了。') + '</div></div>';
    /* 每张卡片的交互：顶行 / 方框 = 选中；「删除」= 单独删 */
    box.querySelectorAll('.ql-card').forEach(function (card) {
      var i = +card.dataset.qi;
      card.querySelectorAll('[data-ql="pick"]').forEach(function (el) {
        el.onclick = function (e) {
          e.stopPropagation();
          var q = bank.questions[i];
          if (!q) return;
          if (QL.sel[q.id]) delete QL.sel[q.id]; else QL.sel[q.id] = 1;
          qlPaint();
        };
      });
      card.querySelectorAll('[data-ql="del1"]').forEach(function (el) {
        el.onclick = function (e) {
          e.stopPropagation();
          var q = bank.questions[i];
          if (!q) return;
          qlAskDel([q.id]);
        };
      });
    });
  }
  function qlCardHtml(bank, q, i, local) {
    var k = kOf(bank, q);
    var rec = (typeof ANS !== 'undefined' && ANS) ? ANS[k] : null;
    var ans = [];
    try { ans = ansOf(k, q) || []; } catch (e) { ans = q.answer || []; }
    var on = !!QL.sel[q.id];
    var picked = (rec && !rec.redo && rec.sel) ? rec.sel : [];
    var opts = (q.options || []).map(function (t, j) {
      var K = 'ABCDEFGH'[j];
      var right = ans.indexOf(K) >= 0;
      var wrong = !right && picked.indexOf(K) >= 0;
      var txt = (typeof optText === 'function') ? optText(t, K) : t;
      return '<div class="ql-opt' + (right ? ' right' : '') + (wrong ? ' wrong' : '') + '"><b>' + K + '</b><span>' + E(txt) + '</span></div>';
    }).join('');
    var expText = '';
    try { expText = (typeof explainOf === 'function') ? explainOf(k, q) : String(q.explain || ''); } catch (e) { expText = String(q.explain || ''); }
    return '<div class="ql-card' + (on ? ' on' : '') + '" data-qi="' + i + '">'
      + '<div class="ql-ctop" data-ql="pick" title="' + (local ? '点这里选中 / 取消' : '') + '">'
      + (local ? '<span class="ql-box' + (on ? ' on' : '') + '" aria-hidden="true"></span>' : '')
      + '<span class="ql-no">第 ' + ((typeof qNo === 'function') ? qNo(q, bank.questions) : (i + 1)) + ' 题</span>'
      + '<span class="tag">' + ((typeof typeLabel === 'function') ? typeLabel(q, ans) : '') + '</span>'
      + (rec && !rec.redo ? '<span class="tag g">已答 ' + (rec.tries || 1) + ' 次 · 错 ' + (rec.wrong || 0) + ' 次</span>' : '')
      + (rec && !rec.redo ? '<span class="tag ' + (rec.ok ? 'g' : 'r') + '">你选 ' + (((rec.sel || []).join('')) || '—') + '</span>' : '')
      + '<span class="spacer-grow"></span>'
      + '<span class="ql-ans">答案 <b>' + (ans.join('') || '—') + '</b></span>'
      + (local ? '<button class="btn tiny danger" data-ql="del1" title="只删这一题">删除</button>' : '')
      + '</div>'
      + (q.groupTitle ? '<div class="ql-group"><b>' + E(q.groupTitle) + '：</b>' : '')
      + (q.group ? ((q.groupTitle ? '' : '<div class="ql-group"><b>共用题干：</b>') + E(q.group) + '</div>') : (q.groupTitle ? '</div>' : ''))
      + '<div class="ql-stem">' + E(q.stem) + '</div>'
      + (opts ? '<div class="ql-opts">' + opts + '</div>' : '')
      + (expText ? '<details class="ql-exp"><summary>看解析</summary><div class="ql-exp-body">'
          + ((typeof renderRich === 'function') ? renderRich(k, expText) : E(expText)) + '</div></details>' : '')
      + '</div>';
  }
  function qlAskDel(qids) {
    var bank = bankOf(QL.bankId);
    if (!bank || !qids.length) return;
    if (typeof delBankQuestion !== 'function') { T('删除功能没加载（app.js）'); return; }
    BFUI.confirm({
      title: qids.length > 1 ? ('删除选中的 ' + qids.length + ' 道题？') : '删除这道题？',
      html: '从题库「' + E(bank.title) + '」里移除 ' + qids.length + ' 道题。<br>它们的作答记录、收藏、解析（含 AI 解析、参考资料）、标签会一起清掉，<b>不可恢复</b>。',
      okText: '删除', danger: true
    }).then(function (ok) {
      if (!ok) return;
      var n = 0;
      qids.forEach(function (qid) {
        var r = delBankQuestion(QL.bankId, qid);
        if (r && r.ok) { delete QL.sel[qid]; n++; }
      });
      T(n ? ('已删除 ' + n + ' 道题' + (n < qids.length ? '（有 ' + (qids.length - n) + ' 道已经不在了）' : '')) : '没有删掉任何题');
      qlPaint();
    });
  }
  function qlDelSelection() {
    var ids = Object.keys(QL.sel);
    if (!ids.length) { T('先点题目卡片选中要删的题'); return; }
    qlAskDel(ids);
  }

  /* ---------- 对外接口 ---------- */
  window.CAT = {
    KEY: CAT_KEY,
    all: catsAll,
    kids: kids,
    get: byId,
    path: pathOf,
    descIds: descIds,
    dirBanks: dirBanks,
    cur: function () { return CUR; },
    setCur: function (id) { CUR = id || null; CUR_SET = true; },
    create: createCat,
    importCats: importCats,
    rename: renameCat,
    move: moveCat,
    moveBank: moveBank,
    save: saveCats,
    bankStat: bankStat,
    subStat: subStat,
    renderHook: catRenderHook,
    qlistRender: qlistRender,
    qlist: function () { return QL; },
    treeHtml: treeHtml,
    render: repaint,
    reload: function () { try { CAT = null; ensure(); hookHome(); } catch (e) {} },
    batch: function () { return BATCH ? { n: batCount(), ids: Object.keys(BATCH.sel) } : null; },
    visibleBanks: visibleBanks,
    openDir: openDir,
    menu: catMenu,              // 目录「⋯」菜单（测试/自动化用）
    delDeep: askDelCatDeep,     // 删除目录并连里面的题库一起删
    emptyDirs: emptyDirIds,     // 空目录 id 列表
    delEmpty: deleteDirs,       // 直接删掉这些空目录（返回删掉数）
    cleanEmpty: askDelEmpty     // 带确认框的空目录清理
  };
})();
