/* ============================================================
   刷题站 · 核心 app.js
   题库：banks/*.js（registerBank）+ 本地导入 + 临时套卷
   存储：全部在浏览器 localStorage
     qbank.answers.v2  "bankId#qid" -> { sel:[], ok:bool, tries, wrong, ts, redo }
     qbank.favs.v2     收藏
     qbank.notes.v2    自定义解析 { text, imgs:[{name,src}] }
     qbank.local.v2    自建题库
     qbank.papers.v2   临时套卷定义
     qbank.answerfix.v1 手动修正的正确答案 { key -> ['A','B'] }
     qbank.srs.v1      复习曲线（模式 + 初始参数）
   ★ 兼容旧数据：老的 { sel, ok } 读取时自动补 tries/wrong，不会被清掉。
   ============================================================ */

/* ---------- 存储 ---------- */
const LS = {
  ans: 'qbank.answers.v2',
  banks: 'qbank.local.v2',
  set: 'qbank.settings.v2',
  fav: 'qbank.favs.v2',
  note: 'qbank.notes.v2',
  paper: 'qbank.papers.v2',
  fix: 'qbank.answerfix.v1',
  srs: 'qbank.srs.v1',
  cat: 'qbank.cats.v1',
  tag: 'qbank.tags.v1',            /* 知识点标签（tags.js） */
  tagvocab: 'qbank.tagvocab.v1',   /* 考点词表（受控：AI 打标签只从里面挑） */
  report: 'qbank.report.v1',       /* AI 学情诊断的历史报告（report.js） */
  qtn: 'qbank.qtn.v1'              /* 答题页右侧的「口诀 / 思路」小便签（跟解析分开存） */
};
const readLS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
/* 写不进去要吵醒用户：localStorage 满了 / 被禁用时悄悄丢数据是最坑的 */
let _saveWarned = false;
function saveWarn(key, err) {
  if (_saveWarned) return; _saveWarned = true;
  try {
    let el = document.getElementById("saveWarnBar");
    if (!el) { el = document.createElement("div"); el.id = "saveWarnBar"; document.body.appendChild(el); }
    el.innerHTML = `<b>数据没存进浏览器！</b>存储空间可能满了（${esc(String((err && err.name) || err || "写入失败"))}，键：${esc(key)}）。请立刻导出备份：` +
      `<button class="btn tiny" id="saveWarnExp">导出全部数据</button><button class="btn tiny" id="saveWarnClose">知道了</button>`;
    document.getElementById("saveWarnExp").onclick = function () { if (typeof exportAllData === "function") exportAllData(); };
    document.getElementById("saveWarnClose").onclick = function () { el.remove(); };
  } catch (e) {}
}
const writeLS = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); }
  catch (e) { if (String(k).indexOf("qbank.") === 0) saveWarn(k, e); return false; }
  return true;
};

/* ---------- 多标签安全：同时开两个标签页也不丢数据 ----------
   内存里的 ANS/FAV/NOTES… 只在打开页面时读一次。两个标签页各答各的，
   后写的那次会把先写的整份记录覆盖掉，而且没有任何提示。这里的做法：
     1) 写入前先读回最新存档，按每条记录的时间戳合并（谁新用谁的）；
     2) 删除记进墓碑表 qbank.tomb.v1，免得被另一个标签页的合并又「复活」；
     3) 监听 storage 事件：别的标签页一写，本页立刻把最新数据读进内存。
   记录没有时间戳时（老数据、旧收藏）以本页内存为准，但不会盖掉存档里更新的那条。 */
const TOMB_KEY = 'qbank.tomb.v1';
let TOMB = readLS(TOMB_KEY, {});            // { ans:{键:时间}, fav:{}, note:{}, fix:{}, paper:{}, wipe:{ans:时间} }
const TOMB_TTL = 7 * 86400000;

function tombAdd(kind, key) {
  const now = Date.now();
  const t = TOMB[kind] = TOMB[kind] || {};
  t[key] = now;
  Object.keys(t).forEach(x => { if (now - t[x] > TOMB_TTL) delete t[x]; });  // 顺手清理过期墓碑
  writeLS(TOMB_KEY, TOMB);
}
/* 反向操作：把某条记回来了（例如清空标签后又重新打上），墓碑必须撤掉，
   否则 mergeWrite 会因为墓碑把这条当成「已删」再次丢掉。 */
function tombDel(kind, key) {
  const t = TOMB[kind];
  if (!t || !(key in t)) return;
  delete t[key];
  writeLS(TOMB_KEY, TOMB);
}
function tombWipe(kind) {                    // 整表清空（例如「清空作答记录」），别让旧记录被合并回来
  TOMB[kind] = {};
  TOMB.wipe = TOMB.wipe || {};
  TOMB.wipe[kind] = Date.now();
  writeLS(TOMB_KEY, TOMB);
}
function tombClear() { TOMB = { ans: {}, fav: {}, note: {}, qtn: {}, aisrc: {}, fix: {}, paper: {}, tag: {}, vocab: {}, report: {}, wipe: {} }; writeLS(TOMB_KEY, TOMB); }
function recTs(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return Math.max(+v.ts || 0, +v.upd || 0, +v.updatedAt || 0, +v.createdAt || 0);
}
/* 合并写入：mem 是内存里的对象（就地改成合并后的结果），返回是否写成功 */
function mergeWrite(key, mem, kind) {
  const isArr = Array.isArray(mem);
  const stored = readLS(key, isArr ? [] : {});
  const tomb = TOMB[kind] || {};
  const wipe = (TOMB.wipe || {})[kind] || 0;
  let out;
  if (isArr) {
    out = mem.filter(x => !(x && x.id != null && tomb[x.id]));                             // 本页删掉的（有墓碑）不再留
    const seen = {};
    out.forEach(x => { if (x && x.id != null) seen[x.id] = 1; });
    (stored || []).forEach(x => { if (x && x.id != null && !seen[x.id] && !tomb[x.id]) out.push(x); });   // 数组按 id 并集，但不复活墓碑
  } else {
    out = {};
    Object.keys(stored || {}).forEach(k => { if (!tomb[k] && recTs(stored[k]) >= wipe) out[k] = stored[k]; });
    Object.keys(mem).forEach(k => {
      const mine = mem[k], theirs = out[k];
      if (!theirs) { if (!(tomb[k] && tomb[k] >= recTs(mine))) out[k] = mine; return; }
      if (recTs(theirs) > recTs(mine)) return;    // 存档那条更新：保留存档的
      out[k] = mine;
    });
  }
  if (isArr) { mem.length = 0; out.forEach(x => mem.push(x)); }
  else { Object.keys(mem).forEach(k => delete mem[k]); Object.keys(out).forEach(k => { mem[k] = out[k]; }); }
  return writeLS(key, out);
}
/* 保存统一入口：全部走合并写入 */
const saveAns = () => mergeWrite(LS.ans, ANS, 'ans');
const saveFav = () => mergeWrite(LS.fav, FAV, 'fav');
const saveNotes = () => { const r = mergeWrite(LS.note, NOTES, 'note'); if (typeof bumpHay === 'function') bumpHay(); return r; };
const saveFix = () => { const r = mergeWrite(LS.fix, FIX, 'fix'); if (typeof bumpHay === 'function') bumpHay(); return r; };
const savePapers = () => mergeWrite(LS.paper, PAPERS, 'paper');
/* 口诀 / 思路便签：跟解析一样走「合并写入」（多标签安全 + 删除记墓碑），这样云同步才能按时间戳合并、
   并且在一台设备上清空之后，不会被另一台设备/云端里的旧副本复活。 */
const saveQtn = () => mergeWrite(LS.qtn, QTN, 'qtn');

/* 别的标签页写了 → 把最新数据读进内存；正打字就先不重画，免得把输入冲掉 */
let _syncT = 0, _syncNeed = false;
window.addEventListener('storage', e => {
  if (!e || !e.key) return;
  const k = e.key;
  if (k === LS.ans) ANS = readLS(LS.ans, {});
  else if (k === LS.fav) FAV = readLS(LS.fav, {});
  else if (k === LS.note) NOTES = readLS(LS.note, {});
  else if (k === LS.qtn) QTN = readLS(LS.qtn, {});
  else if (k === LS.fix) FIX = readLS(LS.fix, {});
  else if (k === LS.paper) { PAPERS = readLS(LS.paper, []); invalidateBanks(); }
  else if (k === LS.banks) { LOCAL = readLS(LS.banks, []); invalidateBanks(); }
  else if (k === LS.srs) SRS = readLS(LS.srs, {});
  else if (k === LS.tag || k === LS.tagvocab) { if (typeof tagReload === 'function') tagReload(); }   /* 标签在 tags.js 里，让它自己重读 */
  else if (k === LS.report) { if (window.REPORT && REPORT.reload) REPORT.reload(); }   /* 学情诊断历史报告 */
  else if (k === LS.cat) {                       // 别的标签页改了分类：直接让分类模块重画（它自己写自己，不再走下面的事件）
    if (typeof CAT !== 'undefined' && CAT && CAT.reload) { try { CAT.reload(); CAT.render(); } catch (err) {} }
    return;
  }
  else if (k === LS.set) { SET = Object.assign(SET, readLS(LS.set, {})); applyLook(); }
  else if (k === TOMB_KEY) TOMB = readLS(TOMB_KEY, {});
  else return;
  _syncNeed = true;
  clearTimeout(_syncT);
  _syncT = setTimeout(() => {
    if (!_syncNeed) return;
    _syncNeed = false;
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;   // 正在打字：先只更新内存
    /* AI 解析 / 变式题面板开着（含还没点「生成」的空面板）：整页重画会把它们冲掉，先只更新内存 */
    if ((typeof aiPanelOpen === 'function' && aiPanelOpen()) || (typeof variantPanelOpen === 'function' && variantPanelOpen())) return;
    /* 正在看参考资料 / PDF 整屏阅读器：别重画，免得把它冲掉、PDF 又得重下一遍 */
    try { if (document.getElementById('pdfFs') || document.querySelector('.aisrc-full')) return; } catch (err) {}
    try { render(); showSyncTip(); } catch (err) {}
  }, 250);
});
function showSyncTip() {
  let el = $('syncTip');
  if (!el) { el = document.createElement('div'); el.id = 'syncTip'; el.className = 'syncTip'; document.body.appendChild(el); }
  el.textContent = '已同步另一个标签页的改动';
  el.classList.add('show');
  clearTimeout(showSyncTip._t);
  showSyncTip._t = setTimeout(() => el.classList.remove('show'), 2600);
}

let ANS = readLS(LS.ans, {});
let LOCAL = readLS(LS.banks, []);
let FAV = readLS(LS.fav, {});
let NOTES = readLS(LS.note, {});
let QTN = readLS(LS.qtn, {});      /* 答题页右侧便签（口诀 / 思路）：跟解析分开存，一个题目一条 */
let PAPERS = readLS(LS.paper, []);     // [{ id, title, createdAt, keys:[] }]
let SET = readLS(LS.set, { expOnOk: true, autoNext: false, shuffle: false });
let FIX = readLS(LS.fix, {});          // 手动修正的正确答案（只在本机生效，题库文件不动）
let SRS = readLS(LS.srs, {});          // 复习曲线：模式 + 初始参数
/* 新增的外观设置：老数据里没有这两项，读出来补上默认值 */
const SET_DEF = { expOnOk: true, autoNext: false, shuffle: false, theme: 'auto', fs: 'm', color: 'teal', bg: 'default', fxConfetti: true, fxNormalBank: false, focus: false, reduceMotion: false, quizMode: 'normal', speedSec: 0 };
Object.keys(SET_DEF).forEach(k => { if (SET[k] == null) SET[k] = SET_DEF[k]; });
/* 方案九：刷题模式（'normal' 普通 / 'speed' 速刷 / 'recite' 背题）—— 存 SET 里，不新增 key。
   speedSec = 速刷每题限时秒数，0 = 不限时（用户拍板：默认关，要限时自己去设置里开）。 */
if (['normal', 'speed', 'recite'].indexOf(SET.quizMode) < 0) SET.quizMode = 'normal';
SET.speedSec = Math.max(0, Math.min(300, Math.round(+SET.speedSec || 0)));
const QUIZ_MODES = [['normal', '普通'], ['speed', '⚡ 速刷'], ['recite', '📖 背题']];
const BACKUP_KEY = 'qbank.lastbackup.v1';   // 上次导出备份的时间

/* 复习到期按本地自然日算：due = 目标日 0 点，而不是「答对时刻 + N×24h」。
   用 setDate 而不是 +N×86400000，跨夏令时也落在本地 0 点。 */
function dayStart(ts) {
  const d = new Date(ts == null ? Date.now() : ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function dayAdd(ts, n) {
  const d = new Date(ts == null ? Date.now() : ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (Math.round(+n) || 0));
  return d.getTime();
}
function migrate() {
  let changed = false;
  Object.keys(ANS).forEach(k => {
    const a = ANS[k];
    if (!a || typeof a !== 'object') return;
    if (typeof a.ok !== 'boolean') { a.ok = false; changed = true; }
    if (!Array.isArray(a.sel)) { a.sel = []; changed = true; }
    if (a.tries == null) { a.tries = 1; changed = true; }
    if (a.wrong == null) { a.wrong = a.ok ? 0 : 1; changed = true; }
    if (a.ts == null) { a.ts = 0; changed = true; }
    if (a.ivl == null) { a.ivl = 0; changed = true; }
    if (a.ease == null) { a.ease = 2.5; changed = true; }
    if (a.due == null) { a.due = a.ts || 0; changed = true; }
    /* 老数据的 due 精确到时分，统一落到当天 0 点（新规则：过了 0 点就是新的一天） */
    if (a.due > 0) {
      const d0 = dayStart(a.due);
      if (d0 !== a.due) { a.due = d0; changed = true; }
    }
  });
  if (changed) saveAns();
}
migrate();

/* ---------- 外观：深色模式 + 字号 + 主题色 ---------- */
/* §8 视觉 v2：主色默认改成「① 冷静青」，另有 靛 / 蓝+暖橙（②）/ 紫。
   只改 <html data-theme> 和几个变量，style.css 里 html[data-theme=…] 覆盖
   --primary / --a1~--a3 / --grad / --a-top，全站的按钮、链接、进度条、高亮、
   底部导航、热力图都跟着变。老用户存的 'blue' 会落到默认的 teal 上。 */
const THEME_COLORS = ['teal', 'indigo', 'warm', 'violet', 'rose', 'amber', 'emerald', 'ocean', 'graphite', 'candy'];
const THEME_META = { teal: ['#0d9488', '#080c14'], indigo: ['#4f46e5', '#080c14'], warm: ['#2563eb', '#080c14'], violet: ['#7c3aed', '#080c14'],
  rose: ['#e11d48', '#080c14'], amber: ['#b45309', '#080c14'], emerald: ['#047857', '#080c14'], ocean: ['#0369a1', '#080c14'],
  graphite: ['#334155', '#0b1220'], candy: ['#c026d3', '#080c14'] };
const THEME_NAME = { teal: '冷静青', indigo: '靛蓝', warm: '蓝 + 暖橙', violet: '紫', rose: '玫瑰', amber: '琥珀', emerald: '森林', ocean: '海洋', graphite: '石墨金', candy: '糖果' };
/* 背景氛围：只换 body 的底图（style.css 末尾 html[data-bg=…]），不碰布局 */
const BG_OPTIONS = ['default', 'aurora', 'grid', 'dots', 'lines', 'rings', 'paper', 'plain', 'custom'];
const BG_NAME = { default: '默认微光', aurora: '极光', grid: '细网格', dots: '圆点', lines: '斜纹', rings: '涟漪', paper: '纸感', plain: '纯色', custom: '自定义图片' };

/* ---------- 自定义背景图（本机） ----------
   选图 → canvas 压到最长边 1800px → 存 IndexedDB（不占题库的 localStorage 配额，
   实在不行才退 localStorage）→ 写成 --bg-img，CSS 里用 cover 自适应。 */
var BG_URL = '';
function bgDB() {
  return new Promise(res => {
    try {
      const rq = indexedDB.open('shuati-bg', 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore('img'); } catch (e) {} };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
}
function bgPut(data) {
  return bgDB().then(db => {
    if (!db) { try { localStorage.setItem('qbank.bgimg.v1', data); return true; } catch (e) { return false; } }
    return new Promise(res => {
      try {
        const tx = db.transaction('img', 'readwrite');
        tx.objectStore('img').put(data, 'page');
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
      } catch (e) { res(false); }
    });
  });
}
function bgGet() {
  return bgDB().then(db => {
    if (!db) return localStorage.getItem('qbank.bgimg.v1') || '';
    return new Promise(res => {
      try {
        const rq = db.transaction('img', 'readonly').objectStore('img').get('page');
        rq.onsuccess = () => res(rq.result || '');
        rq.onerror = () => res('');
      } catch (e) { res(''); }
    });
  }).catch(() => '');
}
function bgDel() {
  try { localStorage.removeItem('qbank.bgimg.v1'); } catch (e) {}
  return bgDB().then(db => {
    if (!db) return;
    try { db.transaction('img', 'readwrite').objectStore('img').delete('page'); } catch (e) {}
  });
}
function applyBgImage() {
  const root = document.documentElement;
  if (SET.bg !== 'custom') { root.style.removeProperty('--bg-img'); BG_URL = ''; return; }
  if (BG_URL) { root.style.setProperty('--bg-img', 'url("' + BG_URL + '")'); return; }
  bgGet().then(d => {
    if (!d) return;
    BG_URL = d;
    if (SET.bg === 'custom') root.style.setProperty('--bg-img', 'url("' + d + '")');
  });
}
/* 图片读进来 → 缩放 → 出 dataURL（优先 webp，不支持就 jpeg） */
function bgScale(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 1800;
        const s = Math.min(1, MAX / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round((img.naturalWidth || 1) * s));
        const h = Math.max(1, Math.round((img.naturalHeight || 1) * s));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        let out = '';
        try { out = cv.toDataURL('image/webp', 0.85); } catch (e) { out = ''; }
        if (!out || out.indexOf('data:image/webp') !== 0) out = cv.toDataURL('image/jpeg', 0.85);
        URL.revokeObjectURL(url);
        res(out);
      } catch (e) { URL.revokeObjectURL(url); rej(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')); };
    img.src = url;
  });
}
function bgPick() {
  const f = $('setBgFile');
  if (!f) return;
  f.value = '';
  f.click();
}
async function bgSetFromFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type || '')) { toast('请选图片文件（jpg / png / webp）'); return; }
  try {
    const data = await bgScale(file);
    const ok = await bgPut(data);
    if (!ok) { toast('这张图存不下（浏览器存储已满），换张小点的'); return; }
    BG_URL = data;
    document.documentElement.style.setProperty('--bg-img', 'url("' + data + '")');
    setLook('bg', 'custom');
    const sel = $('setBg'); if (sel) sel.value = 'custom';
    toast('背景已换成本机图片（自适应裁切）', 1600, 'ok');
  } catch (e) { toast('这张图读不出来，换一张试试'); }
}
function bgClearImage() {
  BG_URL = '';
  bgDel();
  document.documentElement.style.removeProperty('--bg-img');
  setLook('bg', 'default');
  const sel = $('setBg'); if (sel) sel.value = 'default';
  toast('已清除自定义背景', 1400, 'ok');
}
function applyLook() {
  const sysDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = (SET.theme === 'dark') || (SET.theme !== 'light' && sysDark);
  document.body.classList.toggle('dark', dark);
  document.body.classList.toggle('fs-s', SET.fs === 's');
  document.body.classList.toggle('fs-l', SET.fs === 'l');
  document.body.classList.toggle('fs-xl', SET.fs === 'xl');
  const color = THEME_COLORS.indexOf(SET.color) >= 0 ? SET.color : 'teal';
  if (document.documentElement) document.documentElement.setAttribute('data-theme', color);
  const bg = BG_OPTIONS.indexOf(SET.bg) >= 0 ? SET.bg : 'default';
  if (document.documentElement) document.documentElement.setAttribute('data-bg', bg);
  applyBgImage();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', (THEME_META[color] || THEME_META.teal)[dark ? 1 : 0]);
  /* §3.6-P0① 专注模式：只加一个 body 类，隐藏顶栏/底栏交给 CSS（退出按钮 .focus-exit 只在这时露出来） */
  document.body.classList.toggle('focus', !!SET.focus);
  /* 「减少动态效果」（设置里的开关）：加个 body 类，style.css 里那条规则把全站动画/过渡关掉；
     系统级的 prefers-reduced-motion 仍然独立生效（两条并存）。 */
  document.body.classList.toggle('reduce-motion', !!SET.reduceMotion);
}
function setLook(k, v) { SET[k] = v; writeLS(LS.set, SET); applyLook(); }
if (window.matchMedia) {
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (SET.theme !== 'light' && SET.theme !== 'dark') applyLook(); }); } catch (e) {}
}
applyLook();

/* ---------- 题库 ---------- */
let _bankCache = null;
function invalidateBanks() { _bankCache = null; if (typeof bumpHay === 'function') bumpHay(); }

function allBanks() {
  if (!_bankCache) {
    const base = (window.__BANKS__ || []).map(b => normalizeBank(b, 'builtin'))
      .concat(LOCAL.map(b => normalizeBank(b, 'local')));
    _bankCache = base.concat(paperBanks(base));
  }
  return _bankCache;
}
function baseBanks() { return allBanks().filter(b => !b.paper); }
function bankById(id) { return allBanks().find(b => b.id === id); }
function findQIn(base, k) {
  for (const b of base) {
    const pre = b.id + '#';
    if (k.indexOf(pre) === 0) {
      const qid = k.slice(pre.length);
      const q = b.questions.find(x => String(x.id) === String(qid));
      if (q) return { bank: b, q: q };
    }
  }
  return null;
}
function paperBanks(base) {
  const out = [];
  PAPERS.forEach(p => {
    const qs = [];
    (p.keys || []).forEach(k => {
      const f = findQIn(base, k);
      if (!f) return;
      qs.push(Object.assign({}, f.q, { id: 'p' + (qs.length + 1), _srcKey: k }));
    });
    if (qs.length) out.push({
      id: p.id, title: p.title || '临时套卷', subtitle: (p.exam ? '模拟考试 · ' : '临时套卷 · ') + qs.length + ' 题',
      paper: true, exam: !!p.exam, duration: p.duration || 0, createdAt: p.createdAt || 0, questions: qs
    });
  });
  return out;
}

function normalizeBank(b, source) {
  const qs = (b.questions || []).map((q, i) => normalizeQ(q, i + 1));
  const o = { id: b.id || ('bank-' + i2s()), title: b.title || '未命名题库', subtitle: b.subtitle || '', source: source, paper: false, cat: (b.cat == null || b.cat === '' ? null : String(b.cat)), questions: qs };
  if (b.ord != null) o.ord = +b.ord || 0;      // 目录内的手排顺序
  return o;
}
function normalizeQ(q, fallbackId) {
  const opts = (q.options || []).map(String);
  let ans = q.answer == null ? [] : (Array.isArray(q.answer) ? q.answer : String(q.answer).replace(/[^A-Ha-h]/g, '').split(''));
  ans = Array.from(new Set(ans.map(a => String(a).toUpperCase()))).filter(a => 'ABCDEFGH'.includes(a)).sort();
  const o = {
    id: (q.id == null ? fallbackId : q.id),
    stem: String(q.stem || ''),
    options: opts,
    answer: ans,
    explain: String(q.explain || ''),
    group: q.group ? String(q.group) : '',
    groupTitle: q.groupTitle ? String(q.groupTitle) : ''
  };
  if (q._srcKey) o._srcKey = q._srcKey;
  return o;
}
function i2s() { return Math.random().toString(36).slice(2, 8); }

const qType = (q, ans) => ((ans || q.answer || []).length > 1 ? 'X' : 'A');
const typeLabel = (q, ans) => ((ans || q.answer || []).length > 1 ? '多选' : '单选');
const key = (bankId, qid) => bankId + '#' + qid;
const kOf = (bank, q) => key(bank.id, q.id);
/* 题号显示：临时套卷里的题目 id 是 p1/p2…（paperBanks 给的重编号），要去掉前缀 p；
   题库 id 不是纯数字的（比如导入时给的 q1、uuid 那种），就退回「它在题库里排第几」，
   免得界面上冒出「第 q1 题」这种内部编号。
   list 传题库/试卷的题目数组；不传就只能原样显示。 */
const qNo = (q, list) => {
  const raw = String(q && q.id == null ? '' : q.id);
  const m = raw.match(/^p?(\d+)$/);
  if (m) return m[1];
  if (list && list.length) {
    const at = list.findIndex(x => String(x.id) === raw);
    if (at >= 0) return String(at + 1);
  }
  return raw || '?';
};
const favKey = (bank, q) => (bank.paper && q._srcKey) ? q._srcKey : key(bank.id, q.id);

/* 作答记录 */
function recOf(k) {
  const a = ANS[k];
  if (!a) return null;
  if (a.tries == null) { a.tries = 1; a.wrong = a.ok ? 0 : 1; a.ts = a.ts || 0; }
  return a;
}
const answered = k => { const a = ANS[k]; return !!a && !a.redo; };
/* 到期时间：答错的题当天回到队列，答对后按间隔排期 */
/* 复习排期只针对「做错过」的题——每日复习 = 错题集的排期 */
function inSrs(k) { const a = ANS[k]; return !!a && (a.wrong || 0) > 0; }
function dueOf(k) {
  const a = ANS[k];
  if (!a) return null;
  return (a.due == null ? (a.ts || 0) : a.due);
}
function isDue(k) {
  if (!inSrs(k)) return false;
  const d = dueOf(k);
  return d != null && d <= Date.now();
}
function rateOf(a) { if (!a || !a.tries) return 0; return Math.round((a.tries - (a.wrong || 0)) / a.tries * 100); }
function noteOf(k) { return NOTES[k] || null; }
function explainOf(k, q) { const n = NOTES[k]; return (n && n.text) ? n.text : (q.explain || ''); }

/* ============================================================
   复习曲线（SRS）：可选模式 + 可自定义初始参数
   ============================================================ */
const SRS_PRESETS = {
  sm2: { label: '经典（默认）', first: 1, second: 3, factor: 'ease', ease0: 2.5, easeUp: 0, easeDown: 0.2, minEase: 1.3, maxEase: 3, wrongIvl: 1, wrongToday: true, maxIvl: 365, daily: 0,
    desc: '答对：1 → 3 → 间隔×易度；答错：打回 1 天、易度 -0.2，当天重新排队' },
  anki: { label: 'Anki 风格', first: 1, second: 4, factor: 'ease', ease0: 2.5, easeUp: 0.15, easeDown: 0.2, minEase: 1.3, maxEase: 3, wrongIvl: 1, wrongToday: true, maxIvl: 365, daily: 0,
    desc: '毕业 1 → 4 天，之后间隔×易度；答对易度 +0.15，越熟的题间隔涨得越快' },
  fast: { label: '快速通过（间隔翻倍）', first: 1, second: 2, factor: 2, ease0: 2.5, easeUp: 0, easeDown: 0.2, minEase: 1.3, maxEase: 3, wrongIvl: 1, wrongToday: true, maxIvl: 30, daily: 0,
    desc: '间隔固定翻倍、最长 30 天：适合考前把整本题库刷熟' },
  sprint: { label: '考前冲刺（短周期）', first: 1, second: 1, factor: 1.5, ease0: 2.5, easeUp: 0, easeDown: 0.2, minEase: 1.3, maxEase: 3, wrongIvl: 1, wrongToday: true, maxIvl: 10, daily: 60,
    desc: '1 → 1 → ×1.5、最长 10 天，天天见面；默认每天最多复习 60 题' },
  longterm: { label: '长期记忆（慢速）', first: 2, second: 7, factor: 'ease', ease0: 2.6, easeUp: 0.1, easeDown: 0.15, minEase: 1.5, maxEase: 3.2, wrongIvl: 2, wrongToday: false, maxIvl: 500, daily: 0,
    desc: '2 → 7 → 间隔×易度，答错退 2 天再见：题少而稳，适合长期积累' },
  custom: { label: '自定义', first: 1, second: 3, factor: 'ease', ease0: 2.5, easeUp: 0, easeDown: 0.2, minEase: 1.3, maxEase: 3, wrongIvl: 1, wrongToday: true, maxIvl: 365, daily: 0,
    desc: '自定义：完全按下面填的参数来' }
};
const SRS_FIELDS = ['first', 'second', 'factor', 'ease0', 'easeUp', 'easeDown', 'minEase', 'maxEase', 'wrongIvl', 'wrongToday', 'maxIvl', 'daily'];
function srsCfg() {
  const mode = SRS_PRESETS[SRS.mode] ? SRS.mode : 'sm2';
  const p = SRS_PRESETS[mode];
  const c = { mode: mode, label: p.label, desc: p.desc };
  SRS_FIELDS.forEach(k => { c[k] = (SRS[k] == null ? p[k] : SRS[k]); });
  return c;
}
function srsSave() { writeLS(LS.srs, SRS); }
/* 选模式＝把该模式的推荐值一次性填好，之后还能逐项微调 */
function setSrsMode(mode) {
  if (!SRS_PRESETS[mode]) return;
  SRS.mode = mode;
  SRS_FIELDS.forEach(k => { SRS[k] = SRS_PRESETS[mode][k]; });
  srsSave();
}
/* 手动改任一项 → 自动变成「自定义」，其它项保留当前值 */
function srsSetField(f, v) {
  const c = srsCfg();
  SRS_FIELDS.forEach(k => { SRS[k] = c[k]; });
  SRS[f] = v;
  SRS.mode = 'custom';
  srsSave();
}
/* 只算下一档，便于预览 */
function srsNext(ivl, ease, ok, c) {
  c = c || srsCfg();
  if (ok) {
    if (!ivl || ivl < c.first) ivl = c.first;
    else if (ivl <= c.first) ivl = c.second;
    else ivl = Math.round(ivl * (c.factor === 'ease' ? ease : (+c.factor || 2)));
    ease = Math.min(c.maxEase, ease + (+c.easeUp || 0));
    ivl = Math.max(1, Math.min(c.maxIvl, ivl));
  } else {
    ivl = Math.max(1, +c.wrongIvl || 1);
    ease = Math.max(c.minEase, ease - (+c.easeDown || 0));
  }
  return { ivl: ivl, ease: Math.round(ease * 100) / 100 };
}
function srsPreview(c) {
  c = c || srsCfg();
  let ivl = 0, ease = +c.ease0 || 2.5;
  const out = [];
  for (let i = 0; i < 8; i++) { const r = srsNext(ivl, ease, true, c); ivl = r.ivl; ease = r.ease; out.push(ivl); }
  return out;
}
function srsPreviewText(c) {
  c = c || srsCfg();
  return '答对后的间隔：' + srsPreview(c).join(' → ') + ' 天　·　答错：'
    + (c.wrongToday ? '当天重新排队' : '退 ' + Math.max(1, +c.wrongIvl || 1) + ' 天')
    + '，易度 -' + (+c.easeDown || 0)
    + (c.daily ? '　·　每天最多复习 ' + c.daily + ' 题' : '');
}

/* ============================================================
   手动修正答案：只改本机的判分依据，题库文件不动
   键与错题本/收藏一致（套卷、模考里的题记在原题上）
   ============================================================ */
function fixOf(k) { const f = FIX[k]; return (Array.isArray(f) && f.length) ? f.slice() : null; }
function hasFix(k) { return !!fixOf(k); }
function ansOf(k, q) { return fixOf(k) || ((q && q.answer) ? q.answer : []); }
function setFix(k, letters) {
  letters = Array.from(new Set((letters || []).map(x => String(x).toUpperCase()).filter(a => 'ABCDEFGH'.includes(a)))).sort();
  if (letters.length) {
    FIX[k] = letters;
    /* 删题时会给 FIX 记过墓碑；7 天内又把这道题（重新导入后）修了答案的话，
       墓碑会把这次写入挡掉，这里主动把墓碑删掉——跟「取消收藏 → 撤销」一个套路 */
    try { if (TOMB && TOMB.fix && TOMB.fix[k]) { delete TOMB.fix[k]; writeLS(TOMB_KEY, TOMB); } } catch (e) {}
  } else delete FIX[k];
  saveFix();
}
/* 按新答案重判这条作答记录：原来是误判为错的，把错次数还回去 */
function rejudgeRec(k, letters) {
  const a = ANS[k];
  if (!a) return null;
  const wasOk = !!a.ok, ok = sameAns(a.sel || [], letters);
  a.ok = ok;
  if (ok && !wasOk) a.wrong = Math.max(0, (a.wrong || 0) - 1);
  if (!ok && wasOk) a.wrong = (a.wrong || 0) + 1;
  a.redo = false;
  srsUpdate(a, ok);
  return ok;
}
function rejudgeAll() {
  let n = 0;
  Object.keys(FIX).forEach(k => { if (ANS[k]) { rejudgeRec(k, FIX[k]); n++; } });
  if (n) saveAns();
  return n;
}
/* 答题页 / 错题本里共用的「改答案」小面板 */
function openAnsEditor(host, k, q, done) {
  if (!host) return;
  const cur = ansOf(k, q), orig = (q && q.answer) || [];
  const n = Math.min(8, Math.max(2, (q && q.options && q.options.length) || 4));
  const letters = 'ABCDEFGH'.slice(0, n).split('');
  const fixed = hasFix(k);
  host.innerHTML =
    '<div class="fixbox">' +
    '<div class="small muted">勾选这道题<b>正确</b>的选项；只改本机的判分依据，题库文件不动。</div>' +
    '<div class="fixrow">' + letters.map(L => '<label class="fixopt' + (cur.includes(L) ? ' on' : '') + '"><input type="checkbox" data-f="' + L + '"' + (cur.includes(L) ? ' checked' : '') + '><span>' + L + '</span></label>').join('') + '</div>' +
    '<div class="small muted">题库原答案 <b>' + (orig.join('') || '—') + '</b>' + (fixed ? '　·　已修正为 <b>' + cur.join('') + '</b>' : '') + '</div>' +
    '<label class="chk small" style="margin-top:6px"><input type="checkbox" id="fxRe" checked> 保存后顺带重判我做过的这道题（错次数和复习排期一起改）</label>' +
    '<div class="actions"><button class="btn primary" id="fxOk">保存</button>' +
    '<button class="btn" id="fxOrig"' + (fixed ? '' : ' disabled') + '>恢复题库原答案</button>' +
    '<button class="btn" id="fxCancel">取消</button></div></div>';
  host.querySelectorAll('.fixopt input').forEach(cb => cb.onchange = () => cb.parentNode.classList.toggle('on', cb.checked));
  const pick = () => Array.from(host.querySelectorAll('.fixopt input')).filter(cb => cb.checked).map(cb => cb.dataset.f);
  host.querySelector('#fxOk').onclick = () => {
    const L = pick();
    if (!L.length) { toast('至少勾一个正确选项'); return; }
    setFix(k, L);
    let msg = '已把答案改成 ' + (fixOf(k) || []).join('');
    if (host.querySelector('#fxRe').checked && ANS[k]) {
      const okk = rejudgeRec(k, fixOf(k));
      saveAns();
      msg += okk ? '，这道题已重判为答对' : '，按新答案仍算答错';
    }
    host.innerHTML = '';
    toast(msg);
    if (done) done();
  };
  host.querySelector('#fxOrig').onclick = () => {
    delete FIX[k];
    saveFix();
    if (ANS[k]) { rejudgeRec(k, orig); saveAns(); }
    host.innerHTML = '';
    toast('已恢复题库原答案');
    if (done) done();
  };
  host.querySelector('#fxCancel').onclick = () => { host.innerHTML = ''; };
}

/* ---------- 运行时状态 ---------- */
const QZ = { bankId: null, filter: 'all', subject: '', cur: null, pending: {}, order: null, streak: 0, focusCur: false };
const SS = {
  get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} },
  del: k => { try { sessionStorage.removeItem(k); } catch (e) {} }
};

/* ---------- 小工具 ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* 安全绑定：id 不存在也不会中断后面的绑定 */
function on(id, fn, ev) { const el = $(id); if (el) el['on' + (ev || 'click')] = fn; return el; }
/* 选项文本：题库里常写成「A. 甲说法」，界面上已经另有 A/B/C/D 徽章，
   这里把与徽章重复的那个前缀去掉，免得出现「A  A. 甲说法」 */
function optText(t, K) {
  const s = String(t == null ? '' : t);
  if (!K) return s;
  const m = s.match(/^\s*([A-Ha-h])\s*[.、．·:：)）]\s*/);
  return (m && m[1].toUpperCase() === String(K).toUpperCase()) ? s.slice(m[0].length) : s;
}
/* 气泡提示：kind = ok / bad / 空（普通）。放底部，手机上不会被手指挡住。
   action = { label, fn }：给这个气泡挂一个按钮（「撤销」那种），点完就消失 */
function toast(msg, ms, kind, action) {
  const d = document.createElement('div');
  d.className = 'toast' + (kind === 'ok' ? ' ok' : kind === 'bad' ? ' bad' : '') + (action ? ' has-act' : '');
  const ic = document.createElement('span');
  ic.className = 'tic';
  ic.textContent = kind === 'ok' ? '✓' : kind === 'bad' ? '!' : 'i';
  const tx = document.createElement('span');
  tx.textContent = msg;
  d.appendChild(ic); d.appendChild(tx);
  let timer = null, gone = false;
  const kill = () => { if (gone) return; gone = true; clearTimeout(timer); d.classList.remove('show'); setTimeout(() => d.remove(), 260); };
  if (action && action.label) {
    const b = document.createElement('button');
    b.className = 'btn tiny toast-act';
    b.textContent = action.label;
    b.onclick = () => { try { action.fn && action.fn(); } catch (e) {} kill(); };
    d.appendChild(b);
  }
  document.body.appendChild(d);
  requestAnimationFrame(() => d.classList.add('show'));
  timer = setTimeout(kill, ms || (action ? 5200 : 1700));
  return d;
}
/* 动效开关：系统开了「减少动态效果」就连脉冲 / 震动一起省掉（sticky 到本页） */
function uiMotionOK() {
  try { if (typeof SET !== 'undefined' && SET && SET.reduceMotion) return false; } catch (e) {}
  try { return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return true; }
}
/* 判分后的即时反馈（候补池 B）：触屏轻轻震一下 + 选项脉冲一次 + 答错给一句小提示 */
function uiFeedbackPulse(bank, q, st, picked) {
  if (!uiMotionOK()) return;
  try {
    if (navigator.vibrate && (window.matchMedia && window.matchMedia('(hover:none)').matches)) {
      navigator.vibrate(st.ok ? 18 : [22, 60, 22]);
    }
  } catch (e) {}
  try {
    const keys = st.ok ? ansOf(favKey(bank, q), q) : (picked || []);
    document.querySelectorAll('#view .opts .opt').forEach(el => {
      if (keys.indexOf(el.dataset.k) < 0) return;
      el.classList.remove(st.ok ? 'pulse-ok' : 'pulse-bad');
      void el.offsetWidth;                       /* 重新触发动画 */
      el.classList.add(st.ok ? 'pulse-ok' : 'pulse-bad');
      setTimeout(() => el.classList.remove('pulse-ok', 'pulse-bad'), 700);
    });
  } catch (e) {}
  if (!st.ok) toast('已记入错题本', 1500, 'bad');
}
/* 判分揭示：选项按 ~55ms 淡入 + 微缩，结果框跟着轻轻亮一下。
   不做 3D 翻牌 / 波浪 / 外扩光圈；系统开了「减少动态效果」就整段跳过。 */
function uiReveal(bank, q, st) {
  if (!uiMotionOK()) return;
  const opts = [...document.querySelectorAll('#view .opts .opt')];
  const marks = opts.filter(el => el.classList.contains('right') || el.classList.contains('wrong'));
  if (!marks.length) return;
  const plan = marks.map(el => ({ el: el, cls: el.classList.contains('right') ? 'right' : 'wrong' }));
  plan.forEach(m => m.el.classList.remove('right', 'wrong'));   /* 先退回去，再轻轻揭示 */
  const fb = $('fb');
  if (fb) fb.classList.add('fb-hold');
  plan.forEach((m, i) => {
    setTimeout(() => {
      m.el.classList.add(m.cls, 'flip-in');
      setTimeout(() => m.el.classList.remove('flip-in'), 320);
      if (i === plan.length - 1 && fb) {
        setTimeout(() => { fb.classList.remove('fb-hold'); fb.classList.add('fb-pop'); setTimeout(() => fb.classList.remove('fb-pop'), 420); }, 160);
      }
    }, 55 + i * 55);
  });
}
/* §3.6-P0② 连对 streak：答对累加、答错清零，只在 3 连对起、之后每 5 连对轻提示一次（不动 fx.js 那套彩带） */
function uiStreakBump(ok) {
  if (!ok) { QZ.streak = 0; return; }
  QZ.streak = (QZ.streak || 0) + 1;
  const n = QZ.streak;
  if (n >= 3 && (n === 3 || n % 5 === 0)) toast('连对 ' + n + ' 题 🔥', 1600, 'ok');
}
/* 复制一段文本：站里一直用 execCommand 这一套（file:// 下 navigator.clipboard 常被拦） */
function uiCopyText(txt, okMsg) {
  try {
    const t = document.createElement('textarea');
    t.value = String(txt);
    t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    toast(ok ? (okMsg || '已复制') : '复制失败，请手动选中', 1400, ok ? 'ok' : 'bad');
  } catch (e) { toast('复制失败，请手动选中', 1600, 'bad'); }
}
/* 候补池 A：触屏左右滑动翻题（左滑＝下一题，右滑＝上一题）
   只在触屏上启用；横向位移 > 30px 且横向明显大于纵向才算；
   从选项 / 输入框 / 按钮上起手的不算（不然「点选项」会被当成翻页） */
function uiBindSwipe(bank) {
  const host = $('view');
  if (!host) return;
  if (!(('ontouchstart' in window) || (window.matchMedia && window.matchMedia('(hover:none)').matches))) return;
  const card = host.querySelector('.card');
  if (!card) return;
  let x0 = null, y0 = 0, t0 = 0, moved = false;
  card.addEventListener('touchstart', e => {
    x0 = null;
    if (e.touches.length !== 1) return;
    const el = e.target;
    if (el && el.closest && el.closest('input,select,textarea,button,.opts,.kbrow')) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); moved = false;
  }, { passive: true });
  card.addEventListener('touchmove', e => {
    if (x0 == null || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) moved = true;
  }, { passive: true });
  card.addEventListener('touchend', e => {
    if (x0 == null) return;
    const t = e.changedTouches && e.changedTouches[0];
    const x1 = x0; x0 = null;
    if (!t) return;
    const dx = t.clientX - x1, dy = t.clientY - y0, dt = Date.now() - t0;
    if (!moved || dt > 900) return;
    if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (typeof aiBusy === 'function' && aiBusy()) return;    /* 正在生成解析就别翻页 */
    try { e.preventDefault(); } catch (err) {}               /* 压掉紧随其后的 click */
    step(dx < 0 ? 1 : -1);
  }, { passive: false });
}
/* 候补池 H：长按题干 600ms 弹一个小菜单（复制题干 / AI 解析 / 收藏） */
function uiBindStemLongPress(bank, q, fk) {
  const stem = document.querySelector('#view .stem');
  if (!stem) return;
  let timer = null;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const openMenu = () => {
    clear();
    if ($('stemMenu')) return;
    const m = document.createElement('div');
    m.className = 'stemmenu';
    m.id = 'stemMenu';
    m.innerHTML = '<button class="btn tiny" data-a="copy">复制题干</button>'
      + '<button class="btn tiny" data-a="ai">AI 解析</button>'
      + '<button class="btn tiny" data-a="fav">' + (FAV[fk] ? '取消收藏' : '收藏') + '</button>'
      + '<button class="btn tiny" data-a="x">关闭</button>';
    stem.appendChild(m);
    m.onclick = ev => {
      const b = ev.target && ev.target.closest ? ev.target.closest('[data-a]') : null;
      if (!b) return;
      const a = b.dataset.a;
      const el = $('stemMenu'); if (el) el.remove();
      if (a === 'copy') uiCopyText(q.stem || '', '题干已复制');
      else if (a === 'ai') { if (typeof aiOpenPanel === 'function') aiOpenPanel($('aiHost'), fk, q); else toast('AI 模块没加载（ai.js）', 1600, 'bad'); }
      else if (a === 'fav') toggleFav(fk, $('btnFav'));
    };
    setTimeout(() => document.addEventListener('click', () => { const el = $('stemMenu'); if (el) el.remove(); }, { once: true }), 30);
  };
  stem.addEventListener('pointerdown', e => {
    if (e.pointerType && e.pointerType !== 'touch') return;   /* 鼠标长按不弹 */
    clear();
    timer = setTimeout(openMenu, 600);
  });
  ['pointerup', 'pointermove', 'pointercancel', 'pointerleave'].forEach(ev => stem.addEventListener(ev, clear));
}
/* 底栏滑动指示器：一个持续存在的胶囊，在 active 按钮下面滑过去。
   nav 本身不重画，所以换页时是连续动画；按钮图标再做轻微回弹。 */
function uiBottomNavInit() {
  const nav = document.querySelector('.bnav');
  if (!nav || nav.querySelector('.bnav-ind')) return;
  const ind = document.createElement('span');
  ind.className = 'bnav-ind';
  ind.setAttribute('aria-hidden', 'true');
  nav.insertBefore(ind, nav.firstChild);
  const paint = () => {
    const on = nav.querySelector('.btn.on');
    if (!on || !on.offsetWidth) { ind.style.opacity = '0'; return; }
    const nr = nav.getBoundingClientRect();
    const br = on.getBoundingClientRect();
    const bl = parseFloat(getComputedStyle(nav).borderLeftWidth) || 0;
    ind.style.opacity = '1';
    ind.style.width = br.width + 'px';
    ind.style.transform = 'translateX(' + (br.left - nr.left - bl) + 'px)';
  };
  nav.__bnavPaint = paint;
  paint();
  window.addEventListener('resize', paint);
  if ('MutationObserver' in window) {
    new MutationObserver(paint).observe(nav, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true });
  }
}

/* 底栏高亮当前所在页（第二批之后，入口都在底部导航上） */
function markTop(name) {
  const map = { home: 'bnHome', wrong: 'btnGoWrong', fav: 'btnGoFav', search: 'btnGoSearch', kb: 'btnGoKb', sync: 'btnGoSync' };
  Object.keys(map).forEach(n => {
    const el = $(map[n]);
    if (!el) return;
    const on_ = n === name;
    el.classList.toggle('on', on_);
    if (on_) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  const nav = document.querySelector('.bnav');
  if (nav && nav.__bnavPaint) nav.__bnavPaint();
}
/* §3.6-P0③ 待复习角标：数一遍「做错过且今天到期」的题，把数字挂到底部导航的「错题」上。
   纯读 ANS（`wrong > 0` + `due <= now`，和 isDue 同一套判据），不新增任何记录、不改数据层。 */
function uiDueCount() {
  const now = Date.now();
  let n = 0;
  for (const k in ANS) {
    const a = ANS[k];
    if (!a || !(a.wrong > 0)) continue;
    const d = (a.due == null ? (a.ts || 0) : a.due);
    if (d <= now) n++;
  }
  return n;
}
function uiPaintBadge() {
  const n = uiDueCount();
  const els = [];
  const byId = $('btnGoWrong');
  if (byId) els.push(byId);
  const bn = document.querySelector('.bnav');
  if (bn) bn.querySelectorAll('button').forEach(b => {
    if (/错题/.test(b.textContent || '') && els.indexOf(b) < 0) els.push(b);
  });
  els.forEach(b => {
    let s = b.querySelector('.nb-badge');
    if (!n) { if (s) s.remove(); if (!b.hasAttribute('data-due')) b.removeAttribute('title'); return; }
    if (!s) { s = document.createElement('span'); s.className = 'nb-badge'; b.appendChild(s); }
    s.textContent = n > 99 ? '99+' : String(n);
    s.title = '今天有 ' + n + ' 道错题到期该复习';
    b.setAttribute('data-due', String(n));
  });
}
/* 跨零点 / 切回前台 / 系统时间被改：角标和首页「待复习」数字跟着刷新。
   只改这两个地方，不重画整页 —— 免得把正在输入的对话/搜索框冲掉。 */
function uiDayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
let _uiDueDay = uiDayKey();
function uiRefreshDueNow() {
  try { uiPaintBadge(); } catch (e) {}
  const btn = document.querySelector('.hstat [data-act="review"]');
  if (!btn) return;
  const n = uiDueCount();
  const b = btn.querySelector('b');
  if (b) b.textContent = String(n);
  btn.classList.toggle('off', !n);
  btn.title = n ? '开始今日复习' : '今天没有该复习的题';
  /* 首页那颗「今日复习 N 题」跟着改；变成 0 就收起来 */
  const rv = document.getElementById('toReview');
  if (rv) {
    if (!n) rv.remove();
    else {
      const cap = +srsCfg().daily || 0;
      rv.textContent = '今日复习 ' + (cap && n > cap ? cap + ' / ' + n : n) + ' 题';
    }
  }
}
function uiDueDayTick() {
  const k = uiDayKey();
  if (k === _uiDueDay) return;
  _uiDueDay = k;
  uiRefreshDueNow();
}
setInterval(uiDueDayTick, 30000);
document.addEventListener('visibilitychange', function () { if (!document.hidden) uiRefreshDueNow(); });
window.addEventListener('focus', uiRefreshDueNow);

/* 一键到底 / 一键到顶：右下角一个浮动按钮，按当前滚动位置切方向。
   长页面（题库、统计、解析）才有；内容不够一屏就自动隐藏。 */
function uiScrollJumpInit() {
  if (document.getElementById('scrollJump')) return;
  const wrap = document.createElement('div');
  wrap.id = 'scrollJump';
  wrap.className = 'scroll-jump';
  wrap.innerHTML = '<button type="button" class="sj-top" aria-label="回到顶部" title="回到顶部">↑</button>'
    + '<button type="button" class="sj-bottom" aria-label="跳到页面底部" title="跳到页面底部">↓</button>';
  document.body.appendChild(wrap);
  const upBtn = wrap.querySelector('.sj-top');
  const downBtn = wrap.querySelector('.sj-bottom');
  const doc = document.documentElement;
  const maxY = () => Math.max(0, ((doc && doc.scrollHeight) || document.body.scrollHeight || 0) - window.innerHeight);
  /* 聊天页整页高度固定，真正滚的是 #chatLog；其它页面滚 window。 */
  function target() {
    const page = document.querySelector('.chat-page');
    const log = page && document.getElementById('chatLog');
    if (log) {
      const max = (log.scrollHeight || 0) - (log.clientHeight || 0);
      if (max > 80) return { y: log.scrollTop || 0, max: max, el: log, win: false };
    }
    return { y: window.scrollY || doc.scrollTop || 0, max: maxY(), el: null, win: true };
  }
  function goTo(t, top, smooth) {
    const behavior = smooth ? 'smooth' : 'auto';
    if (!t.win && t.el) {
      try { t.el.scrollTo({ top: top, behavior: behavior }); }
      catch (e) { t.el.scrollTop = top; }
    } else {
      try { window.scrollTo({ top: top, behavior: behavior }); }
      catch (e) { window.scrollTo(0, top); }
    }
  }
  let raf = 0;
  function paint() {
    raf = 0;
    const t = target();
    const show = t.max > 120;
    wrap.classList.toggle('show', show);
    if (!show) return;
    wrap.classList.toggle('at-top', t.y <= 2);
    wrap.classList.toggle('at-bottom', t.y >= t.max - 4);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(paint); };
  const jump = (toTop) => {
    const t = target();
    const smooth = !(typeof uiMotionOK === 'function' && !uiMotionOK());
    goTo(t, toTop ? 0 : t.max, smooth);
    paint();                         /* 即时滚动时立刻切换箭头；平滑滚动由 scroll 事件接着刷 */
    setTimeout(kick, 120);
  };
  upBtn.onclick = () => jump(true);
  downBtn.onclick = () => jump(false);
  window.addEventListener('hashchange', function () { setTimeout(paint, 0); });
  /* 键盘聚焦到浮钮时，Enter / 空格只触发按钮，别让答题页的全局 Enter 快捷键再走一题 */
  wrap.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') e.stopPropagation();
  });
  window.addEventListener('scroll', kick, { passive: true });
  document.addEventListener('scroll', kick, { capture: true, passive: true });  /* 接住 #chatLog 内部滚动 */
  window.addEventListener('resize', kick);
  const view = document.getElementById('view');
  if (view && 'MutationObserver' in window) {
    new MutationObserver(kick).observe(view, { childList: true, subtree: true, characterData: true });
  }
  paint();
  setTimeout(paint, 60);     /* 首页内容由 cat.js 稍后挂进来：再刷一次，确认导航/浮钮状态 */
  setInterval(paint, 600);   /* 聊天记录是内部滚动、高度会自己长；定时兜底，别等用户滚一下才出现 */
}

uiScrollJumpInit();

/* ============================================================
   主界面总导航：独立悬浮胶囊，可拖动，松手吸附左右边，位置记住。
   只在首页显示；点开是「顶部 / 学习概览 / 全部题库 / 临时套卷 / 数据备份 / 底部」。
   ============================================================ */
function uiHomeNavInit() {
  if (document.getElementById('homeNavFab')) return;
  const fab = document.createElement('div');
  fab.id = 'homeNavFab';
  fab.className = 'home-nav-fab';
  fab.setAttribute('role', 'button');
  fab.setAttribute('tabindex', '0');
  fab.setAttribute('aria-label', '主界面导航');
  fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML = '<span class="hnf-ic">☰</span><span class="hnf-tx">导航</span>';
  const menu = document.createElement('div');
  menu.id = 'homeNavMenu';
  menu.className = 'home-nav-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.innerHTML = '<div class="hn-head"><span class="hn-cap">主界面导航</span>'
    + '<button class="hn-x" type="button" aria-label="关闭">×</button></div>'
    + '<button type="button" class="hn-item" data-hn="top" role="menuitem"><span class="hn-i">⇡</span><span>顶部</span></button>'
    + '<button type="button" class="hn-item" data-hn="secBento" role="menuitem"><span class="hn-i">◫</span><span>学习概览</span></button>'
    + '<button type="button" class="hn-item" data-hn="nbHome" role="menuitem"><span class="hn-i">▤</span><span>全部题库</span></button>'
    + '<button type="button" class="hn-item" data-hn="secPapers" role="menuitem"><span class="hn-i">▧</span><span>临时套卷</span></button>'
    + '<button type="button" class="hn-item" data-hn="secBackup" role="menuitem"><span class="hn-i">⤓</span><span>数据备份</span></button>'
    + '<button type="button" class="hn-item" data-hn="bottom" role="menuitem"><span class="hn-i">⇣</span><span>底部</span></button>';
  document.body.appendChild(fab);
  document.body.appendChild(menu);

  const POS_KEY = 'qbank.homenav.pos.v1';
  const M = 12;
  let side = 'right', top = 0, dragging = false, moved = false, start = null, startRect = null, skipClick = false;
  const vw = () => window.innerWidth || document.documentElement.clientWidth;
  const vh = () => window.innerHeight || document.documentElement.clientHeight;
  const fabW = () => fab.offsetWidth || 76;
  const fabH = () => fab.offsetHeight || 44;
  const clampTop = y => Math.max(72, Math.min(y, vh() - fabH() - 96));
  const isHome = () => { try { return typeof route === 'function' && route().name === 'home'; } catch (e) { return false; } };

  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (p && (p.side === 'left' || p.side === 'right') && isFinite(p.top)) { side = p.side; top = +p.top; }
  } catch (e) {}
  if (!top) top = Math.round(vh() * 0.42);

  function place() {
    fab.style.left = ''; fab.style.right = '';
    if (side === 'left') fab.style.left = M + 'px'; else fab.style.right = M + 'px';
    top = clampTop(top);
    fab.style.top = top + 'px';
  }
  function savePos() {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ side: side, top: clampTop(top) })); } catch (e) {}
  }
  function closeMenu() {
    menu.hidden = true;
    fab.classList.remove('open');
    fab.setAttribute('aria-expanded', 'false');
  }
  function openMenu() {
    menu.querySelectorAll('[data-hn]').forEach(function (b) {
      const id = b.dataset.hn;
      b.style.display = (id === 'top' || id === 'bottom' || document.getElementById(id)) ? '' : 'none';
    });
    menu.style.left = ''; menu.style.right = ''; menu.style.top = '';
    const r = fab.getBoundingClientRect();
    if (side === 'right') menu.style.right = Math.max(M, vw() - r.left + 10) + 'px';
    else menu.style.left = Math.max(M, r.right + 10) + 'px';
    menu.hidden = false;
    fab.classList.add('open');
    fab.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(function () {
      const mh = menu.offsetHeight || 300;
      const y = Math.max(72, Math.min(r.top + r.height / 2 - mh / 2, vh() - mh - 88));
      menu.style.top = y + 'px';
    });
  }
  function toggleMenu() { if (menu.hidden) openMenu(); else closeMenu(); }
  function sync() {
    const home = isHome();
    fab.classList.toggle('show', home);
    if (!home) closeMenu();
  }

  place();
  sync();

  /* 拖动：按下记起点，移动超过 6px 才算拖；松手吸附到最近的左右边 */
  fab.addEventListener('pointerdown', function (e) {
    if (e.button != null && e.button !== 0) return;
    dragging = true; moved = false;
    start = { x: e.clientX, y: e.clientY };
    startRect = fab.getBoundingClientRect();
    try { fab.setPointerCapture(e.pointerId); } catch (err) {}
    fab.classList.add('dragging');
    document.body.classList.add('hn-dragging');
  });
  fab.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 6) {
      moved = true;
      closeMenu();
    }
    if (!moved) return;
    try { e.preventDefault(); } catch (err) {}
    const nx = Math.max(M, Math.min(startRect.left + dx, vw() - M - fabW()));
    const ny = Math.max(72, Math.min(startRect.top + dy, vh() - 96 - fabH()));
    fab.style.left = nx + 'px'; fab.style.right = '';
    fab.style.top = ny + 'px';
  });
  function endDrag(e) {
    if (!dragging) return;
    /* 先读位置再撤 dragging：撤了以后 left/top 的过渡会重新打开，
       getBoundingClientRect 可能还停在旧位置，吸附方向就会判错。 */
    const r = fab.getBoundingClientRect();
    const wasMoved = moved;
    dragging = false;
    fab.classList.remove('dragging');
    document.body.classList.remove('hn-dragging');
    try { if (e && e.pointerId != null) fab.releasePointerCapture(e.pointerId); } catch (err) {}
    if (!wasMoved) return;                   /* 没拖动：交给 click 开菜单 */
    side = (r.left + r.width / 2 < vw() / 2) ? 'left' : 'right';
    top = clampTop(r.top);
    fab.classList.add('snapping');
    place(); savePos();
    setTimeout(function () { fab.classList.remove('snapping'); }, 240);
    skipClick = true;
    setTimeout(function () { skipClick = false; }, 400);
  }
  fab.addEventListener('pointerup', endDrag);
  fab.addEventListener('pointercancel', endDrag);
  fab.addEventListener('click', function (e) {
    e.stopPropagation();
    if (skipClick) { skipClick = false; return; }
    toggleMenu();
  });
  fab.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault(); e.stopPropagation(); toggleMenu();
    } else if (e.key === 'Escape') { closeMenu(); }
  });
  menu.querySelector('.hn-x').onclick = function () { closeMenu(); };
  menu.addEventListener('click', function (e) {
    const b = e.target.closest('[data-hn]');
    if (!b) return;
    const id = b.dataset.hn;
    const smooth = !(typeof uiMotionOK === 'function' && !uiMotionOK());
    if (id === 'top') {
      try { window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' }); } catch (err) { window.scrollTo(0, 0); }
    } else if (id === 'bottom') {
      const y = Math.max(0, (document.documentElement.scrollHeight || document.body.scrollHeight || 0) - window.innerHeight);
      try { window.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'auto' }); } catch (err) { window.scrollTo(0, y); }
    } else {
      const el = document.getElementById(id);
      if (el) {
        const y2 = Math.max(0, el.getBoundingClientRect().top + (window.scrollY || 0) - 64);
        try { window.scrollTo({ top: y2, behavior: smooth ? 'smooth' : 'auto' }); } catch (err) { window.scrollTo(0, y2); }
      }
    }
    closeMenu();
  });
  document.addEventListener('click', function (e) {
    if (menu.hidden) return;
    if (menu.contains(e.target) || fab.contains(e.target)) return;
    closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden) closeMenu();
  });
  window.addEventListener('scroll', closeMenu, { passive: true });
  window.addEventListener('resize', function () { top = clampTop(top); place(); closeMenu(); });
  window.addEventListener('hashchange', function () { setTimeout(sync, 0); });
  setTimeout(sync, 60);
}

uiHomeNavInit();
uiBottomNavInit();
/* §3.6-P0① 专注模式：`body.focus` 由 applyLook() 统一加（设置里也能开关），这里只管切状态 + 提示。
   答题页的「⛶ 专注」按钮、右下角浮出的「退出专注」、Esc 都走这里。 */
function uiSetFocus(on, quiet) {
  const v = !!on;
  if (!!SET.focus === v) { if (!v && !quiet) applyLook(); return; }
  setLook('focus', v);                       /* 写 LS + applyLook（body.focus 一起切） */
  if (!quiet) toast(v ? '专注模式：顶栏和底栏收起来了（Esc 退出）' : '已退出专注模式', 1800, v ? '' : 'ok');
}
/* §8 视觉 v2：答题页的「⋯ 更多」抽屉（改解析 / 改答案 / AI 解析 / AI 变式题 收进来）。
   on 不给就按当前状态反切；面板本身留在 DOM 里，所以探针用 getElementById('doNote').click()
   照样点得到（display:none 不妨碍程序化 click）。 */
function qSheetToggle(on) {
  const s = document.getElementById('qSheet');
  if (!s) return;
  const want = (on === undefined || on === null) ? s.hasAttribute('hidden') : !!on;
  if (want) s.removeAttribute('hidden'); else s.setAttribute('hidden', '');
  if (document.body) document.body.classList.toggle('sheet-open', want);
}
/* 列表入场：给「错题本 / 收藏 / 搜索」的卡片排上入场延迟。   只算前 12 个（长列表一次性动会掉帧），--i 交给 style.css 的 .stagger > * 用。 */
function staggerList(host) {
  const box = host || $('view');
  if (!box) return;
  const kids = [...box.querySelectorAll(':scope > .wi, :scope > .card.wi')];
  kids.forEach((el, i) => {
    if (i >= 12) { el.style.removeProperty('--i'); el.classList.remove('stagger-i'); return; }
    el.style.setProperty('--i', String(i));
    el.classList.add('stagger-i');
  });
}
window.addEventListener('animationend', e => {
  if (e.target && e.target.classList && e.target.classList.contains('stagger-i')) e.target.classList.remove('stagger-i');
});
function download(name, text, mime) {
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function stamp() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}
const safeName = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);

/* ---------- 路由 ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  /* 地址栏的 hash 会被浏览器做百分号编码：题库 id 里若带中文（例如自带的 ttsx-内科学-1
     会变成 ttsx-%E5%86%85%E7%A7%91%E5%AD%A6-1），不解码就查不到题库，
     点「开始」会被 renderQuiz 当成无效题库弹回首页。 */
  const parts = h.split('/').map(p => { try { return decodeURIComponent(p); } catch (e) { return p; } });
  if (parts[0] === 'bank' && parts[1]) return { name: 'quiz', bankId: parts[1] };
  if (parts[0] === 'import') return { name: 'import' };
  if (parts[0] === 'wrong') return { name: 'wrong' };
  if (parts[0] === 'fav') return { name: 'fav' };
  if (parts[0] === 'exam' && parts[1]) return { name: 'exam', bankId: parts[1] };
  if (parts[0] === 'review') return { name: 'wrong' };   // 复习入口已并入错题本
  if (parts[0] === 'search') return { name: 'search' };
  if (parts[0] === 'kb') return { name: 'kb' };
  if (parts[0] === 'sync') return { name: 'sync' };   /* 云同步（sync.js）：电脑 ↔ 手机共用一份记录 */
  if (parts[0] === 'stats') return { name: 'stats' };
  if (parts[0] === 'report') return { name: 'report' };       /* AI 学情诊断（report.js） */
  if (parts[0] === 'qlist' && parts[1]) return { name: 'qlist', bankId: parts[1] };   /* 题目管理（cat.js）：一张张读题 / 批量删题 */
  if (parts[0] === 'chat') return { name: 'chat' };                                          /* AI 对话（chat.js）：出题 / 问知识点 / 分析题库 */
  return { name: 'home' };
}
function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}

/* ---------- 「继续上次」：记住最近做的是哪个题库、哪一题 ----------
   以前每题号都存在 qbank.last.<题库id> 里，但首页不知道最近开的是哪个题库。
   这里再记一条总的，首页就能直接把「继续刷题」摆在最上面。 */
const LAST_BANK_KEY = 'qbank.lastbank.v1';
function rememberLast(bank, qid) {
  if (!bank || bank.paper) return;          // 临时套卷随时可能被删，不记
  writeLS(LAST_BANK_KEY, { bankId: bank.id, qid: qid == null ? null : qid, ts: Date.now() });
}
function lastPos() {
  const v = readLS(LAST_BANK_KEY, null);
  if (!v || !v.bankId) return null;
  const b = bankById(v.bankId);
  if (!b || !b.questions || !b.questions.length) return null;
  let done = 0, ok = 0;
  b.questions.forEach(x => { const a = ANS[kOf(b, x)]; if (a && !a.redo) { done++; if (a.ok) ok++; } });
  let idx = b.questions.findIndex(x => String(x.id) === String(v.qid));
  if (idx < 0) idx = 0;
  return { bank: b, done: done, ok: ok, n: b.questions.length, idx: idx, ts: +v.ts || 0 };
}
window.addEventListener('hashchange', render);
/* 任何一个脚本文件顶层抛错也留个提示，而不是白屏 */
window.addEventListener('error', e => { if (e && e.message) showFatal(e.error || e.message); });
window.addEventListener('unhandledrejection', e => { if (e && e.reason) showFatal(e.reason); });

/* render 出错不再白屏：留一条错误提示，能复制能重载 */
let FATAL_SHOWN = false;
function showFatal(err) {
  const msg = (err && (err.stack || err.message)) || String(err == null ? '未知错误' : err);
  try { console.error('[刷题站]', err); } catch (e) {}
  if (FATAL_SHOWN) return;
  FATAL_SHOWN = true;
  const bar = document.createElement('div');
  bar.id = 'fatalBar';
  bar.innerHTML = '<div class="fb-in"><b>页面出错了。</b><span class="fb-msg"></span>'
    + '<div class="fb-acts"><button class="btn tiny" id="fbCopy">复制错误</button>'
    + '<button class="btn tiny primary" id="fbReload">重新加载</button>'
    + '<button class="btn tiny" id="fbClose">关掉</button></div>'
    + '<div class="small muted">常见原因：题库文件格式不对，或浏览器缓存是旧的（按 Ctrl+F5 强刷一次）。你的作答记录不会因为这次报错丢失。</div></div>';
  document.body.appendChild(bar);
  const m = bar.querySelector('.fb-msg');
  if (m) m.textContent = ' ' + String(msg).split('\n')[0].slice(0, 300);
  const cp = bar.querySelector('#fbCopy');
  if (cp) cp.onclick = () => {
    const t = document.createElement('textarea');
    t.value = String(msg); document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); toast('错误信息已复制'); } catch (e) { toast('复制失败，请手动选中'); }
    t.remove();
  };
  const rl = bar.querySelector('#fbReload');
  if (rl) rl.onclick = () => location.reload();
  const cl = bar.querySelector('#fbClose');
  if (cl) cl.onclick = () => { bar.remove(); FATAL_SHOWN = false; };
}
function render() {
  if (typeof richFlush === 'function') richFlush();          // 方案十：换页 / 重画前先保存就地编辑
  try {
    const r = route();
    const sig = r.name + '/' + (r.bankId || '');
    /* §3.6-P2⑥：换页 + 这页真可能卡一下 → 先同步铺一层骨架，真内容留到下一个宏任务，
       这样浏览器能先把骨架画出来（渲染真慢的时候，用户看到的是骨架，不是白屏） */
    if (sig !== _lastViewSig && skelNeeded(r) && skelPaint(r)) {
      setTimeout(() => { try { renderInner(); } catch (err) { showFatal(err); } }, 0);
      return;
    }
    renderInner();
  }
  catch (err) { showFatal(err); }
}
function renderInner() {
  const r = route();
  document.querySelectorAll('.mask').forEach(m => m.classList.remove('show'));
  const full = (r.name === 'quiz' || r.name === 'exam');
  document.body.classList.toggle('quiz', full);
  $('nav').style.display = r.name === 'quiz' ? 'flex' : 'none';
  $('chips').style.display = r.name === 'quiz' ? 'flex' : 'none';
  var sjc = $('subjchips'); if (sjc) sjc.style.display = r.name === 'quiz' ? 'flex' : 'none';
  /* 第二批：顶栏瘦身 —— 题号 / 设置 都挪到下面了（答题卡的「上一题 / 答题卡 / 下一题」里有 #jumpInfo，
     底部导航里有 #btnSetAll），所以这两个老按钮统一收起来，只留在 DOM 里给老代码兜底。 */
  $('btnGrid').style.display = 'none';
  $('btnQuizSet').style.display = 'none';
  $('btnHome').style.display = r.name === 'home' ? 'none' : '';
  /* 固定返回键：非首页都显示；挪到 body 下才不会被顶栏的 backdrop-filter 限制成随顶栏滚走 */
  var bfEl = $('backFix');
  if (bfEl && bfEl.parentNode !== document.body) document.body.appendChild(bfEl);
  if (bfEl) bfEl.style.display = r.name === 'home' ? 'none' : '';
  document.body.classList.toggle('has-back', r.name !== 'home');
  /* 底部导航的六个去处：不分页面，一直显示 */
  $('btnGoWrong').style.display = '';
  $('btnGoFav').style.display = '';
  $('btnGoSearch').style.display = '';
  if ($('btnGoKb')) $('btnGoKb').style.display = '';
  if ($('btnSetAll')) $('btnSetAll').style.display = '';

  /* 考试没交卷就想跳走：先确认，免得倒计时在后台自己跑 */
  if (typeof examActive === 'function' && examActive() && r.name !== 'exam') {
    if (!confirm('考试还没交卷。离开的话倒计时仍会继续，确定离开？')) { go('#/exam/' + EX.id); return; }
    stopExamTimer();
  }

  if (r.name === 'home') renderHome();
  else if (r.name === 'import') renderImport();
  else if (r.name === 'wrong') { if (typeof renderWrong === 'function') renderWrong(); }
  else if (r.name === 'fav') { if (typeof renderFav === 'function') renderFav(); }
  else if (r.name === 'search') { if (typeof renderSearch === 'function') renderSearch(); }
  else if (r.name === 'stats') renderStats();
  else if (r.name === 'report') { if (typeof renderReport === 'function') renderReport(); }
  else if (r.name === 'kb') { if (typeof renderKb === 'function') renderKb(); }
  else if (r.name === 'sync') { if (typeof renderSync === 'function') renderSync(); }
  else if (r.name === 'exam') { if (typeof renderExam === 'function') renderExam(r.bankId); }
  else if (r.name === 'qlist') { if (window.CAT && CAT.qlistRender) CAT.qlistRender(r.bankId); else $('view').innerHTML = '<div class="card"><div class="empty">题目管理模块没加载（cat.js）。</div></div>'; }
  else if (r.name === 'chat') { if (window.CHAT && CHAT.render) CHAT.render(); else $('view').innerHTML = '<div class="card"><div class="empty">AI 对话模块没加载（chat.js）。</div></div>'; }
  else renderQuiz(r.bankId);
  markTop(r.name);
  try { uiPaintBadge(); } catch (e) {}
  viewEnter(r);
}

/* 视图签名守卫：只有「换了个页面」才播入场动画。
   renderQuiz 每答一题、每翻一题都会重写 #view，所以答题页只看「哪个题库」，
   无脑加动画会变成每答一题整页闪一下。 */
let _lastViewSig = '';
function viewEnter(r) {
  const sig = r.name + '/' + (r.bankId || '');
  if (sig === _lastViewSig) return;
  _lastViewSig = sig;
  skelDrop();                               /* §3.6-P2⑥：真内容已经在了，还留着骨架就摘掉 */
  const v = $('view');
  if (!v) return;
  v.classList.remove('view-enter');
  void v.offsetWidth;                       /* 重排一下，让同一个类能重新播 */
  v.classList.add('view-enter');
}
window.addEventListener('animationend', e => {
  if (e.target && e.target.id === 'view') e.target.classList.remove('view-enter');
});

/* ============================================================
   §3.6-P2⑥ 骨架屏：换页那一瞬间先给个「形状」，别让屏幕白一下
   ------------------------------------------------------------
   · 首屏那层直接写在 index.html 的 #view 里 —— JS / 知识库还在解析时它就看得见，不用等任何人；
   · 这里只管「换页」：只有真可能卡一下的地方才铺（知识库 / 搜索全部 / 学习统计 / 大题库），
     铺完把真内容丢进下一个宏任务，浏览器才有机会先把骨架画出来；
   · 答题页每答一题都会重画，所以只在「换了个题库」时铺（签名跟 viewEnter 那一套一致）。
   ============================================================ */
const SKEL_BIG_Q = 200;                 /* 题库超过这么多题才值得铺一层 */
function skelHtml(kind) {
  const bl = w => '<i class="sk-bl" style="width:' + w + '%"></i>';
  const card = ws => '<div class="sk-card">' + ws.map(bl).join('') + '</div>';
  if (kind === 'quiz') return '<div class="skel" aria-hidden="true">' + card([62, 100, 88, 74, 92]) + card([40, 70]) + '</div>';
  if (kind === 'stats') return '<div class="skel" aria-hidden="true">' + card([30, 100, 100]) + card([46, 100, 92, 84]) + '</div>';
  return '<div class="skel" aria-hidden="true">'
    + '<div class="sk-hero">' + bl(38) + bl(72) + bl(54) + '</div>'
    + card([100, 76])
    + '<div class="sk-grid">' + card([100, 62]) + card([100, 58]) + '</div></div>';
}
function skelNeeded(r) {
  if (!r || r.name === 'exam') return false;                    /* 考试有自己的倒计时，别插队 */
  if (r.name === 'quiz') {
    const b = (typeof bankById === 'function') ? bankById(r.bankId) : null;
    return !!(b && b.questions && b.questions.length >= SKEL_BIG_Q);
  }
  return r.name === 'kb' || r.name === 'search' || r.name === 'stats';
}
function skelPaint(r) {
  const v = $('view');
  if (!v) return false;
  v.innerHTML = skelHtml(r.name === 'quiz' ? 'quiz' : (r.name === 'kb' || r.name === 'stats') ? 'stats' : 'home');
  return true;
}
/* 真内容画好了：把还留在那儿的骨架摘掉（正常情况下 innerHTML 已经把它顶掉了，这是兜底） */
function skelDrop() {
  const v = $('view');
  if (!v) return;
  const sk = v.querySelector('.skel');
  if (sk && sk.parentNode === v) sk.remove();
}

/* ============================================================
   首页
   ============================================================ */
/* 备份提醒：本机浏览器数据一旦被清就没了，没备份过或超过 7 天就提示一下 */
function backupHint() {
  const last = +readLS(BACKUP_KEY, 0) || 0;
  if (!last) return '<div class="note err" style="margin:0 0 10px">还没有导出过备份。清一次浏览器缓存、或者换设备，刷题记录就全没了，建议现在导出一份。</div>';
  const days = Math.floor((Date.now() - last) / 86400000);
  if (days >= 7) return '<div class="note" style="margin:0 0 10px">上次备份是 ' + days + ' 天前（' + fmtTime(last) + '），建议再导出一份。</div>';
  return '<div class="small muted" style="margin:0 0 10px">上次备份：' + fmtTime(last) + '</div>';
}

/* 今日学习看板：今日已答 / 今日正确率 / 连续刷题天数 */
function todayStats() {
  const dayOf = ts => { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const today = dayOf(Date.now());
  const days = {};
  const weekAgo = Date.now() - 7 * 86400000;
  let dNum = 0, dOk = 0, weekN = 0;
  Object.keys(ANS).forEach(k => {
    const a = ANS[k]; if (!a || !a.ts) return;
    const d = dayOf(a.ts);
    days[d] = 1;
    if (a.ts >= weekAgo) weekN++;
    if (d === today) { dNum++; if (a.ok) dOk++; }
  });
  let streak = 0;
  const base = new Date(); base.setHours(0, 0, 0, 0);
  for (let i = 0; i < 3650; i++) {
    const d = dayOf(base.getTime() - i * 86400000);
    if (days[d]) streak++;
    else if (i > 0) break;      // 今天还没做不算断
  }
  return { dNum: dNum, dOk: dOk, streak: streak, weekN: weekN };
}

/* §3.6-P1④ 学习热力图：拿现有作答记录的时间戳（ANS[k].ts）按天分桶，不新增任何存储。
   返回 cells 按时间正序，每格 { ts, n, l }（l = 0..4 的档位，给颜色用），外加 total / max / weeks。
   排布：7 行（周一…周日）× weeks 列，最后一列是本周。 */
function heatStats(weeks) {
  const w = Math.max(4, Math.min(53, Math.round(+weeks || 12)));   /* 上限是一年（53 周）：桌面首页要铺满整张卡 */
  const dayOf = ts => { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const cnt = {};
  Object.keys(ANS).forEach(k => {
    const a = ANS[k]; if (!a || !a.ts) return;
    const d = dayOf(a.ts); cnt[d] = (cnt[d] || 0) + 1;
  });
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const dow = (base.getDay() + 6) % 7;                       // 0 = 周一
  const start = base.getTime() - (dow + (w - 1) * 7) * 86400000;
  const cells = []; let total = 0, max = 0;
  for (let i = 0; i < w * 7; i++) {
    const ts = start + i * 86400000;
    const n = cnt[dayOf(ts)] || 0;
    total += n; if (n > max) max = n;
    cells.push({ ts: ts, n: n });
  }
  cells.forEach(c => {
    c.l = c.n <= 0 ? 0 : c.n <= 2 ? 1 : c.n <= 5 ? 2 : c.n <= 10 ? 3 : 4;
  });
  return { cells: cells, total: total, max: max, weeks: w };
}

/* 候补池 C：一题都还没有时的「三步就能开始」引导卡（有题库了返回空串）。
   注意：首页正文实际由 cat.js 的目录视图接管（它会把 app.js 渲染出来的卡片清掉），
   所以 cat.js 的 homeHtml() 也调这个函数取一次；两边共用，别各写一份。 */
function firstGuideHtml() {
  if (typeof baseBanks === 'function' && baseBanks().length) return '';
  return `
    <div class="card guide" id="firstGuide">
      <div class="gname">三步就能开始</div>
      <div class="gstep"><b>①</b><div><div class="gt">把题库导进来</div><div class="small muted">支持 JSON 题库，也支持「题干 / 选项 / 答案 / 解析」这种纯文本，粘贴或选文件都行。</div></div><button class="btn primary" data-g="#/import">去导入</button></div>
      <div class="gstep"><b>②</b><div><div class="gt">想让 AI 帮你写解析</div><div class="small muted">在「AI 与知识库」里填服务商地址 + API Key，答完题点「AI 解析」就行；还能挂上自己的资料库。</div></div><button class="btn" data-g="#/kb">去设置</button></div>
      <div class="gstep"><b>③</b><div><div class="gt">手机和电脑共用一份记录</div><div class="small muted">在「云同步」里连一个私有仓库，做题记录自动互通；不做也不影响本机使用。</div></div><button class="btn" data-g="#/sync">去同步</button></div>
      <div class="small muted" style="margin-top:8px">数据都存在本机浏览器里，换电脑或清缓存前先在下面「导出全部数据」备一份。</div>
    </div>`;
}
/* 引导卡的三个按钮用事件委托（cat.js 会重画首页，逐个绑会丢） */
/* 触屏上「滑不动」的兜底：解析块/AI 输出是 contenteditable 与可选文字，
   手指落在上面拖拽会被当成「选文字」，页面就滞住了。只要手指落点不在正在编辑的那块里，
   就先把焦点放开（顺带收键盘），把滚动权还给页面。
   ⚠ 唯独放行格式小浮条（.fmt-bar，选中文字后的 加粗 / 颜色…）：它挂在 body 上、
   不在编辑块里，点色点时要是先把编辑器失焦，手机上选区就丢了 ——
   表现出来就是「颜色改不了」（2026-10-17 用户报，实测点浮条的 pointerdown 后 activeElement 变 body）。 */
document.addEventListener('pointerdown', ev => {
  try {
    const ae = document.activeElement;
    if (!ae || !ae.isContentEditable) return;
    if (ev.target && ae.contains(ev.target)) return;
    if (ev.target && ev.target.closest && ev.target.closest('.fmt-bar')) return;   // 浮条不算「点别处」
    ae.blur();
  } catch (e) {}
}, true);

document.addEventListener('click', ev => {
  const t = ev.target && ev.target.closest ? ev.target.closest('#firstGuide [data-g]') : null;
  if (t) go(t.dataset.g);
});

function renderHome() {
  QZ.bankId = null;
  $('appTitle').textContent = '刷题站';

  const banks = baseBanks();
  const papers = allBanks().filter(b => b.paper);
  let totalQ = 0, totalDone = 0, totalOk = 0, wrongN = 0, dueN = 0;
  banks.forEach(b => b.questions.forEach(q => {
    totalQ++;
    const k = kOf(b, q), a = ANS[k];
    if (a && !a.redo) { totalDone++; if (a.ok) totalOk++; }
    if (a && (a.wrong || 0) > 0) wrongN++;
    if (isDue(k)) dueN++;
  }));
  const srsCap = +srsCfg().daily || 0;
  const favN = Object.keys(FAV).filter(k => FAV[k]).length;
  const TODAY = todayStats();

  const list = banks.map(b => {
    let done = 0, ok = 0, wr = 0;
    b.questions.forEach(q => {
      const a = ANS[kOf(b, q)];
      if (a && !a.redo) { done++; if (a.ok) ok++; }
      if (a && (a.wrong || 0) > 0) wr++;
    });
    const pct = b.questions.length ? Math.round(done / b.questions.length * 100) : 0;
    const acc = done ? Math.round(ok / done * 100) : 0;
    return `
      <div class="card bank">
        <div class="info">
          <div class="name">${esc(b.title)}${b.source === 'local' ? '<span class="pill local">自建</span>' : '<span class="pill">内置</span>'}</div>
          <div class="meta">${b.subtitle ? esc(b.subtitle) + '　' : ''}${b.questions.length} 题　已答 ${done}${wr ? `　<span class="warn">错题 ${wr}</span>` : ''}　正确率 ${acc}%</div>
          <div class="prog"><i style="width:${pct}%"></i></div>
        </div>
        <div class="acts">
          <button class="btn primary" data-start="${b.id}">${done ? '继续刷题' : '开始刷题'}</button>
          <button class="btn" data-wrong="${b.id}">错题 ${wr}</button>
          <button class="btn" data-rand="${b.id}">随机 30 题</button>
          <button class="btn" data-export="${b.id}">导出</button>
          ${b.source === 'local' ? `<button class="btn" data-edit="${b.id}">编辑</button><button class="btn danger" data-del="${b.id}">删除</button>` : ''}
        </div>
      </div>`;
  }).join('');

  const paperList = papers.map(b => {
    let done = 0, ok = 0;
    b.questions.forEach(q => { const a = ANS[kOf(b, q)]; if (a && !a.redo) { done++; if (a.ok) ok++; } });
    return `
      <div class="card bank paper-card">
        <div class="info">
          <div class="name">${esc(b.title)}<span class="pill paper">${b.exam ? '模拟考试' : '临时套卷'}</span></div>
          <div class="meta">${b.questions.length} 题　已做 ${done}　正确率 ${done ? Math.round(ok / done * 100) : 0}%</div>
          <div class="prog"><i style="width:${b.questions.length ? done / b.questions.length * 100 : 0}%"></i></div>
        </div>
        <div class="acts">
          <button class="btn primary" data-start="${b.id}">${done ? '继续' : '开始'}${b.exam ? '考试' : '做题'}</button>
          <button class="btn danger" data-delpaper="${b.id}">删除${b.exam ? '试卷' : '套卷'}</button>
        </div>
      </div>`;
  }).join('');

  /* 继续上次：最近开过的题库放到最上面，免去每次翻列表找上次做到哪 */
  const last = lastPos();
  const resumeHtml = last ? `
    <div class="resume">
      <div class="rinfo">
        <div class="rtitle">${esc(last.bank.title)}</div>
        <div class="rmeta">上次做到 第 ${last.idx + 1} / ${last.n} 题 · 已答 ${last.done} · 正确率 ${last.done ? Math.round(last.ok / last.done * 100) : 0}%${last.ts ? ' · ' + fmtTime(last.ts) : ''}</div>
        <div class="prog"><i style="width:${last.n ? Math.round(last.done / last.n * 100) : 0}%"></i></div>
      </div>
      <button class="btn primary" id="toResume">继续刷题</button>
    </div>` : '';

  /* 候补池 C：一题都还没有时，给一块「三步就能开始」的引导（有题了就不再出现） */
  const guideHtml = firstGuideHtml();

  const bytes = storageBytes();
  $('view').innerHTML = `
    <div class="hero">
      <h1>刷题站</h1>
      <p>选择题即时判分，选错立刻出解析。错题自动进错题本，可批量收藏 / 移除 / 清空次数 / 组成套卷再做一遍，也能改解析、按需导出。</p>
      <div class="hstat">
        <button class="hs" data-act="banks" title="往下看我的题库"><b>${banks.length}</b>个题库</button>
        <button class="hs" data-go="#/stats" title="学习统计"><b>${totalQ}</b>道题</button>
        <button class="hs" data-go="#/stats" title="学习统计"><b>${totalDone}</b>已答</button>
        <button class="hs" data-go="#/stats" title="学习统计"><b>${totalDone ? Math.round(totalOk / totalDone * 100) : 0}%</b>正确率</button>
        <button class="hs" data-go="#/wrong" title="打开错题本"><b>${wrongN}</b>错题</button>
        <button class="hs" data-go="#/fav" title="打开收藏"><b>${favN}</b>收藏</button>
        <button class="hs${dueN ? '' : ' off'}" data-act="review" title="${dueN ? '开始今日复习' : '今天没有该复习的题'}"><b>${dueN}</b>待复习</button>
      </div>
      <div class="hstat today">
        <div><b>${TODAY.dNum}</b>今日已答</div>
        <div><b>${TODAY.dNum ? Math.round(TODAY.dOk / TODAY.dNum * 100) : 0}%</b>今日正确率</div>
        <div><b>${TODAY.streak}</b>连续天数</div>
        <div><b>${TODAY.weekN}</b>近 7 天</div>
      </div>
    </div>
    ${resumeHtml}
    ${guideHtml}
    <div class="toolbar main">
      <button class="btn primary" id="toImport">＋ 导入 / 新建题库</button>
      ${dueN ? `<button class="btn primary" id="toReview">今日复习 ${srsCap && dueN > srsCap ? srsCap + ' / ' + dueN : dueN} 题</button>` : ''}
      <button class="btn" id="toRand">随机抽 30 题</button>
    </div>
    <div class="toolbar sub">
      <button class="btn" id="toWrong">错题本${wrongN ? '（' + wrongN + (dueN ? ' · 待复习 ' + dueN : '') + '）' : ''}</button>
      <button class="btn" id="toFav">收藏${favN ? '（' + favN + '）' : ''}</button>
      <button class="btn" id="toSearch">搜索题目<span class="kbd">/</span></button>
      <button class="btn" id="toStats">学习统计</button>
      <button class="btn" id="toHelp">快捷键<span class="kbd">?</span></button>
      <span class="small muted" id="storeUse" style="flex:1;min-width:180px">数据存在本机浏览器，共占用约 ${(bytes / 1024 / 1024).toFixed(2)} MB（本地估算，正在算真实占用…）。</span>
    </div>
    ${papers.length ? `<h2 class="sec">临时套卷</h2>${paperList}` : ''}
    <h2 class="sec" id="secBanks">我的题库</h2>
    ${list || '<div class="card"><div class="empty">还没有题库，点上面的按钮加一个吧。</div></div>'}
    <div class="card" style="margin-top:16px">
      <div class="name" style="font-weight:700;margin-bottom:6px">数据备份</div>
      <div class="small muted" style="margin-bottom:10px">作答记录、错题、收藏、自定义解析都存在本机浏览器里。换电脑或清缓存前，建议导出备份。</div>
      ${backupHint()}
      <div class="row-inline">
        <button class="btn" id="expAll">导出全部数据</button>
        <button class="btn" id="impAll">导入数据（恢复）</button>
        <input type="file" id="impAllFile" accept=".json" style="display:none">
      </div>
    </div>`;

  $('stat').textContent = `${totalDone}/${totalQ}`;
  $('bar').style.width = (totalQ ? totalDone / totalQ * 100 : 0) + '%';
  on('toImport', () => go('#/import'));
  on('toWrong', () => go('#/wrong'));
  on('toFav', () => go('#/fav'));
  on('toSearch', () => go('#/search'));
  on('toRand', () => randomPaper(baseBanks(), 30));
  on('toStats', () => go('#/stats'));
  on('toHelp', showHelp);
  on('toReview', () => startReview(60));
  on('toResume', () => { if (last) startBank(last.bank.id); });
  on('expAll', exportAllData);
  on('impAll', () => $('impAllFile').click());
  on('impAllFile', importAllData, 'change');
  /* 首页上调色板：统计块能直接点进去 */
  document.querySelectorAll('.hstat [data-go]').forEach(el => el.onclick = () => go(el.dataset.go));
  /* 首次引导卡上的三个按钮：走 document 上的事件委托（见 firstGuideHtml 上面），这里不用再绑 */
  document.querySelectorAll('.hstat [data-act]').forEach(el => el.onclick = () => {
    const a = el.dataset.act;
    if (a === 'banks') { const s = $('secBanks'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (a === 'review') { if (dueN) startReview(60); else toast('今天没有到期的复习题，接着刷题就好'); }
  });

  document.querySelectorAll('[data-start]').forEach(el => el.onclick = () => startBank(el.dataset.start));
  document.querySelectorAll('[data-wrong]').forEach(el => el.onclick = () => { QZ.filter = 'wrong'; startBank(el.dataset.wrong); });
  document.querySelectorAll('[data-export]').forEach(el => el.onclick = () => exportBank(bankById(el.dataset.export)));
  document.querySelectorAll('[data-rand]').forEach(el => el.onclick = () => randomPaper([bankById(el.dataset.rand)], 30));
  document.querySelectorAll('[data-delpaper]').forEach(el => el.onclick = () => deletePaper(el.dataset.delpaper));
  document.querySelectorAll('[data-edit]').forEach(el => el.onclick = () => {
    const b = bankById(el.dataset.edit);
    SS.set('editing', b.id);
    SS.set('importText', JSON.stringify({ id: b.id, title: b.title, subtitle: b.subtitle, questions: b.questions }, null, 2));
    go('#/import');
  });
  document.querySelectorAll('[data-del]').forEach(el => el.onclick = () => {
    const b = bankById(el.dataset.del);
    if (!confirm(`删除题库「${b.title}」？该题库的作答记录、收藏、自定义解析也会一起清掉，不可恢复。`)) return;
    b.questions.forEach(q => {
      const k = kOf(b, q);
      delete ANS[k]; delete FAV[k]; delete NOTES[k];
      tombAdd('ans', k); tombAdd('fav', k); tombAdd('note', k);   // 记墓碑：别的标签页不会把它合并回来
    });
    LOCAL = LOCAL.filter(x => x.id !== b.id);
    try { localStorage.removeItem('qbank.last.' + b.id); } catch (e) {}   // 顺手清掉「上次做到哪」的键
    if (typeof dropTagsOfBank === 'function') { try { dropTagsOfBank(b.id); } catch (e) {} }   // 考点标签也一起清（跟收藏一个道理）
    invalidateBanks();
    writeLS(LS.banks, LOCAL); saveAns(); saveFav(); saveNotes();
    if (typeof BF !== 'undefined' && BF && BF.autoSave) { try { BF.autoSave(); } catch (e) {} }
    toast('已删除'); render();
  });
  /* 目录式题库浏览（cat.js）：把首页的统计卡之后整段换成「目录 + 卡片」视图 */
  if (typeof CAT !== 'undefined' && CAT && CAT.renderHook) { try { CAT.renderHook(); } catch (err) { console.error('CAT', err); } }
  if (typeof BFF !== 'undefined' && BFF && BFF.boot) { try { BFF.boot(); } catch (err) { console.error('BFF', err); } }
  paintStorageUse();   // 占用改成问浏览器（含知识库），回来再回填数字
}

/* 随机抽题：把题库打乱后取前 n 道，组成临时套卷直接做 */
function randomPaper(banks, n) {
  const keys = [];
  (banks || []).forEach(b => { if (b && b.questions) b.questions.forEach(q => keys.push(kOf(b, q))); });
  if (!keys.length) { toast('还没有题目'); return; }
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = keys[i]; keys[i] = keys[j]; keys[j] = t;
  }
  const c = Math.min(n, keys.length);
  makePaper('随机 ' + c + ' 题', keys.slice(0, c));
}

function startBank(bankId) {
  const b = bankById(bankId); if (!b || !b.questions.length) return;
  QZ.order = null;
  QZ.focusCur = false;
  if (b.exam) { rememberLast(b, null); go('#/exam/' + b.id); return; }
  const last = readLS('qbank.last.' + b.id, null);
  QZ.cur = (last && b.questions.some(q => String(q.id) === String(last))) ? last : b.questions[0].id;
  rememberLast(b, QZ.cur);
  go('#/bank/' + b.id);
}

/* 临时套卷 */
function makePaper(title, keys, opts) {
  opts = opts || {};
  keys = Array.from(new Set(keys));
  if (!keys.length) { toast('先勾选题目'); return; }
  let id = (opts.exam ? 'exam-' : 'paper-') + Date.now().toString(36);
  while (PAPERS.some(p => p.id === id)) id += '-' + i2s();   // 防撞车
  const p = { id: id, title: title || ((opts.exam ? '模拟考试 · ' : '套卷 · ') + keys.length + ' 题'), createdAt: Date.now(), keys: keys, exam: !!opts.exam, duration: opts.duration || 0 };
  PAPERS.push(p);
  savePapers();
  invalidateBanks();
  const mins = Math.round((opts.duration || 0) / 60);
  toast(opts.exam
    ? ('已生成试卷：' + keys.length + ' 题，' + (mins ? '限时 ' + mins + ' 分钟' : '不限时'))
    : ('已生成套卷：' + keys.length + ' 题，做完会计入原来的错题次数'));
  go((opts.exam ? '#/exam/' : '#/bank/') + id);
}
function deletePaper(id) {
  const p = PAPERS.find(x => x.id === id);
  if (!p) return;
  if (!confirm('删除这个套卷？套卷本身的作答记录会清掉（原本题库的错题次数保留）。')) return;
  const b = allBanks().find(x => x.id === id);
  if (b) b.questions.forEach(q => { const k = kOf(b, q); delete ANS[k]; tombAdd('ans', k); });
  PAPERS = PAPERS.filter(x => x.id !== id);
  tombAdd('paper', id);      // 记墓碑：别的标签页/合并写入不会把这个套卷加回来
  savePapers(); saveAns();
  invalidateBanks();
  toast('已删除套卷'); render();
}

/* ---------- 删题：从【自建题库】里移除一道题 ----------
   场景：刷题时觉得某道题不好（重复 / 出得歪 / 跟资料对不上），想直接扔掉。
   入口：答题页「⋯ 更多 → 删除本题」、cat.js 题目管理页（#/qlist）的勾选删除。
   内置题库是 banks/*.js 里的只读文件，删不了；自建题库存在 qbank.local.v2，这里直接把那道题摘掉。
   连带清掉这道题的本机痕迹（作答 / 收藏 / 自定义解析 / 参考资料 / 口诀便签 / 修正答案 / 考点标签），
   该写墓碑的写墓碑 —— 免得被另一个标签页或云端旧副本复活；套卷里引用它的地方也一起摘干净。 */
function delTargetOf(bank, q) {
  if (!bank || !q) return null;
  if (bank.paper) {                              /* 套卷 / 模考里的题：删的是它原来题库里那道 */
    if (!q._srcKey) return null;
    const f = findQIn(baseBanks(), q._srcKey);
    if (!f || !f.bank || f.bank.source !== 'local') return null;
    return { bankId: f.bank.id, qid: f.q.id, title: f.bank.title };
  }
  if (bank.source !== 'local') return null;      /* 内置题库：只读 */
  return { bankId: bank.id, qid: q.id, title: bank.title };
}
function delQTraces(k) {
  if (ANS[k] != null) { delete ANS[k]; tombAdd('ans', k); saveAns(); }
  if (FAV[k] != null) { delete FAV[k]; tombAdd('fav', k); saveFav(); }
  if (NOTES[k] != null) { delete NOTES[k]; tombAdd('note', k); saveNotes(); }   /* ai.js 包过 tombAdd：参考资料清单跟着一起清 */
  else if (typeof aiSrcFor === 'function' && typeof aiSrcDrop === 'function') {
    try { if (aiSrcFor(k).length) aiSrcDrop(k); } catch (e) {}                  /* 只剩参考资料清单的旧数据也清掉 */
  }
  if (QTN[k] != null) { delete QTN[k]; tombAdd('qtn', k); saveQtn(); }
  if (FIX[k] != null) { delete FIX[k]; tombAdd('fix', k); saveFix(); }
  try { if (window.TAGS && TAGS.set) TAGS.set(k, []); } catch (e) {}
}
function delBankQuestion(bankId, qid) {
  if (!Array.isArray(LOCAL)) return { ok: false, reason: 'builtin' };
  const raw = LOCAL.find(x => x && x.id === bankId);
  if (!raw) return { ok: false, reason: 'builtin' };
  const qs = Array.isArray(raw.questions) ? raw.questions : (raw.questions = []);
  const idx = qs.findIndex(q => q && String(q.id) === String(qid));
  if (idx < 0) return { ok: false, reason: 'missing' };
  const srcKey = key(bankId, qid);
  /* 先清套卷（要在缓存还认得出这道题的时候做）：套卷自己的作答键、套卷引用的 keys */
  let paperTouched = false;
  try {
    allBanks().forEach(b => {
      if (!b.paper) return;
      b.questions.forEach(q => {
        if (q._srcKey !== srcKey) return;
        const pk = kOf(b, q);
        if (ANS[pk] != null) { delete ANS[pk]; tombAdd('ans', pk); paperTouched = true; }
      });
    });
    let changed = false;
    PAPERS.forEach(p => {
      if (Array.isArray(p.keys) && p.keys.indexOf(srcKey) >= 0) {
        p.keys = p.keys.filter(x => x !== srcKey);
        changed = true; paperTouched = true;
      }
    });
    if (changed) savePapers();
  } catch (e) {}
  qs.splice(idx, 1);
  delQTraces(srcKey);
  if (paperTouched) saveAns();
  writeLS(LS.banks, LOCAL);
  invalidateBanks();
  try { if (window.BF && BF.autoSync) BF.autoSync(); } catch (e) {}
  return { ok: true, left: qs.length };
}
window.delBankQuestion = delBankQuestion;   /* cat.js 的题目管理页要调 */
window.delTargetOf = delTargetOf;

function storageBytes() {
  let n = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (k || '').length + (localStorage.getItem(k) || '').length; } } catch (e) {}
  return n * 2;
}
/* 真实占用要问浏览器：知识库存在 IndexedDB 里，localStorage 根本数不出来 */
async function storageUse() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      if (e && (e.usage || e.quota)) return { used: e.usage || 0, quota: e.quota || 0, real: true };
    }
  } catch (err) {}
  return { used: storageBytes(), quota: 0, real: false };
}
async function paintStorageUse() {
  const u = await storageUse();
  const el = $('storeUse');
  if (!el) return;                       // 页面已经画到别处去了
  const mb = x => (x / 1024 / 1024).toFixed(2);
  el.textContent = '数据存在本机浏览器，共占用约 ' + mb(u.used) + ' MB'
    + (u.quota ? '（浏览器给的额度约 ' + Math.round(u.quota / 1024 / 1024) + ' MB）' : '')
    + (u.real ? '，含知识库。' : '，只算了 localStorage，知识库没算进来。');
}

function exportBank(b) {
  if (!b) return;
  if (typeof BF !== 'undefined' && BF && BF.exportBankHook) { try { BF.exportBankHook(b); return; } catch (e) {} }
  const data = { id: b.id, title: b.title, subtitle: b.subtitle, questions: b.questions.map(q => ({ id: q.id, stem: q.stem, options: q.options, answer: q.answer, explain: q.explain, group: q.group, groupTitle: q.groupTitle })) };
  download(safeName(b.title) + '.json', JSON.stringify(data, null, 2), 'application/json');
}

/* 顶层的分类表（惰性取值：cat.js 还没加载时也安全） */
function catRows() {
  try { if (typeof CAT !== 'undefined' && CAT && CAT.all) return CAT.all().map(c => ({ id: c.id, title: c.title, parent: c.parent, order: c.order })); } catch (e) {}
  return readLS(LS.cat, []) || [];
}

/* 全量备份 / 恢复：知识库正文也一起带走（来自 知识库.js 的文件库不在里面） */
async function exportAllData() {
  let tipCats = 0;
  const data = { app: 'shuati', version: 8, exportedAt: new Date().toISOString(), answers: ANS, banks: LOCAL, cats: catRows(), favs: FAV, notes: NOTES, papers: PAPERS, settings: SET, fixes: FIX, srs: SRS, qtn: QTN,
    aisrc: (typeof aiSrcNorm === 'function' ? aiSrcNorm() : readLS('qbank.aisrc.v1', {})),
    tags: (typeof window.tagsOf === 'function') ? window.TAGS.data() : readLS(LS.tag, {}),
    tagVocab: (typeof window.TAGS === 'object' && window.TAGS) ? window.TAGS.vocab() : readLS(LS.tagvocab, []),
    report: (window.REPORT && REPORT.data) ? REPORT.data() : readLS(LS.report, []) };
  let tip = '';
  try {
    if (typeof kbExportAll === 'function') {
      toast('正在打包知识库…', 1200);
      const kb = await kbExportAll();
      if (kb && (kb.list || []).length) { data.kb = kb; tip = '，含 ' + kb.list.length + ' 个自己导入的知识库'; }
      if (kb && (kb.autoN || 0)) tip += '（另有 ' + kb.autoN + ' 个来自 知识库.js 的文件库不打包，换电脑后重新生成或复制那个文件即可）';
    }
  } catch (err) { tip = '（知识库打包失败：' + (err.message || err) + '）'; }
  download('刷题站-全部数据-' + stamp() + '.json', JSON.stringify(data), 'application/json');
  writeLS(BACKUP_KEY, Date.now());
  toast('已导出备份' + tip, 3600);
}
function importAllData(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || typeof d !== 'object') throw new Error('格式不对');
      const cnt = k => Object.keys(d[k] || {}).length;
      const kbCnt = (d.kb && (d.kb.list || []).length) || 0;
      const tagCnt = Object.keys(d.tags || {}).length;
      const repCnt = Array.isArray(d.report) ? d.report.length : 0;
      if (!confirm(`即将导入：作答 ${cnt('answers')} 条、自建题库 ${(d.banks || []).length} 个、收藏 ${cnt('favs')} 条、自定义解析 ${cnt('notes')} 条、口诀便签 ${cnt('qtn')} 条、解析参考资料 ${cnt('aisrc')} 道题、修正答案 ${cnt('fixes')} 条${tagCnt ? '、考点标签 ' + tagCnt + ' 道题' : ''}${repCnt ? '、学情报告 ' + repCnt + ' 份' : ''}${kbCnt ? '、知识库 ' + kbCnt + ' 个' : ''}。\n\n导入会与现有数据合并（同一条以导入的为准），不会删除其它记录。继续？`)) return;
      Object.assign(ANS, d.answers || {});
      Object.assign(FAV, d.favs || {});
      Object.assign(NOTES, d.notes || {});
      Object.assign(FIX, d.fixes || {});
      if (d.qtn && typeof d.qtn === 'object') {                  // 口诀便签：同一条以时间戳新的为准
        Object.keys(d.qtn).forEach(k => {
          const th = d.qtn[k], mi = QTN[k];
          if (th && typeof th === 'object' && (!mi || (+th.ts || 0) > (+mi.ts || 0))) QTN[k] = th;
        });
      }
      if (Array.isArray(d.banks)) d.banks.forEach(b => { if (b && b.id && !LOCAL.some(x => x.id === b.id)) LOCAL.push(b); });
      let tipCats = 0;                                          // 导入进来的分类数（原先漏了声明，导致导入完弹「导入失败：tipCats is not defined」）
      if (Array.isArray(d.cats) && d.cats.length) {            // 分类树跟着一起恢复
        if (typeof CAT !== 'undefined' && CAT && CAT.importCats) {
          try { const r = CAT.importCats(d.cats); tipCats = (r.added || 0) + (r.updated || 0); } catch (err) {}
        } else {
          const have = readLS(LS.cat, []) || [];
          const seen = {}; have.forEach(c => { if (c && c.id) seen[c.id] = 1; });
          let n = 0;
          d.cats.forEach(c => {
            if (!c || !c.id || seen[c.id]) return;
            have.push({ id: String(c.id), title: String(c.title || '未命名分类'), parent: (c.parent == null ? null : String(c.parent)), order: (c.order == null ? 999 : (+c.order || 0)) });
            seen[c.id] = 1; n++;
          });
          writeLS(LS.cat, have); tipCats = n;
        }
      }
      if (Array.isArray(d.papers)) d.papers.forEach(p => { if (p && p.id && !PAPERS.some(x => x.id === p.id)) PAPERS.push(p); });
      if (d.settings) Object.assign(SET, d.settings);
      if (d.srs) Object.assign(SRS, d.srs);
      let kbN = 0;
      if (d.kb && typeof kbImportAll === 'function') { try { kbN = kbImportAll(d.kb) || 0; } catch (err) {} }
      /* 考点标签：同一条以导入的为准（按题合并）。老备份里的 syllabus（考纲清单）字段已经不用了，忽略即可 */
      let tagN = 0;
      if (d.tags && typeof window.TAGS === 'object' && window.TAGS) {
        try {
          const mine = window.TAGS.data() || {};
          Object.keys(d.tags).forEach(k => { if (Array.isArray(d.tags[k])) { mine[k] = d.tags[k].slice(); tagN++; } });
          if (Array.isArray(d.tagVocab)) window.TAGS.rememberVocab(d.tagVocab);
          window.TAGS.save();
        } catch (err) {}
      }
      /* 学情诊断的历史报告：按 id 并集（导入的优先），最多留 20 份 */
      let repN = 0;
      if (Array.isArray(d.report) && window.REPORT && REPORT.data) {
        try {
          let mine = REPORT.data() || [];
          const seen = {};
          mine.forEach(r => { if (r && r.id) seen[r.id] = 1; });
          d.report.forEach(r => { if (r && r.id && r.text && !seen[r.id]) { mine.push(r); seen[r.id] = 1; repN++; } });
          mine = mine.sort((x, y) => (+y.ts || 0) - (+x.ts || 0)).slice(0, 20);
          if (typeof mergeWrite === 'function') mergeWrite(LS.report, mine, 'report'); else writeLS(LS.report, mine);
        } catch (err) {}
      }
      tombClear();   // 导入＝以这份备份为准，清掉本机墓碑，别把要恢复的记录挡回去
      /* 解析参考资料：放在 tombClear 之后并（走的 mergeWrite 会看墓碑）*/
      if (d.aisrc && typeof aiSrcMergeIn === 'function') { try { aiSrcMergeIn(d.aisrc); } catch (e) {} }
      migrate();
      invalidateBanks();
      saveAns(); saveFav(); saveNotes(); saveQtn(); writeLS(LS.banks, LOCAL); savePapers(); writeLS(LS.set, SET);
      saveFix(); writeLS(LS.srs, SRS);
      if (typeof BF !== 'undefined' && BF && BF.autoSave) { try { BF.autoSave(); } catch (e) {} }
      toast('导入完成' + (tipCats ? '（含 ' + tipCats + ' 个分类）' : '') + (kbN ? '，含 ' + kbN + ' 个知识库' : '')
        + (tagN ? '，含 ' + tagN + ' 道题的考点标签' : '')
        + (repN ? '，含 ' + repN + ' 份学情报告' : '')); render();
    } catch (err) { alert('导入失败：' + err.message); }
  };
  r.readAsText(f, 'utf-8');
  e.target.value = '';
}

/* ============================================================
   答题页
   ============================================================ */
function renderQuiz(bankId) {
  if (typeof richFlush === 'function') richFlush();          // 方案十：重画前先把就地编辑的改动存了
  const bank = bankById(bankId);
  if (!bank) { go('#/'); return; }
  if (bank.exam) { go('#/exam/' + bank.id); return; }   // 模考走专用页面
  QZ.bankId = bankId;
  $('appTitle').textContent = bank.title;

  /* 先收一下失效的六科筛选再算题池：标完最后一题「未选」/换筛法后，
     否则 poolOf 会先按旧科目算出空池，页面卡在「这里暂时没有题目」而 chips 已经回全选。 */
  if (QZ.subject && subjectCount(bank, QZ.subject) === 0) QZ.subject = '';
  const pool = poolOf(bank);
  if (!pool.length) {
    $('view').innerHTML = `<div class="card"><div class="empty">这里暂时没有题目，换个分类看看。</div></div>`;
    $('stat').textContent = ''; $('bar').style.width = '0%';
    renderChips(bank);
    return;
  }
  if (QZ.cur == null || !pool.some(q => String(q.id) === String(QZ.cur))) QZ.cur = pool[0].id;
  const q = pool.find(x => String(x.id) === String(QZ.cur));
  const k = kOf(bank, q);
  const speed = SET.quizMode === 'speed';
  const recite = SET.quizMode === 'recite';
  uiSpeedStop();                                  // 换题 / 重画：先把上一题的速刷浮层和待跳计时收掉
  const locked = !recite && answered(k);
  const rec = recOf(k);
  const picked = locked ? (rec.sel || []) : (recite ? [] : (QZ.pending[q.id] || []));
  const fk = favKey(bank, q);
  const faved = !!FAV[fk];
  const custom = !!noteOf(fk);
  const fixedAns = hasFix(fk);
  const delT = delTargetOf(bank, q);              /* 这道题能不能删、删的是哪个题库里的哪道（内置题库不能删） */

  const opts = q.options.map((t, i) => {
    const K = 'ABCDEFGH'[i];
    let cls = 'opt';
    if (recite) {
      /* 背题模式：选项只读，正确答案直接高亮（点一下只给提示，不判分、不写记录） */
      cls += ' ro';
      if (ansOf(fk, q).includes(K)) cls += ' right';
    } else if (locked) {
      if (ansOf(fk, q).includes(K)) cls += ' right';
      else if (picked.includes(K)) cls += ' wrong';
    } else if (picked.includes(K)) cls += ' sel';
    return `<button class="${cls}" data-k="${K}" ${locked ? 'disabled' : ''}><span class="k">${K}</span><span>${esc(optText(t, K))}</span></button>`;
  }).join('');

  const pos = pool.findIndex(x => String(x.id) === String(q.id)) + 1;
  $('view').innerHTML = `
    <div class="card">
      <div class="qmode" role="tablist" aria-label="刷题模式">
        ${QUIZ_MODES.map(([mk, mt]) => `<button class="chip qm${SET.quizMode === mk ? ' on' : ''}" data-qm="${mk}" title="${
          mk === 'normal' ? '普通模式：点选项判分，看解析' :
          mk === 'speed' ? '速刷模式：答对约 1.2 秒自动跳下一题，答错停下看解析' :
          '背题模式：不要求作答，直接看答案和解析（不写任何作答记录，不熟就点 ★ 收藏）'}">${mt}</button>`).join('')}
        ${speed && SET.speedSec > 0 && !locked ? `<span class="sp-clock" id="spClock" title="速刷限时：超时算答错">⏱ ${SET.speedSec}s</span>` : ''}
        <span class="spacer-grow"></span>
        <span class="qm-hint small muted">${recite ? '背题：直接看答案，不记作答' : speed ? '速刷：答对自动跳，答错停下' : ''}</span>
      </div>
      <div class="qhead">
        <span class="qno">第 ${qNo(q, pool)} 题</span>
        <span class="tag">${typeLabel(q, ansOf(fk, q))}</span>
        ${q.groupTitle ? `<span class="tag g">${esc(q.groupTitle)}</span>` : ''}
        ${bank.paper ? `<span class="tag paper-tag">临时套卷</span>` : ''}
        ${fixedAns ? `<span class="tag g" title="答案是你手动改过的，只在本机生效">答案已修正</span>` : ''}
        ${!recite && rec && rec.tries ? `<span class="tag g">本题作答 ${rec.tries} 次 · 错 ${rec.wrong || 0} 次</span>` : ''}
        <span class="spacer-grow"></span>
        <button class="btn focus-btn${SET.focus ? ' on' : ''}" id="btnFocus" title="专注模式：把顶栏和底栏收起来，只看题目（Esc 退出）">⛶ 专注</button>
        <button class="btn fav-btn${faved ? ' on' : ''}" id="btnFav">${faved ? '★ 已收藏' : '☆ 收藏'}</button>
      </div>
      <div class="vstrip" id="vStrip"></div>
      <div class="qtwo">
      <div id="qBody">
      ${q.group ? `<div class="gstem"><b>共用题干：</b>${esc(q.group)}</div>` : ''}
      <div class="stem">${esc(q.stem)}</div>
      ${typeof tagRowHtml === 'function' ? tagRowHtml(fk, q) : ''}
      <div class="opts">${opts}</div>
      </div>
      <aside class="qnbox" id="qnBox">
        <div class="qn-cap">✎ 口诀 / 思路<span class="qn-state small muted" id="qnState"></span></div>
        <textarea id="qnTa" rows="4" spellcheck="false" placeholder="只记几个字：口诀、判别法、易错点。&#10;（跟解析分开存，只在本机）">${esc((QTN[fk] || {}).text || '')}</textarea>
      </aside>
      </div>
      <div class="actions qz-more">
        ${qType(q, ansOf(fk, q)) === 'X' ? `<button class="btn primary" id="doSubmit" ${locked || !picked.length ? 'disabled' : ''}>提交答案</button>` : ''}
        ${speed ? '' : `<button class="btn" id="doMore" title="改解析 / 改答案 / AI 解析 / AI 变式题 —— 这些管理动作收进抽屉里，不摊在题目下面">⋯ 更多</button>`}
      </div>
      ${speed ? '' : `<div class="qsheet" id="qSheet" hidden>
        <div class="qsheet-scrim" data-qsheet="0"></div>
        <div class="qsheet-panel" role="dialog" aria-label="这题的管理动作">
          <div class="grip"></div>
          <div class="qsheet-cap">这题还能做什么</div>
          <div class="qsheet-grid">
            ${rec ? `<button class="btn" id="doRedo">再答一次</button>` : ''}
            <button class="btn" id="doNote">${custom ? '改解析（已自定义）' : '改解析'}</button>
            <button class="btn" id="doFix" title="题库答案写错了 / 自己点错了：可以在这里改，只影响本机的判分">${fixedAns ? '改答案（已修正）' : '改答案'}</button>
            <button class="btn" id="doAI" title="让 AI 写解析（可以带上本地知识库的资料）">AI 解析</button>
            <button class="btn" id="doVariant" title="让 AI 照这道题出几道同考点的新题（变式题），还能跟库里相似的老题并排对比">AI 变式题</button>
            ${delT ? '<button class="btn danger" id="doDelQ" title="把这道题从题库里永久删掉（它的作答记录 / 收藏 / 解析会一起清）">🗑 删除本题</button>' : ''}
          </div>
          <button class="btn" data-qsheet="0">取消</button>
        </div>
      </div>`}
      <div class="fb" id="fb"></div>
      <div class="keyhint">
        <span><span class="kbd">A</span>–<span class="kbd">H</span> 选选项</span>
        <span><span class="kbd">Enter</span> 提交 / 下一题</span>
        <span><span class="kbd">←</span><span class="kbd">→</span> 翻页</span>
        <span><span class="kbd">J</span><span class="kbd">K</span> 翻题</span>
        <span><span class="kbd">S</span> 收藏</span>
        <span><span class="kbd">O</span> 答题卡</span>
        <span><span class="kbd">?</span> 全部快捷键</span>
      </div>
      <div id="noteHost"></div>
      <div id="fixHost"></div>
      <div id="aiHost"></div>
      <div id="vHost"></div>
    </div>`;

  $('view').querySelectorAll('[data-qm]').forEach(el => el.onclick = () => uiQuizMode(el.dataset.qm));
  /* §8：管理动作抽屉的开关（「⋯ 更多」按钮 / 遮罩 / 取消 三处都关） */
  on('doMore', () => qSheetToggle(true));
  $('view').querySelectorAll('[data-qsheet]').forEach(el => el.onclick = () => qSheetToggle(false));
  if (recite) $('view').querySelectorAll('.opt').forEach(el => el.onclick = () => toast('背题模式直接看答案，不用作答（不熟就点「★ 收藏」）', 1800));
  else $('view').querySelectorAll('.opt').forEach(el => el.onclick = () => onPick(bank, q, el.dataset.k));
  on('doSubmit', () => judge(bank, q, QZ.pending[q.id] || []));
  on('doRedo', () => redo(bank, q));
  /* 方案十 4.7：两个入口共用一份 NOTES —— 打开完整编辑器之前，先把就地编辑的改动存进去，
     不然编辑器里显示的是旧内容，用户会以为刚才改的白改了。 */
  /* 点抽屉里的动作先把抽屉收掉：不然遮罩（.qsheet 固定全屏）还盖着，
     编辑器 / AI 面板开在下面，手机上看起来就是「点了没反应」。 */
  on('doNote', () => {
    qSheetToggle(false);
    if (typeof richFlush === 'function') richFlush();
    openNoteEditor(fk, $('noteHost'), q, render);
  });
  on('doFix', () => { qSheetToggle(false); openAnsEditor($('fixHost'), fk, q, render); });
  /* 「删除本题」：只删自建题库里的题（套卷里的题记在它原来的题库上）。删完自动跳到下一题 */
  if (delT) on('doDelQ', () => {
    const i2 = pool.findIndex(x => String(x.id) === String(q.id));
    const nxt = pool[i2 + 1] || pool[i2 - 1] || null;
    const ask = (window.BFUI && BFUI.confirm) ? BFUI.confirm.bind(BFUI) : (o => Promise.resolve(confirm(o.title)));
    ask({
      title: '删除这道题？',
      html: '从题库「' + esc(delT.title) + '」里移除第 ' + esc(String(qNo(q, pool))) + ' 题。<br>它的作答记录、收藏、解析（含 AI 解析、参考资料）、标签会一起清掉，<b>不可恢复</b>。'
        + (bank.paper ? '<br><span class="muted">引用它的套卷里也会一起消失。</span>' : ''),
      okText: '删除', danger: true
    }).then(ok => {
      if (!ok) return;
      const r = delBankQuestion(delT.bankId, delT.qid);
      if (!r.ok) { toast(r.reason === 'builtin' ? '内置题库是只读文件，删不了题' : '这道题已经不在了'); return; }
      QZ.cur = nxt ? nxt.id : null;
      qSheetToggle(false);
      toast('已删除这道题' + (bank.paper ? '（套卷里也一起去掉了）' : ''), 1600, 'ok');
      render();
    });
  });
  on('doAI', () => { qSheetToggle(false); if (typeof aiOpenPanel === 'function') aiOpenPanel($('aiHost'), fk, q); else toast('AI 模块没加载（ai.js）'); });
  on('doVariant', () => { qSheetToggle(false); if (typeof openVariant === 'function') openVariant($('vHost'), fk, q); else toast('变式题模块没加载（variant.js）'); });
  /* 方案十一：题目下面那排「变式 1 / 2 / 3」——生成过就直接画出来 */
  if (typeof varqBind === 'function') varqBind($('vStrip'), fk);
  on('btnFav', () => toggleFav(fk, document.getElementById('btnFav')));
  (() => {                                   /* 右侧小便签：输入防抖自动存，失焦再存一次 */
    const ta = document.getElementById('qnTa');
    const st = document.getElementById('qnState');
    if (!ta) return;
    let timer = null;
    const save = () => {
      const v = ta.value.trim();
      if (v) QTN[fk] = { text: v, ts: Date.now() };
      else { delete QTN[fk]; tombAdd('qtn', fk); }   /* 清空即删除：记一笔墓碑，免得被别的标签页 / 云端的旧副本复活 */
      saveQtn();
      if (st) { st.textContent = v ? '已存' : ''; setTimeout(() => { if (st) st.textContent = ''; }, 1200); }
    };
    ta.addEventListener('input', () => { if (st) st.textContent = '…'; clearTimeout(timer); timer = setTimeout(save, 700); });
    ta.addEventListener('blur', () => { clearTimeout(timer); save(); });
  })();
  /* §3.6-P0① 专注模式：就地切，不整页重画（重画会打断正在生成的 AI 面板） */
  on('btnFocus', () => { uiSetFocus(!SET.focus); const b = document.getElementById('btnFocus'); if (b) b.classList.toggle('on', !!SET.focus); });
  /* 考点标签那一行：加 / 删 / 小浮层编辑器（就地重画，不整页重画） */
  if (typeof bindTagRow === 'function') { try { bindTagRow($('view'), bank, q); } catch (e) {} }

  /* 整页重画之后把「AI 解析」面板挂回来：不然选选项 / 提交 / 翻页 / 别的标签页同步
     都会把正在生成的解析冲掉（看起来就是「突然变回原来解析、生成中断」） */
  if (typeof aiReopenFor === 'function') { try { aiReopenFor($('aiHost'), fk); } catch (e) {} }
  /* 「AI 变式题」面板同理：翻页 / 答题重画之后挂回来，正在生成的不打断 */
  if (typeof variantReopenFor === 'function') { try { variantReopenFor($('vHost'), fk, q); } catch (e) {} }

  if (recite) uiReciteFb(bank, q); else showFb(bank, q);
  /* 方案九：速刷限时（默认关，设置里开了才跑）—— 到点算答错，走和普通答错同一条路 */
  if (speed && !locked && SET.speedSec > 0) uiSpeedClock(bank, q, SET.speedSec);
  /* 3.1 判分后不用滚回底部：解析下面那个「下一题 →」直接用（末题给个灰的） */
  const fbNext = $('fbNext');
  if (fbNext) {
    if (pos >= pool.length) { fbNext.disabled = true; fbNext.textContent = '已经是最后一题'; }
    else on('fbNext', () => step(1));
  }
  /* 候补池 A：手机上左右滑动翻题（触屏才启用；位移 > 30px 且横向为主才算） */
  uiBindSwipe(bank);
  /* 候补池 H：长按题干弹「复制 / AI 解析 / 收藏」 */
  uiBindStemLongPress(bank, q, fk);
  rememberLast(bank, q.id);
  $('jumpInfo').innerHTML = '<b>' + pos + ' / ' + pool.length + '</b><span>答题卡</span>';
  /* 首题 / 末题：把翻页按钮的边界状态摆出来，免得以为点了没反应 */
  const prevB = $('prev'), nextB = $('next');
  if (prevB) {
    const first = pos <= 1;
    prevB.disabled = first;
    prevB.title = first ? '已经是第一题了' : '上一题（← 或 k）';
  }
  if (nextB) {
    const lastQ = pos >= pool.length;
    nextB.disabled = lastQ;
    nextB.textContent = lastQ ? '最后一题' : '下一题 ›';
    nextB.title = lastQ ? '已经是最后一题（按 O 打开答题卡可以跳回去）' : '下一题（→、Enter 或 j）';
  }

  let done = 0, ok = 0, wr = 0;
  bank.questions.forEach(x => {
    const a = ANS[kOf(bank, x)];
    if (a && !a.redo) { done++; if (a.ok) ok++; }
    if (a && (a.wrong || 0) > 0) wr++;
  });
  $('stat').textContent = `${done}/${bank.questions.length}${wr ? ' · 错' + wr : ''}`;
  $('bar').style.width = (done / bank.questions.length * 100) + '%';
  renderChips(bank);

  /* 一套题做完 → 庆祝一次（fx.js）。renderQuiz 每答一题都会重绘，
     所以靠 localStorage 里的一次性记号 + FX 自己的守卫，绝不重复放；
     普通题库默认不庆祝，要「设置 → 普通题库刷完也庆祝」打开。 */
  if (window.FX && bank.questions.length && done === bank.questions.length) {
    try {
      if (bank.paper) FX.celebrateSet({ bankId: bank.id, total: bank.questions.length });
      else if (typeof FX.celebrateNormal === 'function') FX.celebrateNormal({ bankId: bank.id, total: bank.questions.length });
    } catch (e) {}
  }
}

function toggleFav(k, btn) {
  if (FAV[k]) {
    const was = FAV[k];
    delete FAV[k]; tombAdd('fav', k);
    /* 候补池 E：误点取消收藏 → 5 秒内可以撤销。
       撤销前要把「fav 墓碑」删掉：墓碑是给同步用的（别的标签页别把它合并回来），
       留着的话 saveFav() 合并时又会把它过滤掉，等于撤销无效。 */
    toast('已取消收藏', 5000, '', {
      label: '撤销',
      fn: () => {
        FAV[k] = was;
        try { if (TOMB.fav) { delete TOMB.fav[k]; writeLS(TOMB_KEY, TOMB); } } catch (e) {}
        saveFav(); render(); toast('已恢复收藏', 1300, 'ok');
      }
    });
  } else { FAV[k] = Date.now(); toast('已收藏 ★', 1200, 'ok'); }
  if (!saveFav()) toast('保存失败：浏览器存储空间可能已满', 2600, 'bad');
  /* 就地换那颗星：整页重画会把正在生成的「AI 解析」一起冲掉（找不到按钮时才重画） */
  const b = btn || document.getElementById('btnFav');
  if (b) {
    const on = !!FAV[k];
    if (b.classList.contains('tiny')) b.textContent = on ? '★' : '☆';
    else { b.classList.toggle('on', on); b.textContent = on ? '★ 已收藏' : '☆ 收藏'; }
    return;
  }
  render();
}

function qzTags(k) { try { return (window.TAGS && TAGS.of) ? TAGS.of(k) : []; } catch (e) { return []; } }
/* 套卷 / 每日复习里的题是复制品（键是 paper#p1…），标签挂在原题上：查标签一律走 _srcKey，
   否则六科计数全是 0，整行灰死点不动（web126 用户报）。 */
function qzKey(bank, q) { return (bank && bank.paper && q && q._srcKey) ? q._srcKey : kOf(bank, q); }
function qzBasics() {
  try { if (window.TAGS && typeof TAGS.basic === 'function') { const b = TAGS.basic(); if (b && b.length) return b; } } catch (e) {}
  return ['生理', '生化', '病理', '内科', '外科', '人文'];
}
function qzBasicOf(bank, q, basic) {
  basic = basic || qzBasics();
  return qzTags(qzKey(bank, q)).filter(t => basic.indexOf(t) >= 0);
}
function qzHasSubject(bank, q) {
  if (!QZ.subject) return true;
  const bs = qzBasicOf(bank, q);
  if (QZ.subject === '__none') return bs.length === 0;     /* 未选：六科里一科都还没分 */
  return bs.indexOf(QZ.subject) >= 0;
}
function chipFilter(arr, f, bank) {
  if (f === 'single') return arr.filter(q => ansOf(favKey(bank, q), q).length === 1);
  if (f === 'multi') return arr.filter(q => ansOf(favKey(bank, q), q).length > 1);
  if (f === 'wrong') return arr.filter(q => { const a = ANS[kOf(bank, q)]; return a && (a.wrong || 0) > 0; });
  if (f === 'fav') return arr.filter(q => FAV[favKey(bank, q)]);
  if (f === 'due') return arr.filter(q => isDue(kOf(bank, q)));
  if (f === 'undone') return arr.filter(q => !answered(kOf(bank, q)));
  return arr;
}
function poolOf(bank) {
  let arr = bank.questions.slice();
  if (SET.shuffle) {
    if (!QZ.order || QZ.order.bankId !== bank.id) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      /* 从答题卡 / 搜索 / 统计里点某道题进来：把它转到队首。
         否则随机可能把它排在最后，一进来「下一题」就是灰的。 */
      const ci = QZ.focusCur ? a.findIndex(q => String(q.id) === String(QZ.cur)) : -1;
      if (ci > 0) a.push.apply(a, a.splice(0, ci));
      QZ.order = { bankId: bank.id, ids: a.map(q => q.id) };
      QZ.focusCur = false;
    } else if (QZ.focusCur) {
      /* 题库里已有随机顺序：把点的题转到队首，其余顺序不动 */
      const ids = QZ.order.ids || [];
      const ci = ids.findIndex(id => String(id) === String(QZ.cur));
      if (ci > 0) QZ.order.ids = ids.slice(ci).concat(ids.slice(0, ci));
      QZ.focusCur = false;
    }
    const map = {}; bank.questions.forEach(q => map[q.id] = q);
    arr = QZ.order.ids.map(id => map[id]);
  } else {
    QZ.focusCur = false;
  }
  arr = chipFilter(arr, QZ.filter, bank);
  if (QZ.subject) arr = arr.filter(q => qzHasSubject(bank, q));
  return arr;
}

function renderChips(bank) {
  /* 六科行：跟下面「全部 / 没做 / 单选…」同时生效；该筛法下没有这个科目的题就灰掉 */
  if (QZ.subject && subjectCount(bank, QZ.subject) === 0) QZ.subject = '';
  const sj = $('subjchips');
  if (sj) {
    const subs = [['', '全选'], ['内科', '内科'], ['外科', '外科'], ['病理', '病理'], ['生理', '生理'], ['生化', '生化'], ['人文', '人文'], ['__none', '未选']];
    const allN = chipFilter(bank.questions, QZ.filter, bank).length;
    sj.innerHTML = '<span class="slabel">六科</span>' + subs.map(([v, label]) => {
      const cnt = v ? subjectCount(bank, v) : allN;
      const dis = v && !cnt;
      const ttl = v === '__none' ? '还没分到六科里任何一科的题' : (v ? '只看这个科目' : '不限定科目');
      return `<button type="button" class="subjchip${QZ.subject === v ? ' on' : ''}${v === '__none' ? ' none' : ''}" data-subj="${v}" ${dis ? 'disabled ' : ''}title="${ttl}">${label}<i>${cnt}</i></button>`;
    }).join('');
    sj.querySelectorAll('.subjchip').forEach(c => c.onclick = () => {
      if (c.disabled) return;
      QZ.subject = c.dataset.subj || '';
      const p = poolOf(bank);
      if (p.length && !p.some(q => String(q.id) === String(QZ.cur))) QZ.cur = p[0].id;
      render();
    });
  }
  const n = f => poolCount(bank, f);
  const defs = [['all', '全部 ' + n('all')], ['undone', '没做 ' + n('undone')],
                ['single', '单选 ' + n('single')], ['multi', '多选 ' + n('multi')],
                ['wrong', '错题 ' + n('wrong')], ['fav', '收藏 ' + n('fav')], ['due', '待复习 ' + n('due')]];
  $('chips').innerHTML = defs.map(([k, t]) => `<button class="chip${QZ.filter === k ? ' on' : ''}" data-f="${k}">${t}</button>`).join('')
    + `<button class="chip tog${SET.shuffle ? ' on' : ''}" id="chipShuffle" title="随机顺序出题（和「设置」里那个开关是同一个）">随机 ${SET.shuffle ? '开' : '关'}</button>`;
  $('chips').querySelectorAll('.chip[data-f]').forEach(c => c.onclick = () => {
    QZ.filter = c.dataset.f;
    if (QZ.subject && subjectCount(bank, QZ.subject) === 0) QZ.subject = '';
    const p = poolOf(bank);
    if (p.length && !p.some(q => String(q.id) === String(QZ.cur))) QZ.cur = p[0].id;
    render();
  });
  /* 候补池 F：「只刷错题」本来就是上面那颗「错题 N」chip，这里补一个「随机 开/关」快捷开关 */
  on('chipShuffle', () => {
    SET.shuffle = !SET.shuffle;
    writeLS(LS.set, SET);
    QZ.order = null;
    render();
    toast(SET.shuffle ? '随机顺序：开' : '随机顺序：关', 1200);
  });
}
/* 题上改完基本标签：只重画六科/筛选行，不整页重画（免得把解析、AI 输出冲掉）。
   正在刷题页时，未选计数会当场减少；标完最后一题会自动回「全选」。 */
function refreshQuizChips() {
  try {
    if (typeof route !== 'function' || route().name !== 'quiz') return;
    const b = QZ.bankId ? bankById(QZ.bankId) : null;
    if (b) renderChips(b);
  } catch (e) {}
}
function poolCount(bank, f) {
  let arr = chipFilter(bank.questions, f, bank);
  if (QZ.subject) arr = arr.filter(q => qzHasSubject(bank, q));
  return arr.length;
}
function subjectCount(bank, sub) {
  let arr = chipFilter(bank.questions, QZ.filter, bank);
  if (sub === '__none') { const basic = qzBasics(); arr = arr.filter(q => qzBasicOf(bank, q, basic).length === 0); }
  else if (sub) { const basic = qzBasics(); arr = arr.filter(q => qzBasicOf(bank, q, basic).indexOf(sub) >= 0); }
  return arr.length;
}

function onPick(bank, q, K) {
  if (answered(kOf(bank, q))) return;
  if (qType(q, ansOf(favKey(bank, q), q)) === 'X') {
    const cur = QZ.pending[q.id] || (QZ.pending[q.id] = []);
    const i = cur.indexOf(K);
    if (i >= 0) cur.splice(i, 1); else cur.push(K);
    render();
    return;
  }
  judge(bank, q, [K]);
}

/* ---------- 作答写入 + 间隔重复 ---------- */
const DAY = 86400000;
function sameAns(a, b) { return a.slice().map(String).sort().join('') === b.slice().map(String).sort().join(''); }

/* 按当前复习曲线算下一档（设置里可换模式/改参数） */
function srsUpdate(rec, ok, now) {
  now = now || Date.now();
  const c = srsCfg();
  const r = srsNext((rec.ivl == null ? 0 : rec.ivl), (rec.ease == null ? (+c.ease0 || 2.5) : rec.ease), ok, c);
  rec.ease = r.ease;
  rec.ivl = r.ivl;
  rec.due = ok ? dayAdd(now, r.ivl) : (c.wrongToday ? now : dayAdd(now, r.ivl));
}

/* 写一条作答记录（含 SRS），返回是否答对 */
function commitAnswer(k, sel, answer) {
  const ok = sameAns(sel, answer);
  const prev = ANS[k] || {};
  const rec = {
    sel: sel.slice(), ok: ok,
    tries: (prev.tries || 0) + 1,
    wrong: (prev.wrong || 0) + (ok ? 0 : 1),
    ts: Date.now(), redo: false,
    ease: (prev.ease == null ? (+srsCfg().ease0 || 2.5) : prev.ease),
    ivl: (prev.ivl == null ? 0 : prev.ivl)
  };
  srsUpdate(rec, ok);
  ANS[k] = rec;
  return ok;
}

function judge(bank, q, sel) {
  const k = kOf(bank, q);
  const ans = ansOf(favKey(bank, q), q);      // 手工修正过的答案优先
  const ok = commitAnswer(k, sel, ans);
  /* 套卷 / 模考：把这次对错累加到原题上（SRS 一并生效） */
  if (bank.paper && q._srcKey) commitAnswer(q._srcKey, sel, ans);
  delete QZ.pending[q.id];
  saveAns();
  render();
  /* 候补池 B：判完立刻给反馈（触屏震一下 + 选项脉冲 + 答错一句提示） */
  uiFeedbackPulse(bank, q, ANS[k] || { ok: ok }, sel);
  /* §3.6-P0②：选项逐个揭示 + 连对 streak（判分「仪式感」） */
  uiReveal(bank, q, ANS[k] || { ok: ok });
  uiStreakBump(ok);
  /* 方案九：速刷 —— 判完给极简反馈 + 约 1.2 秒自动跳下一题 */
  uiSpeedFx(bank, q, ok);
  /* 判完分把反馈（对错 + 解析）滚进视野：手机上尤其需要，不然要点完还得自己往下翻 */
  const fbEl = $('fb');
  if (fbEl && (!ok || SET.expOnOk)) {
    setTimeout(() => { try { fbEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { fbEl.scrollIntoView(); } }, 60);
  }
  /* 速刷模式下不叠加 SET.autoNext 那次跳（否则两道跳会连跳两题）—— autoNext 本身的行为没动 */
  if (ok && SET.autoNext && SET.quizMode !== 'speed') setTimeout(() => step(1), 650);
}

function redo(bank, q) {
  const k = kOf(bank, q);
  if (!ANS[k]) return;
  ANS[k].redo = true;
  delete QZ.pending[q.id];
  saveAns();
  if (window.FX && FX.reset) FX.reset(bank.id);      /* 再答一次：允许这套题重新庆祝 */
  render();
}

/* ---------- 方案九：三种刷题模式（⚡ 速刷 / 📖 背题）+ ⏱ 模考入口 ---------- */
/* 切模式：重画一次（render() 会把 AI 面板挂回来，正在生成的解析不会断） */
function uiQuizMode(m) {
  if (['normal', 'speed', 'recite'].indexOf(m) < 0) m = 'normal';
  if (SET.quizMode === m) return;
  SET.quizMode = m; writeLS(LS.set, SET);
  uiSpeedStop();
  render();
  toast(m === 'speed' ? '⚡ 速刷模式：答对自动跳，答错停下看解析' :
    m === 'recite' ? '📖 背题模式：直接看答案和解析，不记作答' : '普通模式：点选项判分', 1900, 'ok');
}

/* 速刷的浮层和计时：一次只留一份，换题 / 切模式 / 「停下看解析」都要收干净 */
let SP_JUMP = null, SP_TICK = null;
function uiSpeedStop() {
  if (SP_JUMP) { clearTimeout(SP_JUMP); SP_JUMP = null; }
  if (SP_TICK) { clearInterval(SP_TICK); SP_TICK = null; }
  const fx = document.getElementById('spFx'); if (fx) fx.remove();
}
/* 判完分：答对叠一个极简反馈，约 1.2 秒后自动跳下一题；答错就停下，把解析留在眼前 */
function uiSpeedFx(bank, q, ok) {
  if (SET.quizMode !== 'speed') return;
  uiSpeedStop();
  const ans = ansOf(favKey(bank, q), q).join('') || '?';
  const host = document.querySelector('#view .card') || $('view');
  if (!host) return;
  const el = document.createElement('div');
  el.id = 'spFx';
  el.className = 'sp-fx ' + (ok ? 'ok' : 'bad');
  el.innerHTML = ok
    ? `<b class="sp-t">✓ 对</b>
    <button class="btn tiny" id="spStop" title="这一次不自动跳，停下来看解析">停下看解析</button>`
    : `<b class="sp-t">✗ 答案 ${esc(ans)}</b>
    <span class="sp-note">答错已停下，看完解析点「下一题 ›」</span>`;
  host.appendChild(el);
  if (!ok) return;                      /* 打错不自动跳：先把解析看完 */
  on('spStop', () => { uiSpeedStop(); toast('已停下 —— 看完点「下一题 ›」', 1700); });
  const qid = String(q.id);
  SP_JUMP = setTimeout(() => {
    SP_JUMP = null;
    const fx = document.getElementById('spFx'); if (fx) fx.remove();
    if (String(QZ.cur) === qid) step(1);          // 这中间用户自己翻页了就别再跳
  }, 1200);
}
/* 速刷限时（默认关）：到点算答错并自动跳，走的是和普通答错同一条写入路径 */
function uiSpeedClock(bank, q, sec) {
  if (SP_TICK) { clearInterval(SP_TICK); SP_TICK = null; }
  const el = document.getElementById('spClock');
  if (!el) return;
  const k = kOf(bank, q);
  let left = sec;
  const paint = () => { el.textContent = '⏱ ' + Math.max(0, left) + 's'; el.classList.toggle('hot', left <= 5); };
  paint();
  SP_TICK = setInterval(() => {
    left--;
    if (left > 0) { paint(); return; }
    clearInterval(SP_TICK); SP_TICK = null;
    paint();
    if (!answered(k) && String(QZ.cur) === String(q.id)) { toast('⏱ 超时，这题算答错', 1700, 'bad'); judge(bank, q, []); }
  }, 1000);
}
/* 背题：不做题，直接把正确答案高亮 + 解析摊开（不写 ANS，收藏照旧可用） */
function uiReciteFb(bank, q) {
  const fb = $('fb'); if (!fb) return;
  const fk = favKey(bank, q);
  const custom = !!noteOf(fk);
  fb.className = 'fb show rec';
  fb.innerHTML = `
    <div class="res">📖 背题：正确答案 <b>${ansOf(fk, q).join('') || '—'}</b></div>
    ${richBox(fk, explainOf(fk, q), custom, '解析')}
    <div class="fbnext"><button class="btn primary" id="fbNext" title="和底部那个「下一题」一样（Enter 也行）">下一题 →</button></div>`;
  if (typeof richBindAll === 'function') richBindAll(fb);
  uiOptLink(fb);                                                       // §3.6-P1⑤：背题态也能点字母跳选项
}

/* §3.6-P1⑤：解析里的 A/B/C/D 和上面那排选项互相联动 ——
   点解析里的字母，闪一下对应选项并滚到它；点某个选项，把这题解析里提到它的字母点亮。
   只认「本页真有的选项字母」，所以四选项的题里 F/G/H 不会被误包 */
function uiOptLetters() {
  const L = {};
  document.querySelectorAll('#view .opt').forEach(el => { if (el.dataset && el.dataset.k) L[String(el.dataset.k).toUpperCase()] = el; });
  return L;
}
function uiOptHtml(txt) {
  return String(txt == null ? '' : txt).replace(
    /(^|[\s（(【\[、，,。；;：:>」』"'“”])([A-H])(?=[\s）)】\]、，,。；;：:<」』"'“”]|$)/g,
    (m, pre, ch) => pre + '<b class="optjump" data-k="' + ch + '" contenteditable="false">' + ch + '</b>');
}
function uiOptFlash(el) {
  if (!el) return;
  el.classList.remove('opt-hit'); void el.offsetWidth; el.classList.add('opt-hit');
  const smooth = !(typeof uiMotionOK === 'function' && !uiMotionOK());
  try { el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
}
function uiOptBind(view) {
  if (!view || view._optBound) return;
  view._optBound = 1;
  view.addEventListener('click', e => {
    const t = e.target;
    if (!t || !t.closest) return;
    const j = t.closest('.optjump');
    if (j) { uiOptFlash(uiOptLetters()[j.dataset.k]); return; }
    const o = t.closest('.opt');
    if (o && o.dataset && o.dataset.k) {
      view.querySelectorAll('.optjump[data-k="' + o.dataset.k + '"]').forEach(b => {
        b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 1100);
      });
    }
  });
}
/* 只在解析正文里包字母：`.exp.rich-edit` 是就地编辑块、`.aiout / .aih-a` 是 AI 输出 */
function uiOptLink(root) {
  if (!root) return;
  const L = uiOptLetters(), keys = Object.keys(L);
  uiOptBind(document.getElementById('view') || document.body);
  if (!keys.length || !root.querySelectorAll) return;
  root.querySelectorAll('.exp.rich-edit, .aiout, .aih-a').forEach(b => {
    if (b.dataset.optlinked === '1') return;
    const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, null);
    const jobs = [];
    while (walk.nextNode()) {
      const t = walk.currentNode;
      if (!t.nodeValue || !/[A-H]/.test(t.nodeValue)) continue;
      const p = t.parentNode;
      if (p && p.closest && p.closest('.optjump, .opt, a, code, pre')) continue;
      const html = uiOptHtml(esc(t.nodeValue));
      if (html !== esc(t.nodeValue)) jobs.push([t, html]);
    }
    jobs.forEach(([t, html]) => {
      const wrap = document.createElement('span');
      wrap.innerHTML = html;
      wrap.querySelectorAll('.optjump').forEach(b => { if (!L[b.dataset.k]) b.replaceWith(document.createTextNode(b.textContent)); });
      if (wrap.querySelector('.optjump') && t.parentNode) t.parentNode.replaceChild(wrap, t);
    });
    b.dataset.optlinked = '1';
  });
}

function showFb(bank, q) {
  const k = kOf(bank, q), fb = $('fb');
  const st = answered(k) ? ANS[k] : null;
  if (!st) { fb.className = 'fb'; fb.innerHTML = ''; return; }
  const showExp = st.ok ? SET.expOnOk : true;
  const fk = favKey(bank, q);
  const custom = !!noteOf(fk);
  let extra = '';
  if (bank.paper && q._srcKey && ANS[q._srcKey]) {
    const s = ANS[q._srcKey];
    extra = `<div class="small muted" style="margin-bottom:6px">原题累计：作答 ${s.tries || 0} 次 · 错 ${s.wrong || 0} 次 · 正确率 ${rateOf(s)}%</div>`;
  }
  fb.className = 'fb show ' + (st.ok ? 'ok' : 'bad');
  fb.innerHTML = `
    <div class="res">${st.ok ? '✅ 回答正确' : '❌ 回答错误'}</div>
    <div class="ans">正确答案：<b>${ansOf(fk, q).join('') || '—'}</b>${hasFix(fk) ? ' <span class="mini-tag" title="这是你手动修正过的答案">已修正</span>' : ''}　你的选择：<b>${(st.sel || []).join('') || '—'}</b>　
      <span class="muted">累计作答 ${st.tries || 1} 次 · 错 ${st.wrong || 0} 次 · 正确率 ${rateOf(st)}%</span></div>
    ${extra}
    ${showExp
      ? richBox(fk, explainOf(fk, q), custom, '解析')
      : `<div class="exp muted">（已答对，解析已隐藏，可在「设置」中开启）</div>`}
    <div class="fbnext"><button class="btn primary" id="fbNext" title="和底部那个「下一题」一样（Enter 也行）">下一题 →</button></div>`;
  if (showExp && typeof richBindAll === 'function') richBindAll(fb);   // 方案十：解析块就地可改
  uiOptLink(fb);                                                       // §3.6-P1⑤：解析里的 A/B/C/D 与选项联动
}

function renderRich(k, text) {
  const n = noteOf(k);
  let html = (typeof mdToHtml === 'function') ? mdToHtml(text) : esc(text);
  if (n && n.imgs && n.imgs.length) {
    html += '<div class="rich-imgs">' + n.imgs.map(im => `<img src="${im.src}" alt="${esc(im.name || '')}" loading="lazy">`).join('') + '</div>';
  }
  return html;
}

function step(d) {
  if (typeof richFlush === 'function') richFlush();          // 方案十：翻页前先把就地编辑的改动存了
  const bank = bankById(QZ.bankId); if (!bank) return;
  const p = poolOf(bank); if (!p.length) return;
  const i = p.findIndex(x => String(x.id) === String(QZ.cur));
  const j = Math.min(p.length - 1, Math.max(0, (i < 0 ? 0 : i) + d));
  QZ.cur = p[j].id;
  writeLS('qbank.last.' + bank.id, QZ.cur);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

let GRIDF = 'all';        // 答题卡筛选：all / wrong / undone（只影响显示，不影响题号）
function renderGrid() {
  if (route().name === 'exam' && typeof renderExamGrid === 'function') { renderExamGrid(); return; }
  const bank = bankById(QZ.bankId); if (!bank) return;
  const body = $('gridBody');
  let done = 0, wrong = 0;
  bank.questions.forEach(q => { const a = ANS[kOf(bank, q)]; if (a && !a.redo) done++; if (a && (a.wrong || 0) > 0) wrong++; });

  /* 题多的时候（几百题）只想看错题或没做的，这里给个筛子 */
  const f = $('gridFilter');
  if (f) {
    const defs = [['all', '全部 ' + bank.questions.length], ['wrong', '做错 ' + wrong], ['undone', '没做 ' + Math.max(0, bank.questions.length - done)]];
    f.innerHTML = defs.map(([k, t]) => `<button class="chip${GRIDF === k ? ' on' : ''}" data-gf="${k}">${t}</button>`).join('');
    f.querySelectorAll('.chip').forEach(c => c.onclick = () => { GRIDF = c.dataset.gf; renderGrid(); });
  }
  const shown = bank.questions.filter(q => {
    const a = ANS[kOf(bank, q)];
    if (GRIDF === 'wrong') return !!(a && (a.wrong || 0) > 0);
    if (GRIDF === 'undone') return !(a && !a.redo);
    return true;
  });

  body.innerHTML = `<div class="sec-t">${esc(bank.title)}　共 ${bank.questions.length} 题　已答 ${done}　做错 ${wrong}${GRIDF === 'all' ? '' : '　（当前只显示 ' + shown.length + ' 题）'}</div>`
    + (shown.length ? `<div class="grid">` + shown.map(q => {
      const k = kOf(bank, q), a = ANS[k];
      const no = bank.questions.indexOf(q) + 1;     // 用原题号，筛选后也不会串号
      const cls = 'gnum' + (a && (a.wrong || 0) > 0 ? ' err' : (a ? ' done' : '')) + (String(q.id) === String(QZ.cur) ? ' cur' : '');
      return `<button class="${cls}" data-j="${esc(q.id)}">${no}</button>`;
    }).join('') + `</div>` : '<div class="empty">这个筛选下没有题目。</div>');

  body.querySelectorAll('.gnum').forEach(b => b.onclick = () => {
    /* 答题卡筛的「没做 / 做错」也带进答题页：从没做的题进去，下一题就继续走没做的 */
    QZ.filter = GRIDF === 'undone' ? 'undone' : (GRIDF === 'wrong' ? 'wrong' : 'all');
    QZ.focusCur = true;
    QZ.cur = (isNaN(+b.dataset.j) ? b.dataset.j : +b.dataset.j);
    writeLS('qbank.last.' + bank.id, QZ.cur);
    if (typeof rememberLast === 'function') rememberLast(bank, QZ.cur);
    closeAll(); render(); window.scrollTo({ top: 0 });
  });
}
/* 关弹层：先播一小段退场（只动 opacity / transform），播完再把 .show 摘掉。
   系统开了「减少动态效果」就直接关，不留延迟。 */
function hideMask(m) {
  if (!m || !m.classList.contains('show')) return;
  var rm = false;
  try { rm = !!(typeof SET !== 'undefined' && SET && SET.reduceMotion); } catch (e) {}
  if (!rm) { try { rm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {} }
  if (rm || m.classList.contains('closing')) { m.classList.remove('show', 'closing'); return; }
  m.classList.add('closing');
  setTimeout(function () { m.classList.remove('show'); m.classList.remove('closing'); }, 190);
}
function hideMasks() { document.querySelectorAll('.mask').forEach(hideMask); }
function closeAll() { hideMasks(); }

/* ============================================================
   导入 / 新建题库
   ============================================================ */
let EDIT_ID = '';
function renderImport() {
  $('appTitle').textContent = '导入 / 新建题库';
  $('stat').textContent = ''; $('bar').style.width = '0%';
  const editing = SS.get('editing') || '';
  const remembered = SS.get('importText') || '';
  SS.del('importText'); SS.del('editing');
  EDIT_ID = editing;

  $('view').innerHTML = `
    <h2 class="sec">${editing ? '编辑题库' : '导入 / 新建题库'}</h2>
    <div class="card">
      ${editing ? `<div class="note">正在编辑已有题库，保存后会覆盖它（作答记录、收藏、自定义解析保留）。</div>` : ''}
      <div class="field">
        <label>题库名称（文本格式里写 # 名称 也可以自动识别）</label>
        <input type="text" id="bankTitle" placeholder="例如：生化 第一章 蛋白质结构与功能">
      </div>
      <div class="field">
        <label>题目内容（纯文本或 JSON）</label>
        <textarea id="ta" placeholder="把题目粘到这里…"></textarea>
      </div>
      <div class="actions">
        <button class="btn" id="pickFile">从文件读取</button>
        <input type="file" id="fileInput" accept=".txt,.json,.md" style="display:none">
        <button class="btn" id="aiFormat" title="用设置里的 AI 把原始题目整理成站点格式；只改格式，不改答案">✨ AI 一键标准化</button>
        <button class="btn" id="doPreview">解析预览</button>
        <button class="btn primary" id="doSave">保存题库</button>
        <button class="btn ghost" id="doFormat">填入示例格式</button>
      </div>
      <div id="preview"></div>
    </div>

    <details class="card" style="margin-top:14px">
      <summary style="cursor:pointer;font-weight:700">支持的文本格式（点开看模板）</summary>
      <pre class="fmt"># 生化 第一章 蛋白质

1. 蛋白质分子中四级结构的特征是
A. 在三级结构的基础上进一步折叠而成
B. 分子中必定含有辅因子
C. 依赖肽键维系稳定性
D. 一定由两条或两条以上的多肽链组成
答案：D
解析：四级结构由两条以上多肽链（亚基）聚合而成。

2. 关于某疾病，下列说法正确的有
A. …
B. …
C. …
D. …
答案：ABD
解析：多选题答案连写即可。</pre>
      <div class="hint" style="margin-top:10px">
        · 题号 <b>1.</b> / <b>1、</b> 可写可省；选项行必须用 <b>A.</b> / <b>A、</b> / <b>A)</b> 开头。<br>
        · <b># 名称</b> 设为题库名；<b>## 说明</b> 会成为后面题目的「共用题干」（病例题、B 型题很好用）。<br>
        · <b>答案：</b> 单选写 <b>D</b>，多选写 <b>ABD</b>；<b>解析：</b> 后面可以写多行。<br>
        · 也支持 JSON：<b>[{"stem":"…","options":["…"],"answer":["D"],"explain":"…"}]</b>
      </div>
    </details>`;

  $('ta').value = remembered;
  /* 批量导入整个文件夹（bf-folder.js） */
  if (typeof BFF !== 'undefined' && BFF && BFF.attach) { try { BFF.attach(); } catch (e) {} }
  on('pickFile', () => $('fileInput').click());
  on('fileInput', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { $('ta').value = r.result; toast('已读取 ' + f.name); };
    r.readAsText(f, 'utf-8');
  }, 'change');
  on('doFormat', () => { $('ta').value = SAMPLE; });
  on('aiFormat', doAiFormat);
  on('doPreview', doPreview);
  on('doSave', doSave);
}

function parseInput(text, nameHint) {
  const t = (text || '').trim();
  if (!t) return { error: '内容是空的' };
  if (t[0] === '{' || t[0] === '[') {
    try {
      const j = JSON.parse(t);
      const b = Array.isArray(j) ? { questions: j } : j;
      const qs = (b.questions || []).map((q, i) => normalizeQ(q, i + 1));
      if (!qs.length) return { error: 'JSON 里没找到题目（需要 questions 数组）' };
      return { bank: { title: b.title || nameHint || '未命名题库', subtitle: b.subtitle || '', questions: qs }, warns: [] };
    } catch (e) { return { error: 'JSON 解析失败：' + e.message }; }
  }
  return parseText(t, nameHint);
}

const SAMPLE = `# 我的题库

1. 下列选项中可使骨骼肌松弛的是
A. 促使Ca2+进入运动神经末梢
B. 减少细胞外液的Mg2+浓度
C. 抑制胆碱酯酶的活性
D. 阻断终板膜非选择性通道
答案：D
解析：终板膜上N2型ACh受体被阻断后，ACh不能引起终板电位，骨骼肌松弛。`;

function parseText(text, nameHint) {
  const lines = text.split(/\r?\n/);
  const warns = [];
  const splitTags = s => String(s || '').split(/[,，、;；\/|]+/).map(x => x.trim()).filter(Boolean).slice(0, 6);
  let bankTitle = '', group = '', cur = null;
  const out = [];
  const RE_OPT = /^\s*([A-Ha-h])\s*[.、．)）:：]\s*(.+)$/;
  const RE_ANS = /^\s*(?:正确)?答案\s*[:：]?\s*([A-Ha-h][A-Ha-h\s,，、\/|]*)\s*$/;
  const RE_EXP = /^\s*(?:解析|解释|考点)\s*[:：]?\s*(.*)$/;
  const RE_TAG = /^\s*(?:标签|考点标签)\s*[:：]\s*(.+)$/;                                     /* 标签：炎症,免疫应答 */
  const RE_TAG2 = /^\s*考点\s*[:：]\s*([^。；！？]{1,24})$/;                                    /* 考点：炎症,免疫应答（短且带分隔符才算标签） */
  const RE_NUM = /^\s*(?:第\s*)?(\d+)\s*(?:[.、．)）:：]|\s)\s*(.+)$/;

  const finish = () => {
    if (!cur) return;
    cur.stem = cur.stem.trim();
    cur.explain = cur.explain.trim();
    if (!cur.stem) { cur = null; return; }
    if (cur.options.length < 2) warns.push(`「${cur.stem.slice(0, 14)}…」选项少于2个`);
    if (!cur.answer.length) warns.push(`「${cur.stem.slice(0, 14)}…」没有答案，已跳过`);
    const bad = cur.answer.some(a => 'ABCDEFGH'.indexOf(a) >= cur.options.length);
    if (bad) warns.push(`「${cur.stem.slice(0, 14)}…」答案超出选项范围`);
    if (cur.stem && cur.options.length >= 2 && cur.answer.length && !bad) {
      out.push({ id: out.length + 1, stem: cur.stem, options: cur.options, answer: cur.answer, explain: cur.explain, group: cur.group, groupTitle: cur.groupTitle, tags: cur.tags || [] });
    }
    cur = null;
  };
  const newQ = (stem, g) => ({ stem: stem, options: [], answer: [], explain: '', tags: [], group: g || '', groupTitle: g ? '共用题干' : '', mode: 'stem' });

  for (const raw of lines) {
    const s = raw.replace(/\s+$/, '').trim();
    if (!s) continue;
    const mG = s.match(/^#{2,}\s+(\S.*)$/) || s.match(/^#{2,}(?![\d#\s])(.+)$/);   /* ##共用题干 / ## 共用题干 都认 */
    if (mG) { finish(); group = mG[1].trim(); continue; }
    const mT = s.match(/^#\s+(\S.*)$/) || s.match(/^#(?![\d#\s])(.+)$/);              /* #题库名 / # 题库名 都认，#1 开头的不算标题 */
    if (mT) { if (!bankTitle) bankTitle = mT[1].trim(); continue; }
    const mAns = s.match(RE_ANS);
    if (mAns && cur) { cur.answer = Array.from(new Set(mAns[1].toUpperCase().replace(/[^A-H]/g, '').split(''))).sort(); cur.mode = 'explain'; continue; }
    const mTag = s.match(RE_TAG);
    if (mTag && cur) { cur.tags = (cur.tags || []).concat(splitTags(mTag[1])); cur.mode = 'explain'; continue; }
    const mTag2 = s.match(RE_TAG2);
    if (mTag2 && cur && /[,，、;；\/|]/.test(mTag2[1])) { cur.tags = (cur.tags || []).concat(splitTags(mTag2[1])); cur.mode = 'explain'; continue; }
    const mExp = s.match(RE_EXP);
    if (mExp && cur) { cur.explain = mExp[1] || ''; cur.mode = 'explain'; continue; }
    const mOpt = s.match(RE_OPT);
    if (mOpt && cur && !cur.answer.length && cur.options.length < 8) { cur.options.push(mOpt[2].trim()); cur.mode = 'opt'; continue; }
    const mNum = s.match(RE_NUM);
    if (mNum && mNum[2] && mNum[2].trim().length > 1) {
      if (!cur) { cur = newQ(mNum[2].trim(), group); continue; }
      if (cur.answer.length || cur.options.length) { finish(); cur = newQ(mNum[2].trim(), group); continue; }
    }
    if (!cur) { cur = newQ(s, group); continue; }
    if (cur.mode === 'explain' || (cur.answer.length && cur.options.length)) cur.explain += (cur.explain ? '\n' : '') + s;
    else if (cur.mode === 'opt') { cur.explain += (cur.explain ? '\n' : '') + s; cur.mode = 'explain'; }
    else cur.stem += (cur.stem ? '\n' : '') + s;
  }
  finish();
  if (!out.length) return { error: '没解析出题目，检查一下选项是不是用 A. B. C. D. 开头、答案是不是写成了「答案：D」' };
  return { bank: { title: bankTitle || nameHint || '未命名题库', subtitle: '', questions: out }, warns: warns };
}

/* 一键 AI 标准化：只整理格式，不改答案；失败保留原文 */
async function doAiFormat() {
  const ta = $('ta'), btn = $('aiFormat'), host = $('preview');
  if (!ta || !btn) return;
  const raw = String(ta.value || '').trim();
  if (!raw) { toast('先把要整理的题目粘进来', 2200, 'warn'); return; }
  const cfg = (typeof aiCfg === 'function') ? aiCfg() : null;
  if (typeof aiChat !== 'function' || !cfg || !cfg.base || !cfg.model) {
    toast('还没配置 AI。先去「AI 与知识库」填接口和模型，再回来点这个按钮', 3600, 'warn');
    return;
  }
  if (raw.length > 16000) {
    toast('内容太长（' + raw.length + ' 字），先分两段整理，避免模型漏题', 3600, 'warn');
    return;
  }
  const titleHint = $('bankTitle') ? $('bankTitle').value.trim() : '';
  const sys = [
    '你是题库格式整理器。把用户给的原始题目整理成刷题站能直接解析的纯文本题库。',
    '只输出整理后的题库文本；不要解释、不要 Markdown 代码块、不要 JSON、不要表格。',
    '标准格式：',
    '# 题库名（原文有就沿用，没有就根据内容起一个）',
    '',
    '1. 题干（保留完整题意）',
    'A. 选项',
    'B. 选项',
    'C. 选项',
    'D. 选项',
    '答案：D',
    '解析：……',
    '',
    '2. ……',
    '要求：',
    '- 保留原文所有题目，不增不减；题干、选项、答案、解析都不要改写医学含义。',
    '- 多选题答案连写，如 ABD。',
    '- 答案和解析必须各自单独一行，分别以「答案：」「解析：」开头。',
    '- 原文没有解析就留空，不要编造；原文没有选项不要硬造选项。',
    '- 去掉「例题」「答案在下方」「来源」等与题目无关的排版文字。',
    '- 如果原文是表格/多栏，按题号拆成上面的线性格式。'
  ].join('\n');
  const user = (titleHint ? '题库名提示：' + titleHint + '\n\n' : '') + '【原始内容】\n' + raw;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'AI 整理中…';
  host.innerHTML = '<div class="note">正在调用 AI 整理格式；只改排版，不改答案。</div>';
  try {
    const out = await aiChat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      null, null, { stream: false, temp: 0.1 }
    );
    let text = String(out || '').trim();
    if (window.CHAT && typeof CHAT.normalizeBankText === 'function') text = CHAT.normalizeBankText(text);
    text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/```\s*$/, '').trim();
    if (!text) throw new Error('AI 返回空内容');
    ta.value = text;
    doPreview();
    const r = parseInput(text, titleHint);
    if (r.error) toast('AI 整理完成，但还没解析成题库：' + r.error, 4200, 'warn');
    else toast('AI 整理完成：' + r.bank.questions.length + ' 题，检查后保存', 2600, 'ok');
  } catch (e) {
    host.innerHTML = '<div class="note err">AI 整理失败：' + esc((e && e.message) || String(e)) + '</div>';
    toast('AI 整理失败，原文已保留', 3000, 'bad');
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

function doPreview() {
  const r = parseInput($('ta').value, $('bankTitle').value.trim());
  const host = $('preview');
  if (r.error) { host.innerHTML = `<div class="note err">${esc(r.error)}</div>`; return; }
  const qs = r.bank.questions;
  if (!$('bankTitle').value.trim()) $('bankTitle').value = r.bank.title;
  const single = qs.filter(q => q.answer.length === 1).length;
  const dup = dupCheck(qs, EDIT_ID);
  host.innerHTML = `
    <div class="note ok">解析成功：<b>${qs.length}</b> 题（单选 ${single}，多选 ${qs.length - single}）</div>
    ${r.warns.length ? `<div class="note">${r.warns.map(esc).join('<br>')}</div>` : ''}
    ${dupHtml(dup)}
    <div class="sec-t">前 3 题预览</div>
    ${qs.slice(0, 3).map(q => `
      <div class="card" style="margin-bottom:10px">
        <div class="qno small">第 ${qNo(q, qs)} 题 · ${q.answer.length > 1 ? '多选' : '单选'}</div>
        ${q.group ? `<div class="gstem"><b>共用题干：</b>${esc(q.group)}</div>` : ''}
        <div style="margin:6px 0">${esc(q.stem)}</div>
        <div class="small">${q.options.map((o, i) => esc('ABCDEFGH'[i] + '. ' + o)).join('<br>')}</div>
        <div class="small" style="margin-top:6px;color:var(--ok)">答案：${q.answer.join('')}</div>
        ${q.explain ? `<div class="small muted" style="margin-top:4px">解析：${esc(q.explain)}</div>` : ''}
      </div>`).join('')}`;
}

function doSave() {
  const r = parseInput($('ta').value, $('bankTitle').value.trim());
  if (r.error) { $('preview').innerHTML = `<div class="note err">${esc(r.error)}</div>`; return; }
  const title = $('bankTitle').value.trim() || r.bank.title;
  const qs = r.bank.questions.map((q, i) => normalizeQ(q, i + 1));
  if (EDIT_ID) {
    const bank = LOCAL.find(b => b.id === EDIT_ID);
    if (bank) {
      bank.title = title;
      bank.subtitle = (r.bank.subtitle || '自建题库') + ' · ' + qs.length + ' 题';
      bank.questions = qs;
      invalidateBanks();
      writeLS(LS.banks, LOCAL);
      applyBankTags(bank);
      toast('已更新：' + title);
      go('#/bank/' + bank.id);
      return;
    }
  }
  let id = 'local-' + Date.now().toString(36);
  while (LOCAL.some(b => b.id === id)) id += '-' + i2s();    // 导入的题库里若带了重复 id 也不会串台
  const bank = { id: id, title: title, subtitle: (r.bank.subtitle || '自建题库') + ' · ' + qs.length + ' 题', questions: qs };
  LOCAL.push(bank);
  invalidateBanks();
  writeLS(LS.banks, LOCAL);
  applyBankTags(bank);
  if (typeof BF !== 'undefined' && BF && BF.autoSave) { try { BF.autoSave(); } catch (e) {} }
  toast('已保存：' + title);
  go('#/bank/' + bank.id);
}

/* 导入的题库若写了「标签：炎症,免疫应答」（parseText 认出来的），顺手落进考点标签，别让人再打一遍 */
function applyBankTags(bank) {
  try {
    if (!bank || typeof window.TAGS !== 'object' || !window.TAGS || typeof kOf !== 'function') return 0;
    const vocab = [];
    let n = 0;
    (bank.questions || []).forEach(q => {
      if (!q || !Array.isArray(q.tags) || !q.tags.length) return;
      const k = kOf(bank, q);
      window.TAGS.set(k, window.TAGS.of(k).concat(q.tags), true);
      q.tags.forEach(t => vocab.push(t));
      n++;
    });
    if (n) {
      window.TAGS.rememberVocab(vocab);
      window.TAGS.save();
      setTimeout(() => toast('顺手打了 ' + n + ' 道题的考点标签'), 700);
    }
    return n;
  } catch (e) { return 0; }
}

/* ============================================================
   学习统计
   ============================================================ */
/* 近 n 天每天做了多少题、对了几道（只算有时间的记录，老数据 ts=0 归不到某天） */
function statsDaily(days) {
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const out = [], idx = {};
  const dk = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000);
    const o = { key: dk(d), label: (d.getMonth() + 1) + '/' + d.getDate(), n: 0, ok: 0 };
    idx[o.key] = o; out.push(o);
  }
  Object.keys(ANS).forEach(k => {
    const a = ANS[k]; if (!a || !a.ts) return;
    const o = idx[dk(new Date(a.ts))];
    if (!o) return;
    o.n++; if (a.ok) o.ok++;
  });
  return out;
}

/* 今天该复习的题：到期的错题，早到期的排前面 */
function dueKeys(limit) {
  const out = [];
  baseBanks().forEach(b => b.questions.forEach(q => { const k = kOf(b, q); if (isDue(k)) out.push(k); }));
  out.sort((a, b) => (dueOf(a) || 0) - (dueOf(b) || 0));
  return limit ? out.slice(0, limit) : out;
}
function startReview(limit) {
  const cap = +srsCfg().daily || 0;                  // 0 = 不限
  const max = Math.min(limit && limit > 0 ? limit : 9999, cap || 9999);
  const ks = dueKeys(max);
  if (!ks.length) { toast('今天没有到期的复习，休息一下'); return; }
  makePaper('今日复习 · ' + ks.length + ' 题', ks);
}

function renderStats() {
  $('appTitle').textContent = '学习统计';
  $('stat').textContent = ''; $('bar').style.width = '0%';

  const banks = baseBanks();
  let recN = 0, okN = 0, triesN = 0, undated = 0;
  Object.keys(ANS).forEach(k => {
    const a = ANS[k]; if (!a) return;
    if (!a.ts) { undated++; return; }
    recN++; triesN += (a.tries || 1); if (a.ok) okN++;
  });
  const T = todayStats();

  const days = statsDaily(14);
  const maxN = Math.max(1, ...days.map(d => d.n));
  const sumN = days.reduce((a, d) => a + d.n, 0), sumOk = days.reduce((a, d) => a + d.ok, 0);
  const dueN = dueKeys(0).length;

  const rows = banks.map(b => {
    let done = 0, ok = 0, wr = 0;
    b.questions.forEach(q => {
      const a = ANS[kOf(b, q)];
      if (a && !a.redo) { done++; if (a.ok) ok++; }
      if (a && (a.wrong || 0) > 0) wr++;
    });
    return { b: b, done: done, wr: wr, n: b.questions.length, acc: done ? Math.round(ok / done * 100) : 0 };
  });

  const tops = [];
  banks.forEach(b => b.questions.forEach(q => {
    const a = ANS[kOf(b, q)];
    if (a && (a.wrong || 0) > 0) tops.push({ b: b, q: q, a: a });
  }));
  tops.sort((x, y) => (y.a.wrong || 0) - (x.a.wrong || 0) || (y.a.tries || 0) - (x.a.tries || 0));

  const none = !recN && !sumN;
  $('view').innerHTML = `
    <div class="card">
      <div class="stats">
        <button class="hst" data-jump="secBanks" title="看下面各题库的正确率"><b>${recN}</b><span>累计做题</span></button>
        <div class="hst-plain"><b>${triesN}</b><span>累计作答次数</span></div>
        <button class="hst" data-jump="secBanks" title="看下面各题库的正确率"><b>${recN ? Math.round(okN / recN * 100) : 0}%</b><span>累计正确率</span></button>
        <button class="hst" data-jump="secDays" title="看近 14 天的柱子"><b>${T.dNum}</b><span>今日已答</span></button>
        <button class="hst" data-jump="secDays" title="看近 14 天的柱子"><b>${T.streak}</b><span>连续天数</span></button>
        <button class="hst${dueN ? '' : ' off'}" ${dueN ? 'data-act="review"' : 'disabled'} title="${dueN ? '开始今日复习' : '今天没有该复习的题'}"><b>${dueN}</b><span>待复习</span></button>
      </div>
      ${none ? '<div class="note" style="margin-top:12px">还没有作答记录：回首页挑一个题库做几道，这里就有数据了。</div>' : ''}
      ${undated ? `<div class="small muted" style="margin-top:8px">另有 ${undated} 条早期记录没有日期（老版本数据），不计入下面的趋势图。</div>` : ''}
    </div>

    ${typeof reportSectionHtml === 'function' ? reportSectionHtml() : ''}

    <h2 class="sec" id="secDays">近 14 天</h2>
    <div class="card">
      <div class="tools" style="margin-top:0">
        <span class="mini-tag">共 ${sumN} 题</span>
        ${sumN ? `<span class="mini-tag ok">平均正确率 ${Math.round(sumOk / sumN * 100)}%</span>` : ''}
        <span class="spacer-grow"></span>
        <span class="tl" id="dayTip">点一下柱子，看那天的详情</span>
      </div>
      <div class="chart">
        ${days.map((d, i) => `<div class="cbar${d.n ? '' : ' zero'}" data-day="${i}" style="--i:${i}" title="${d.key}：${d.n} 题${d.n ? '，正确率 ' + Math.round(d.ok / d.n * 100) + '%' : ''}">
          <b>${d.n || ''}</b><i style="height:${Math.max(2, Math.round(d.n / maxN * 92))}px"></i><span>${d.label}</span>
        </div>`).join('')}
      </div>
      ${dueN ? `<div class="tools"><button class="btn primary" id="stReview">开始今日复习（${dueN} 题）</button></div>` : ''}
    </div>

    <details class="fold secfold" id="secBanks" open>
      <summary>各题库正确率${rows.length ? `（${rows.length} 个题库）` : ''}</summary>
      <div class="fold-body">
        ${rows.length ? rows.map(r => `<button class="srow srow-go" data-openbank="${esc(r.b.id)}" title="去刷这个题库">
        <span class="sname">${esc(r.b.title)}</span>
        <span class="sbar"><i style="width:${r.acc}%"></i></span>
        <span class="sval">${r.acc}%　已答 ${r.done}/${r.n}　错题 ${r.wr}</span>
        <span class="chev">›</span>
      </button>`).join('') : '<div class="empty">还没有题库</div>'}
      </div>
    </details>

    <h2 class="sec">错得最多的题</h2>
    <div class="card">
      ${tops.length ? tops.slice(0, 12).map((t, i) => `<div class="srow srow-go" data-openbank="${esc(t.b.id)}" data-goto="${esc(String(t.q.id))}" title="去做这道题">
        <span class="wno">${i + 1}</span>
        <span class="sname" style="flex:1 1 auto" title="${esc(t.q.stem)}">${esc(t.q.stem.slice(0, 40))}${t.q.stem.length > 40 ? '…' : ''}</span>
        <span class="sval">错 ${t.a.wrong || 0} / 做 ${t.a.tries || 0}</span>
        <span class="chev">›</span>
      </div>`).join('') : '<div class="empty">还没有错题，继续保持。</div>'}
    </div>

    ${typeof tagStatsHtml === 'function' ? `<h2 class="sec" id="secTags">按考点（知识点标签）</h2>${tagStatsHtml()}` : ''}`;

  /* 统计页的点击：数字块滚到对应区块、题库行直接进题库、柱子看当天详情 */
  document.querySelectorAll('#view [data-jump]').forEach(el => el.onclick = () => {
    const t = $(el.dataset.jump);
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const rvBtn = document.querySelector('#view [data-act="review"]');
  if (rvBtn) rvBtn.onclick = () => startReview(60);
  document.querySelectorAll('#view [data-openbank]').forEach(el => el.onclick = () => {
    const b = bankById(el.dataset.openbank); if (!b) return;
    if (el.dataset.goto) { QZ.filter = 'wrong'; QZ.order = null; QZ.cur = el.dataset.goto; QZ.focusCur = true; }
    go('#/bank/' + b.id);
  });
  const bars = document.querySelectorAll('#view .cbar');
  bars.forEach(el => el.onclick = () => {
    const d = days[+el.dataset.day]; if (!d) return;
    bars.forEach(x => x.classList.remove('on'));
    el.classList.add('on');
    const tip = $('dayTip');
    if (tip) tip.innerHTML = `<b>${d.key}</b>：${d.n} 题${d.n ? '，正确率 ' + Math.round(d.ok / d.n * 100) + '%' : '（那天没做题）'}`;
  });
  on('stReview', () => startReview(60));
  /* 「按考点」区块：刷最弱考点 / 考点词表（导入）/ AI 打标签 */
  if (typeof bindTagStats === 'function') { try { bindTagStats($('view')); } catch (e) {} }
  /* 「学情诊断」区块：切时间窗、生成、停止、历史报告 */
  if (typeof bindReport === 'function') { try { bindReport($('view')); } catch (e) {} }
}

/* ============================================================
   导入查重：粘贴的题库和已有题库、以及自身有没有重复题干
   ============================================================ */
const normStem = s => String(s || '').replace(/\s+/g, '').replace(/[，。；：、？！,.;:?!（）()【】\[\]"'“”‘’]/g, '').toLowerCase();

function dupCheck(qs, excludeId) {
  const have = {};
  baseBanks().forEach(b => {
    if (b.id === excludeId) return;
    b.questions.forEach(q => {
      const k = normStem(q.stem); if (!k) return;
      (have[k] = have[k] || { titles: {} }).titles[b.title] = 1;
    });
  });
  const self = {}, dup = [], repeat = [];
  qs.forEach(q => {
    const k = normStem(q.stem); if (!k) return;
    if (have[k]) dup.push({ stem: q.stem, titles: Object.keys(have[k].titles) });
    if (self[k]) repeat.push(q.stem); else self[k] = 1;
  });
  return { dup: dup, repeat: repeat };
}
function dupHtml(d) {
  if (!d.dup.length && !d.repeat.length) return '';
  const cut = s => esc(String(s).slice(0, 44)) + (String(s).length > 44 ? '…' : '');
  return (d.dup.length ? `<div class="note">有 <b>${d.dup.length}</b> 题和现有题库里的题干重复（只是提醒，不会自动合并）：<br>${d.dup.slice(0, 5).map(x => '· ' + cut(x.stem) + ' <span class="muted">（' + esc(x.titles.join('、')) + '）</span>').join('<br>')}${d.dup.length > 5 ? '<br>…' : ''}</div>` : '')
    + (d.repeat.length ? `<div class="note">粘贴的内容里有 <b>${d.repeat.length}</b> 题题干重复：<br>${d.repeat.slice(0, 5).map(x => '· ' + cut(x)).join('<br>')}</div>` : '');
}

/* ============================================================
   快捷键帮助
   ============================================================ */
function showHelp() {
  let m = $('helpMask');
  if (!m) {
    m = document.createElement('div');
    m.className = 'mask'; m.id = 'helpMask';
    m.innerHTML = `<div class="sheet help-sheet">
      <div class="shead help-head"><h3>快捷键与操作</h3><span class="spacer-grow"></span><button class="btn tiny" id="helpClose2">关闭</button></div>
      <div class="hint">手机上直接点就行；下面这些是电脑键盘用的。随时按 <span class="kbd">?</span> 打开这里，按 <span class="kbd">Esc</span> 关掉。</div>

      <div class="help-card">
        <div class="sec-t">答题</div>
        <div class="help-row"><span class="kbd">A</span><span class="kbd">B</span><span class="kbd">C</span><span class="kbd">D</span><span class="spacer-grow"></span><span class="muted">选选项（也可以按 1 2 3 4；多选题先都选上再提交）</span></div>
        <div class="help-row"><span class="kbd">Enter</span><span class="spacer-grow"></span><span class="muted">多选题＝提交答案；单选或已判分＝下一题</span></div>
        <div class="help-row"><span class="kbd">←</span><span class="kbd">→</span><span class="spacer-grow"></span><span class="muted">上一题 / 下一题（到头了按钮会变灰）</span></div>
        <div class="help-row"><span class="kbd">J</span><span class="kbd">K</span><span class="spacer-grow"></span><span class="muted">下一题 / 上一题（Vim 那套；和 <span class="kbd">←</span><span class="kbd">→</span> 一样）</span></div>
        <div class="help-row"><span class="kbd">S</span><span class="spacer-grow"></span><span class="muted">收藏 / 取消收藏当前题（收藏成功会弹一下提示）</span></div>
        <div class="help-row"><span class="kbd">O</span><span class="spacer-grow"></span><span class="muted">打开答题卡：可按「做错 / 没做」筛选，点题号直接跳过去</span></div>
      </div>

      <div class="help-card">
        <div class="sec-t">跳页（都是先按 <span class="kbd">g</span>，再按一下）</div>
        <div class="help-row"><span class="kbd">g</span><span class="kbd">h</span><span class="spacer-grow"></span><span class="muted">首页</span></div>
        <div class="help-row"><span class="kbd">g</span><span class="kbd">w</span><span class="spacer-grow"></span><span class="muted">错题本</span></div>
        <div class="help-row"><span class="kbd">g</span><span class="kbd">s</span><span class="spacer-grow"></span><span class="muted">搜索</span></div>
        <div class="help-row"><span class="kbd">g</span><span class="kbd">k</span><span class="spacer-grow"></span><span class="muted">知识库</span></div>
        <div class="help-row"><span class="kbd">g</span><span class="kbd">f</span><span class="spacer-grow"></span><span class="muted">收藏</span></div>
        <div class="help-row"><span class="kbd">g</span><span class="kbd">t</span><span class="spacer-grow"></span><span class="muted">学习统计</span></div>
        <div class="help-row"><span class="kbd">g</span><span class="kbd">g</span><span class="spacer-grow"></span><span class="muted">回到最上面（长页面用）</span></div>
      </div>

      <div class="help-card">
        <div class="sec-t">找题</div>
        <div class="help-row"><span class="kbd">/</span><span class="spacer-grow"></span><span class="muted">任何页面都能跳到搜索框</span></div>
        <div class="help-row"><span class="kbd">Enter</span><span class="spacer-grow"></span><span class="muted">光标在搜索框里＝立刻搜（不用等那 0.2 秒）</span></div>
        <div class="help-row"><span class="kbd">Esc</span><span class="spacer-grow"></span><span class="muted">搜索框里有字＝清空；没字＝关掉弹窗</span></div>
      </div>

      <div class="help-card">
        <div class="sec-t">界面</div>
        <div class="help-row"><span class="kbd">?</span><span class="spacer-grow"></span><span class="muted">打开 / 收起这个帮助</span></div>
        <div class="help-row"><span class="kbd">◐</span><span class="spacer-grow"></span><span class="muted">顶栏这个按钮：跟随系统 → 浅色 → 深色</span></div>
      </div>

      <div class="sec-t">顺手提一句</div>
      <div class="small muted help-tips">
        · 首页最上面是「继续刷题」，直接接着上次的题号。<br>
        · 首页那排数字都能点：点错题进错题本，点待复习直接开始复习。<br>
        · 底栏中间的数字点开就是答题卡；答完自动把解析滚到眼前。<br>
        · 错题本、收藏页的批量与导出收在「批量操作与导出」里，点一下展开。<br>
        · 顶栏「文件」＝把自建题库存成本机文件，或从文件读回来。
      </div>

      <div class="help-card">
        <div class="sec-t">第一次用 / 忘了怎么配</div>
        <div class="small muted help-tips">导入题库、制作题库、配知识库、填 API Key、云同步 —— 都有一步一步的引导，点哪段看哪段。</div>
        <div class="actions" style="margin-top:8px"><button class="btn primary" id="helpGuide">🎓 打开新手引导</button></div>
      </div>

      <div class="actions"><button class="btn primary" id="helpClose">知道了</button></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', ev => { if (ev.target === m) hideMask(m); });
  }
  m.classList.add('show');
  on('helpClose', () => hideMask(m));
  on('helpClose2', () => hideMask(m));
}

/* ============================================================
   事件绑定（全部走 on()，某个 id 缺失也不会影响其它按钮）
   ============================================================ */
on('prev', () => step(-1));
on('next', () => step(1));
on('btnGrid', () => { renderGrid(); $('gridMask').classList.add('show'); });
on('jumpInfo', () => { renderGrid(); $('gridMask').classList.add('show'); });
on('gridClose', closeAll);
on('btnHome', () => go('#/'));
/* 固定返回键：优先浏览器历史（hash 返回），直接打开的子页就回首页 */
on('backFix', () => { try { if (history.length > 1) history.back(); else go('#/'); } catch (e) { go('#/'); } });
on('bnHome', () => go('#/'));
on('appTitle', () => go('#/'));
on('btnGoWrong', () => go('#/wrong'));
on('btnFocusExit', () => uiSetFocus(false));
on('btnGoFav', () => go('#/fav'));
on('btnGoSearch', () => go('#/search'));
on('btnGoKb', () => go('#/kb'));
on('goKb2', () => { if (typeof closeAll === 'function') closeAll(); go('#/kb'); });
/* 设置面板里的「复习曲线」id ↔ 参数名 */
const SRS_UI = { srsFirst: 'first', srsSecond: 'second', srsFactor: 'factor', srsEase0: 'ease0', srsEaseUp: 'easeUp', srsEaseDown: 'easeDown', srsMinEase: 'minEase', srsMaxIvl: 'maxIvl', srsWrongIvl: 'wrongIvl', srsDaily: 'daily' };
function srsPaintEls() {
  const c = srsCfg();
  const sel = $('srsMode');
  if (sel) {
    sel.innerHTML = Object.keys(SRS_PRESETS).map(m => '<option value="' + m + '">' + SRS_PRESETS[m].label + '</option>').join('');
    sel.value = c.mode;
  }
  Object.keys(SRS_UI).forEach(id => { const el = $(id); if (el) el.value = c[SRS_UI[id]]; });
  const f = $('srsFactor');
  if (f && f.value !== String(c.factor)) {
    const o = document.createElement('option');
    o.value = String(c.factor); o.textContent = '× ' + c.factor;
    f.appendChild(o); f.value = String(c.factor);
  }
  const wt = $('srsWrongToday'); if (wt) wt.checked = !!c.wrongToday;
  if ($('srsDesc')) $('srsDesc').textContent = c.desc;
  if ($('srsPreview')) $('srsPreview').textContent = srsPreviewText(c);
}
/* 改动时只刷新说明和预览，不动正在输入的那个框 */
function srsRepaint() {
  const c = srsCfg();
  if ($('srsDesc')) $('srsDesc').textContent = c.desc;
  if ($('srsPreview')) $('srsPreview').textContent = srsPreviewText(c);
  const sel = $('srsMode'); if (sel && sel.value !== c.mode) sel.value = c.mode;
}
function openSettings() {
  $('setExpOnOk').checked = SET.expOnOk;
  $('setAutoNext').checked = SET.autoNext;
  $('setShuffle').checked = SET.shuffle;
  $('setFxConfetti').checked = SET.fxConfetti !== false;
  $('setFxNormalBank').checked = !!SET.fxNormalBank;
  if ($('setFocus')) $('setFocus').checked = !!SET.focus;
  if ($('setSpeedSec')) $('setSpeedSec').value = SET.speedSec || 0;
  if ($('setReduceMotion')) $('setReduceMotion').checked = !!SET.reduceMotion;
  if ($('setTheme')) $('setTheme').value = SET.theme || 'auto';
  if ($('setFs')) $('setFs').value = SET.fs || 'm';
  if ($('setColor')) $('setColor').value = THEME_COLORS.indexOf(SET.color) >= 0 ? SET.color : 'teal';
  if ($('setBg')) $('setBg').value = BG_OPTIONS.indexOf(SET.bg) >= 0 ? SET.bg : 'default';
  if (!SRS_PRESETS[SRS.mode]) SRS.mode = 'sm2';
  srsPaintEls();
  $('setMask').classList.add('show');
}
on('btnQuizSet', openSettings);
on('btnSetAll', openSettings);
on('setTheme', e => { setLook('theme', e.target.value); paintThemeBtn(); }, 'change');
on('setFs', e => setLook('fs', e.target.value), 'change');
on('setColor', e => { setLook('color', e.target.value); toast('主题色换成「' + (THEME_NAME[e.target.value] || '冷静青') + '」', 1400, 'ok'); }, 'change');
on('setBg', e => { const v = e.target.value; setLook('bg', v); if (v === 'custom') bgPick(); toast('背景换成「' + (BG_NAME[v] || '默认微光') + '」', 1400, 'ok'); }, 'change');
on('setBgPick', bgPick);
on('setBgClear', bgClearImage);
on('setBgFile', e => { const f = e.target.files && e.target.files[0]; if (f) bgSetFromFile(f); }, 'change');
on('closeSet', closeAll);
on('setExpOnOk', e => { SET.expOnOk = e.target.checked; writeLS(LS.set, SET); render(); }, 'change');
on('setAutoNext', e => { SET.autoNext = e.target.checked; writeLS(LS.set, SET); }, 'change');
/* 方案九：⚡ 速刷限时（秒 / 题，0 = 不限时）—— 只在速刷模式生效，改完就重画 */
on('setSpeedSec', e => {
  SET.speedSec = Math.max(0, Math.min(300, Math.round(+e.target.value || 0)));
  e.target.value = SET.speedSec;
  writeLS(LS.set, SET);
  if (SET.quizMode === 'speed') render();
}, 'change');
on('setShuffle', e => { SET.shuffle = e.target.checked; writeLS(LS.set, SET); QZ.order = null; render(); }, 'change');
/* 庆祝开关（fx.js）：关掉时把正在放的彩带立刻收掉，别留在屏幕上 */
on('setFxConfetti', e => {
  SET.fxConfetti = e.target.checked; writeLS(LS.set, SET);
  if (!SET.fxConfetti && window.FX && FX.stop) FX.stop();
}, 'change');
on('setFxNormalBank', e => {
  SET.fxNormalBank = e.target.checked; writeLS(LS.set, SET);
  if (!SET.fxNormalBank && window.FX && FX.stop) FX.stop();
}, 'change');
/* §3.6-P0① 专注模式（设置里的开关，等价于答题页右上角那个「⛶ 专注」） */
on('setFocus', e => uiSetFocus(e.target.checked), 'change');
/* 减少动态效果：勾上/取消立即生效（关掉时把正在放的彩带也收掉） */
on('setReduceMotion', e => {
  setLook('reduceMotion', e.target.checked);
  if (SET.reduceMotion && window.FX && FX.stop) FX.stop();
}, 'change');
on('resetAll', () => {
  if (!confirm('清空全部题库的作答记录？错题、收藏、自定义解析、临时套卷会被保留。不可恢复。')) return;
  tombWipe('ans'); ANS = {}; saveAns(); closeAll(); render(); toast('已清空作答记录');
});
/* 复习曲线：换档位 / 逐项改参数 / 一键重置 / 统一易度 / 按修正答案重判 */
on('srsMode', e => { setSrsMode(e.target.value); srsPaintEls(); }, 'change');
Object.keys(SRS_UI).forEach(id => on(id, e => {
  const f = SRS_UI[id];
  let v = e.target.value;
  if (f === 'factor') v = (v === 'ease' ? 'ease' : (+v || 2));
  else v = +v || 0;
  srsSetField(f, v);
  srsRepaint();
}, 'change'));
on('srsWrongToday', e => { srsSetField('wrongToday', !!e.target.checked); srsRepaint(); }, 'change');
on('srsReset', () => {
  const m = SRS_PRESETS[SRS.mode] ? SRS.mode : 'sm2';
  setSrsMode(m); srsPaintEls();
  toast('已填回「' + SRS_PRESETS[m].label + '」的推荐值');
});
on('srsSyncEase', () => {
  const c = srsCfg(), n = Object.keys(ANS).length;
  if (!n) { toast('还没有作答记录'); return; }
  if (!confirm('把现有 ' + n + ' 条作答记录的易度统一改成 ' + c.ease0 + '？间隔和到期时间不变。')) return;
  Object.keys(ANS).forEach(k => { ANS[k].ease = +c.ease0 || 2.5; });
  saveAns(); toast('已统一易度');
});
on('fixAllRe', () => {
  const n = Object.keys(FIX).length;
  if (!n) { toast('还没有改过任何题的答案'); return; }
  if (!confirm('按修正后的答案重判这 ' + n + ' 道题的历史记录？错次数和复习排期会一起变。')) return;
  const c = rejudgeAll();
  toast('已重判 ' + c + ' 道题');
  render();
});
on('expAll2', exportAllData);

/* ---------- 顶栏「◐」：一键切换外观 ---------- */
const THEME_ORDER = ['auto', 'light', 'dark'];
const THEME_ICON = { auto: '◐', light: '☀', dark: '☾' };
const THEME_LABEL = { auto: '跟随系统', light: '浅色', dark: '深色' };
function paintThemeBtn() {
  const el = $('btnTheme'); if (!el) return;
  const t = THEME_LABEL[SET.theme] ? SET.theme : 'auto';
  el.textContent = THEME_ICON[t];
  el.title = '外观：' + THEME_LABEL[t] + '（点一下切换）';
}
on('btnTheme', () => {
  const cur = THEME_LABEL[SET.theme] ? SET.theme : 'auto';
  const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
  setLook('theme', next);
  const sel = $('setTheme'); if (sel) sel.value = next;
  paintThemeBtn();
  toast('外观已切成「' + THEME_LABEL[next] + '」');
});
if (window.matchMedia) {
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => paintThemeBtn()); } catch (e) {}
}
paintThemeBtn();
document.querySelectorAll('.mask').forEach(m => m.onclick = e => { if (e.target === m) closeAll(); });

/* §3.6-P2⑧ 手势增强：答题页左右滑动翻题（左滑 = 下一题、右滑 = 上一题）
   三条纪律：① 只在触屏上认（pointerType 是 mouse 的直接不管）；
   ② 得先过 30px 且横向明显大于纵向才成立 —— 不然会跟纵向滚动、点选项、点题号打架；
   ③ 翻页只调现成的 step(±1)，不另立一套。卡片跟手那点位移是次要的，reduced-motion 下干脆不动。 */
const SWIPE_MIN = 30;
let _sw = null;                     /* 手上这一笔：{x,y,id,card,dx,ok} */
function uiSwipeBind() {
  const v = $('view');
  if (!v || v.dataset.swipe === '1') return;
  v.dataset.swipe = '1';
  v.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || e.button) return;
    const card = e.target.closest('.card');
    if (!card || !card.querySelector('#qBody')) return;            /* 只认题目卡 */
    if (e.target.closest('input, textarea, select, [contenteditable="true"], .vstrip, .qsheet, .mask')) return;
    _sw = { x: e.clientX, y: e.clientY, id: e.pointerId, card, dx: 0, ok: false };
  });
  v.addEventListener('pointermove', e => {
    if (!_sw || e.pointerId !== _sw.id) return;
    const dx = e.clientX - _sw.x, dy = e.clientY - _sw.y;
    if (!_sw.ok) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dx) <= Math.abs(dy)) { _sw = null; return; }    /* 往纵向走：交回给页面滚动 */
      _sw.ok = true;
      _sw.card.classList.add('swiping');
    }
    _sw.dx = Math.max(-100, Math.min(100, dx));
    if (uiMotionOK()) _sw.card.style.transform = 'translateX(' + (_sw.dx * 0.45).toFixed(1) + 'px)';
  });
  const up = e => {
    if (!_sw || e.pointerId !== _sw.id) return;
    const st = _sw; _sw = null;
    st.card.classList.remove('swiping');
    /* 被系统打断（pointercancel：比如浏览器把这一笔当成滚动了）就不当翻页，
       免得「想滚页面结果题跳了」 */
    const cut = e.type === 'pointercancel';
    if (!cut && st.ok && st.dx <= -SWIPE_MIN) { step(1); return; }  /* 左滑 → 下一题 */
    if (!cut && st.ok && st.dx >= SWIPE_MIN) { step(-1); return; }  /* 右滑 → 上一题 */
    if (st.card.style.transform) {                                  /* 没过阈值：弹回原位 */
      if (uiMotionOK()) {
        st.card.classList.add('snapping');
        setTimeout(() => st.card.classList.remove('snapping'), 240);
      }
      st.card.style.transform = '';
    }
  };
  v.addEventListener('pointerup', up);
  v.addEventListener('pointercancel', up);
}
uiSwipeBind();

/* §3.6-P2⑦：g 后面第二个键去哪儿（'top' 是回到页面最上面，不是换页） */
const GO_KEYS = {
  h: ['#/', '首页'],
  w: ['#/wrong', '错题本'],
  s: ['#/search', '搜索'],
  k: ['#/kb', '知识库'],
  f: ['#/fav', '收藏'],
  t: ['#/stats', '学习统计'],
  g: ['top', '回到最上面'],
};
let _gAt = 0;                       /* 上一次按 g 的时间，超过 1.2 秒就作废 */
document.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || !!(e.target && e.target.isContentEditable);
  /* 在输入框里打字一律不响应快捷键（含中文输入法的候选状态：拼音打字时按空格/回车选词也会冒 keydown）。
     这一条必须放在最前面 —— 否则在 AI 面板里敲字会被当成答题键（A–H / Enter / ←→ / S / Esc），
     一按就把整页重画、正在流式生成的解析面板被冲掉。 */
  if (typing || e.isComposing || e.keyCode === 229) return;
  /* ---------- §3.6-P2⑦ Vim 风格双键：先按 g，再按一下跳页 ----------
     g h 首页 / g w 错题本 / g s 搜索 / g k 知识库 / g f 收藏 / g t 学习统计 / g g 回到最上面。
     只认「1.2 秒内」的第二下，中途按了别的键就作废（不会误伤单键）；
     页面上会冒一条小提示告诉你能按什么，省得记。 */
  const gNow = Date.now();
  if (_gAt && gNow - _gAt >= 1200) _gAt = 0;          /* 上一回的 g 已经过期，清掉再认下一次 */
  if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey && !_gAt) {
    _gAt = gNow;
    if (typeof toast === 'function') toast('g 后面再按一下：h 首页 · w 错题 · s 搜索 · k 知识库 · f 收藏 · t 统计 · g 顶部', 1400);
    e.preventDefault();
    return;
  }
  if (_gAt && gNow - _gAt < 1200) {
    const hit = GO_KEYS[e.key.toLowerCase()];
    _gAt = 0;
    if (hit) {
      e.preventDefault();
      if (hit[0] === 'top') window.scrollTo({ top: 0, behavior: (typeof uiMotionOK === 'function' && !uiMotionOK()) ? 'auto' : 'smooth' });
      else go(hit[0]);
      return;
    }
    /* 等第二下的时候按了别的键：什么也不做（Vim 的规矩）—— 免得「g 之后手滑敲了 A」把选项选上。
       Esc 放行，用来中途反悔。 */
    if (e.key !== 'Escape') { e.preventDefault(); return; }
  }
  /* ? 打开快捷键帮助（任何页面都能用） */
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
    e.preventDefault();
    const hm = $('helpMask');
    if (hm && hm.classList.contains('show')) { hideMask(hm); return; }
    showHelp(); return;
  }
  if (e.key === 'Escape') { if (SET.focus) { uiSetFocus(false); return; } qSheetToggle(false); closeAll(); return; }
  const rn = route().name;
  /* 搜索页（或任何页面）：按 / 跳到搜索框并聚焦 */
  if (e.key === '/') {
    const focusSq = () => { const el = $('sq'); if (el) { el.focus(); el.select(); } };
    const nb = document.getElementById('nbSearch');       /* 首页那个搜索框：就地聚焦，不用跳页 */
    if (nb) { e.preventDefault(); nb.focus(); nb.select(); return; }
    if (rn === 'search') focusSq();
    else { go('#/search'); setTimeout(focusSq, 60); }
    e.preventDefault();
    return;
  }
  if (rn !== 'quiz' && rn !== 'exam') return;
  /* AI 正在流式生成：答题快捷键全部让路（敲 A–H / Enter / ←→ / S / K 都不会再把面板冲掉） */
  if (typeof aiBusy === 'function' && aiBusy()) return;
  const k = e.key.toUpperCase();
  if (/^[A-H]$/.test(k) || /^[1-8]$/.test(k)) {
    const K = /^[A-H]$/.test(k) ? k : 'ABCDEFGH'[+k - 1];
    const o = document.querySelector(`.opt[data-k="${K}"]`);
    if (o && !o.disabled) o.click();
    e.preventDefault(); return;
  }
  if (rn === 'exam') {
    if (e.key === 'Enter' || e.key === 'ArrowRight' || k === 'J') { if (typeof examStep === 'function') examStep(1); e.preventDefault(); return; }
    if (e.key === 'ArrowLeft' || k === 'K') { if (typeof examStep === 'function') examStep(-1); e.preventDefault(); return; }
    return;
  }
  const bank = bankById(QZ.bankId);
  const q = bank && bank.questions.find(x => String(x.id) === String(QZ.cur));
  /* S 收藏本题、O 打开答题卡（原本是 K，让给 Vim 的「上一题」）—— 不用去够鼠标（A–H 留给选项） */
  if (k === 'S' && bank && q) { toggleFav(favKey(bank, q)); e.preventDefault(); return; }
  if (k === 'O') { renderGrid(); const gm = $('gridMask'); if (gm) gm.classList.add('show'); e.preventDefault(); return; }
  /* §3.6-P2⑦：j 下一题 / k 上一题（Vim 那套，跟 ←→ 等价） */
  if (k === 'J') { step(1); e.preventDefault(); return; }
  if (k === 'K') { step(-1); e.preventDefault(); return; }
  if (e.key === 'Enter') {
    if (q && !answered(kOf(bank, q)) && qType(q, ansOf(favKey(bank, q), q)) === 'X' && (QZ.pending[q.id] || []).length) judge(bank, q, QZ.pending[q.id]);
    else step(1);
    e.preventDefault();
  }
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});
