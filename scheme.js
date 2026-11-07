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
    var srcTree = (fromId && DB.data[fromId]) ? DB.data[fromId].cats : null;
    DB.data[id] = { cats: srcTree ? JSON.parse(JSON.stringify(srcTree)) : [] };
    if (fromId && MAP[fromId]) MAP[id] = JSON.parse(JSON.stringify(MAP[fromId]));
    else MAP[id] = {};
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
    apply();
    return true;
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

  window.SCM = {
    KEY_SCH: K_SCH, KEY_CUR: K_CUR, KEY_MAP: K_MAP, KEY_CATS: K_CATS, DEF: DEF,
    load: load, reload: function () { LOADED = false; load(); },
    cats: cats, setCats: setCats, snapshot: snapshot, apply: apply, adopt: adopt,
    catOf: catOf, catForStore: catForStore, setCatOf: setCatOf,
    list: list, current: current, curName: curName, has: has,
    create: create, rename: rename, remove: remove, switchTo: switchTo,
    schemesOfBank: schemesOfBank, raw: raw
  };

  load();
})();
