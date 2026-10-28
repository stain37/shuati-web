/* ============================================================
   刷题站 · 本地知识库 kb.js
   · 资料只存在本机：优先 IndexedDB，退而 localStorage
   · 中文按「双字切分」做 BM25 检索，不用联网、不用向量库
   · 大资料不走浏览器：用 make-kb.py 把 资料/ 变成 知识库.js（自动挂载）
   · 本文件提供：知识库管理界面、检索接口 kbSearch()
   ============================================================ */

const KB_LS_LIST = 'qbank.kb.list.v1';     /* 知识库目录（只存元信息） */
const KB_LS_SEL  = 'qbank.kb.sel.v1';      /* 选中了哪些知识库 */
const KB_LS_DATA = 'qbank.kb.data.v1.';    /* 每个知识库的正文（localStorage 后端时） */
const KB_LS_SKIP = 'qbank.kb.skip.v1';     /* 删掉、不再自动挂载的文件知识库 id */

let KB_LIST = readLS(KB_LS_LIST, []);      /* [{ id, name, src, addedAt, chars, docs, chunks }] */
let KB_SEL_RAW = readLS(KB_LS_SEL, null);  /* null = 从没选过（默认全选） */
let KB_SEL = Array.isArray(KB_SEL_RAW) ? KB_SEL_RAW.slice() : [];
let KB_SEL_SET = Array.isArray(KB_SEL_RAW);
let KB_SKIP = readLS(KB_LS_SKIP, []);      /* 形如 ['chatbox-5']：删掉的文件库，刷新后不再自动挂载 */
const KB_MEM = {}, KB_IDX = {}, KB_OPEN = {};
/* 重排结果缓存：同一道题（同一批候选）反复问时不重复调模型。
   只存「命中顺序」的 key 列表，不存正文，200 条 LRU —— 内存可忽略。 */
const KB_RR_CACHE = new Map();
let KB_DB = null;
const kbBackend = () => (KB_DB ? 'IndexedDB' : 'localStorage');
const kbName = id => { const k = KB_LIST.find(x => x.id === id); return k ? k.name : id; };
const kbList = () => KB_LIST.slice();
const kbSelected = () => (KB_SEL_SET ? KB_SEL.slice() : KB_LIST.map(k => k.id));
function kbSaveList() { writeLS(KB_LS_LIST, KB_LIST.filter(k => !k.auto)); }
function kbSaveSel() { writeLS(KB_LS_SEL, KB_SEL); }
function kbSetSel(id, on) {
  if (!KB_SEL_SET) { KB_SEL = KB_LIST.map(k => k.id); KB_SEL_SET = true; }
  KB_SEL = KB_SEL.filter(x => x !== id);
  if (on) KB_SEL.push(id);
  kbSaveSel();
  if (route().name === 'quiz' && document.querySelector('.aichip')) paintAiChips();
}
function kbSelAll(on) { KB_SEL_SET = true; KB_SEL = on ? KB_LIST.map(k => k.id) : []; kbSaveSel(); }

/* ---------- 存储后端 ---------- */
function kbIdbOpen() {
  return new Promise((res, rej) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; rej(new Error('timeout')); } }, 1200);
    try {
      const rq = indexedDB.open('shuati-kb', 3);
      rq.onupgradeneeded = () => {
        try {
          const db = rq.result;
          if (!db.objectStoreNames.contains('kb')) db.createObjectStore('kb');
          if (!db.objectStoreNames.contains('idx')) db.createObjectStore('idx');   /* 检索索引（结构化克隆，不转 JSON） */
          if (!db.objectStoreNames.contains('emb')) db.createObjectStore('emb');   /* 段落向量（A1，按 模型|库|段落哈希 存） */
        } catch (e) {}
      };
      rq.onsuccess = () => { if (done) return; done = true; clearTimeout(t); KB_DB = rq.result; res(rq.result); };
      rq.onerror = () => { if (done) return; done = true; clearTimeout(t); rej(rq.error || new Error('idb error')); };
      rq.onblocked = () => { if (done) return; done = true; clearTimeout(t); rej(new Error('blocked')); };
    } catch (e) { clearTimeout(t); rej(e); }
  });
}
function kbStorePut(id, obj) {
  if (KB_DB) return new Promise(res => {
    try {
      const tx = KB_DB.transaction('kb', 'readwrite');
      tx.objectStore('kb').put(JSON.stringify(obj), id);
      tx.oncomplete = () => res(true); tx.onerror = () => res(false);
    } catch (e) { res(false); }
  });
  return Promise.resolve(writeLS(KB_LS_DATA + id, obj));
}
function kbStoreGet(id) {
  if (KB_DB) return new Promise(res => {
    try {
      const rq = KB_DB.transaction('kb').objectStore('kb').get(id);
      rq.onsuccess = () => { let v = rq.result || null; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } } res(v); };
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  return Promise.resolve(readLS(KB_LS_DATA + id, null));
}
function kbStoreDel(id) {
  if (KB_DB) return new Promise(res => { try { const tx = KB_DB.transaction('kb', 'readwrite'); tx.objectStore('kb').delete(id); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e) { res(false); } });
  try { localStorage.removeItem(KB_LS_DATA + id); } catch (e) {}
  return Promise.resolve(true);
}
/* ---------- 检索索引落盘（B2） ----------
   361 万字每次刷新都要重切段 + 重算 BM25（kb.js 的 kbIndexAsync），冷启动一两秒到十几秒。
   把建好的索引放进 IndexedDB 的 'idx' store（结构化克隆，不走 JSON.stringify）：
   下次直接用，docs 变了（增删资料 / 正文变了）再用 sig 判定失效重建。 */
function kbIdxSig(docs) {
  let n = 0, len = 0;
  (docs || []).forEach(d => { n++; len += String((d && d.text) || '').length; });
  return n + ':' + len;
}
function kbIdxPut(id, idx, sig) {
  if (!KB_DB) return Promise.resolve(false);       /* localStorage 放不下索引，直接不落盘 */
  return new Promise(res => {
    try {
      const tx = KB_DB.transaction('idx', 'readwrite');
      tx.objectStore('idx').put({ sig: sig, at: Date.now(), idx: idx }, id);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
      tx.onabort = () => res(false);
    } catch (e) { res(false); }
  });
}
function kbIdxGet(id) {
  if (!KB_DB) return Promise.resolve(null);
  return new Promise(res => {
    try {
      const rq = KB_DB.transaction('idx').objectStore('idx').get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
function kbIdxDel(id) {
  if (!KB_DB) return Promise.resolve(true);
  return new Promise(res => {
    try {
      const tx = KB_DB.transaction('idx', 'readwrite');
      tx.objectStore('idx').delete(id);
      tx.oncomplete = () => res(true); tx.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}
/* 启动时探测一次：file:// 下有些浏览器不给用 IndexedDB，就退回 localStorage */
kbIdbOpen().then(() => { if (route().name === 'kb') render(); }).catch(() => {});

/* ---------- 分段 & 检索 ---------- */
/* 中文没有空格：汉字串切成双字（行政诉讼 → 行政/政诉/诉讼），英文数字按词 */
function kbTokens(s) {
  s = String(s || '').toLowerCase();
  const out = [], re = /[\u4e00-\u9fff]+|[a-z0-9_]+/g;
  let m;
  while ((m = re.exec(s))) {
    const w = m[0];
    if (/[\u4e00-\u9fff]/.test(w)) {
      if (w.length === 1) out.push(w);
      else for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
    } else if (w.length > 1) out.push(w);
  }
  return out;
}
/* 归一化正文（去掉空白、统一小写）+ 内容指纹。
   指纹用来做「同一段正文只占一个参考位」：本站自带的 5 个资料库里，
   各库之间有不少篇是完全重复的（内科 / 外科 / 生化 / 生理 / 病理 彼此有交叉章节），
   不去重的话 4 个参考位常被同一段正文占掉两个。 */
function kbFlat(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
function kbHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}
/* 查询里的「字面片段」：把连续汉字切成 4 / 6 / 8 字的窗口。
   只要资料里有一段原文跟这些窗口一字不差，它就是真正相关的那一段 —— 给额外加分。
   题干里混着选项和要求，所以不能要求整句命中，窗口短一点才能命中真正的原句。 */
function kbPhrases(q) {
  const out = [], re = /[\u4e00-\u9fff]{3,}/g;
  let m;
  while ((m = re.exec(String(q || '')))) {
    const w = m[0], add = x => { if (out.indexOf(x) < 0) out.push(x); };
    if (w.length >= 4 && w.length <= 12) add(w);
    [8, 6, 4].forEach(L => { for (let i = 0; i + L <= w.length; i += 2) add(w.slice(i, i + L)); });
  }
  return out;
}
/* 把一篇文章切成 500 字上下的小段，带一点重叠，记下所属标题 */
function kbChunk(text) {
  const MAX = 560, OVER = 90;
  text = String(text || '').replace(/\r\n?/g, '\n').replace(/\u3000/g, ' ').replace(/\n{3,}/g, '\n\n');
  const isHead = s => /^#{1,6}\s+\S/.test(s)
    || /^第[0-9一二三四五六七八九十百千]+[章节讲部分课题]/.test(s)
    || /^[（(]?[一二三四五六七八九十\d]+[)）]?[、.．]\s*\S/.test(s)
    || /^\*\*[^*]{2,30}\*\*$/.test(s);
  const out = [];
  const stack = [];   /* 标题栈：第N章 > 第M节 > 小标题；只留最近三级做路径 */
  let head = '', buf = '';
  const pathOf = () => stack.filter(Boolean).slice(-3).join(' > ');
  const push = () => {
    const t = buf.trim();
    buf = '';
    if (!t) return;
    if (t.length < 60 && out.length && (out[out.length - 1].t.length + t.length) < MAX) { out[out.length - 1].t += '\n' + t; return; }
    out.push({ h: head, hp: pathOf(), t: t });
  };
  String(text || '').split('\n').forEach(raw => {
    const s = raw.trim();
    if (!s) { if (buf) buf += '\n'; return; }
    if (isHead(s) && s.length <= 40) {
      push();
      const title = s.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '');
      const lv = /^#{1,6}\s/.test(s) ? /^#+/.exec(s)[0].length
        : /^第[0-9一二三四五六七八九十百千]+[分编部]/.test(title) ? 1
          : /^第[0-9一二三四五六七八九十百千]+[章节]/.test(title) ? 2 : 3;
      if (stack.length >= lv) stack.length = lv - 1;
      stack[lv - 1] = title;
      head = title;
      return;
    }
    if (buf.length + s.length > MAX && buf.length) {
      const tail = buf.slice(-OVER);
      push();
      buf = tail + '\n';
    }
    buf += s + '\n';
  });
  push();
  return out;
}
/* 建索引：BM25F，正文 / 标题 / 文件名分三个字段。
   为什么要把标题拆出来单算：原来标题是拌进正文里一起算的，标题里的词会被正文的长度归一化稀释掉。
   实测（800 条「按知识点名找那一节」的查询）：标题字段加权后 Top1 从 84.1% 升到 94.5%，
   完整分句 / 真题两类查询不降。参数 k1=1.2 b=0.75 标题×4 文件名×1 是网格搜出来的。 */
/* 建索引支持「分片 + 让出主线程」：184 万字在pad上要一两秒，一口气跑完页面就冻住了。
   kbIndex() 是原来的同步版（还在用，兼容）；kbIndexAsync() 每 120 段让一次，页面保持能滚。 */
const KB_PROG = {};          /* 库id → {done, total}：建索引进度（面板上拿它显示百分比） */
const KB_BUILD = {};         /* 库id → Promise：同一个库同时只建一次 */
function kbYield() { return new Promise(r => setTimeout(r, 0)); }
async function kbIndexAsync(docs, id) {
  const chunks = [], df = Object.create(null), names = [];
  let total = 0, totalH = 0, totalN = 0, totalP = 0;
  const flat = [];
  docs.forEach((d, di) => {
    const ntf = Object.create(null);
    let nlen = 0;
    kbTokens(String(d.name || '').replace(/\.[a-z0-9]+$/i, '')).forEach(t => { ntf[t] = (ntf[t] || 0) + 1; nlen++; });
    names.push({ ntf: ntf, nlen: nlen });
    totalN += nlen;
    (d.chunks || []).forEach((c, ci) => flat.push([d, di, c, ci]));
  });
  const n = flat.length || 1;
  if (id) KB_PROG[id] = { done: 0, total: n };
  for (let k = 0; k < flat.length; k++) {
    const [d, di, c, ci] = flat[k];
    const tf = Object.create(null), hs = Object.create(null);
    let len = 0, hlen = 0, plen = 0;
    kbTokens(c.t).forEach(t => { tf[t] = (tf[t] || 0) + 1; len++; });
    kbTokens(c.h || '').forEach(t => { hs[t] = (hs[t] || 0) + 1; hlen++; });
    const ps = Object.create(null);
    kbTokens(c.hp || '').forEach(t => { ps[t] = (ps[t] || 0) + 1; plen++; });
    const seen = Object.create(null);
    Object.keys(tf).forEach(t => { seen[t] = 1; df[t] = (df[t] || 0) + 1; });
    Object.keys(hs).forEach(t => { if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; } });
    Object.keys(ps).forEach(t => { if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; } });
    Object.keys(names[di] ? names[di].ntf : {}).forEach(t => { if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; } });
    total += len; totalH += hlen; totalP += plen;
    chunks.push({ d: di, ci: ci, h: c.h, hp: c.hp || '', t: c.t, tf: tf, len: len, hs: hs, hlen: hlen, ps: ps, plen: plen, txt: kbFlat((c.hp ? c.hp + ' ' : '') + (c.h ? c.h : '') + c.t), ck: kbHash(kbFlat(c.t)) });
    if (k % 120 === 119) { if (id) KB_PROG[id] = { done: k + 1, total: n }; await kbYield(); }
  }
  if (id) KB_PROG[id] = { done: n, total: n };
  return { chunks: chunks, df: df, names: names,
    avg: total / n, avgH: totalH / n, avgP: totalP / n, avgN: names.length ? totalN / names.length : 1 };
}
/* 面板上显示的那行进度文字（没有在干重活就返回空） */
function kbProgressText() {
  if (KB_FILES_LOADING && !(window.__KBS__ && window.__KBS__.length)) return '正在下载资料库（第一次约 4.8 MB，下完就缓起来了）…';
  const ids = Object.keys(KB_PROG);
  if (!ids.length) return '';
  let d = 0, t = 0;
  ids.forEach(k => { d += (KB_PROG[k] || {}).done || 0; t += (KB_PROG[k] || {}).total || 0; });
  if (!t) return '';
  const pct = Math.min(99, Math.round(d / t * 100));
  return '正在准备检索索引 ' + pct + '%（第一次慢，之后就好了）…';
}
function kbIndex(docs) {
  const chunks = [], df = Object.create(null), names = [];
  let total = 0, totalH = 0, totalN = 0, totalP = 0;
  docs.forEach((d, di) => {
    const ntf = Object.create(null);
    let nlen = 0;
    kbTokens(String(d.name || '').replace(/\.[a-z0-9]+$/i, '')).forEach(t => { ntf[t] = (ntf[t] || 0) + 1; nlen++; });
    names.push({ ntf: ntf, nlen: nlen });
    totalN += nlen;
    (d.chunks || []).forEach((c, ci) => {
      const tf = Object.create(null), hs = Object.create(null);
      let len = 0, hlen = 0, plen = 0;
      kbTokens(c.t).forEach(t => { tf[t] = (tf[t] || 0) + 1; len++; });
      kbTokens(c.h || '').forEach(t => { hs[t] = (hs[t] || 0) + 1; hlen++; });
      const ps = Object.create(null);
      kbTokens(c.hp || '').forEach(t => { ps[t] = (ps[t] || 0) + 1; plen++; });
      /* df = 「这个词在本段里出现过」（三个字段任一算），每段只计一次 */
      const seen = Object.create(null);
      Object.keys(tf).forEach(t => { seen[t] = 1; df[t] = (df[t] || 0) + 1; });
      Object.keys(hs).forEach(t => { if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; } });
      Object.keys(ps).forEach(t => { if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; } });
      Object.keys(ntf).forEach(t => { if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; } });
      total += len; totalH += hlen; totalP += plen;
      chunks.push({ d: di, ci: ci, h: c.h, hp: c.hp || '', t: c.t, tf: tf, len: len, hs: hs, hlen: hlen, ps: ps, plen: plen, txt: kbFlat((c.hp ? c.hp + ' ' : '') + (c.h ? c.h : '') + c.t), ck: kbHash(kbFlat(c.t)) });
    });
  });
  const n = chunks.length || 1;
  return { chunks: chunks, df: df, names: names,
    avg: total / n, avgH: totalH / n, avgP: totalP / n, avgN: names.length ? totalN / names.length : 1 };
}
/* BM25F 参数：一次查询的原始得分 = 三字段 BM25F + 字面命中加分 */
const KB_K1 = 1.2, KB_B = 0.75, KB_WH = 4, KB_WD = 1, KB_WP = 6;
/* 一次查询的原始得分，按分数从高到低 */
function kbHits(query, ids) {
  const qt = Array.from(new Set(kbTokens(query))).filter(t => t.length > 1 || /[\u4e00-\u9fff]/.test(t));
  if (!qt.length) return [];
  const probes = kbPhrases(query);      /* 字面命中的探针；长题干里能命中的才是真原句 */
  const hits = [];
  ids.forEach(id => {
    const idx = KB_IDX[id];
    if (!idx) return;
    const N = idx.chunks.length || 1;
    const names = idx.names || [];
    idx.chunks.forEach(c => {
      const dn = names[c.d];
      let s = 0;
      qt.forEach(t => {
        const tf = c.tf[t] || 0, htf = (c.hs && c.hs[t]) || 0, ptf = (c.ps && c.ps[t]) || 0, ntf = dn ? (dn.ntf[t] || 0) : 0;
        let tfn = 0;
        if (tf) tfn += tf / (1 - KB_B + KB_B * c.len / idx.avg);                                  /* 正文 */
        if (htf) tfn += KB_WH * htf / (1 - KB_B + KB_B * c.hlen / (idx.avgH || 1));              /* 标题（加权） */
        if (ntf) tfn += KB_WD * ntf / (1 - KB_B + KB_B * dn.nlen / (idx.avgN || 1));
        if (ptf) tfn += KB_WP * ptf / (1 - KB_B + KB_B * (c.plen || 1) / (idx.avgP || 1));             /* 文件名 */
        if (!tfn) return;
        const dfv = idx.df[t] || 1;
        s += Math.log(1 + (N - dfv + 0.5) / (dfv + 0.5)) * tfn * (KB_K1 + 1) / (KB_K1 + tfn);
      });
      if (s <= 0) return;
      /* 字面命中：资料里有没有跟查询一字不差的原句。
         先用二元组「守门」（哈希查表，几乎不花时间），过了才做字符串查找。 */
      if (probes.length && c.txt) {
        let pb = 0;
        for (let i = 0; i < probes.length; i++) {
          const p = probes[i];
          if (!c.tf[p.slice(0, 2)] && !(c.hs && c.hs[p.slice(0, 2)]) && !c.tf[p.slice(1, 3)] && !(c.hs && c.hs[p.slice(1, 3)])) continue;
          if (c.txt.indexOf(p) >= 0) pb += (p.length >= 8 ? 6 : p.length >= 6 ? 3.5 : 1.8);
        }
        if (pb) s += pb * 2;              /* 「真的就是这句原话」比「碰巧共用几个词」值钱得多 */
      }
      hits.push({ id: id, score: s, ch: c });
    });
  });
  hits.sort((a, b) => b.score - a.score);
  if (hits.length) {
    const mx = hits[0].score || 1;
    hits.forEach(h => { h.ns = h.score / mx; });
  }
  return hits;
}
function kbSearchSync(query, ids, topK) {
  return kbHybridSearchSync(query, ids, topK || 4);
}
/* 挑结果：
   ① 同一段正文只留一次（跨库重复的按内容指纹去重）；
   ② 相邻切段有 90 字重叠，内容高度相似的也算重复，别让它们互相当「第 2 段」；
   ③ 同一个文件最多 2 段，尽量让参考来自不同文件。 */
function kbPickDiverse(hits, K) {
  const cap = K >= 4 ? 2 : 1;      /* 参考资料条数够多时，同一个文件最多取 2 段 */
  const out = [], spill = [], used = Object.create(null), seenCk = new Set(), bgs = [];
  const bgOf = t => {
    const s = new Set(), x = kbFlat(t);
    for (let i = 0; i < x.length - 1; i++) s.add(x.slice(i, i + 2));
    return s;
  };
  const isDup = bg => {
    for (let i = 0; i < bgs.length; i++) {
      let inter = 0;
      bgs[i].forEach(x => { if (bg.has(x)) inter++; });
      const uni = bg.size + bgs[i].size - inter;
      if (uni && inter / uni > 0.55) return true;
    }
    return false;
  };
  for (let i = 0; i < hits.length && out.length < K; i++) {
    const h = hits[i], ch = h.ch;
    if (ch.ck != null && seenCk.has(ch.ck)) { spill.push(h); continue; }
    const bg = bgOf(ch.t);
    if (isDup(bg)) { spill.push(h); continue; }
    const dk = h.id + "#" + ch.d;
    if ((used[dk] || 0) >= cap) { spill.push(h); continue; }
    used[dk] = (used[dk] || 0) + 1;
    if (ch.ck != null) seenCk.add(ch.ck);
    bgs.push(bg);
    out.push(h);
  }
  for (let i = 0; i < spill.length && out.length < K; i++) out.push(spill[i]);   /* 来源不够时再补重复的 */
  return out;
}
/* ---------- A1：向量 / 混合检索（目标是 Top1） ----------
   关键词 BM25F 只看「词对不对得上」；向量看「整段像不像」。两票用 RRF 合并成一份排序。
   向量来源自动二选一（都失败就退回纯关键词，绝不挡住回答）：
     ① 设置里填了「向量模型」→ OpenAI 兼容 /embeddings；每段向量按「库 + 段落内容哈希」存 IndexedDB，第二次不再花钱；
     ② 没填 → 本地字符二元/三元组哈希向量（零网络、零费用），补的是词序、长短和局部重合。 */
const KB_LS_EMBM = 'qbank.kb.embmodel.v1';
let KB_VW = 0.5;                   /* 向量票在 RRF 里的权重：与关键词票 1:1 */
const KB_VEC = {};                 /* 库id → {post:Map<hash, idx[]>, vecs:[{k,v}], n} */
const KB_EMB = {};                 /* 库id → {段落内容哈希: Float32Array} 远端向量 */
const KB_EMB_BAD = {};             /* 库id → true：这个库远端向量失败过，本次会话不再重试 */

function kbVecWeight() { return KB_VW; }
function kbVecSetWeight(w) { KB_VW = Math.max(0, Math.min(2, Number(w) || 0)); return KB_VW; }
function kbEmbModel() { try { return String(readLS(KB_LS_EMBM, '') || '').trim(); } catch (e) { return ''; } }
function kbEmbSetModel(m) {
  writeLS(KB_LS_EMBM, String(m || '').trim());
  Object.keys(KB_EMB).forEach(k => { delete KB_EMB[k]; });
  Object.keys(KB_EMB_BAD).forEach(k => { delete KB_EMB_BAD[k]; });
}
/* 一段文本 → 稀疏向量（特征哈希 + 权重，L2 归一化） */
function kbVecFeat(s) {
  const txt = kbFlat(s), m = Object.create(null);
  const add = (k, w) => { m[k] = (m[k] || 0) + w; };
  for (let i = 0; i < txt.length - 1; i++) add(txt.slice(i, i + 2), 1);            /* 二元组 ≈ 半个词 */
  for (let i = 0; i + 2 < txt.length; i += 2) add('3' + txt.slice(i, i + 3), 1.2); /* 隔字三元组 ≈ 短语 */
  kbTokens(s).forEach(x => { if (x.length > 1) add('w' + x, 2); });               /* 整词额外加权 */
  const keys = [], vals = [];
  Object.keys(m).forEach(k => { keys.push(kbHash(k)); vals.push(m[k]); });
  const ix = keys.map((k, i) => i).sort((a, b) => keys[a] - keys[b]);
  const k2 = new Uint32Array(ix.length), v2 = new Float32Array(ix.length);
  let norm = 0;
  ix.forEach((src, i) => { k2[i] = keys[src]; v2[i] = vals[src]; norm += vals[src] * vals[src]; });
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v2.length; i++) v2[i] /= norm;
  return { k: k2, v: v2 };
}
/* 本地向量索引：特征 → 段落倒排（只对命中的特征累加，避免全量遍历） */
function kbVecIndex(id) {
  if (KB_VEC[id]) return KB_VEC[id];
  const idx = KB_IDX[id];
  if (!idx) return null;
  const vecs = [], post = new Map();
  idx.chunks.forEach((c, ci) => {
    const f = kbVecFeat((c.hp ? c.hp + ' ' : '') + (c.h || '') + ' ' + c.t);
    vecs.push(f);
    for (let i = 0; i < f.k.length; i++) {
      const key = f.k[i];
      let arr = post.get(key);
      if (!arr) { arr = []; post.set(key, arr); }
      arr.push(ci);
    }
  });
  KB_VEC[id] = { post: post, vecs: vecs, n: vecs.length };
  return KB_VEC[id];
}
/* 本地向量打分：余弦 */
function kbVecHits(query, ids, cap) {
  const qv = kbVecFeat(query);
  const hits = [];
  (ids || []).forEach(id => {
    const V = kbVecIndex(id);
    if (!V) return;
    const idx = KB_IDX[id];
    const acc = new Map();
    for (let i = 0; i < qv.k.length; i++) {
      const arr = V.post.get(qv.k[i]);
      if (!arr) continue;
      const qw = qv.v[i];
      for (let j = 0; j < arr.length; j++) acc.set(arr[j], (acc.get(arr[j]) || 0) + qw);
    }
    acc.forEach((s, ci) => {
      const ch = idx.chunks[ci];
      if (!ch || s <= 0) return;
      hits.push({ id: id, score: s, ch: ch, via: 'vec' });
    });
  });
  hits.sort((a, b) => b.score - a.score);
  const mx = (hits[0] && hits[0].score) || 1;
  hits.forEach(h => { h.ns = h.score / mx; });
  return cap ? hits.slice(0, cap) : hits;
}
/* 混合排序：关键词票 + 向量票（RRF，k=60） */
function kbHybridHits(query, ids, opt) {
  opt = opt || {};
  const kw = kbHits(query, ids);
  const kwTop = kw.slice(0, opt.cap || 120);
  let vec = opt.vec;
  if (!vec) { try { vec = kbVecHits(query, ids, opt.cap || 120); } catch (e) { vec = []; } }
  if (!vec || !vec.length) return kw;          /* 向量没捞到东西：保持原来的关键词排序，别把结果弄坏 */
  const acc = new Map();
  kwTop.forEach((h, i) => {
    const key = h.id + '#' + h.ch.d + '#' + h.ch.ci;
    const cur = acc.get(key) || { h: h, s: 0 };
    cur.s += (opt.wkw == null ? 1 : opt.wkw) / (60 + i + 1);
    acc.set(key, cur);
  });
  vec.forEach((h, i) => {
    const key = h.id + '#' + h.ch.d + '#' + h.ch.ci;
    const cur = acc.get(key) || { h: h, s: 0 };
    cur.s += (opt.wvec == null ? KB_VW : opt.wvec) / (60 + i + 1);
    acc.set(key, cur);
  });
  const arr = []; acc.forEach(v => arr.push(v));
  arr.sort((a, b) => b.s - a.s);
  return arr.map(x => x.h);
}
/* ---------- 远端向量（可选） ---------- */
function kbEmbNorm(arr) {
  const v = Float32Array.from(arr || []);
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
function kbEmbPut(ck, vec) {
  if (!KB_DB) return Promise.resolve(false);
  return new Promise(res => {
    try {
      const tx = KB_DB.transaction('emb', 'readwrite');
      tx.objectStore('emb').put(vec, ck);
      tx.oncomplete = () => res(true); tx.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}
function kbEmbStoreGet(ck) {
  if (!KB_DB) return Promise.resolve(null);
  return new Promise(res => {
    try {
      const rq = KB_DB.transaction('emb').objectStore('emb').get(ck);
      rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
/* 建一个库的远端向量：先读盘上缓存，缺的才调接口（16 段一批） */
async function kbEmbBuild(id) {
  const model = kbEmbModel();
  if (!model || typeof aiEmbed !== 'function' || KB_EMB_BAD[id]) return false;
  if (KB_EMB[id] && KB_EMB[id].__done) return true;
  const idx = KB_IDX[id];
  if (!idx) return false;
  const map = KB_EMB[id] = KB_EMB[id] || Object.create(null);
  const todo = [];
  for (const c of idx.chunks) {
    const ck = model + '|' + id + '|' + c.ck;
    if (map[ck]) continue;
    const cached = await kbEmbStoreGet(ck);
    if (cached) { map[ck] = Float32Array.from(cached); continue; }
    todo.push(c);
  }
  try {
    for (let i = 0; i < todo.length; i += 16) {
      const batch = todo.slice(i, i + 16);
      const vecs = await aiEmbed(batch.map(c => ((c.hp ? c.hp + ' ' : '') + (c.h || '') + ' ' + c.t).slice(0, 900)), { model: model });
      if (!vecs || !vecs.length) throw new Error('embedding 返回空');
      batch.forEach((c, j) => {
        if (!vecs[j]) return;
        const v = kbEmbNorm(vecs[j]);
        map[model + '|' + id + '|' + c.ck] = v;
        kbEmbPut(model + '|' + id + '|' + c.ck, v);
      });
      if (i % 160 === 0) await kbYield();
    }
    map.__done = true;
    return true;
  } catch (e) {
    KB_EMB_BAD[id] = true;
    return false;
  }
}
async function kbEmbQueryVec(query) {
  const model = kbEmbModel();
  if (!model || typeof aiEmbed !== 'function') return null;
  try {
    const vecs = await aiEmbed([String(query || '').slice(0, 900)], { model: model });
    return vecs && vecs[0] ? kbEmbNorm(vecs[0]) : null;
  } catch (e) { return null; }
}
/* 远端向量打分（需要先 kbEmbBuild 过） */
function kbEmbHits(queryVec, ids, cap) {
  if (!queryVec) return [];
  const hits = [];
  (ids || []).forEach(id => {
    const map = KB_EMB[id] || {};
    const idx = KB_IDX[id];
    if (!idx) return;
    idx.chunks.forEach(c => {
      const ck = kbEmbModel() + '|' + id + '|' + c.ck;
      const v = map[ck];
      if (!v) return;
      let s = 0;
      const n = Math.min(v.length, queryVec.length);
      for (let i = 0; i < n; i++) s += v[i] * queryVec[i];
      if (s > 0) hits.push({ id: id, score: s, ch: c, via: 'emb' });
    });
  });
  hits.sort((a, b) => b.score - a.score);
  return cap ? hits.slice(0, cap) : hits;
}
/* 对外：混合检索（同步版，本地向量；远端向量就绪时由异步入口替换） */
function kbHybridSearchSync(query, ids, topK) {
  const vecAll = kbVecHits(query, ids, 120);
  const embModel = kbEmbModel();
  let vec = vecAll;
  if (embModel) {
    const ready = (ids || []).some(id => KB_EMB[id] && KB_EMB[id].__done);
    if (!ready) vec = vecAll;        /* 还没备好：先用本地向量顶着，备好后自动换成远端 */
  }
  return kbPickDiverse(kbHybridHits(query, ids, { vec: vec }), topK || 4);
}

async function kbEnsure(id) {
  if (KB_IDX[id]) return true;
  if (!KB_MEM[id] && KB_LAZY[id]) { try { await kbLoadShard(id); } catch (e) { console.warn('[kb] 分片没加载上', id, e); } }
  if (!KB_MEM[id]) { const d = await kbStoreGet(id); if (!d) return false; KB_MEM[id] = d; }
  if (KB_BUILD[id]) return KB_BUILD[id];          /* 同一个库同时只建一次 */
  KB_BUILD[id] = (async () => {
    const docs = KB_MEM[id].docs || [];
    const sig = kbIdxSig(docs);
    try {
      /* 先看盘上有没有同签名的索引：命中就跳过重切段 */
      const hit = await kbIdxGet(id);
      if (hit && hit.idx && hit.sig === sig && Array.isArray(hit.idx.chunks) && hit.idx.chunks.length) {
        KB_IDX[id] = hit.idx;
        KB_RR_CACHE.clear();
        window.__kbIdxHits = (window.__kbIdxHits || 0) + 1;
        return true;
      }
      window.__kbIdxBuilds = (window.__kbIdxBuilds || 0) + 1;
      KB_IDX[id] = await kbIndexAsync(docs, id);
      KB_RR_CACHE.clear();          /* 索引重建了：老的排序结果可能指向不存在的段，作废 */
      kbIdxPut(id, KB_IDX[id], sig);   /* 落盘：下次刷新直接用（失败不影响本次） */
      if (kbEmbModel() && typeof aiEmbed === 'function') { try { kbEmbBuild(id); } catch (e) {} }
    } finally { delete KB_PROG[id]; delete KB_BUILD[id]; }
    return true;
  })();
  return KB_BUILD[id];
}
function kbSnippet(t, q, n) {
  n = n || 200;
  /* 优先按「一字不差的片段」定位：这样截出来的是真正的原句，而不是碰巧共用两个字的开头 */
  let pos = -1;
  kbPhrases(q).forEach(p => { const i = t.indexOf(p); if (i >= 0 && (pos < 0 || i < pos)) pos = i; });
  if (pos < 0) kbTokens(q).filter(x => x.length > 1).forEach(tk => { const i = t.indexOf(tk); if (i >= 0 && (pos < 0 || i < pos)) pos = i; });
  if (pos < 0) return t.slice(0, n) + (t.length > n ? '…' : '');
  const s = Math.max(0, pos - Math.floor(n / 3));
  return (s > 0 ? '…' : '') + t.slice(s, s + n) + (s + n < t.length ? '…' : '');
}
/* 取同一篇资料相邻的一段（ci±1）。只送命中段经常缺上下文：
   定义在上一段、结论在下一段，模型只看到中间那段就会答得很飘。 */
function kbChunkOf(id, d, ci) {
  const idx = KB_IDX[id];
  if (!idx) return null;
  if (!idx._byDC) {
    const m = Object.create(null);
    idx.chunks.forEach(c => { m[c.d + '#' + c.ci] = c; });
    idx._byDC = m;
  }
  return idx._byDC[d + '#' + ci] || null;
}
/* A3 父段回填：同一篇资料里连续的多段合成一个「父段窗口」。
   以前只取相邻一段的 260 字，遇到「定义隔了两段 / 结论在小标题后」就补不上；
   现在沿 ci 往两侧连续扩，最多 4 段，直到预算用完。 */
function kbSpan(id, d, ci, dir, budget) {
  const parts = [];
  let total = 0, c = ci;
  for (let i = 0; i < 4; i++) {
    c += dir;
    if (c < 0) break;
    const nx = kbChunkOf(id, d, c);
    if (!nx) break;
    const t = String(nx.t || '');
    if (!t) break;
    parts.push(t);
    total += t.length + 1;
    if (total >= budget) break;
  }
  let s = parts.join('\n');
  s = dir < 0 ? s.slice(-budget) : s.slice(0, budget);
  return s;
}
/* A4 句边界对齐（顺手做，成本为零）：别把半句话喂给模型 */
function kbAlignHead(s) {
  const m = String(s || '').match(/[。！？；\n]/g);
  if (!m) return s;
  const i = String(s).indexOf(m[0]);
  return i >= 0 && i < String(s).length - 20 ? String(s).slice(i + 1) : s;
}
function kbAlignTail(s) {
  const t = String(s || '');
  const m = t.match(/[。！？；]/g);
  if (!m) return t;
  const i = t.lastIndexOf(m[m.length - 1]);
  return i > 20 ? t.slice(0, i + 1) : t;
}
/* 把原始命中变成对外结构（带出处和摘要） */
function kbDetail(hits, query) {
  return hits.map(h => {
    const d = (KB_MEM[h.id] && KB_MEM[h.id].docs || [])[h.ch.d] || {};
    return { id: h.id, key: h.id + '#' + h.ch.d + '#' + h.ch.ci,
      pre: kbAlignHead(kbSpan(h.id, h.ch.d, h.ch.ci, -1, 620)), post: kbAlignTail(kbSpan(h.id, h.ch.d, h.ch.ci, +1, 520)),
      kb: kbName(h.id), doc: d.name || '资料', page: d.page, pages: d.pages, pdfp: d.pdfp, file: d.file || '', full: d.text || '', head: h.ch.h || '', path: h.ch.hp || '', text: h.ch.t, score: h.score, snip: kbSnippet(h.ch.t, query, 200) };
  });
}
/* 确保这几个库已挂载并建好索引 */
async function kbReady(ids) {
  if (typeof kbEnsureFilesLoaded === 'function') { try { await kbEnsureFilesLoaded(); } catch (e) {} }
  ids = (ids && ids.length) ? ids : kbSelected();
  for (const id of ids) await kbEnsure(id);
  return ids.filter(id => KB_IDX[id]);
}
/* RRF（倒数排名融合）：多份查询结果各自排一次名，一个段落在哪份里排得高就拿哪份的分。
   好处是不用归一化分数就能把「题干」和模型写的同义词查询合起来用。 */
function kbFuse(lists, K, weights) {
  const acc = new Map();
  lists.forEach((list, li) => {
    /* 第 0 份是用户自己的题干 / 选项，权重最高；其余默认 0.7（模型扩写的同义说法） */
    const w = (weights && weights[li] != null) ? weights[li] : (li === 0 ? 1 : 0.7);
    list.forEach((h, i) => {
      const key = h.id + '#' + h.ch.d + '#' + h.ch.ci;
      const cur = acc.get(key) || { h: h, s: 0 };
      cur.s += w / (60 + i + 1);
      acc.set(key, cur);
    });
  });
  const arr = []; acc.forEach(v => arr.push(v));
  arr.sort((a, b) => b.s - a.s);
  return kbPickDiverse(arr.map(x => x.h), K);
}
/* 对外：单查询检索。不传 ids 就用当前选中的知识库 */
async function kbSearch(query, ids, topK) {
  if (!query) return [];
  ids = await kbReady(ids);
  if (!ids.length) return [];
  return kbDetail(kbSearchSync(query, ids, topK || 4), query);
}
/* 对外：多查询检索（题干 / 选项 / 我的问题 / 模型扩写的说法各一份票，RRF 合并） */
async function kbSearchMulti(queries, ids, topK, weights) {
  const uniq = [], w = [];
  (queries || []).forEach((s, i) => {
    const q = String(s || '').trim();
    if (q.length > 1 && uniq.indexOf(q) < 0) { uniq.push(q); w.push(weights && weights[i] != null ? weights[i] : null); }
  });
  if (!uniq.length) return [];
  ids = await kbReady(ids);
  if (!ids.length) return [];
  const K = topK || 4;
  /* 只有一份查询时不用绕 RRF，直接用原来的打分结果 */
  if (uniq.length === 1) return kbDetail(kbSearchSync(uniq[0], ids, K), uniq[0]);
  const lists = uniq.map(q => kbHybridHits(q, ids, { cap: 60 }).slice(0, 60));
  return kbDetail(kbFuse(lists, K, w), uniq[0]);
}

/* ---------- 可选：让模型帮着找（跨过「用词不一样」这道坎） ----------
   关键词检索最大的毛病：你问「DNA 损伤怎么修复」，资料里叫「切除修复 / 重组修复」，
   一个字都对不上就什么都找不到。Chatbox 那种「搜索很好用」的观感，靠的是向量检索 + 重排。
   这里不装向量库，改用你已经配好的模型做两件同性质的事：
     ① 扩写：把题目变成几组「教材会用的说法」，各自再查一次；
     ② 重排：把关键词捞回来的候选段落给模型看一眼，让它挑出真正相关的那几段。
   都是可选项：没配模型 / 报错 / 超时，会自动退回纯关键词检索，不会挡住回答。 */
async function kbExpandQueries(q, extra, signal) {
  if (typeof aiChat !== 'function') return [];
  const stem = [q && q.group, q && q.stem, (q && q.options || []).join('  '), extra].filter(Boolean).join('\n').slice(0, 1200);
  if (!stem) return [];
  const sys = '你是检索助手。用户给你一道中文医学选择题（含选项）。请输出 3 组用于在医学教材 / 讲义里查找相关段落的检索词。'
    + '每组一行，词与词之间用空格分隔。要求：用教材里的规范术语；补上同义词、别称、英文缩写；'
    + '不要编号、不要标点、不要任何解释。';
  const txt = await aiChat([{ role: 'system', content: sys }, { role: 'user', content: stem }], null, signal, { stream: false, maxTokens: 160, temp: 0.2 });
  return String(txt || '').split(/\n+/).map(s => s.replace(/^[\s\d.、)）(（\-*#]+/, '').trim()).filter(s => s.length > 1).slice(0, 4);
}
async function kbRerank(question, hits, k, signal) {
  if (typeof aiChat !== 'function' || hits.length < 2) return hits;
  const kk = h => String((h && (h.key || (h.kb + '#' + (h.doc || '') + '#' + (h.head || '')) )) || '');
  const ckey = kbHash(String(question || '').slice(0, 800) + '|' + hits.map(kk).join(','));
  const cached = KB_RR_CACHE.get(ckey);
  if (cached && cached.length) {
    const by = Object.create(null);
    hits.forEach(h => { by[kk(h)] = h; });
    const out = [];
    cached.forEach(x => {
      const key = String(x).split('@')[0];
      const rr = String(x).indexOf('@') >= 0 ? +String(x).split('@')[1] : null;
      const h = by[key];
      if (h && out.indexOf(h) < 0) { if (rr != null) h.rr = rr; out.push(h); }
    });
    hits.forEach(h => { if (out.length < k && out.indexOf(h) < 0) out.push(h); });
    if (out.length) return out.slice(0, Math.max(1, k));
  }
  /* 喂料：带标题（和标题路径）、每段 300 字。
     原来只给 170 字，标题经常被截掉，模型判断依据不足 —— 这是「重排后反而更差」的主因。 */
  const list = hits.map((h, i) => '[' + (i + 1) + '] ' + (h.head ? '【' + h.head + '】' : '')
    + (h.path ? '〔' + h.path + '〕' : '') + String(h.text || '').replace(/\s+/g, ' ').slice(0, 300)).join('\n');
  const sys = '你是检索结果重排助手。用户给你一道题目和若干候选资料片段。'
    + '请挑出与题目最相关的片段，每行（或逗号分隔）写成「编号:分数」，分数用 1-10 的整数表示相关度（10 = 直接答得出这道题，1 = 几乎无关）。'
    + '按分数从高到低排；最多 ' + k + ' 个；完全无关的不要输出。不要任何解释。'
    + '例：3:9, 1:6';
  const txt = await aiChat([{ role: 'system', content: sys }, { role: 'user', content: '【题目】\n' + String(question || '').slice(0, 800) + '\n\n【候选片段】\n' + list }], null, signal, { stream: false, maxTokens: 48, temp: 0 });
  /* E2：优先解析「编号:分数」；模型没给分数就退回只解析编号，行为与以前一致 */
  const raw = String(txt || '');
  const ranked = [];
  const pairs = raw.match(/(\d{1,2})\s*[:：]\s*(\d{1,2}(?:\.\d)?)/g) || [];
  pairs.forEach(p => {
    const m = p.match(/(\d{1,2})\s*[:：]\s*(\d{1,2}(?:\.\d)?)/);
    const n = +m[1], sc = +m[2];
    if (n >= 1 && n <= hits.length) ranked.push({ n: n, s: sc });
  });
  if (ranked.length) {
    ranked.sort((a, b) => b.s - a.s || a.n - b.n);
    ranked.forEach(x => { if (x.s > 0) hits[x.n - 1].rr = x.s; });
  }
  const nums = ranked.length
    ? ranked.map(x => x.n)
    : (raw.match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= hits.length);
  const out = [], seen = Object.create(null);
  nums.forEach(n => { if (!seen[n]) { seen[n] = 1; out.push(hits[n - 1]); } });
  hits.forEach(h => { if (out.length < k && out.indexOf(h) < 0) out.push(h); });    /* 剩下的按原顺序补齐 */
  const fin = out.slice(0, Math.max(1, k));
  try {
    KB_RR_CACHE.set(ckey, fin.map(x => kk(x) + (x.rr != null ? '@' + x.rr : '')));
    while (KB_RR_CACHE.size > 200) KB_RR_CACHE.delete(KB_RR_CACHE.keys().next().value);
  } catch (e) {}
  return fin;
}

/* ---------- 文件知识库（make-kb.py 生成 知识库.js 时自动挂载） ---------- */
let KB_FILES_DONE = false;
/* 分片：file:<id> → 'kb/m3.js'。目录（kb/manifest.js）里只有书名和字数，
   正文要等你真的用到这个库才下载 —— 原来 6.4 MB 一次拉完，手机流量扛不住。 */
var KB_LAZY = {};
function kbLoadShard(id) {
  const url = KB_LAZY[id];
  if (!url) return Promise.resolve(false);
  if (KB_LAZY['#p:' + url]) return KB_LAZY['#p:' + url];
  const p = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = () => { try { kbIngestFiles(true); } catch (e) {} res(!!KB_MEM[id]); };
    s.onerror = () => rej(new Error('资料分片没加载上（离线，或 kb/ 下的文件没传上去）：' + url));
    document.head.appendChild(s);
  });
  KB_LAZY['#p:' + url] = p;
  return p;
}
function kbIngestFiles(force) {
  const meta = window.__KBM__ || [];
  if (meta.length) {
    meta.forEach((b, i) => {
      const id = 'file:' + (b.id || ('m' + i));
      if (b.url) KB_LAZY[id] = b.url;
      if (kbIsSkipped(id)) return;
      if (KB_LIST.some(x => x.id === id)) return;
      KB_LIST.push({ id: id, name: b.name || ('资料 ' + (i + 1)), src: 'file', addedAt: Date.now(), auto: true, lazy: b.url || '', chars: +b.chars || 0, docs: +b.docs || 0, chunks: +b.chunks || 0 });
    });
  }
  const arr = window.__KBS__ || [];
  if (!arr.length) return 0;                      /* 知识库.js 还没加载 */
  if (KB_FILES_DONE && !force) return 0;          /* 已经挂载过了，不必每次开 AI 面板都遍历一遍 */
  KB_FILES_DONE = true;
  let added = 0;
  arr.forEach((b, i) => {
    const id = 'file:' + (b.id || i);
    if (kbIsSkipped(id)) return;              /* 你删掉的库：不再自动挂载 */
    const exists = KB_LIST.find(x => x.id === id);
    if (exists && KB_MEM[id]) return;         /* 已经挂过正文了 */
    const docs = (b.docs || []).map(d => ({ name: d.name || '资料', page: d.page, pages: d.pages, pdfp: d.pdfp, file: d.file, text: d.text || '', chunks: Array.isArray(d.chunks) ? d.chunks : kbChunk(d.text || '') }));
    KB_MEM[id] = { docs: docs };
    const st = kbStats({ docs: docs });
    if (exists) { exists.chars = st.chars; exists.docs = st.docs; exists.chunks = st.chunks; exists.lazy = ''; }
    else KB_LIST.push({ id: id, name: b.name || ('资料 ' + (i + 1)), src: 'file', addedAt: Date.now(), auto: true, chars: st.chars, docs: st.docs, chunks: st.chunks });
    added++;
  });
  return added;
}
function kbStats(data) {
  let chars = 0, chunks = 0;
  (data.docs || []).forEach(d => { chunks += (d.chunks || []).length; (d.chunks || []).forEach(c => { chars += c.t.length; }); });
  return { chars: chars, chunks: chunks, docs: (data.docs || []).length };
}

/* ---------- 新增 / 追加 / 删除 ---------- */
function kbNewId() { return 'kb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
async function kbCreate(name, docs, src) {
  const id = kbNewId();
  const data = { docs: (docs || []).map(d => ({ name: d.name || '资料', chunks: kbChunk(d.text || '') })) };
  const st = kbStats(data);
  if (!st.chunks) throw new Error('没读到有效内容');
  KB_MEM[id] = data;
  KB_IDX[id] = kbIndex(data.docs);
  const ok = await kbStorePut(id, data);
  if (ok) kbIdxDel(id);                          /* 正文变了：盘上索引失效 */
  if (!ok) { delete KB_MEM[id]; delete KB_IDX[id]; throw new Error('保存失败：浏览器存储放不下了（' + kbBackend() + '）。大资料请用 make-kb.py 生成 知识库.js'); }
  KB_LIST.push({ id: id, name: name || '知识库', src: src || 'local', addedAt: Date.now(), chars: st.chars, docs: st.docs, chunks: st.chunks });
  kbSaveList(); kbSetSel(id, true);
  return id;
}
async function kbAppend(id, docs) {
  const k = KB_LIST.find(x => x.id === id);
  if (!k) throw new Error('先选一个目标知识库');
  if (k.auto) throw new Error('文件知识库是只读的（由 知识库.js 生成），要改请重新生成');
  await kbEnsure(id);
  const data = KB_MEM[id];
  let add = 0;
  (docs || []).forEach(d => {
    const ch = kbChunk(d.text || '');
    if (ch.length) { data.docs.push({ name: d.name || '资料', chunks: ch }); add += ch.length; }
  });
  if (!add) throw new Error('没读到有效内容');
  const ok = await kbStorePut(id, data);
  if (!ok) throw new Error('保存失败：存储空间不够');
  const st = kbStats(data);
  k.chars = st.chars; k.docs = st.docs; k.chunks = st.chunks;
  KB_IDX[id] = kbIndex(data.docs);
  kbSaveList();
  return add;
}
async function kbDropDoc(id, di) {
  const k0 = KB_LIST.find(x => x.id === id);
  if (k0 && k0.auto) throw new Error('文件知识库是只读的（由 知识库.js 生成），要改请重新生成');
  await kbEnsure(id);
  const data = KB_MEM[id];
  data.docs.splice(di, 1);
  await kbStorePut(id, data);
  const k = KB_LIST.find(x => x.id === id);
  const st = kbStats(data);
  if (k) { k.chars = st.chars; k.docs = st.docs; k.chunks = st.chunks; }
  KB_IDX[id] = kbIndex(data.docs);
  kbSaveList();
}
async function kbRemove(id) {
  const isFile = String(id).indexOf('file:') === 0;
  /* 先在内存里删干净并重画，别让界面等存储（file:// 下 IndexedDB 要等 1.2 秒超时） */
  delete KB_MEM[id]; delete KB_IDX[id];
  KB_LIST = KB_LIST.filter(x => x.id !== id);
  KB_SEL = KB_SEL.filter(x => x !== id);
  kbSaveList(); kbSaveSel();
  if (isFile) { kbSkipAdd(id); return; }   /* 文件库不占浏览器存储：只有一份黑名单要写，立刻完事 */
  await kbStoreDel(id);                    /* 网页导入的库：正文存在浏览器里，真删 */
}
/* 文件知识库（知识库.js 挂载的）删掉后要记住，否则刷新就被挂载回来 —— 这两组函数就是那本「黑名单」 */
function kbFileIdOf(id) { return String(id || '').replace(/^file:/, ''); }
function kbIsSkipped(id) { const f = kbFileIdOf(id); return KB_SKIP.indexOf(f) >= 0; }
function kbSkipAdd(id) { const f = kbFileIdOf(id); if (KB_SKIP.indexOf(f) < 0) { KB_SKIP.push(f); writeLS(KB_LS_SKIP, KB_SKIP); } }
function kbSkipRemove(id) { const f = kbFileIdOf(id); KB_SKIP = KB_SKIP.filter(x => x !== f); writeLS(KB_LS_SKIP, KB_SKIP); }
function kbSkipName(id) { const f = kbFileIdOf(id); const b = (window.__KBS__ || []).find(x => String(x.id) === f); return b ? (b.name || f) : f; }
function kbRestoreSkip(id) {
  kbSkipRemove(id);
  kbIngestFiles(true);          /* 恢复被删的库：强制重新挂载 */
  if (KB_LIST.some(x => x.id === 'file:' + kbFileIdOf(id))) kbSetSel('file:' + kbFileIdOf(id), true);
}
function kbUsageText() {
  const chars = KB_LIST.reduce((a, b) => a + (b.chars || 0), 0);
  const chunks = KB_LIST.reduce((a, b) => a + (b.chunks || 0), 0);
  const mb = (typeof storageBytes === 'function') ? (storageBytes() / 1024 / 1024) : 0;
  return KB_LIST.length + ' 个知识库 · ' + chars.toLocaleString() + ' 字 · ' + chunks.toLocaleString() + ' 段　·　存储：' + kbBackend()
    + (KB_DB ? '' : '（浏览器已用 ' + mb.toFixed(2) + ' MB，约 5 MB 上限；大资料请用 make-kb.py）');
}

/* ---------- 文本 / 文件解析 ---------- */
function kbTextFromHtml(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}
function kbReadFile(f) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('读不了 ' + f.name));
    fr.onload = () => {
      let t = String(fr.result || '');
      const n = (f.name || '').toLowerCase();
      if (/\.html?$/.test(n)) t = kbTextFromHtml(t);
      if (/\.json$/.test(n)) { try { t = JSON.stringify(JSON.parse(t), null, 1).replace(/[{}\"\[\],]/g, ' ').replace(/\s{2,}/g, ' '); } catch (e) {} }
      res({ name: f.name, text: t });
    };
    fr.readAsText(f, 'utf-8');
  });
}

/* ---------- 界面：知识库管理 + 试检索（由 ai.js 的 #/kb 页面调用） ---------- */
function kbRowHtml(k) {
  const sel = new Set(kbSelected());
  const on = sel.has(k.id);
  const open = !!KB_OPEN[k.id];
  let html = '<div class="kbrow' + (on ? ' on' : '') + '" data-id="' + k.id + '">'
    + '<label class="kbchk"><input type="checkbox" data-kbsel="' + k.id + '"' + (on ? ' checked' : '') + '><span>' + esc(k.name) + '</span></label>'
    + '<span class="mini-tag' + (k.src === 'file' ? ' ok' : '') + '">' + (k.src === 'file' ? '文件' : '网页导入') + '</span>'
    + '<span class="kbinfo small muted">' + (k.docs || 0) + ' 篇 · ' + (k.chars || 0).toLocaleString() + ' 字 · ' + (k.chunks || 0) + ' 段</span>'
    + '<span class="spacer-grow"></span>'
    + '<button class="btn tiny" data-kbact="open">' + (open ? '收起' : '明细') + '</button>'
    + '<button class="btn tiny" data-kbact="rename">改名</button>'
    + '<button class="btn tiny" data-kbact="export">导出</button>'
    + '<button class="btn tiny danger" data-kbact="del"' + (k.auto ? ' title="删掉后刷新也不会再自动挂载，页面下方可以恢复"' : '') + '>删除</button>';
  if (open) {
    html += '<div class="kbdocs">';
    if (KB_MEM[k.id]) {
      html += (KB_MEM[k.id].docs || []).map(function (d, i) {
        return '<div class="kbDoc"><span>' + esc(d.name || '资料') + '</span><span class="small muted">' + (d.chunks || []).length + ' 段</span>'
          + (k.auto ? '' : '<button class="btn tiny danger" data-kbdoc="' + i + '">删</button>') + '</div>';
      }).join('') || '<div class="small muted">空的</div>';
    if (k.auto) html += '<div class="small muted">文件知识库是只读的：单篇删不掉，要减内容请重新生成 知识库.js；整个库不想用就点这一行的「删除」。</div>';
    } else html += '<div class="small muted">正在读取正文…</div>';
    html += '</div>';
  }
  return html + '</div>';
}
/* ② 知识库：列表 + 导入/粘贴 + 选择。单独一个函数，好让 #/kb 把它放进「② 知识库」标签页 */
function kbLibHtml() {
  const rows = KB_LIST.map(kbRowHtml).join('') || '<div class="small muted">还没有知识库。导入 txt / md 文件，或把资料直接粘进来。</div>';
  const opts = KB_LIST.map(k => '<option value="' + k.id + '">' + esc(k.name) + '</option>').join('');
  const L = [];
  L.push('<div class="card kbcard">');
  L.push('<div class="kbhead">② 知识库 <span class="small muted" id="kbUsage">' + esc(kbUsageText()) + '</span></div>');
  L.push('<div class="hint">资料只存在本机浏览器里。<b>大资料</b>更推荐把文件放进站点的 <code>资料/</code> 文件夹，双击 <code>转知识库.bat</code> 生成 <code>知识库.js</code>，本站会自动挂载（不受浏览器 5 MB 限制）。</div>');
  L.push('<div class="kbList" id="kbRows">' + rows + '</div>');
  if (KB_SKIP.length) {
    L.push('<div class="kbSkipped small muted" id="kbSkipped" style="margin-top:10px">已删掉、刷新也不再自动挂载：'
      + KB_SKIP.map(f => '<span style="display:inline-block;margin:4px 10px 0 0">' + esc(kbSkipName(f))
        + ' <button class="btn tiny" data-kbskipres="' + esc(f) + '">恢复</button></span>').join('') + '</div>');
  }
  L.push('<div class="tools" style="margin-top:12px">');
  L.push('<span class="tl">目标知识库</span>');
  L.push('<select class="num" id="kbTarget"><option value="__new">＋ 新建知识库</option>' + opts + '</select>');
  L.push('<input class="num" id="kbNewName" placeholder="新知识库名字，如：民法笔记">');
  L.push('</div>');
  L.push('<div class="tools">');
  L.push('<button class="btn primary" id="kbPick">导入文件（txt / md / csv / html / json）</button>');
  L.push('<span class="small muted">可多选；Word、PDF 请先转成 txt（见 AI知识库说明.md）</span>');
  L.push('<input type="file" id="kbFile" multiple accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.log,.srt,.text,text/*" style="display:none">');
  L.push('</div>');
  L.push('<textarea class="ed-ta kb-ta" id="kbPaste" placeholder="也可以把讲义、笔记直接粘在这里…"></textarea>');
  L.push('<div class="actions">');
  L.push('<input class="num" id="kbPasteName" placeholder="这段资料的名字（可留空）">');
  L.push('<button class="btn" id="kbPasteAdd">加入知识库</button>');
  L.push('<button class="btn" id="kbAll">全选</button>');
  L.push('<button class="btn" id="kbNone">清空选择</button>');
  L.push('</div></div>');
  return L.join('\n');
}
/* ③ 试检索：只用关键词检索，不花 token */
function kbTryHtml() {
  const L = [];
  L.push('<div class="card kbcard">');
  L.push('<div class="kbhead">③ 试检索 <span class="small muted">（看看资料能不能被 AI 找到，不花 token）</span></div>');
  L.push('<div class="tools">');
  L.push('<input class="num grow" id="kbQ" placeholder="输入题干关键词，例如：善意取得的构成要件">');
  L.push('<button class="btn primary" id="kbSearchBtn">检索</button>');
  L.push('<button class="btn" id="kbEvalBtn" title="从各库随机抽段，用段内一段原文当查询，看命中率（离线、不花 token）">检索自检</button>');
  L.push('</div>');
  L.push('<div id="kbEvalOut"></div>');
  L.push('<div class="small muted">这里只用关键词检索（不联模型、不花 token，所以最快），看到的是「字面能对上」的下限。'
    + '同一个文件最多 2 段、同一段正文只出现一次。真正生成解析时，还会在①里那两个开关的帮助下先扩写题目、再重排结果，命中会比这里更好。</div>');
  L.push('<div id="kbHits"></div>');
  L.push('</div>');
  return L.join('\n');
}
/* 老接口：②+③ 一起返回（#/kb 现在把 ③ 单独放进「试检索」标签页；这个留着给别处和老探针用） */
function kbSectionHtml() { return kbLibHtml() + kbTryHtml(); }
function kbBind(host) {
  const rows = host.querySelector('#kbRows');
  if (rows) rows.addEventListener('change', e => {
    const id = e.target.dataset && e.target.dataset.kbsel;
    if (!id) return;
    kbSetSel(id, e.target.checked);
    const row = e.target.closest('.kbrow');
    if (row) row.classList.toggle('on', e.target.checked);
  });
  if (rows) rows.addEventListener('click', async e => {
    const row = e.target.closest('.kbrow');
    if (!row) return;
    const id = row.dataset.id, k = KB_LIST.find(x => x.id === id);
    if (!k) return;
    const docBtn = e.target.closest('[data-kbdoc]');
    if (docBtn) {
      await kbEnsure(id);
      const d = (KB_MEM[id].docs || [])[+docBtn.dataset.kbdoc] || {};
      if (!confirm('删掉《' + (d.name || '资料') + '》？')) return;
      await kbDropDoc(id, +docBtn.dataset.kbdoc);
      render();
      return;
    }
    const b = e.target.closest('[data-kbact]');
    const act = b && b.dataset.kbact;
    if (!act) return;
    if (act === 'open') {
      KB_OPEN[id] = !KB_OPEN[id];
      if (KB_OPEN[id]) await kbEnsure(id);
      render();
    } else if (act === 'rename') {
      const n = prompt('新的知识库名字', k.name);
      if (n == null) return;
      k.name = n.trim() || k.name;
      if (k.auto) toast('文件知识库改名只在本页有效，刷新后恢复');
      kbSaveList(); render();
    } else if (act === 'export') {
      await kbEnsure(id);
      const docs = (KB_MEM[id].docs || []).map(d => ({ name: d.name, text: (d.chunks || []).map(c => c.t).join('\n') }));
      download(k.name + '.知识库.json', JSON.stringify({ app: 'shuati-kb', name: k.name, docs: docs }), 'application/json');
      toast('已导出，可以换台电脑再导入');
    } else if (act === 'del') {
      if (!confirm(k.auto
        ? ('删掉《' + k.name + '》？它是 知识库.js 里的资料库：删掉后刷新不会再自动挂载，需要时在列表下方点「恢复」。')
        : ('删除知识库《' + k.name + '》？资料只存在本机，删了就没了。'))) return;
      await kbRemove(id); render();
      toast(k.auto ? '已删除，刷新也不会再挂载' : '已删除');
    }
  });
  const sk = host.querySelector('#kbSkipped');
  if (sk) sk.addEventListener('click', e => {
    const b = e.target.closest('[data-kbskipres]');
    if (!b) return;
    kbRestoreSkip(b.dataset.kbskipres);
    render(); toast('已恢复《' + kbSkipName(b.dataset.kbskipres) + '》');
  });
  on('kbAll', () => { kbSelAll(true); render(); });
  on('kbNone', () => { kbSelAll(false); render(); });
  on('kbPick', () => $('kbFile').click());
  on('kbFile', async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) await kbImportFiles(files);
  }, 'change');
  on('kbPasteAdd', () => kbImportPaste());
  on('kbSearchBtn', () => kbRunTest());
  on('kbEvalBtn', () => kbRunEval());
  on('kbQ', e => { if (e.key === 'Enter') kbRunTest(); }, 'keydown');
}
async function kbImportFiles(files) {
  const target = $('kbTarget') ? $('kbTarget').value : '__new';
  const newName = $('kbNewName') ? $('kbNewName').value.trim() : '';
  try {
    toast('正在读取 ' + files.length + ' 个文件…', 800);
    const docs = [];
    for (const f of files) docs.push(await kbReadFile(f));
    const keep = docs.filter(d => (d.text || '').trim().length > 20);
    if (!keep.length) { toast('这些文件里没读到文字'); return; }
    let msg;
    if (target === '__new') {
      const id = await kbCreate(newName || keep[0].name.replace(/\.[^.]+$/, '') || '知识库', keep, 'local');
      msg = '已建《' + kbName(id) + '》：' + keep.length + ' 篇';
    } else {
      const n = await kbAppend(target, keep);
      msg = '已往《' + kbName(target) + '》加 ' + keep.length + ' 篇 / ' + n + ' 段';
    }
    if ($('kbNewName')) $('kbNewName').value = '';
    render(); toast(msg);
  } catch (err) { toast(err.message || '导入失败'); }
}
async function kbImportPaste() {
  const ta = $('kbPaste'), nameEl = $('kbPasteName');
  if (!ta) return;
  const text = (ta.value || '').trim();
  if (text.length < 20) { toast('粘贴的内容太短了'); return; }
  const target = $('kbTarget') ? $('kbTarget').value : '__new';
  const nm = (nameEl.value || '').trim() || ('粘贴资料 ' + new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
  try {
    if (target === '__new') { const id = await kbCreate(nm, [{ name: nm, text: text }], 'local'); toast('已建《' + kbName(id) + '》'); }
    else { const n = await kbAppend(target, [{ name: nm, text: text }]); toast('已加入 ' + n + ' 段'); }
    ta.value = ''; nameEl.value = '';
    render();
  } catch (err) { toast(err.message || '加入失败'); }
}
async function kbRunTest() {
  const q = ($('kbQ').value || '').trim();
  const box = $('kbHits');
  if (!q) { toast('先写点关键词'); return; }
  box.innerHTML = '<div class="small muted">检索中…</div>';
  const hits = await kbSearch(q, null, 6);
  if (!hits.length) {
    box.innerHTML = '<div class="small muted">没命中。可能：① 没勾选知识库；② 你用的词和资料里的说法对不上（这里只按字面找，换成资料里会用的词再试；生成解析时开的「扩写 / 重排」就是治这个的）；③ 资料还没导入。</div>';
    return;
  }
  box.innerHTML = hits.map(function (h, i) {
    return '<div class="kbhit"><div class="kbhit-h"><b>[' + (i + 1) + ']</b> ' + esc(h.kb) + ' · ' + esc(h.doc) + (h.head ? ' · ' + esc(h.head) : '')
      + '<span class="spacer-grow"></span><span class="small muted">得分 ' + h.score.toFixed(1) + '</span></div><div class="small">' + esc(h.snip) + '</div></div>';
  }).join('');
}

/* ---------- 检索自检（H1 护栏） ----------
   做法：从每个勾选库的索引进样本段，取段内一段「只在这一段出现」的 8 字原文当查询，
   期望命中的就是这一段本身 —— 自动标注，不用维护标注集。
   输出 Top1 / Recall@5 / MRR：以后改权重、改切段、加同义表，先看这三个数别掉。
   纯本地、不调模型、不花 token。 */
function kbEvalSet(n) {
  n = n || 60;
  const ids = kbSelected().filter(id => KB_IDX[id]);
  const out = [];
  if (!ids.length) return out;
  const per = Math.max(1, Math.ceil(n / ids.length));
  ids.forEach(id => {
    const idx = KB_IDX[id];
    if (!idx || !idx.chunks || !idx.chunks.length) return;
    const step = Math.max(1, Math.floor(idx.chunks.length / per));
    let got = 0;
    for (let i = 0; i < idx.chunks.length && got < per; i += step) {
      const c = idx.chunks[i];
      const t = String(c.txt || '').replace(/\s+/g, '');
      if (t.length < 60) continue;
      const mid = Math.floor(t.length / 2);
      let q = '';
      for (const start of [mid, Math.max(0, mid - 120), Math.max(0, Math.floor(t.length / 3)), 20]) {
        for (let off = 0; off + 8 <= 60 && start + off + 8 <= t.length; off += 6) {
          const w = t.slice(start + off, start + off + 8);
          if (!/^[\u4e00-\u9fff]{8}$/.test(w)) continue;
          /* 必须「稀有」：它的二元组在本库里出现次数少，才配当标注查询 */
          const df = kbTokens(w).reduce((m, tk) => Math.min(m, idx.df[tk] || idx.chunks.length), idx.chunks.length);
          if (df <= Math.max(4, Math.floor(idx.chunks.length / 40))) { q = w; break; }
        }
        if (q) break;
      }
      if (!q) continue;
      out.push({ id: id, q: q, d: c.d, ci: c.ci, txt: t });
      got++;
    }
  });
  return out;
}
function kbEvalRun(n) {
  const set = kbEvalSet(n || 60);
  if (!set.length) return { ok: false, error: '没有可评测的资料库（先勾选并等索引建好）', n: 0, top1: 0, recall5: 0, mrr: 0, detail: [] };
  const rankOf = (hits, it) => {
    for (let i = 0; i < hits.length; i++) { const ch = hits[i].ch; if (ch && ch.d === it.d && ch.ci === it.ci) return i; }
    return -1;
  };
  const tally = pick => {
    let t1 = 0, r5 = 0, m = 0;
    const det = [];
    set.forEach(it => {
      const rank = rankOf(pick(it), it);
      if (rank === 0) t1++;
      if (rank >= 0 && rank < 5) r5++;
      if (rank >= 0) m += 1 / (rank + 1);
      det.push({ q: it.q, kb: it.id, rank: rank });
    });
    const n2 = set.length || 1;
    return { top1: t1 / n2, recall5: r5 / n2, mrr: m / n2, detail: det };
  };
  const kw = tally(it => kbHits(it.q, [it.id]));
  const hy = tally(it => kbHybridHits(it.q, [it.id]));
  return { ok: true, n: set.length, top1: hy.top1, recall5: hy.recall5, mrr: hy.mrr, detail: hy.detail,
    kwTop1: kw.top1, kwRecall5: kw.recall5, kwMrr: kw.mrr, kwDetail: kw.detail };
}
const KB_EVAL_BASE = { top1: 0.841, recall5: 0.95, mrr: 0.87 };   /* 网格搜参时的基线（kb.js 注释里记的老数） */

/* 改写问句评测：上面那批样本的查询是「原文里掐出来的 8 个字」，逐字命中，
   关键词检索本来就必中 —— 拿它测向量票永远是 0.0 个点，测不出语义收益。
   这里换成模型改写的「学生会问的那句话」：不照抄原句，只有懂意思才找得到。
   改写结果按段+长度缓存在 localStorage（第二次跑不调模型；探针可以直接种缓存离线跑）。 */
const KB_LS_EVALP = 'qbank.kb.evalpara.v1';
const KB_EVALP = readLS(KB_LS_EVALP, {}) || {};
const KB_EVALP_MAX = 500;
function kbParaKey(it) { return kbHash(String(it.d) + '|' + String(it.txt).slice(0, 120) + '|' + String(it.txt).length); }
function kbParaPrompt(txt) {
  return '把下面这段教材原文，改写成一句医学生复习时真会问老师的问题：'
    + '只保留必要的专业名词，不要照抄原句，30 字以内，只输出问题本身，不要引号、不要解释。\n\n' + String(txt).slice(0, 400);
}
async function kbParaOf(it) {
  const key = kbParaKey(it);
  let q = KB_EVALP[key];
  if (q) return q;
  if (typeof aiChat !== 'function') return '';
  try {
    q = await aiChat([{ role: 'system', content: '你是医学生，正在复习教材。' }, { role: 'user', content: kbParaPrompt(it.txt) }],
      null, null, { stream: false, temp: 0.3, maxTokens: 120 });
  } catch (e) { return ''; }
  q = String(q || '').trim().replace(/^["“「『\s]+|["”」』\s]+$/g, '').replace(/\s+/g, '').slice(0, 60);
  if (q) {
    KB_EVALP[key] = q;
    const ks = Object.keys(KB_EVALP);
    if (ks.length > KB_EVALP_MAX) ks.slice(0, ks.length - KB_EVALP_MAX).forEach(k => { delete KB_EVALP[k]; });
  }
  return q;
}
function kbTally(set, pick) {
  let t1 = 0, r5 = 0, m = 0;
  const det = [];
  set.forEach(it => {
    let rank = -1;
    const hits = pick(it);
    for (let i = 0; i < hits.length; i++) { const ch = hits[i].ch; if (ch && ch.d === it.d && ch.ci === it.ci) { rank = i; break; } }
    if (rank === 0) t1++;
    if (rank >= 0 && rank < 5) r5++;
    if (rank >= 0) m += 1 / (rank + 1);
    det.push({ q: it.q, kb: it.id, rank: rank });
  });
  const n2 = set.length || 1;
  return { top1: t1 / n2, recall5: r5 / n2, mrr: m / n2, detail: det };
}
/* 跑改写问句评测：只统计拿到改写句的样本；没配 AI 或一条都没改写成功就返回 ok:false */
async function kbEvalRunPara(n, onStep) {
  const raw = kbEvalSet(n || 30);
  if (!raw.length) return { ok: false, error: '没有可评测的资料库（先勾选并等索引建好）', n: 0 };
  const set = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i];
    const q = await kbParaOf(it);
    if (q) set.push({ q: q, d: it.d, ci: it.ci, id: it.id, txt: it.txt, raw: it.q });
    if (onStep) onStep(i + 1, raw.length);
    if (i % 5 === 4) await kbYield();
  }
  writeLS(KB_LS_EVALP, KB_EVALP);
  if (!set.length) return { ok: false, error: '改写问句没生成出来（先在上面填好 AI 服务与模型）', n: 0 };
  const hy = kbTally(set, it => kbHybridHits(it.q, [it.id]));
  const kw = kbTally(set, it => kbHits(it.q, [it.id]));
  return { ok: true, n: set.length, total: raw.length,
    top1: hy.top1, recall5: hy.recall5, mrr: hy.mrr, detail: hy.detail,
    kwTop1: kw.top1, kwRecall5: kw.recall5, kwMrr: kw.mrr, kwDetail: kw.detail };
}
async function kbRunEval() {
  const box = $('kbEvalOut');
  if (box) box.innerHTML = '<div class="small muted">正在抽样本段并逐条检索…（只算分，不调模型）</div>';
  const ids = kbSelected();
  for (const id of ids) { try { if (KB_MEM[id] && !KB_IDX[id]) await kbEnsure(id); } catch (e) {} }
  await kbYield();
  const r = kbEvalRun(60);
  if (!r.ok) { if (box) box.innerHTML = '<div class="small muted">' + esc(r.error) + '</div>'; return r; }
  const pct = x => (x * 100).toFixed(1) + '%';
  const drop = (k) => r[k] + 0.02 < KB_EVAL_BASE[k];
  const rows = r.detail.slice(0, 8).map(d => '<div class="small">' + esc(d.q) + ' → 命中排位 ' + (d.rank < 0 ? '未命中' : '第 ' + (d.rank + 1) + ' 位') + ' · ' + esc(d.kb) + '</div>').join('');
  if (box) {
    box.innerHTML = '<div class="kbhit"><div class="kbhit-h"><b>检索自检</b>' + '<span class="spacer-grow"></span>'
      + '<span class="small muted">样本 ' + r.n + ' 条</span></div>'
      + '<div class="small">混合检索（关键词 + 向量）：Top1 <b' + (drop('top1') ? ' style="color:#c0392b"' : '') + '>' + pct(r.top1) + '</b> · Recall@5 <b' + (drop('recall5') ? ' style="color:#c0392b"' : '') + '>' + pct(r.recall5) + '</b> · MRR <b' + (drop('mrr') ? ' style="color:#c0392b"' : '') + '>' + r.mrr.toFixed(3) + '</b></div>'
      + (r.kwTop1 != null ? '<div class="small muted">同一批样本纯关键词：Top1 ' + pct(r.kwTop1) + ' · Recall@5 ' + pct(r.kwRecall5) + ' · MRR ' + r.kwMrr.toFixed(3) + '（差值 = 向量票的贡献）</div>' : '')
      + '<div class="small muted">基线（当年网格搜参）：Top1 84.1% · Recall@5 95% · MRR 0.87；掉了 2 个点以上标红，说明这次改动伤到检索了</div>'
      + rows
      + '<div class="small" style="margin-top:6px"><button class="btn small" id="kbEvalPara">跑改写问句评测（测语义）</button>'
      + '<span class="small muted"> 上面那批是原文 8 字，逐字命中；只有改写成「学生会问的话」才测得出向量票的语义价值（要调模型，按样本条数计）</span></div>'
      + '</div>';
    const pb = box.querySelector('#kbEvalPara');
    if (pb) pb.onclick = () => kbEvalParaFlow(r.n);
  }
  return r;
}
/* 改写问句评测的交互：跑 → 出对照表 */
async function kbEvalParaFlow(n) {
  const box = $('kbEvalOut');
  const btn = box && box.querySelector('#kbEvalPara');
  if (btn) { btn.disabled = true; btn.textContent = '正在改写并检索…'; }
  const r = await kbEvalRunPara(Math.min(30, n || 30), (i, t) => {
    const b2 = box && box.querySelector('#kbEvalPara');
    if (b2) b2.textContent = '改写中 ' + i + '/' + t + '…';
  });
  if (!r.ok) { toast(r.error); if (btn) { btn.disabled = false; btn.textContent = '跑改写问句评测（测语义）'; } return r; }
  const pct = x => (x * 100).toFixed(1) + '%';
  const gain = (r.top1 - r.kwTop1) * 100;
  const rows = (r.detail || []).slice(0, 8).map(d => '<div class="small">' + esc(d.q) + ' → ' + (d.rank < 0 ? '未命中' : '第 ' + (d.rank + 1) + ' 位') + '</div>').join('');
  if (box) {
    const host = box.querySelector('.kbhit') || box;
    host.insertAdjacentHTML('beforeend', '<div class="kbhit" style="margin-top:6px"><div class="kbhit-h"><b>改写问句评测</b><span class="spacer-grow"></span>'
      + '<span class="small muted">样本 ' + r.n + ' / ' + r.total + ' 条</span></div>'
      + '<div class="small">混合检索：Top1 <b>' + pct(r.top1) + '</b> · Recall@5 <b>' + pct(r.recall5) + '</b> · MRR <b>' + r.mrr.toFixed(3) + '</b></div>'
      + '<div class="small muted">同一批改写问句纯关键词：Top1 ' + pct(r.kwTop1) + ' · Recall@5 ' + pct(r.kwRecall5) + ' · MRR ' + r.kwMrr.toFixed(3)
      + '（向量票 ' + (gain >= 0 ? '+' : '') + gain.toFixed(1) + ' 个点）</div>'
      + rows + '</div>');
  }
  const btn2 = box && box.querySelector('#kbEvalPara');
  if (btn2) { btn2.disabled = false; btn2.textContent = '重跑改写问句评测'; }
  return r;
}
/* 导入别处导出的知识库 JSON */
async function kbImportJson(files) {
  for (const f of files) {
    try {
      const t = await f.text();
      const j = JSON.parse(t);
      if (!j || !Array.isArray(j.docs)) throw new Error('不是知识库文件');
      const id = await kbCreate(j.name || f.name.replace(/\.[^.]+$/, ''), j.docs, 'local');
      toast('已导入《' + kbName(id) + '》');
    } catch (e) { toast('导入失败：' + (e.message || '格式不对')); }
  }
  render();
}

/* ---------- 备份：自己导入的知识库也能一起导出 / 恢复 ----------
   来自 知识库.js 的文件库不进备份（正文就在那个文件里，换电脑重新生成或复制过去即可）。 */
async function kbExportAll() {
  const list = KB_LIST.filter(k => !k.auto);
  const out = { list: list, sel: kbSelected(), skip: KB_SKIP.slice(), data: {}, autoN: KB_LIST.filter(k => k.auto).length };
  for (const k of list) {
    let d = KB_MEM[k.id];
    if (!d) { try { d = await kbStoreGet(k.id); } catch (e) { d = null; } }
    if (d) out.data[k.id] = d;
  }
  return out;
}
function kbImportAll(o) {
  if (!o || typeof o !== 'object') return 0;
  if (Array.isArray(o.skip)) { o.skip.forEach(f => { if (KB_SKIP.indexOf(f) < 0) KB_SKIP.push(f); }); writeLS(KB_LS_SKIP, KB_SKIP); }
  const list = Array.isArray(o.list) ? o.list : [];
  let n = 0;
  list.forEach(k => {
    if (!k || !k.id) return;
    const d = (o.data || {})[k.id];
    if (d) {
      KB_MEM[k.id] = d;
      delete KB_IDX[k.id];
      kbIdxDel(k.id);
      kbStorePut(k.id, d);                       /* 存回浏览器（IndexedDB / localStorage） */
      const st = kbStats(d);
      k.chars = st.chars; k.docs = st.docs; k.chunks = st.chunks; k.auto = false;
    }
    if (!KB_LIST.some(x => x.id === k.id)) KB_LIST.push(k);
    n++;
  });
  if (Array.isArray(o.sel)) { KB_SEL = o.sel.filter(x => KB_LIST.some(k => k.id === x)); KB_SEL_SET = true; kbSaveSel(); }
  kbSaveList();
  kbPreheatIndex();
  return n;
}

window.kbEval = kbEvalRun;
window.kbEvalRunPara = kbEvalRunPara;
window.kbHybridHits = kbHybridHits;
window.kbHybridSearchSync = kbHybridSearchSync;
window.kbVecHits = kbVecHits;
window.kbEmbModel = kbEmbModel;
window.kbEmbSetModel = kbEmbSetModel;
window.kbEmbBuild = kbEmbBuild;
window.kbVecSetWeight = kbVecSetWeight;
window.kbVecWeight = kbVecWeight;
window.kbEvalSet = kbEvalSet;

/* ---------- 动态挂载 知识库.js（没有这个文件也没关系） ----------
   4.2 MB 的资料文件不该每次打开页面都拉一遍：等真正要用时（打开 AI 面板 / 检索 / 进 #/kb）
   再挂载。挂载过就记在 KB_FILES_DONE，之后直接返回。
   ⚠ KB_FILES_TRIED：web176 把知识库拆成「引导脚本 + 分片」后，引导脚本只填 __KBM__（目录），
   __KBS__ 一直是空的、kbIngestFiles() 也会提前 return，KB_FILES_DONE 永远设不上。
   于是每次重画知识库页都会重新挂一遍 知识库.js，而挂完的 fin() 又调 render()——
   render → 挂脚本 → render 自己叫自己，页面直接卡死（点不动、打不了字、复制不了）。
   所以要单独一个「挂过一次就算数」的标记。 */
let KB_FILES_TRIED = false;
let KB_FILES_PROMISE = null;
/* 引导脚本 知识库.js 是「异步再挂 kb/manifest.js」的：它的 onload 早于目录到达，
   这时 kbIngestFiles() 还看不到 __KBM__，书单就是空的（表现＝原来的书全没了）。
   所以挂完要盯一眼目录，到了就补进 KB_LIST 并重画一次。 */
function kbFilesWatch() {
  if (window.__KBM_WATCH) return;
  if (window.__KBM__ && window.__KBM__.length) return;
  let n = 0;
  window.__KBM_WATCH = setInterval(function () {
    n++;
    if (window.__KBM__ && window.__KBM__.length) {
      clearInterval(window.__KBM_WATCH); delete window.__KBM_WATCH;
      try { kbIngestFiles(); } catch (e) {}
      try { if (typeof route === 'function' && route().name === 'kb') render(); } catch (e) {}
    } else if (n > 100) {                       /* 10 秒还没来：放弃，别一直空转 */
      clearInterval(window.__KBM_WATCH); delete window.__KBM_WATCH;
    }
  }, 100);
}
function kbEnsureFilesLoaded(force) {
  if (KB_FILES_DONE || (window.__KBS__ && window.__KBS__.length)
    || (window.__KBM__ && window.__KBM__.length)) return Promise.resolve({ ok: true, added: kbIngestFiles() });
  if (KB_FILES_PROMISE) return KB_FILES_PROMISE;
  if (KB_FILES_TRIED && !force) return Promise.resolve({ ok: false, added: 0, skipped: true });
  kbFilesWatch();
  KB_FILES_LOADING = true;
  KB_FILES_PROMISE = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = '知识库.js';
    let done = false;
    const fin = ok => {
      if (done) return;
      done = true; KB_FILES_PROMISE = null; KB_FILES_LOADING = false;
      /* 挂上了就记死（引导脚本只填 __KBM__，别指望 KB_FILES_DONE）；
         没挂上就留个机会，下次进这页再试一次 —— 但失败时绝不重画，
         否则「重画 → 挂脚本 → 重画」还是会自己叫自己。 */
      KB_FILES_TRIED = !!ok;
      kbFilesWatch();                       /* 目录可能还没到：盯一眼，到了再补书单 */
      const added = kbIngestFiles();
      kbPreheatIndex();
      if (ok && route().name === 'kb') { try { render(); } catch (e) {} }
      resolve({ ok: ok, added: added });
    };
    s.onload = () => fin(true);
    s.onerror = () => fin(false);
    document.head.appendChild(s);
  });
  return KB_FILES_PROMISE;
}
let KB_FILES_LOADING = false;
/* 开机一会儿就把知识库拉下来预热：第一次点 AI 解析就不用现等几 MB */
function kbWarmUp() {
  const go = () => { try { kbEnsureFilesLoaded(); } catch (e) {} };
  setTimeout(go, 1500);          /* 不再等 requestIdleCallback —— 用户手快时它可能半天不触发 */
}
/* 空闲预热检索索引：整库建索引要几百毫秒，别等用户点检索时才卡（每次只做一小会儿就让出主线程） */
function kbPreheatIndex() {
  const ids = kbSelected().filter(id => KB_MEM[id] && !KB_IDX[id]);
  if (!ids.length) return;
  /* 逐个库异步建（kbEnsure 里已经分片 + 让主线程，不会一下子冻住） */
  (async () => {
    for (const id of ids) {
      try { await kbEnsure(id); } catch (e) {}
      await kbYield();
    }
  })();
}
kbWarmUp();
