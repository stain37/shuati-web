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
      const rq = indexedDB.open('shuati-kb', 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore('kb'); } catch (e) {} };
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
  let head = '', buf = '';
  const push = () => {
    const t = buf.trim();
    buf = '';
    if (!t) return;
    if (t.length < 60 && out.length && (out[out.length - 1].t.length + t.length) < MAX) { out[out.length - 1].t += '\n' + t; return; }
    out.push({ h: head, t: t });
  };
  String(text || '').split('\n').forEach(raw => {
    const s = raw.trim();
    if (!s) { if (buf) buf += '\n'; return; }
    if (isHead(s) && s.length <= 40) { push(); head = s.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, ''); return; }
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
function kbIndex(docs) {
  const chunks = [], df = Object.create(null), names = [];
  let total = 0, totalH = 0, totalN = 0;
  docs.forEach((d, di) => {
    const ntf = Object.create(null);
    let nlen = 0;
    kbTokens(String(d.name || '').replace(/\.[a-z0-9]+$/i, '')).forEach(t => { ntf[t] = (ntf[t] || 0) + 1; nlen++; });
    names.push({ ntf: ntf, nlen: nlen });
    totalN += nlen;
    (d.chunks || []).forEach((c, ci) => {
      const tf = Object.create(null), hs = Object.create(null);
      let len = 0, hlen = 0;
      kbTokens(c.t).forEach(t => { tf[t] = (tf[t] || 0) + 1; len++; });
      kbTokens(c.h || '').forEach(t => { hs[t] = (hs[t] || 0) + 1; hlen++; });
      /* df = 「这个词在本段里出现过」（三个字段任一算），每段只计一次 */
      const seen = Object.create(null);
      Object.keys(tf).forEach(t => { seen[t] = 1; df[t] = (df[t] || 0) + 1; });
      Object.keys(hs).forEach(t => { if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; } });
      Object.keys(ntf).forEach(t => { if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; } });
      total += len; totalH += hlen;
      chunks.push({ d: di, ci: ci, h: c.h, t: c.t, tf: tf, len: len, hs: hs, hlen: hlen, txt: kbFlat((c.h ? c.h : '') + c.t), ck: kbHash(kbFlat(c.t)) });
    });
  });
  const n = chunks.length || 1;
  return { chunks: chunks, df: df, names: names,
    avg: total / n, avgH: totalH / n, avgN: names.length ? totalN / names.length : 1 };
}
/* BM25F 参数：一次查询的原始得分 = 三字段 BM25F + 字面命中加分 */
const KB_K1 = 1.2, KB_B = 0.75, KB_WH = 4, KB_WD = 1;
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
        const tf = c.tf[t] || 0, htf = (c.hs && c.hs[t]) || 0, ntf = dn ? (dn.ntf[t] || 0) : 0;
        let tfn = 0;
        if (tf) tfn += tf / (1 - KB_B + KB_B * c.len / idx.avg);                                  /* 正文 */
        if (htf) tfn += KB_WH * htf / (1 - KB_B + KB_B * c.hlen / (idx.avgH || 1));              /* 标题（加权） */
        if (ntf) tfn += KB_WD * ntf / (1 - KB_B + KB_B * dn.nlen / (idx.avgN || 1));             /* 文件名 */
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
  return hits;
}
function kbSearchSync(query, ids, topK) {
  return kbPickDiverse(kbHits(query, ids), topK || 4);
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
async function kbEnsure(id) {
  if (KB_IDX[id]) return true;
  if (!KB_MEM[id]) { const d = await kbStoreGet(id); if (!d) return false; KB_MEM[id] = d; }
  KB_IDX[id] = kbIndex(KB_MEM[id].docs || []);
  return true;
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
/* 把原始命中变成对外结构（带出处和摘要） */
function kbDetail(hits, query) {
  return hits.map(h => {
    const d = (KB_MEM[h.id] && KB_MEM[h.id].docs || [])[h.ch.d] || {};
    return { id: h.id, key: h.id + '#' + h.ch.d + '#' + h.ch.ci, kb: kbName(h.id), doc: d.name || '资料', page: d.page, pages: d.pages, file: d.file || '', full: d.text || '', head: h.ch.h || '', text: h.ch.t, score: h.score, snip: kbSnippet(h.ch.t, query, 200) };
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
  const lists = uniq.map(q => kbHits(q, ids).slice(0, 60));
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
  const list = hits.map((h, i) => '[' + (i + 1) + '] ' + String(h.text || '').replace(/\s+/g, ' ').slice(0, 170)).join('\n');
  const sys = '你是检索结果重排助手。用户给你一道题目和若干候选资料片段。'
    + '请只输出与题目最相关的片段编号，按相关度从高到低，用逗号分隔；最多 ' + k + ' 个；完全无关的不要输出。'
    + '只输出编号，不要任何解释。';
  const txt = await aiChat([{ role: 'system', content: sys }, { role: 'user', content: '【题目】\n' + String(question || '').slice(0, 800) + '\n\n【候选片段】\n' + list }], null, signal, { stream: false, maxTokens: 32, temp: 0 });
  const nums = (String(txt || '').match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= hits.length);
  const out = [], seen = Object.create(null);
  nums.forEach(n => { if (!seen[n]) { seen[n] = 1; out.push(hits[n - 1]); } });
  hits.forEach(h => { if (out.length < k && out.indexOf(h) < 0) out.push(h); });    /* 剩下的按原顺序补齐 */
  return out.slice(0, Math.max(1, k));
}

/* ---------- 文件知识库（make-kb.py 生成 知识库.js 时自动挂载） ---------- */
let KB_FILES_DONE = false;
function kbIngestFiles(force) {
  const arr = window.__KBS__ || [];
  if (!arr.length) return 0;                      /* 知识库.js 还没加载 */
  if (KB_FILES_DONE && !force) return 0;          /* 已经挂载过了，不必每次开 AI 面板都遍历一遍 */
  KB_FILES_DONE = true;
  let added = 0;
  arr.forEach((b, i) => {
    const id = 'file:' + (b.id || i);
    if (kbIsSkipped(id)) return;              /* 你删掉的库：不再自动挂载 */
    if (KB_LIST.some(x => x.id === id)) return;
    const docs = (b.docs || []).map(d => ({ name: d.name || '资料', page: d.page, pages: d.pages, file: d.file, text: d.text || '', chunks: Array.isArray(d.chunks) ? d.chunks : kbChunk(d.text || '') }));
    KB_MEM[id] = { docs: docs };
    const st = kbStats({ docs: docs });
    KB_LIST.push({ id: id, name: b.name || ('资料 ' + (i + 1)), src: 'file', addedAt: Date.now(), auto: true, chars: st.chars, docs: st.docs, chunks: st.chunks });
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
  L.push('</div>');
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

/* ---------- 动态挂载 知识库.js（没有这个文件也没关系） ----------
   4.2 MB 的资料文件不该每次打开页面都拉一遍：等真正要用时（打开 AI 面板 / 检索 / 进 #/kb）
   再挂载。挂载过就记在 KB_FILES_DONE，之后直接返回。 */
let KB_FILES_PROMISE = null;
function kbEnsureFilesLoaded() {
  if (KB_FILES_DONE || (window.__KBS__ && window.__KBS__.length)) return Promise.resolve({ ok: true, added: kbIngestFiles() });
  if (KB_FILES_PROMISE) return KB_FILES_PROMISE;
  KB_FILES_PROMISE = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = '知识库.js';
    let done = false;
    const fin = ok => {
      if (done) return;
      done = true; KB_FILES_PROMISE = null;
      const added = kbIngestFiles();
      kbPreheatIndex();
      if (route().name === 'kb') { try { render(); } catch (e) {} }
      resolve({ ok: ok, added: added });
    };
    s.onload = () => fin(true);
    s.onerror = () => fin(false);
    document.head.appendChild(s);
  });
  return KB_FILES_PROMISE;
}
/* 空闲时偷偷先拉一次：第一次点 AI 解析就不用等那 7 MB */
function kbWarmUp() {
  const go = () => { try { kbEnsureFilesLoaded(); } catch (e) {} };
  if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
}
/* 空闲预热检索索引：整库建索引要几百毫秒，别等用户点检索时才卡（每次只做一小会儿就让出主线程） */
function kbPreheatIndex() {
  const ids = kbSelected().filter(id => KB_MEM[id] && !KB_IDX[id]);
  if (!ids.length) return;
  let i = 0;
  const ric = window.requestIdleCallback || function (f) { return setTimeout(() => f({ timeRemaining: () => 6 }), 600); };
  const step = dl => {
    const left = () => (dl && dl.timeRemaining ? dl.timeRemaining() : 6);
    while (i < ids.length && left() > 4) {
      const id = ids[i++];
      if (KB_MEM[id] && !KB_IDX[id]) { try { KB_IDX[id] = kbIndex(KB_MEM[id].docs || []); } catch (e) {} }
    }
    if (i < ids.length) ric(step);
  };
  ric(step);
}
kbWarmUp();
