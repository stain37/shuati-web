/* ============================================================
   scheme.js —— 多方案（同一批题库，换一套文件夹方案）
   ------------------------------------------------------------
   存的东西：
     qbank.schemes.v1      = { list:[{id,name}], data:{ sid:{ cats:[…] } } }
     qbank.scheme.cur.v1   = 'default' | 'sc…'
     qbank.schemes.map.v1  = { sid: { bankId: catId | '' } }
     qbank.cats.v1         —— 默认方案的树继续镜像写这里（旧备份、旧代码、探针都还能读）

   规矩：
     · 默认方案 id 恒为 'default'，它的树就是 qbank.cats.v1
     · 每个方案的「题库 → 目录」归属存在 map 里；b.cat 只是**当前方案的运行时视图**
     · 每次 cat.js 保存分类（saveCats）都会调 setCats()，顺手把当前方案整张 map 对齐一遍，
       所以像「拖进目录」「删目录后上移」这些直接改 b.cat 的路径也不会漏
     · 写回题库文件/本机文件时要用 catForStore()（永远取默认方案的值），
       否则在 B 方案里保存会把默认方案的位置污染掉
   ============================================================ */
(function () {
  'use strict';

  var K_SCH = 'qbank.schemes.v1';
  var K_CUR = 'qbank.scheme.cur.v1';
  var K_MAP = 'qbank.schemes.map.v1';
  var K_CATS = 'qbank.cats.v1';
  var DEF = 'default';

  var DB = null, MAP = {}, CUR = DEF, LOADED = false;

  function lsRaw(k, d) {
    try { var s = localStorage.getItem(k); return s == null ? d : JSON.parse(s); } catch (e) { return d; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function uid() { return 'sc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function banks() { try { return (typeof baseBanks === 'function') ? (baseBanks() || []) : []; } catch (e) { return []; } }
  function trim(s) { return String(s == null ? '' : s).trim().slice(0, 24); }

  function normDb() {
    if (!DB || typeof DB !== 'object') DB = {};
    if (!Array.isArray(DB.list)) DB.list = [];
    if (!DB.data || typeof DB.data !== 'object') DB.data = {};
    if (!DB.list.some(function (s) { return s && s.id === DEF; })) DB.list.unshift({ id: DEF, name: '默认方案' });
    DB.list.forEach(function (s) {
      if (!s || !s.id) return;
      if (!DB.data[s.id] || typeof DB.data[s.id] !== 'object') DB.data[s.id] = { cats: [] };
      if (!Array.isArray(DB.data[s.id].cats)) DB.data[s.id].cats = [];
    });
    Object.keys(DB.data).forEach(function (sid) {
      if (!DB.data[sid] || typeof DB.data[sid] !== 'object') DB.data[sid] = { cats: [] };
      if (!Array.isArray(DB.data[sid].cats)) DB.data[sid].cats = [];
    });
  }

  function load() {
    DB = lsRaw(K_SCH, null);
    MAP = lsRaw(K_MAP, null);
    if (!MAP || typeof MAP !== 'object' || Array.isArray(MAP)) MAP = {};
    normDb();
    /* 默认方案的树：DB 里没有就从老 key 捞一次 */
    if (!DB.data[DEF].cats.length) {
      var old = lsRaw(K_CATS, null);
      if (Array.isArray(old) && old.length) DB.data[DEF].cats = old;
    }
    /* 默认方案的归属：没有就按现有 b.cat 拍一张快照 */
    if (!MAP[DEF] || typeof MAP[DEF] !== 'object') {
      MAP[DEF] = {};
      banks().forEach(function (b) { if (b && b.id) MAP[DEF][b.id] = b.cat || ''; });
    }
    var c = null;
    try { c = localStorage.getItem(K_CUR); } catch (e) {}
    CUR = (c && DB.data[c]) ? c : DEF;
    LOADED = true;
    save();
  }
  function ensure() { if (!LOADED) load(); }
  function save() {
    lsSet(K_SCH, DB);
    lsSet(K_MAP, MAP);
    try { localStorage.setItem(K_CUR, CUR); } catch (e) {}
    if (CUR === DEF) lsSet(K_CATS, DB.data[DEF].cats);
  }

  /* ---------- 树 ---------- */
  function cats() {
    ensure();
    if (CUR === DEF) {
      /* 默认方案直接读老 key 的最新值，万一有别的脚本/旧代码写它 */
      var v = lsRaw(K_CATS, null);
      if (Array.isArray(v)) { DB.data[DEF].cats = v; }
    }
    return (DB.data[CUR] && DB.data[CUR].cats) || [];
  }
  /* 「真实题库树」= 默认方案（DEF）的目录树。
     考点方案只是标签视图，不是题库目录树：首页 / 题库管理器永远按这棵树显示，
     免得考点文件夹被当成题库分类混进管理器。 */
  function plainCats() {
    ensure();
    if (!DB.data[DEF]) DB.data[DEF] = { cats: [] };
    var v = lsRaw(K_CATS, null);
    if (Array.isArray(v)) DB.data[DEF].cats = v;
    return (DB.data[DEF] && DB.data[DEF].cats) || [];
  }
  /* cat.js 的 saveCats() 会调这里：落树 + 对齐当前方案的归属 */
  function setCats(list) {
    ensure();
    if (!DB.data[CUR]) DB.data[CUR] = { cats: [] };
    DB.data[CUR].cats = Array.isArray(list) ? list : [];
    snapshot(CUR);
    save();
  }
  /* 把当前内存里的 b.cat 记进某个方案的 map（保存分类 / 切走之前各调一次） */
  function snapshot(sid) {
    if (!MAP[sid] || typeof MAP[sid] !== 'object') MAP[sid] = {};
    var m = MAP[sid];
    banks().forEach(function (b) {
      if (!b || !b.id) return;
      if (b.cat) m[b.id] = b.cat; else delete m[b.id];
    });
  }

  /* ---------- 归属 ---------- */
  function catOf(bankId) {
    ensure();
    var m = MAP[CUR] || {};
    return m[bankId] || '';
  }
  /* 写回磁盘用：永远给默认方案的归属 */
  function catForStore(bankId) {
    ensure();
    var m = MAP[DEF] || {};
    return m[bankId] || '';
  }
  function setCatOf(bankId, catId, sid) {
    ensure();
    var id = sid || CUR;
    if (!MAP[id] || typeof MAP[id] !== 'object') MAP[id] = {};
    if (catId) MAP[id][bankId] = catId; else delete MAP[id][bankId];
    save();
  }
  /* 把当前方案铺到每个 bank 对象上 */
  function apply() {
    ensure();
    var m = MAP[CUR] || {};
    var changed = 0;
    banks().forEach(function (b) {
      if (!b || !b.id) return;
      var want = m[b.id] || '';
      if (CUR === DEF && !want && b.cat) { m[b.id] = b.cat; want = b.cat; }  /* 新题库还没进表 */
      if ((b.cat || '') !== want) { b.cat = want || null; changed++; }
    });
    try { if (typeof invalidateBanks === 'function') invalidateBanks(); } catch (e) {}
    return changed;
  }

  /* ---------- 方案清单 ---------- */
  function list() { ensure(); return DB.list.map(function (s) { return { id: s.id, name: s.name }; }); }
  function current() { ensure(); return CUR; }
  function curName() {
    ensure();
    var s = DB.list.filter(function (x) { return x.id === CUR; })[0];
    return s ? s.name : CUR;
  }
  function has(id) { ensure(); return !!DB.data[id]; }

  function create(name, fromId) {
    ensure();
    var nm = trim(name) || ('方案 ' + (DB.list.length + 1));
    var id = uid();
    DB.list.push({ id: id, name: nm });
    /* 复制来源方案的文件夹树：默认方案的实时树在 qbank.cats.v1 里，
       DB.data['default'].cats 可能还是空的（只有 catsOf() 被调用过才同步） */
    var srcTree = null;
    if (fromId) {
      if (fromId === DEF) {
        var live = lsRaw(K_CATS, null);
        srcTree = Array.isArray(live) ? live : (DB.data[DEF] ? DB.data[DEF].cats : null);
      } else if (DB.data[fromId]) {
        srcTree = DB.data[fromId].cats;
      }
    }
    DB.data[id] = { cats: srcTree ? JSON.parse(JSON.stringify(srcTree)) : [] };
    /* 归属：来源方案还没拍过快照时，先按当前 b.cat 现拍一张 */
    if (fromId) {
      if (!MAP[fromId] || typeof MAP[fromId] !== 'object') {
        MAP[fromId] = {};
        if (fromId === CUR) banks().forEach(function (b) { if (b && b.id) MAP[fromId][b.id] = b.cat || ''; });
      }
      MAP[id] = JSON.parse(JSON.stringify(MAP[fromId] || {}));
    } else {
      MAP[id] = {};
    }
    save();
    return id;
  }
  function rename(id, name) {
    ensure();
    var nm = trim(name);
    if (!nm) return false;
    DB.list.forEach(function (s) { if (s.id === id) s.name = nm; });
    save();
    return true;
  }
  function remove(id) {
    ensure();
    if (id === DEF) return false;
    DB.list = DB.list.filter(function (s) { return s.id !== id; });
    delete DB.data[id]; delete MAP[id];
    if (CUR === id) { CUR = DEF; apply(); }
    save();
    return true;
  }
  function switchTo(id) {
    ensure();
    if (!DB.data[id] || id === CUR) return false;
    snapshot(CUR);                       /* 先把当前视图记进当前方案 */
    CUR = id;
    save();
    if (tagMode(CUR)) syncTagTree(CUR);  /* 新打的小标签：方案里自动补文件夹 */
    apply();
    try { if (typeof window.dropTagBankCache === 'function') window.dropTagBankCache(); } catch (e) {}
    return true;
  }

  /* ---------- 导出 / 导入（文件夹群组方案） ----------
     文件格式（.scheme.json）：
       {
         "app": "shuati-web", "kind": "scheme", "v": 1,
         "exportedAt": "2026-11-08T12:00:00.000Z",
         "name": "方案名",
         "cats":  [{ "id": "c...", "title": "内科", "parent": null, "order": 1 }],
         "banks": { "pth2": "c...", "pth": "" },
         "bankTitles": { "pth2": "阑尾炎长链题" }
       }
     banks 里是「题库 id → 文件夹 id（空串＝顶层）」；bankTitles 只是给人看 + 导入时按标题兜底。 */
  function exportCur() {
    ensure();
    var m = MAP[CUR] || {};
    var banks0 = banks();
    var mine = {}, titles = {};
    banks0.forEach(function (b) {
      if (!b || !b.id) return;
      var c = m[b.id] || '';
      if (CUR === DEF && !c && b.cat) c = b.cat;
      mine[b.id] = c || '';
      titles[b.id] = String(b.title || b.name || '').slice(0, 60);
    });
    return {
      app: 'shuati-web', kind: 'scheme', v: 1,
      exportedAt: new Date().toISOString(),
      name: curName(),
      cats: JSON.parse(JSON.stringify(cats() || [])),
      banks: mine,
      bankTitles: titles
    };
  }

  /* 导入：返回 { id, name, cats, banks, matched, dropped } 或 { error } */
  function importData(obj, asName) {
    ensure();
    if (!obj || typeof obj !== 'object') return { error: '文件内容不是方案 JSON' };
    var catsIn = Array.isArray(obj.cats) ? obj.cats : (Array.isArray((obj.scheme || {}).cats) ? obj.scheme.cats : null);
    var banksIn = (obj.banks && typeof obj.banks === 'object') ? obj.banks
      : (obj.scheme && obj.scheme.banks && typeof obj.scheme.banks === 'object') ? obj.scheme.banks : null;
    if (!catsIn && !banksIn) return { error: '文件里没有 cats / banks 字段，不是方案文件' };

    var nm = trim(asName || obj.name || '导入的方案') || '导入的方案';
    var names = DB.list.map(function (s) { return s.name; });
    var nm2 = nm, k = 2;
    while (names.indexOf(nm2) >= 0) { nm2 = nm + '（导入 ' + k + '）'; k++; }

    var id = uid();
    /* 文件夹树：保留 id，父节点缺失就改成顶层 */
    var tree = (catsIn || []).map(function (c, i) {
      return { id: String(c && c.id || ('c' + i)), title: String((c && (c.title || c.name)) || '未命名'),
               parent: c && c.parent != null ? String(c.parent) : null,
               order: c && c.order != null ? (+c.order || 0) : i };
    }).filter(function (c) { return c.id && c.title; });
    var has = {};
    tree.forEach(function (c) { has[c.id] = 1; });
    tree.forEach(function (c) { if (c.parent && !has[c.parent]) c.parent = null; });

    /* 题库归属：先按 id，再按标题兜底 */
    var map = {}, matched = 0, dropped = 0;
    var banks0 = banks();
    var byId = {}, byTitle = {};
    banks0.forEach(function (b) {
      if (!b || !b.id) return;
      byId[b.id] = b;
      var t = String(b.title || b.name || '').trim();
      if (t && !byTitle[t]) byTitle[t] = b;
    });
    var titles = obj.bankTitles || {};
    Object.keys(banksIn || {}).forEach(function (bid) {
      var cat = String(banksIn[bid] == null ? '' : banksIn[bid]);
      var b = byId[bid] || (titles[bid] ? byTitle[String(titles[bid])] : null) || byTitle[String(bid)];
      if (!b) { dropped++; return; }
      if (cat && !has[cat]) cat = '';
      if (cat) map[b.id] = cat;
      matched++;
    });

    DB.list.push({ id: id, name: nm2 });
    DB.data[id] = { cats: tree };
    MAP[id] = map;
    save();
    return { id: id, name: nm2, cats: tree.length, banks: matched, dropped: dropped };
  }

  /* 这个题库还出现在哪些方案里（侧栏角标用） */
  function schemesOfBank(bankId) {
    ensure();
    var out = [];
    DB.list.forEach(function (s) {
      var m = MAP[s.id] || {};
      var cat = m[bankId] || '';
      if (!cat && s.id === DEF) {
        var b = banks().filter(function (x) { return x && x.id === bankId; })[0];
        if (b && b.cat) cat = b.cat;
      }
      if (cat) out.push({ id: s.id, name: s.name, cat: cat });
    });
    return out;
  }

  function raw() { ensure(); return { schemes: DB, map: MAP, cur: CUR }; }
  function adopt() { ensure(); snapshot(CUR); apply(); save(); }

  /* ============================================================
     按小知识点标签自动建方案（不靠 AI）
     ------------------------------------------------------------
     · 方案带 mode:'tag'，它的文件夹＝题目身上现有的**小标签**（不含七大基本标签）
     · 每个文件夹里放一个「虚拟题集」，id = 'tg:' + 标签；题目引用原题库的原题，
       作答 / 收藏 / 复习都记在原题上（app.js 的 kOf 用 q._bank 还原键）
     · 没有小标签的题不进任何文件夹（用户要求：不分类）
     · 一道题多个标签 → 出现在多个文件夹里（引用，不是复制）
     · 标签是现读现算的：以后打了新标签，切回方案时会自动补文件夹
     ============================================================ */
  function tagMode(sid) {
    ensure();
    var id = sid || CUR;
    var s = DB.list.filter(function (x) { return x && x.id === id; })[0];
    return !!(s && s.mode === 'tag');
  }
  function tgBankId(tag) { return 'tg:' + encodeURIComponent(String(tag)); }
  function tgCatId(tag) { return 'tgcat:' + encodeURIComponent(String(tag)); }
  function basicSet() {
    var out = {};
    try {
      var b = (window.TAGS && TAGS.basic) ? TAGS.basic() : [];
      (b || []).forEach(function (t) { out[String(t)] = 1; });
    } catch (e) {}
    return out;
  }
  function tagsOfQ(bank, q) {
    var k = bank.id + '#' + q.id;
    var ts = [];
    try { if (window.TAGS && TAGS.of) ts = TAGS.of(k) || []; } catch (e) { ts = []; }
    if (!ts.length && q && q.tags && q.tags.length) ts = q.tags;
    return ts.map(function (t) { return String(t || '').trim(); }).filter(Boolean);
  }
  /* 垃圾标签：日期（2026-11-09 / 2026年11月9日）、纯数字/标点、太长的一段话 */
  var JUNK_TAG = /^[\d\s\-\/.:：年月日号]+$|^\d{4}\s*[-\/.年]\s*\d{1,2}/;
  function isJunkTag(t) {
    var s = String(t || '').trim();
    if (!s) return true;
    if (s.length > 14) return true;
    if (JUNK_TAG.test(s)) return true;
    return false;
  }
  /* 这道题属于哪个大标签（取标签里第一个基本标签） */
  function bigOfQ(bank, q) {
    var basic = basicSet();
    var ts = tagsOfQ(bank, q);
    for (var i = 0; i < ts.length; i++) if (basic[ts[i]]) return ts[i];
    return '';
  }
  /* ---- 标签倒排索引：一次扫描，全部标签共用；标签改了 / 题库变了才重建 ----
     以前 smallTags() 全库扫一遍、tagBankOf() 每个标签再全库扫一遍，
     标签一多就是 O(标签数 x 题数)，第一次进方案会直接卡死。 ---- */
  var TG_IDX = { sig: '', byTag: null, list: null, banks: null };
  function banksSig() {
    var n = 0, q = 0;
    banks().forEach(function (b) { if (b && b.id) { n++; q += (b.questions || []).length; } });
    return n + ':' + q + ':' + (window.__TAGS_REV || 0);
  }
  function tagIndex() {
    ensure();
    var sig = banksSig();
    if (TG_IDX.byTag && TG_IDX.sig === sig) return TG_IDX;
    var basic = basicSet(), byTag = Object.create(null);
    banks().forEach(function (b) {
      if (!b || !b.id || !Array.isArray(b.questions)) return;
      b.questions.forEach(function (qq) {
        if (!qq) return;
        var bigq = '';
        tagsOfQ(b, qq).forEach(function (t) {
          if (basic[t] || isJunkTag(t)) return;
          if (!bigq) bigq = bigOfQ(b, qq);
          var arr = byTag[t] || (byTag[t] = []);
          arr.push({ b: b, q: qq, big: bigq });
        });
      });
    });
    var list = Object.keys(byTag).sort(function (a, b2) { return a.localeCompare(b2, 'zh'); });
    TG_IDX = { sig: sig, byTag: byTag, list: list, banks: Object.create(null) };
    return TG_IDX;
  }
  /* 某个考点文件夹的题数 / 已答（只查索引，不造题目行 —— 列目录时用这个，快得多） */
  function tagStatOf(catId) {
    var tag = String(catId || '').replace(/^tgcat:/, '');
    try { tag = decodeURIComponent(tag); } catch (e0) {}
    var ix = tagIndex();
    var arr = ix.byTag[tag] || [];
    var done = 0;
    try {
      var A = (typeof ANS === 'object' && ANS) ? ANS : {};
      arr.forEach(function (it) {
        var a = A[it.b.id + '#' + it.q.id];
        if (a && !a.redo) done++;
      });
    } catch (e1) {}
    return { n: arr.length, done: done, tag: tag };
  }

  /* 考点方案的总题数 / 已答（按「题」去重，不是按标签累加） */
  function tagTotal() {
    var ix = tagIndex();
    var seen = Object.create(null), q = 0, done = 0;
    var A = (typeof ANS === 'object' && ANS) ? ANS : {};
    ix.list.forEach(function (t) {
      (ix.byTag[t] || []).forEach(function (it) {
        var k = it.b.id + '#' + it.q.id;
        if (seen[k]) return;
        seen[k] = 1; q++;
        var a = A[k];
        if (a && !a.redo) done++;
      });
    });
    return { q: q, done: done, tags: ix.list.length };
  }

  function smallTags() {
    ensure();
    return tagIndex().list.slice(0);
  }
  function tagBankOf(tag) {
    ensure();
    var ix = tagIndex();
    var hit = ix.banks[tag];
    if (hit) return hit;
    var b = {
      id: tgBankId(tag), title: tag, name: tag, virtualTag: tag,
      questions: [], source: 'tag', createdAt: 0, cat: null
    };
    /* 惰性：真正要题（打开题集 / 显示题数）时才复制，列目录时不做任何复制 */
    Object.defineProperty(b, 'questions', {
      enumerable: true,
      configurable: true,
      get: function () {
        if (b.__qs) return b.__qs;
        var qs = (ix.byTag[tag] || []).map(function (it) {
          var o = {};
          Object.keys(it.q).forEach(function (kk) { o[kk] = it.q[kk]; });
          o._bank = it.b.id; o._bname = String(it.b.title || it.b.name || '');
          return o;
        });
        b.__qs = qs;
        return qs;
      },
      set: function (v) { b.__qs = v; }
    });
    ix.banks[tag] = b;
    return b;
  }
  var TB_CACHE = { key: '', list: null };
  function tagBanks() {
    ensure();
    if (!tagMode()) return [];
    var ix = tagIndex();
    var m = MAP[CUR] || {};
    var ck = ix.sig + '|' + CUR + '|' + Object.keys(m).length;
    if (TB_CACHE.key === ck && TB_CACHE.list) return TB_CACHE.list;
    var out = [], seen = {};
    Object.keys(m).forEach(function (bid) {
      if (String(bid).indexOf('tg:') !== 0 || seen[bid]) return;
      seen[bid] = 1;
      var tag = '';
      try { tag = decodeURIComponent(String(bid).slice(3)); } catch (e) { tag = String(bid).slice(3); }
      if (!tag) return;
      var b = tagBankOf(tag);
      if (b.cat !== (m[bid] || null)) { b.cat = m[bid] || null; }
      out.push(b);
    });
    out.sort(function (a, b) { return String(a.title).localeCompare(String(b.title), 'zh'); });
    TB_CACHE = { key: ck, list: out };
    return out;
  }
  function tagBankById(id) {
    ensure();
    if (String(id || '').indexOf('tg:') !== 0) return null;
    if (!tagMode()) return null;
    var tag = '';
    try { tag = decodeURIComponent(String(id).slice(3)); } catch (e) { tag = String(id).slice(3); }
    if (!tag) return null;
    var b = tagBankOf(tag);
    b.cat = (MAP[CUR] || {})[id] || null;
    return b;
  }
  /* 某个标签文件夹里的「题目行」：一道题一行（虚拟单题集，点开＝打开这个标签的题集并定位到该题） */
  var TQ_CACHE = { key: '', map: null };
  function tagQList(catId) {
    ensure();
    if (!tagMode()) return [];
    var tag = '';
    try { tag = decodeURIComponent(String(catId).slice(6)); } catch (e) { tag = String(catId).slice(6); }
    if (!tag) return [];
    var ix = tagIndex();
    var ck = ix.sig + '|' + CUR + '|' + tag;
    if (TQ_CACHE.key !== ck) TQ_CACHE = { key: ck, map: Object.create(null) };
    if (TQ_CACHE.map[tag]) return TQ_CACHE.map[tag];
    var rows = (ix.byTag[tag] || []).map(function (it) {
      var q = it.q;
      var stem = String(q.stem || q.title || q.q || q.name || '').replace(/\s+/g, ' ').trim();
      var title = stem.slice(0, 34) || ('第 ' + q.id + ' 题');
      var one = {};
      Object.keys(q).forEach(function (k) { one[k] = q[k]; });
      one._bank = it.b.id; one._bname = String(it.b.title || it.b.name || '');
      return {
        id: 'tgq:' + encodeURIComponent(tag) + '|' + it.b.id + '#' + q.id,
        title: title, name: title, virtualTag: tag,
        virtualQ: { bankId: it.b.id, qid: q.id }, source: 'tagq',
        cat: catId, bankName: String(it.b.title || it.b.name || ''),
        questions: [one], createdAt: 0
      };
    });
    TQ_CACHE.map[tag] = rows;
    return rows;
  }
  /* 由 id 还原一条题目行（深链接 / 刷新时用） */
  function tagQById(id) {
    ensure();
    var s = String(id || '');
    if (s.indexOf('tgq:') !== 0) return null;
    var rest = s.slice(4);
    var bar = rest.indexOf('|');
    if (bar < 0) return null;
    var tag = '';
    try { tag = decodeURIComponent(rest.slice(0, bar)); } catch (e) { tag = rest.slice(0, bar); }
    var inner = rest.slice(bar + 1);
    var hash = inner.lastIndexOf('#');
    if (hash < 0) return null;
    var bid = inner.slice(0, hash), qid = inner.slice(hash + 1);
    var rb = banks().filter(function (b) { return b && b.id === bid; })[0];
    if (!rb) return null;
    var q = (rb.questions || []).filter(function (x) { return x && String(x.id) === qid; })[0];
    if (!q) return null;
    var stem = String(q.stem || q.title || q.q || q.name || '').replace(/\s+/g, ' ').trim();
    var one = {};
    Object.keys(q).forEach(function (k) { one[k] = q[k]; });
    one._bank = rb.id; one._bname = String(rb.title || rb.name || '');
    return {
      id: s, title: stem.slice(0, 34), name: stem.slice(0, 34), virtualTag: tag,
      virtualQ: { bankId: rb.id, qid: q.id }, source: 'tagq', cat: null,
      bankName: String(rb.title || rb.name || ''), questions: [one], createdAt: 0
    };
  }
  /* 这个标签下的题，多数属于哪个大标签 */
  function bigTitleOf(tag) {
    var ix = tagIndex();
    var c = {}, best = '', n = 0;
    (ix.byTag[tag] || []).forEach(function (it) { var g = it.big || ''; if (g) c[g] = (c[g] || 0) + 1; });
    Object.keys(c).forEach(function (k) { if (c[k] > n) { n = c[k]; best = k; } });
    return best;
  }
  /* 把现在的小标签同步成这个方案的文件夹（幂等；新标签会补进来） */
  function syncTagTree(sid) {
    ensure();
    var id = sid || CUR;
    if (!tagMode(id)) return 0;
    if (!DB.data[id]) DB.data[id] = { cats: [] };
    var cats = DB.data[id].cats;
    var sch = DB.list.filter(function (x) { return x && x.id === id; })[0] || {};
    var big = !!sch.big;
    var ix = tagIndex();
    if (!MAP[id] || typeof MAP[id] !== 'object') MAP[id] = {};
    var added = 0, have = {};
    cats.forEach(function (c) { if (c && c.id) have[c.id] = 1; });
    /* 大标签这一层 */
    var bigCat = {};
    if (big) {
      var used = {};
      ix.list.forEach(function (t) { var g = bigTitleOf(t); if (g) used[g] = 1; });
      Object.keys(used).sort(function (a, b) { return a.localeCompare(b, 'zh'); }).forEach(function (g, i) {
        var cid = 'tgb:' + encodeURIComponent(g);
        bigCat[g] = cid;
        if (!have[cid]) { cats.push({ id: cid, title: g, parent: null, order: i + 1, bigDir: 1 }); have[cid] = 1; added++; }
      });
    }
    /* 小标签文件夹（parent ＝ 大标签；没开大标签就平铺） */
    ix.list.forEach(function (t, i) {
      var cid = tgCatId(t);
      var g = big ? bigTitleOf(t) : '';
      var parent = (big && g && bigCat[g]) ? bigCat[g] : null;
      var c = cats.filter(function (x) { return x && x.id === cid; })[0];
      if (!c) { cats.push({ id: cid, title: t, parent: parent, order: i + 1 }); added++; }
      else if ((c.parent || null) !== parent) { c.parent = parent; added++; }
      MAP[id][tgBankId(t)] = cid;
    });
    /* 大标签层只留「真的有子文件夹」的父级：没人挂进去的（投票没选它）就别建空壳 */
    if (big) {
      var need = {};
      cats.forEach(function (c) {
        if (c && c.parent) need[String(c.parent)] = 1;
      });
      var badd = 0;
      Object.keys(bigCat).forEach(function (g) {
        var cid2 = bigCat[g];
        if (!need[cid2]) { delete bigCat[g]; badd++; }
      });
      if (badd) {
        cats = cats.filter(function (c) { return !(c && /^tgb:/.test(String(c.id)) && !need[String(c.id)]); });
        DB.data[id].cats = cats;
      }
      /* 反过来：某个小标签要挂的父级还没建，就补一个 */
      var ordMax = 0;
      cats.forEach(function (c) { if (c && c.order > ordMax) ordMax = c.order; });
      var seen = {};
      cats.forEach(function (c) { if (c && c.id) seen[String(c.id)] = 1; });
      cats.forEach(function (c) {
        if (!c || !c.parent || seen[String(c.parent)]) return;
        var g2 = String(c.parent).replace(/^tgb:/, '');
        cats.push({ id: c.parent, title: decodeURIComponent(g2), parent: null, order: ++ordMax, bigDir: 1 });
        seen[String(c.parent)] = 1; added++;
      });
    }
    /* 清掉已经不存在的标签文件夹（以前标签删了/题删了，文件夹还留着，就成了空文件夹） */
    var live = {};
    ix.list.forEach(function (t) { live[tgCatId(t)] = 1; });
    Object.keys(bigCat).forEach(function (g) { live[bigCat[g]] = 1; });
    var before = cats.length;
    DB.data[id].cats = cats = cats.filter(function (c) {
      if (!c || !c.id) return false;
      var s = String(c.id);
      if (s.indexOf('tgcat:') === 0 || s.indexOf('tgb:') === 0) return !!live[s];
      return true;
    });
    /* 顺手把失效的「标签 → 文件夹」映射删掉 */
    var keepBank = {};
    ix.list.forEach(function (t) { keepBank[tgBankId(t)] = 1; });
    Object.keys(MAP[id]).forEach(function (bid) { if (String(bid).indexOf('tg:') === 0 && !keepBank[bid]) delete MAP[id][bid]; });
    if (cats.length !== before) added++;
    if (added) save();
    return added;
  }
  /* 新建「按小标签分」方案 */
  function makeTagScheme(name, big) {
    ensure();
    var nm = trim(name) || ('知识点分类 ' + (DB.list.length + 1));
    var id = uid();
    DB.list.push({ id: id, name: nm, mode: 'tag', big: !!big });
    DB.data[id] = { cats: [] };
    MAP[id] = {};
    CUR = id;                       /* 先切过去，syncTagTree 按当前方案写 */
    save();
    syncTagTree(id);
    apply();
    return id;
  }

  try {
    window.addEventListener('qbank:tags-changed', function () { window.__TAGS_REV = (window.__TAGS_REV || 0) + 1; });
  } catch (e0) {}

  function modeOf(sid) {
    ensure();
    var id = sid || CUR;
    var s = DB.list.filter(function (x) { return x && x.id === id; })[0];
    return (s && s.mode) || 'cat';
  }

  window.SCM = {
    KEY_SCH: K_SCH, KEY_CUR: K_CUR, KEY_MAP: K_MAP, KEY_CATS: K_CATS, DEF: DEF,
    load: load, reload: function () { LOADED = false; load(); },
    cats: cats, plainCats: plainCats, setCats: setCats, snapshot: snapshot, apply: apply, adopt: adopt,
    catOf: catOf, catForStore: catForStore, setCatOf: setCatOf,
    list: list, current: current, curName: curName, has: has,
    create: create, rename: rename, remove: remove, switchTo: switchTo,
    schemesOfBank: schemesOfBank, raw: raw,
    exportCur: exportCur, importData: importData,
    tagMode: tagMode, modeOf: modeOf, tagBanks: tagBanks, tagBankById: tagBankById,
    tagQList: tagQList, tagStatOf: tagStatOf, tagTotal: tagTotal, tagQById: tagQById, bigTitleOf: bigTitleOf, isJunkTag: isJunkTag,
    schemeOf: function (sid) { ensure(); var id = sid || CUR; return DB.list.filter(function (x) { return x && x.id === id; })[0] || null; },
    setBig: function (sid, v) {
      ensure();
      var id = sid || CUR;
      var s = DB.list.filter(function (x) { return x && x.id === id; })[0];
      if (!s) return false;
      s.big = !!v; save();
      syncTagTree(id); apply();
      return true;
    },
    makeTagScheme: makeTagScheme, syncTagTree: syncTagTree, smallTags: smallTags,
    tagBankOf: tagBankOf, tgBankId: tgBankId, tgCatId: tgCatId
  };

  load();
})();
