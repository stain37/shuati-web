/* ============================================================
   刷题站 · AI 助手 ai.js
   · 只用 OpenAI 兼容接口：本地 Ollama / LM Studio、云端 DeepSeek / OpenAI 都行
   · 生成的解析可以一键存进「本题解析」，也可以基于知识库答问
   · 页面：#/kb（AI 配置 + 知识库 + 试检索）
   · 答题页「AI 解析」按钮、错题本每题、解析编辑器里都能调出来
   ============================================================ */

const AI_LS = 'qbank.ai.v1';
const AI_PRESETS = {
  ollama:  { label: '本地 Ollama（免费、离线）', base: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b',
             models: ['qwen2.5:7b', 'qwen2.5:14b', 'qwen2.5:32b', 'deepseek-r1:8b', 'llama3.1:8b', 'gemma2:9b'],
             tip: '装好 Ollama 后执行：ollama pull qwen2.5:7b。要让网页能调用，需设环境变量 OLLAMA_ORIGINS=*（详见 AI知识库说明.md）。' },
  lmstudio:{ label: '本地 LM Studio', base: 'http://127.0.0.1:1234/v1', model: '', models: [],
             tip: 'LM Studio → Developer → Start Server，然后把「模型」填成它显示的模型名。' },
  deepseek:{ label: 'DeepSeek 云端 API', base: 'https://api.deepseek.com/v1', model: 'deepseek-flash',
             models: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash'],
             tip: '在 platform.deepseek.com 生成 API Key 填到下面。deepseek-flash 便宜快、够用；deepseek-v4-pro 更强更贵。用云端时，只有命中的资料片段会发出去。' },
  kimi:    { label: 'Kimi / Moonshot 云端', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k',
             models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-latest'],
             tip: '在 platform.moonshot.cn 生成 API Key。' },
  custom:  { label: '自定义（任意 OpenAI 兼容接口）', base: '', model: '', models: [],
             tip: '填类似 https://xxx/v1 的地址；本地服务一般不需要 Key。' }
};
const AI_DEF = { preset: 'ollama', base: AI_PRESETS.ollama.base, model: 'qwen2.5:7b', key: '', temp: 0.3, topK: 4, maxChars: 3500, stream: true, sys: '', tmpl: false, expand: true, rerank: true, models: null, tempFix: null };
let AIC = readLS(AI_LS, null) || {};
Object.keys(AI_DEF).forEach(k => { if (AIC[k] == null) AIC[k] = AI_DEF[k]; });
function aiSave() { writeLS(AI_LS, AIC); }
function aiCfg() { return AIC; }
function aiBase(cfg) {
  let b = String((cfg || AIC).base || '').trim().replace(/\/+$/, '');
  if (b && !/\/v\d+$/.test(b) && !/\/api$/.test(b) && !/\/chat\/completions$/.test(b)) b += '/v1';
  return b;
}
function aiHeaders(cfg) {
  const h = { 'Content-Type': 'application/json' };
  if ((cfg || AIC).key) h['Authorization'] = 'Bearer ' + (cfg || AIC).key;
  return h;
}

/* ---------- 错误提示：尽量告诉用户到底哪里不对 ---------- */
/* 服务商返回的错误体里通常有一句人话（{"error":{"message":"…","type":"…"}}），抠出来给用户看 */
function aiErrBrief(body) {
  var b = String(body || '').trim();
  if (!b) return '';
  var out = '';
  try {
    var j = JSON.parse(b);
    var e = (j && j.error) || j || {};
    if (typeof e === 'string') e = { message: e };
    var m = e.message || e.msg || (j && j.message) || '';
    var t = e.type || e.code || '';
    out = (t ? '[' + t + '] ' : '') + m;
  } catch (err) {
    out = b.replace(/\s+/g, ' ');
  }
  out = String(out || '').trim();
  return out ? out.slice(0, 160) : '';
}
function aiErrTail(body) {
  var s = aiErrBrief(body);
  return s ? '　服务商原话：' + s : '';
}
function aiErrInfo(e) {
  if (!e) return { msg: '未知错误', hint: '' };
  if (e.name === 'AbortError') return { msg: '已停止', hint: '' };
  if (e instanceof TypeError || /Failed to fetch|NetworkError|load failed/i.test(e.message || '')) {
    return { msg: '连不上模型服务', hint: '① 服务没启动（Ollama 要开着）；② 浏览器直连被跨域挡了：把 OLLAMA_ORIGINS 设成 * ，或者用站点里的「本地服务器.bat」打开（http://localhost:5173），见 AI知识库说明.md。' };
  }
  const s = e.status;
  const body = String(e.body || '');
  if (s === 401 || s === 403) return { msg: 'API Key 不对或没有权限', hint: '检查 Key 有没有复制全、有没有欠费。' + aiErrTail(body) };
  if (s === 402) return { msg: '余额 / 额度不足（HTTP 402）', hint: '这是模型服务商那边的账务问题，不是站点的问题：去它的控制台看看余额或免费额度；急用可以先换个便宜的小模型（如 moonshot-v1-8k），或用本机 Ollama 顶着。' + aiErrTail(body) };
  if (s === 404) return { msg: '接口地址或模型名不对（HTTP 404）', hint: '地址一般要以 /v1 结尾（例如 https://api.moonshot.cn/v1）；也可能这个模型你的账号没有权限，点「拉取模型列表」换一个。' + aiErrTail(body) };
  if (s === 429) {
    if (/quota|balance|insufficient|billing|exceed|余额|欠费|额度|配额/i.test(body)) {
      return { msg: '额度 / 余额用完了（HTTP 429）', hint: '拉模型列表能通、一生成就 429，一般就是账户额度用完了：去 Kimi（Moonshot）控制台的账户页看看余额 / 免费额度；也可以先把模型换成便宜的小号（moonshot-v1-8k）或本机 Ollama 顶着。' + aiErrTail(body) };
    }
    return { msg: '问得太密了（HTTP 429）', hint: '一分钟内请求太多：等 30–60 秒再点；也可以把设置里的「检索片段数」「资料上限」调小、把「让模型把捞回来的段落重排」关掉，一次问得轻一点。' + aiErrTail(body) };
  }
  if (s >= 500) return { msg: '模型服务自己出错了（HTTP ' + s + '）', hint: '一般是服务商那边抖动，不是你配置的问题：等一会儿重试，或者换个模型。' + aiErrTail(body) };
  if (s === 400) {
    const b = body;
    /* 这一支最容易被误判：错误体里几乎都带 "model" 这个词（for this model / model 某某），
       所以先按具体关键词判，最后才回落到「模型名不存在」 */
    if (/temperature/i.test(b)) {
      return { msg: '这个模型只接受 temperature=1', hint: '设置里的「温度」现在填的不是 1：把它改成 1 就好（站点也会自己按 1 重试一次，成功的话不用你动手）。' + aiErrTail(b) };
    }
    if (/(max_tokens|context length|too long|maximum context|length limit|too many tokens)/i.test(b)) {
      return { msg: '这次问得太长了（HTTP 400）', hint: '把设置里的「资料上限」或「检索片段数」调小一点再试；也可能是这道题本身太长。' + aiErrTail(b) };
    }
    if (/(model_not_found|model not found|unknown model|no such model|invalid model|does not exist|模型不存在)/i.test(b)) {
      return { msg: '模型名不存在', hint: '先在模型服务里拉取模型（Ollama: ollama pull 模型名），再点「拉取模型列表」挑一个。' + aiErrTail(b) };
    }
    return { msg: '请求被拒绝（HTTP 400）', hint: (aiErrBrief(b) || b.slice(0, 200)) };
  }
  return { msg: e.message || '出错', hint: aiErrBrief(body) ? ('服务商原话：' + aiErrBrief(body)) : '' };
}

/* 有的模型（推理模型，例如 kimi-k3）只接受 temperature=1。
   碰到「400 + temperature」就自动按 1 重试一次，并把这个模型记在本机配置里，下次直接用 1。 */
var AI_TEMP_NOTE = '';
function aiTempFixed(model) { return !!(AIC.tempFix && AIC.tempFix[model]); }
function aiTempRemember(model) {
  if (!AIC.tempFix) AIC.tempFix = {};
  AIC.tempFix[model] = 1;
  AI_TEMP_NOTE = model;
  try { aiSave(); } catch (e) {}
}
function aiTempNoteText() {
  return AI_TEMP_NOTE ? '（这个模型只收 temperature=1，已经自动按 1 走；把设置里的温度改成 1 以后就每次都直接走）' : '';
}

/* ---------- 接口调用 ---------- */
async function aiModels() {
  const cfg = aiCfg();
  const res = await fetch(aiBase(cfg) + '/models', { headers: aiHeaders(cfg) });
  if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; e.body = await res.text().catch(() => ''); throw e; }
  const j = await res.json();
  const arr = (j && (j.data || j.models)) || [];
  return arr.map(x => x.id || x.name || x.model).filter(Boolean);
}
async function aiChat(messages, onDelta, signal, opts) {
  const cfg = aiCfg();
  const url = aiBase(cfg) + '/chat/completions';
  const o = opts || {};
  const body = {
    model: cfg.model, messages: messages,
    temperature: o.temp == null ? (aiTempFixed(cfg.model) ? 1 : +cfg.temp) : +o.temp,
    stream: o.stream == null ? !!cfg.stream : !!o.stream
  };
  if (o.maxTokens) body.max_tokens = +o.maxTokens;
  const post = () => fetch(url, {
    method: 'POST', headers: aiHeaders(cfg), signal: signal,
    body: JSON.stringify(body)
  });
  const errOf = async (r) => {
    const e = new Error('HTTP ' + r.status);
    e.status = r.status;
    e.body = await r.text().catch(() => '');
    return e;
  };
  let res = await post();
  if (!res.ok) {
    const e1 = await errOf(res);
    /* 这个模型只收 temperature=1（kimi-k3 这类推理模型）：自动按 1 重试一次，并记下来 */
    if (e1.status === 400 && /temperature/i.test(String(e1.body || '')) && +body.temperature !== 1) {
      aiTempRemember(cfg.model);
      body.temperature = 1;
      res = await post();
      if (!res.ok) throw await errOf(res);
    } else {
      throw e1;
    }
  }
  if (!body.stream || !res.body) {
    const j = await res.json();
    const c0 = (j.choices && j.choices[0]) || {};
    const c = (c0.message && c0.message.content) || c0.text || '';
    if (onDelta) onDelta(c);
    return c;
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', full = '', reas = '';      /* reas：推理模型的思考过程（deepseek-flash 这类会先吐它） */
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line || line.charAt(0) === ':' || line.indexOf('data:') !== 0) continue;
      const d = line.slice(5).trim();
      if (d === '[DONE]') { if (onDelta) onDelta(full); return full; }
      try {
        const j = JSON.parse(d);
        if (j && j.error) {            /* 有的服务商把报错塞在 200 的流里（限速/额度用完最常见） */
          const em = new Error('HTTP ' + (j.error.code || j.error.status || 200));
          em.status = j.error.code || j.error.status || 0;
          em.body = JSON.stringify(j.error);
          throw em;
        }
        const ch0 = (j.choices && j.choices[0]) || {};
        const d0 = ch0.delta || {};
        const c = d0.content || (ch0.message && ch0.message.content) || '';
        const rz = d0.reasoning_content || d0.reasoning || '';
        if (rz) reas += rz;
        if (c) { full += c; if (onDelta) onDelta(full, reas); }
        else if (rz && onDelta) onDelta(full, reas);      /* 只吐思考过程时也报一次，界面好显示「正在思考」 */
      } catch (err) {
        if (err instanceof SyntaxError) continue;         /* 半截 JSON 是正常的，跳过这一行 */
        throw err;
      }
    }
  }
  if (onDelta) onDelta(full);
  return full;
}
/* ---------- 一键配置：读取 AI配置.js（chatbox-import.py 生成）+ 自动检测本机服务 ---------- */
/* 向量：OpenAI 兼容 /embeddings（批量）。config 里给了模型才走远端；失败由调用方退回本地向量。 */
async function aiEmbed(texts, opts) {
  const cfg = aiCfg();
  const model = String((opts && opts.model) || cfg.embModel || '').trim();
  if (!model) return null;
  const list = (texts || []).map(t => String(t == null ? '' : t).slice(0, 2000));
  if (!list.length) return [];
  const url = aiBase(cfg) + '/embeddings';
  const r = await fetch(url, { method: 'POST', headers: aiHeaders(cfg), body: JSON.stringify({ model: model, input: list }) });
  if (!r.ok) throw new Error('向量接口 HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120));
  const j = await r.json();
  const arr = (j.data || []).map(d => d && d.embedding).filter(a => Array.isArray(a) && a.length);
  return arr.length === list.length ? arr : null;
}
window.aiEmbed = aiEmbed;
function aiCfgFileName() { return 'AI配置.js'; }
function aiApplyCfgFile(force) {
  const c = window.__AICFG__;
  if (!c) return false;
  if (!force && AIC.cfgAuto === false) return false;      /* 自己改过配置就听你的，除非点「重新读取」 */
  if (c.base) AIC.base = c.base;
  if (c.model) AIC.model = c.model;
  if (c.key) AIC.key = c.key;
  if (c.provider && AI_PRESETS[c.provider]) AIC.preset = c.provider;
  else if (c.provider) AIC.preset = 'custom';
  AIC.cfgAuto = true; AIC.cfgAt = c.at || '';
  aiSave();
  if (typeof aiPaintForm === 'function' && route().name === 'kb') aiPaintForm();
  return true;
}
function aiLoadCfgFile() {
  if (window.__AICFG__) { aiApplyCfgFile(false); return; }
  const s = document.createElement('script');
  s.src = aiCfgFileName();
  s.onload = () => { if (window.__AICFG__ && aiApplyCfgFile(false)) { if (route().name === 'kb') aiPaintForm(); } };
  s.onerror = () => {};
  document.head.appendChild(s);
}
/* 本机常见的 OpenAI 兼容服务，挨个探一遍，谁先回话就用谁 */
const AI_LOCAL_PROBES = [
  { preset: 'ollama',   base: 'http://127.0.0.1:11434/v1', label: 'Ollama' },
  { preset: 'lmstudio', base: 'http://127.0.0.1:1234/v1',  label: 'LM Studio' },
  { preset: 'custom',   base: 'http://127.0.0.1:8080/v1',  label: 'llama.cpp / LocalAI' },
  { preset: 'custom',   base: 'http://127.0.0.1:8000/v1',  label: 'vLLM / 其它' },
  { preset: 'custom',   base: 'http://127.0.0.1:5000/v1',  label: '其它本地服务' }
];
async function aiProbe(base) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1800);
  try {
    const res = await fetch(base + '/models', { headers: aiHeaders({}), signal: ctl.signal });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const arr = (j && (j.data || j.models)) || [];
    const ids = arr.map(x => (typeof x === 'string' ? x : (x.id || x.name || x.model))).filter(Boolean);
    return ids;
  } catch (e) { return null; } finally { clearTimeout(t); }
}
async function aiDetect(silent) {
  const st = $('aiState');
  const say = (t, cls) => { if (st) { st.textContent = t; st.className = 'aistate ' + (cls || ''); } };
  if (!silent) say('正在扫描本机常见的 AI 服务…');
  for (let i = 0; i < AI_LOCAL_PROBES.length; i++) {
    const p = AI_LOCAL_PROBES[i];
    const ids = await aiProbe(p.base);
    if (ids) {
      AIC.preset = p.preset; AIC.base = p.base; AIC.cfgAuto = false;
      if (ids.length) AIC.model = ids[0];
      aiSave();
      aiPaintForm(); aiFillModels(ids);
      say('发现 ' + p.label + '（' + p.base + '）' + (ids.length ? '，模型：' + ids.slice(0, 3).join(' / ') : '，但里面还没有模型，先 ollama pull 一个'), 'ok');
      if (!silent) toast('已自动填好：' + p.label);
      return { ok: true, probe: p, ids: ids };
    }
  }
  say('没扫到本机 AI 服务（Ollama 默认端口 11434、LM Studio 默认 1234）。装了 Ollama 请确认它正开着，并设好 OLLAMA_ORIGINS=*；或者用「从Chatbox导入.bat」把 Chatbox 里的 Key 导进来用云端模型。', 'bad');
  return { ok: false };
}

async function aiTest() {
  const st = $('aiState');
  const set = (t, cls) => { if (st) { st.textContent = t; st.className = 'aistate ' + (cls || ''); } };
  aiReadForm();
  set('测试中…');
  const t0 = Date.now();
  try {
    const ids = await aiModels();
    if (ids && ids.length) aiFillModels(ids);
    set('接口通（' + (Date.now() - t0) + ' ms' + (ids && ids.length ? '，' + ids.length + ' 个模型' : '') + '），再试生成…', 'ok');
  } catch (e) {
    const c = aiErrInfo(e);
    set('连接失败：' + c.msg + '　' + c.hint, 'bad');
    return;
  }
  try {
    const txt = await aiChat([{ role: 'user', content: '只回复两个字：可以' }], null, null);
    set('一切正常 · 模型回了「' + String(txt || '').trim().slice(0, 20) + '」' + aiTempNoteText(), 'ok');
  } catch (e) {
    const c = aiErrInfo(e);
    set('生成失败：' + c.msg + '　' + c.hint, 'bad');
  }
}

/* ---------- 提示词 ---------- */
const AI_SYS_BASE = [
  '你是我的私人刷题助教，面向中国的考试。用简体中文和 Markdown 回答，不要客套话。',
  '需要强调时可以用 ==高亮== 或 <font color="red">红字</font> 标色（如正确项标绿、错误项标红），但别滥用。',
  '严格按我这次的要求来写；我没提格式，就自己看情况组织，不要硬套固定小节。',
  '如果我给了【参考资料】：优先使用资料里的说法，并在句末标出 [ID:1] [ID:2] 这样的编号（编号就是每条资料开头的 ID）；资料没覆盖的地方可以补充你自己的知识，但要注明「（模型补充）」。',
  '不要编造资料的出处；不确定的地方直说不确定。'
].join('\n');
/* 想要固定四段的讲解格式时才加这段（配置里勾「套用模板」） */
const AI_SYS_TMPL = [
  '这次的输出按这个结构写：',
  '**答案**：只写选项字母',
  '**为什么**：一步步讲清楚推理，点出考的是哪个知识点',
  '**其它选项**：每一项一句话，说明错在哪',
  '**易错点 / 记忆**：1-2 条，能给口诀就给口诀'
].join('\n');
function aiSysText() {
  let s = AI_SYS_BASE;
  if (AIC.tmpl) s += '\n\n' + AI_SYS_TMPL;
  if (AIC.sys) s += '\n\n额外要求：' + AIC.sys;
  return s;
}
function aiUserText(q, ctxText, userQ, k) {
  const parts = [];
  if (q) {
    if (q.group) parts.push('【共用题干】' + q.group);
    parts.push('【题目】' + q.stem);
    if (q.options && q.options.length) parts.push('【选项】\n' + q.options.map((o, i) => 'ABCDEFGHIJKL'[i] + '. ' + o).join('\n'));
    const ans = (typeof ansOf === 'function') ? ansOf(k || '', q) : (q.answer || []);   /* k：这道题的键（套卷题是原题键），别再往 q 上挂 __k */
    if (ans && ans.length) parts.push('【题库答案】' + ans.join(''));
    if (q.explain) parts.push('【题库自带解析】' + String(q.explain).slice(0, 600));
  }
  if (ctxText) parts.push('【参考资料】\n' + ctxText);
  if (userQ) parts.push('【我的问题】' + userQ);
  else parts.push('【任务】请给出这道题的完整解析。');
  return parts.join('\n\n');
}
function aiMyRecText(k) {
  if (!k || typeof ANS === 'undefined' || !ANS[k]) return '';
  const a = ANS[k];
  return '【我的作答】' + ((a.sel || []).join('') || '—') + '（错 ' + (a.wrong || 0) + ' 次 / 共 ' + (a.tries || 0) + ' 次作答）';
}
async function aiContext(q, userQ) {
  const cfg = aiCfg();
  const empty = { hits: [], text: '', count: 0, note: '' };
  if (!cfg.topK || typeof kbSearch !== 'function') return empty;
  /* 资料文件是懒加载的：第一次真正用到时才去挂 知识库.js */
  if (typeof kbEnsureFilesLoaded === 'function') { try { await kbEnsureFilesLoaded(); } catch (e) {} }
  const ids = (typeof kbSelected === 'function') ? kbSelected() : [];
  if (!ids.length) return empty;
  const K = +cfg.topK || 4;
  const stem = [q && q.group, q && q.stem].filter(Boolean).join(' ');
  const optText = (q && q.options || []).join(' ');
  const main = [stem, optText].filter(Boolean).join(' ');
  const ask = String(userQ || '').trim();
  const note = [];
  /* 检索用的查询和「给模型的题目」分开：
     · 题干 + 选项合成主查询；
     · 你自己写的要求（「只讲 B 为什么错」）单独算一份票 ——
       以前是把它拼在题干后面一起查，指令性的词会把题干的关键词冲淡。 */
  let queries = [main || ask];
  let weights = [1];
  if (ask && ask !== main) { queries.push(ask); weights.push(0.5); }   /* 你的要求单独算一份票，权重低一点 */
  const ctl = new AbortController();
  const timer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, 12000);     /* 扩写/重排合计最多等 12 秒 */
  /* ① 扩写：让模型把题目换几种「教材的说法」 */
  if (cfg.expand && AIC.model && main && typeof kbExpandQueries === 'function') {
    try {
      const extra = await kbExpandQueries(q, userQ, ctl.signal);
      extra.forEach(x => { queries.push(x); weights.push(0.7); });
      if (extra.length) note.push('模型扩写 ' + extra.length + ' 组检索词');
    } catch (e) {}
  }
  /* ② 检索：多份查询各查一次，RRF 合并；去重后同一段正文只占一个参考位 */
  let hits = [];
  try {
    hits = (queries.length > 1 && typeof kbSearchMulti === 'function')
      ? await kbSearchMulti(queries, ids, K, weights)
      : await kbSearch(queries[0], ids, K);
  } catch (e) { hits = []; }
  /* ③ 重排：把捞回来的候选段落给模型看一遭，让它挑真正相关的那几段 */
  if (!ctl.signal.aborted && cfg.rerank && AIC.model && hits.length > 1 && typeof kbRerank === 'function') {
    try {
      const before = hits.map(h => h.key).join('|');
      const re = await kbRerank([stem, optText, ask].filter(Boolean).join('\n'), hits, K, ctl.signal);
      if (re.length) {
        if (re.map(h => h.key).join('|') !== before) note.push('模型重排');
        hits = re;
      }
    } catch (e) {}
  }
  clearTimeout(timer);
  /* 同一份资料的重复段落合并成一个参考位（同一文件 + 同一页只留第一条），
     不然参考资料里会出现两条一模一样的 —— 面板上、给模型看的提示词里都只留一条 */
  hits = aiUniqHits(hits);
  /* ④ 低置信过滤：分数不到最高分 25% 的段落不要（AQBot 同思路，宁可空手也别喂无关内容）。
     被滤光时说清原因，别让用户以为「知识库里没有」。 */
  let dropped = 0;
  let bridged = 0;                       /* 有几条参考真的衔上了前后文（提前声明，别在下面 TDZ 报错） */
  /* E2：有重排分就用重排分做三态（10 分制），没有才退回 BM25 原始分（未知量纲，只能比相对值） */
  const rrTop = hits.reduce((mx, h) => Math.max(mx, h.rr == null ? 0 : h.rr), 0);
  if (rrTop > 0) {
    const kept = hits.filter((h, i) => i === 0 || (h.rr == null ? 0 : h.rr) >= 3);
    if (kept.length !== hits.length) { dropped = hits.length - kept.length; hits = kept; }
    if (rrTop >= 7) note.push('资料与题目强相关（重排 ' + rrTop + '/10）');
    else if (rrTop >= 4) note.push('资料只部分相关（重排 ' + rrTop + '/10），答案可能不全面');
    else note.push('资料相关性弱（重排 ' + rrTop + '/10），请核对原文');
  } else if (hits.length > 1) {
    const top = hits[0].score || 0;
    if (top > 0) {
      const kept = hits.filter((h, i) => i === 0 || (h.score || 0) >= top * 0.25);
      if (kept.length !== hits.length) { dropped = hits.length - kept.length; hits = kept; }
    }
  }
  if (!hits.length) {
    return { hits: [], text: '', count: 0, note: '没有命中知识库：换个更具体的说法（教材里的名词），或再多选几份资料' };
  }
  if (dropped) note.push(dropped + ' 段分数太低被滤掉');
  if (bridged) note.push(bridged + ' 条参考带上了前后文');
  /* ⑤ 只命中一份资料时提醒模型/用户「结论可能不全面」（AQBot 单源降级提示） */
  const srcs = {};
  hits.forEach(h => { srcs[(h.kb || '') + '|' + (h.doc || '')] = 1; });
  if (Object.keys(srcs).length === 1 && hits.length <= 2) note.push('只命中 1 份资料，答案可能不全面');
  const per = Math.max(400, Math.floor((+cfg.maxChars || 3500) / Math.max(1, hits.length)));
  const blocks = [];
  let used = 0;
  hits.forEach(h => {
    /* 邻段扩展：命中段前后各带一小截，补「定义在上一段 / 结论在下一段」的缺口。
       预算：正文 per 字，前后各最多 200 字。 */
    const pre = h.pre ? String(h.pre).slice(-200) : '';
    const post = h.post ? String(h.post).slice(0, 200) : '';
    if (pre || post) bridged++;
    const t = (pre ? '〔衔接上文〕' + pre + '\n' : '') + h.text.slice(0, per) + (post ? '\n〔衔接下文〕' + post : '');
    if (used + t.length > (+cfg.maxChars || 3500) && blocks.length) return;
    used += t.length;
    /* 送模型的参考资料用 ID / Title / Path / Content 四行：
       ① ID:n 让模型能写 [ID:2] 指向具体那一条（页面上的编号也是它）；
       ② Path 是标题路径（章 > 节），比单个 head 更能说明这段在教材哪一节，
          模型回答时可以直接说「按第三章第二节」，溯源也更好找。 */
    const meta = [];
    if (h.head) meta.push(h.head);
    if (h.page) meta.push('第' + h.page + '页');
    blocks.push('ID: ' + (blocks.length + 1)
      + '\nTitle: 《' + h.doc + '》' + (meta.length ? ' · ' + meta.join(' · ') : '') + '（知识库：' + h.kb + '）'
      + (h.path ? '\nPath: ' + h.path : '')
      + '\n└── Content:\n' + t);
  });
  return { hits: hits.slice(0, blocks.length), text: blocks.join('\n\n'), count: blocks.length, note: note.join(' · ') };
}

/* ---------- 面板：答题页 / 错题本 / 解析编辑器里共用 ---------- */
let AI_LAST = {};   /* 每个 host 的会话状态 */

/* ---------- 面板「续命」：整页重画（重画会把面板一起冲掉、正在生成的也会断）----------
   站点里很多操作都会 render() 整页重画：答题页选选项/提交/翻页、错题本展开收起/勾选、
   别的标签页改了数据（storage 事件）等。重画之后原来的面板节点就没了，
   于是「生成到一半突然变回原来解析」。
   办法：每个会话记住自己的宿主怎么找回（#aiHost / [data-k=..] .ai-host / .ed .ai-host），
   重画后由 renderQuiz / bindItem / paintEditor 调 aiReopenFor() 把面板挂回去，
   流式输出每次画之前都用 aiFindHost() 取「当前活着的那个宿主」，所以不会断。 */
function aiSels(host, k) {
  const s = [];
  if (host && host.id) s.push('#' + host.id);
  try { if (host && host.closest && host.closest('.ed')) s.push('.ed .ai-host'); } catch (e) {}
  if (k != null && k !== '') s.push('[data-k="' + String(k).replace(/["\\]/g, '\\$&') + '"] .ai-host');
  if (!s.length) s.push('.ai-host');
  return s;
}
function aiFindHost(st) {
  if (!st) return null;
  if (st.host && st.host.isConnected && st.host.querySelector) return st.host;
  const list = st.sels || [];
  for (let i = 0; i < list.length; i++) {
    let el = null;
    try { el = document.querySelector(list[i]); } catch (e) { el = null; }
    if (el) return el;
  }
  return null;
}
function aiInEditor(host) { try { return !!(host && host.closest && host.closest('.ed')); } catch (e) { return false; } }
function aiAttach(st, host) {
  if (!host || !st) return false;
  st.host = host;
  st.sels = aiSels(host, st.k);
  if (!host.dataset.aiid) host.dataset.aiid = st.id;
  if (!host.querySelector('.aipanel')) {
    if (st.onUse) host.dataset.aiuse = '1';
    host.innerHTML = aiPanelHtml(host);
    aiPanelBind(host);
    /* 面板一开就开始预热资料库：等用户写完要求、点「生成解析」时，索引已经建好了 */
    try { if (typeof kbWarmUp === 'function') kbWarmUp(); } catch (e) {}
  }
  return true;
}
function aiRestore(st) {
  const host = aiFindHost(st);
  if (!host) return false;
  const fresh = host !== st.host;
  aiAttach(st, host);
  const ta = host.querySelector('.ai-askq');
  if (fresh && ta && st.draft != null && ta.value !== st.draft) ta.value = st.draft;
  if (st.ctx) { try { aiPaintSrc(host, st.ctx); } catch (e) {} }
  try { aiPaintHist(host); } catch (e) {}
  if (st.text) aiPaintOut(host, st.text, true);
  else if (!st.running) {
    const out = host.querySelector('.aiout');
    if (out && !out.innerHTML.trim()) out.innerHTML = '<span class="muted">还没开始。先在上面写你要什么（可以留空），再点「生成解析」；写好追问后点「继续问」。</span>';
  }
  if (st.running) aiState(host, '正在生成…', '');
  else aiState(host, st.text ? ('完成' + aiTempNoteText()) : '就绪 · 等你的要求', st.text ? 'ok' : '');
  const stop = host.querySelector('.ai-stop'), go = host.querySelector('.ai-go');
  if (stop) stop.disabled = !st.running;
  if (go) go.disabled = !!st.running;
  try { aiPaintFollow(host, !!st.text); } catch (e) {}   /* §3.6-P1⑤：重画后把快捷追问也带回来 */
  try { paintAiChips(); } catch (e) {}
  return true;
}
/* 重画之后调用：把这一格（同一道题 / 同一个编辑器）「还活着」的会话挂回来 */
function aiReopenFor(host, k) {
  if (!host) return false;
  const inEd = aiInEditor(host);
  let best = null;
  Object.keys(AI_LAST).forEach(id => {
    const st = AI_LAST[id];
    if (!st || !st.host || String(st.k) !== String(k)) return;
    if (aiInEditor(st.host) !== inEd) return;                 /* 编辑器的面板别挂到错题本行里去（反过来也一样） */
    /* 刚打开、还没点「生成解析」的空面板也算「还活着」：否则整页重画会把它冲掉且不回来
       （看起来就是「点开正准备输入就没了」）。ts = 最后一次打开/生成时间，3 分钟内都挂回来。 */
    const fresh = st.running || (st.endTs && Date.now() - st.endTs < 3 * 60 * 1000) || (st.ts && Date.now() - st.ts < 3 * 60 * 1000);
    if (!fresh) return;
    if (!best) { best = st; return; }
    if (st.running !== best.running) { if (st.running) best = st; return; }
    if ((st.ts || 0) > (best.ts || 0)) best = st;
  });
  if (!best) return false;
  aiAttach(best, host);
  return aiRestore(best);
}
function aiIsRunning() {
  return Object.keys(AI_LAST).some(id => AI_LAST[id] && AI_LAST[id].running);
}
/* 页面上有没有开着的 AI 面板（哪怕还没开始生成）：别的标签页同步要整页重画时，先拿它挡一下 */
function aiPanelOpen() {
  return !!(document.querySelector && document.querySelector('.aipanel'));
}
/* 这个面板被彻底关掉了（取消/保存）→ 忘掉这个会话，别在下次重画时又冒出来 */
function aiForget(host) {
  try {
    if (!host) return;
    if (host.dataset && host.dataset.aiid) delete AI_LAST[host.dataset.aiid];
    if (host.querySelectorAll) host.querySelectorAll('[data-aiid]').forEach(x => { if (x.dataset.aiid) delete AI_LAST[x.dataset.aiid]; });
  } catch (e) {}
}
function aiPanelHtml(host) {
  const L = [];
  L.push('<div class="aipanel">');
  L.push('<div class="aihead"><b>AI 解析</b> <span class="small muted ai-model"></span><span class="spacer-grow"></span><a class="small" href="#/kb">设置 / 知识库</a></div>');
  L.push('<div class="aichips"><span class="small muted" title="点标签就能切换用不用它，可以多选；第一个「总库 · 全部」等于一次全选">用哪些资料</span><span class="aichipbox"></span><button class="btn tiny ai-all">全选</button><button class="btn tiny ai-none">清空</button><span class="small muted aichint"></span></div>');
  L.push('<div class="aibar aiquick"><textarea class="ai-askq" rows="2" placeholder="先写你要什么（留空就自由发挥，不套格式）。例如：只讲 B 为什么错 / 用表格对比四个选项 / 按考纲口吻，200 字内"></textarea></div>');
  L.push('<div class="aibar">');
  L.push('<button class="btn primary ai-go">生成解析</button>');
  L.push('<button class="btn ai-ask" title="把框里写的话当成追问，接着上面的对话继续问">继续问</button>');
  L.push('<button class="btn ai-stop" disabled>停止</button>');
  L.push('<button class="btn ai-copy">复制</button>');
  L.push('<button class="btn ai-copyq" title="把这道题 + 命中的资料 + 要求复制到剪贴板，粘到 Chatbox 等客户端里问">复制提问</button>');
  L.push('<button class="btn ai-save">' + (host.dataset.aiuse === '1' ? '写进解析框' : '存入本题解析') + '</button>');
  L.push('<button class="btn ai-clear" title="把这道题的这次对话清掉，重新开始（已存进解析的正文不受影响）">清空对话</button>');
  L.push('<span class="aistate small"></span>');
  L.push('</div>');
  L.push('<div class="aihist" hidden></div>');                 /* 候补池 D：追问的历史折叠在这里 */
  L.push('<div class="aiout small" data-readonly="1" title="只读：AI 输出的文字不能选中也不能改，要复制请点上面的「复制」"></div>');
  L.push('<div class="aisrc small muted"></div>');   /* 参考资料：紧跟解析正文下面（挪上来过，别又放回末尾） */
  L.push('<div class="aifollow" hidden></div>');               /* §3.6-P1⑤：生成完给三个快捷追问 */
  L.push('</div>');
  return L.join('');
}
const AI_KB_ALL = '__all__';
let aiChipExcept = null;   /* 正在被点击的那个知识库标签框：不重建它，避免点击丢失 */
function aiChipHtml() {
  const list = (typeof kbList === 'function') ? kbList() : [];
  const sel = new Set((typeof kbSelected === 'function') ? kbSelected() : []);
  if (!list.length) return '<span class="small muted">还没有知识库（去 <a href="#/kb">AI 与知识库</a> 导入资料；不选也能用，只是纯靠模型知识）</span>';
  const allOn = list.every(k => sel.has(k.id));
  const chars = list.reduce((a, b) => a + (b.chars || 0), 0);
  let h = '<span class="aichip aichip-all' + (allOn ? ' on' : '') + '" data-kb="' + AI_KB_ALL + '" title="一键选定全部资料：'
    + list.length + ' 个库 / ' + chars.toLocaleString() + ' 字">总库 · 全部</span>';
  h += list.map(k => '<span class="aichip' + (sel.has(k.id) ? ' on' : '') + '" data-kb="' + k.id + '" title="' + (k.chars || 0).toLocaleString() + ' 字">' + esc(k.name) + '</span>').join('');
  return h;
}
function aiChipHintText() {
  const list = (typeof kbList === 'function') ? kbList() : [];
  const sel = (typeof kbSelected === 'function') ? kbSelected() : [];
  if (!list.length) return '（还没有知识库，点上面「设置 / 知识库」去导入资料）';
  if (!sel.length) return '（一个都没选：这次回答只靠模型自己的知识）';
  return '';
}
function paintAiChips() {
  const html = aiChipHtml();
  const hint = aiChipHintText();
  document.querySelectorAll('.aipanel .aichips').forEach(row => {
    const box = row.querySelector('.aichipbox');
    if (box && box !== aiChipExcept) box.innerHTML = html;
    const h = row.querySelector('.aichint');
    if (h) h.textContent = (box === aiChipExcept) ? h.textContent : hint;
  });
  document.querySelectorAll('.aipanel .ai-model').forEach(el => { el.textContent = AIC.model ? ('模型 ' + AIC.model) : '没配模型'; });
}
/* 就地刷新某个标签框（不重建 DOM，所以连着点多个标签也不会丢） */
function paintAiChipsIn(box) {
  if (!box) return;
  const list = (typeof kbList === 'function') ? kbList() : [];
  const sel = new Set((typeof kbSelected === 'function') ? kbSelected() : []);
  const allOn = list.length > 0 && list.every(k => sel.has(k.id));
  box.querySelectorAll('.aichip').forEach(ch => {
    ch.classList.toggle('on', ch.dataset.kb === AI_KB_ALL ? allOn : sel.has(ch.dataset.kb));
  });
  const hint = box.parentNode ? box.parentNode.querySelector('.aichint') : null;
  if (hint) hint.textContent = aiChipHintText();
}
function aiPanelBind(host) {
  const q = sel => host.querySelector(sel);
  const aiAskText = () => { const el = q('.ai-askq'); return el ? (el.value || '').trim() : ''; };
  q('.ai-go').onclick = () => {                 /* 生成解析：带上你写的要求，从头生成（不点就不会开始） */
    const st0 = AI_LAST[host.dataset.aiid];
    if (st0) { st0.text = ''; st0.msgs = []; st0.draft = aiAskText(); st0.host = host; st0.sels = aiSels(host, st0.k); }
    try { const a = q('.ai-askq'); if (a) a.blur(); } catch (e) {}     /* 收起键盘：不然手机上半个屏幕被键盘占着，看起来就像滑不动 */
    aiRun(host, aiAskText());
  };
  q('.ai-ask').onclick = () => { const v = aiAskText(); if (!v) { toast('先在框里写一句要问的'); return; } try { const a = q('.ai-askq'); if (a) a.blur(); } catch (e) {} aiRun(host, v); };
  q('.ai-askq').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); q('.ai-go').click(); } };
  { const askq = q('.ai-askq'); if (askq) askq.oninput = () => { const st0 = AI_LAST[host.dataset.aiid]; if (st0) st0.draft = askq.value; }; }
  q('.ai-stop').onclick = () => { const st = AI_LAST[host.dataset.aiid]; if (st && st.ctl) st.ctl.abort(); };
  q('.ai-copy').onclick = () => { const st = AI_LAST[host.dataset.aiid]; aiCopy(st ? st.text : '', host); };
  q('.ai-copyq').onclick = () => {
    const st = AI_LAST[host.dataset.aiid];
    if (!st) return;
    aiCopy(aiSysText() + '\n\n' + aiUserText(st.q, (st.ctx && st.ctx.text) || '', '', st.k), host);
  };
  q('.ai-save').onclick = () => aiSaveOut(host);
  q('.ai-clear').onclick = () => {
    const st0 = AI_LAST[host.dataset.aiid];
    if (!st0) return;
    if (st0.running) { toast('正在生成，先点「停止」再清'); return; }
    if (st0.text && !confirm('把这次对话清掉重新开始？（已经「存入本题解析」的正文不受影响）')) return;
    st0.text = ''; st0.msgs = []; st0.hist = []; st0.curQ = ''; st0.ctx = null; st0.reason = '';
    aiPaintHist(host);
    aiPaintSrc(host, null);
    aiPaintOut(host, '', true);
    const o = host.querySelector('.aiout');
    if (o) o.innerHTML = '<span class="muted">已经清空。在上面写你要什么，再点「生成解析」。</span>';
    aiState(host, '就绪 · 等你的要求', '');
  };
  q('.ai-all').onclick = () => { kbSelAll(true); paintAiChips(); };
  q('.ai-none').onclick = () => { kbSelAll(false); paintAiChips(); };
  host.querySelector('.aichipbox').addEventListener('click', e => {
    const c = e.target.closest('.aichip');
    if (!c) return;
    const box = c.parentNode;
    const on = !c.classList.contains('on');
    aiChipExcept = box;                                       /* 先声明：本框别被重建（kbSetSel 内部会调 paintAiChips） */
    try {
      if (c.dataset.kb === AI_KB_ALL) kbSelAll(on);           /* 「总库 · 全部」= 一键选定所有资料 */
      else kbSetSel(c.dataset.kb, on);
      paintAiChips();                                         /* 只刷新别的面板 */
    } finally { aiChipExcept = null; }
    paintAiChipsIn(box);                                      /* 本框就地切 class，不重建 DOM */
  });
}
/* 网络是不是「不心疼」：开了省流量 / 2G-3G 就当贵，别自动拉几 MB 的资料库 */
function aiNetCheap() {
  try {
    const c = navigator.connection || {};
    if (c.saveData) return false;
    const t = String(c.effectiveType || '');
    if (/^(slow-2g|2g|3g)$/.test(t)) return false;
  } catch (e) {}
  return true;
}
function aiOpenPanel(host, k, q, onUse) {
  if (!host) return;
  /* 省流量：资料库（知识库.js）可能有几 MB，只在网络不贵时自动挂；手机流量/省流量模式先不挂，
     用户真要查资料时进「AI 与知识库」页面会挂上（那里必然会用到）。 */
  if (typeof kbEnsureFilesLoaded === 'function' && aiNetCheap()) {
    kbEnsureFilesLoaded().then(() => { try { paintAiChips(); } catch (e) {} });
  }
  if (!host.dataset.aiid) {
    /* 这一格刚被整页重画过、会话还活着 → 挂回来（别新开一个空面板，看起来就像「生成被中断了」） */
    if (!aiReopenFor(host, k)) {
      host.dataset.aiid = 'ai' + Math.random().toString(36).slice(2, 8);
      if (onUse) host.dataset.aiuse = '1';
      AI_LAST[host.dataset.aiid] = {
        id: host.dataset.aiid, k: k, q: q, onUse: onUse, text: '', msgs: [], running: false,
        ctl: null, ctx: null, host: host, sels: aiSels(host, k), ts: Date.now(), draft: ''
      };
      host.innerHTML = aiPanelHtml(host);
      aiPanelBind(host);
    }
  }
  const stKeep = AI_LAST[host.dataset.aiid];
  if (stKeep) { stKeep.host = host; stKeep.sels = aiSels(host, k); stKeep.ts = Date.now(); }
  paintAiChips();
  host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const st = AI_LAST[host.dataset.aiid];
  if (!st.text && !st.running) {
    /* 不自动开始：等你自己写完要求，再点「生成解析」 */
    const out = host.querySelector('.aiout');
    if (out) out.innerHTML = '<span class="muted">还没开始。先在上面写你要什么（可以留空），再点「生成解析」；写好追问后点「继续问」。</span>';
    aiState(host, '就绪 · 等你的要求');
    const ta = host.querySelector('.ai-askq');
    if (ta) { try { ta.focus({ preventScroll: true }); } catch (e) { try { ta.focus(); } catch (e2) {} } }
  }
}
function aiState(host, msg, cls) {
  if (!host || !host.querySelector) return;      /* 面板已经被整页重画冲掉了：别再报错 */
  const el = host.querySelector('.aistate');
  if (el) { el.textContent = msg || ''; el.className = 'aistate small ' + (cls || ''); }
}
function aiPaintOut(host, text, force) {
  const out = host.querySelector('.aiout');
  if (!out) return;
  const now = Date.now();
  if (!force && host._aiT && now - host._aiT < 80) return;
  host._aiT = now;
  out.innerHTML = (typeof mdToHtml === 'function') ? mdToHtml(text) : esc(text).replace(/\n/g, '<br>');
  if (typeof uiOptLink === 'function') { try { uiOptLink(out); } catch (e) {} }   /* §3.6-P1⑤：AI 解析里的 A/B/C/D 也能点 */
  if (force) host.scrollIntoView({ block: 'nearest' });
}
/* §3.6-P1⑤：生成完给三个快捷追问 —— 点一下就接着问，不用自己组织语言 */
const AI_FOLLOW = [
  ['再详细点', '上面这段再展开讲讲：把机制 / 判断依据 / 常见易错点讲透，可以长一些。'],
  ['换个说法', '换个更口语、更好记的说法再讲一遍这道题的考点，别堆术语。'],
  ['出变式题', '照这道题出 2 道同考点、换数字或换情境的变式题，给出答案和一句话解析。'],
];
function aiPaintFollow(host, on) {
  if (!host || !host.querySelector) return;
  const box = host.querySelector('.aifollow');
  if (!box) return;
  if (!on) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<span class="small muted">接着问：</span>' + AI_FOLLOW.map((f, i) =>
    '<button class="btn tiny aifollow-btn" data-fi="' + i + '" title="' + esc(f[1]) + '">' + esc(f[0]) + '</button>').join('');
  box.querySelectorAll('.aifollow-btn').forEach(b => {
    b.onclick = () => { const f = AI_FOLLOW[+b.dataset.fi]; if (f) aiRun(host, f[1]); };
  });
}
/* 候补池 D：追问会把上一轮的回答顶掉，这里把历史收进一个可折叠的块（点开能回看） */
function aiPaintHist(host) {
  const st = AI_LAST[host && host.dataset ? host.dataset.aiid : ''];
  const box = host ? host.querySelector('.aihist') : null;
  if (!box) return;
  const hist = (st && st.hist) || [];
  if (!hist.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const rnd = hist.map((h, i) => '<div class="aih-round"><div class="aih-q">第 ' + (i + 1) + ' 轮问：' + esc(h.q || '（没写要求，自由发挥）') + '</div>'
    + '<div class="aih-a">' + ((typeof mdToHtml === 'function') ? mdToHtml(h.a || '') : esc(h.a || '').replace(/\n/g, '<br>')) + '</div></div>').join('');
  box.innerHTML = '<details class="fold"><summary>之前的 ' + hist.length + ' 轮追问（点开看）</summary><div class="fold-body">' + rnd + '</div></details>';
}
/* ---------- 「打开 PDF 第 N 页」（只在本机可用）----------
   桌面用 本地服务器.bat（localhost:5173）或直接双击 index.html 时，参考资料下面多一个按钮，
   点一下用系统 PDF 阅读器打开这一节、跳到对应页（`pdf/科目/文件名.pdf#page=N`）。
   站点目录里的 pdf\ 是五个指向桌面精编版文件夹的 junction（本机才有，不随部署上传），
   手机（局域网 IP）和线上（github.io）上这份 PDF 根本不存在，所以那边干脆不画这个按钮。 */
function aiPdfOk() {
  /* 2026-10-16 改：PDF 现在**跟着站点一起上线了**（站点目录里的 pdf\ 那 476MB 也会上传），
     所以本地 / 局域网 / 线上（github.io）都能看，这个开关就恒为 true。
     只有一种情况会 404：把站点目录拷给别人时没带上 pdf\（分享包里那个文件夹本来就大，不带也算合理）。 */
  return true;
}
/* （留着备用）哪些「打开方式」算本机能直接读 PDF junction 的 */
function aiPdfHostOk(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10) return true;                        /* 10.0.0.0/8（校园网/热点常见） */
    if (a === 192 && b === 168) return true;          /* 192.168.0.0/16 */
    if (a === 172 && b >= 16 && b <= 31) return true; /* 172.16.0.0/12 */
  }
  return false;
}
function aiPdfHref(h) {
  if (!h || !h.file) return '';
  const parts = String(h.file).split(/[\\\/]/).filter(Boolean).map(encodeURIComponent);
  if (!parts.length) return '';
  const lib = h.kb ? encodeURIComponent(h.kb) + '/' : '';
  /* pdfp 优先：病理那种「文件名兜底」的篇，page 是原书页码（如 110），
     而 PDF 文件本身只有 8 页 —— 直接 #page=110 会被浏览器弹到最后一页，得用 pdfp（= 1） */
  const anchor = h.pdfp || h.page;
  return 'pdf/' + lib + parts.join('/') + (anchor ? '#page=' + anchor : '');
}
/* 站点根（index.html 所在目录）：站内 PDF / 阅读器都从它算绝对地址 */
function aiPdfBase() { return location.origin + location.pathname.replace(/[^\/]*$/, ''); }
/* ---------- PDF 走哪条线路（2026-10-16「PDF 太慢」这一轮的方案 ①）----------
   实测：线上直连 GitHub Pages 只有 33–46 KB/s（1.23 MB 的病理要 33 秒），
   国内能连上的 GitHub 加速代理 gh-proxy.com 有 729 KB/s（约 18 倍）、ghfast.top 约 300 KB/s。
   所以：线上（github.io）走代理，本机 / 局域网 / file:// 走本地相对路径（本地本来最快、还不吃流量）。
   选线：优先用上次选中的（记 qbank.pdfmirror.v1，7 天后重测），后台用 2 字节的 Range 请求探一遍，
   谁先回来用谁；点开时要是这条挂了，阅读器里有「换条线路」按钮立刻换。 */
const PDF_MIR_LS = 'qbank.pdfmirror.v1';
const PDF_RAW_BASE = 'https://raw.githubusercontent.com/stain37/shuati-web/main/';
const PDF_MIRS = [
  { id: 'gh-proxy', pre: 'https://gh-proxy.com/', label: '加速线路①' },
  { id: 'ghfast', pre: 'https://ghfast.top/', label: '加速线路②' },
  { id: 'direct', pre: '', label: '原站直连' }
];
function aiPdfOnline() {
  try { if (window.__pdfForceOnline != null) return !!window.__pdfForceOnline; } catch (e) {}
  try { return /(^|\.)github\.io$/i.test(location.hostname); } catch (e) { return false; }
}
function aiPdfMirCache() { try { const o = JSON.parse(localStorage.getItem(PDF_MIR_LS) || 'null'); return (o && o.id) ? o : null; } catch (e) { return null; } }
function aiPdfMirSave(id) { try { localStorage.setItem(PDF_MIR_LS, JSON.stringify({ id: id, ts: Date.now() })); } catch (e) {} }
function aiPdfMirId() {
  const o = aiPdfMirCache();
  const ok = o && PDF_MIRS.some(m => m.id === o.id) && (Date.now() - (+o.ts || 0) < 7 * 86400000);
  return ok ? o.id : '';
}
function aiPdfMirUrl(rel, id) {
  const m = PDF_MIRS.find(x => x.id === id) || PDF_MIRS[0];
  return m.pre ? (m.pre + PDF_RAW_BASE + rel) : (aiPdfBase() + rel);
}
function aiPdfMirLabel(id) { const m = PDF_MIRS.find(x => x.id === id); return m ? m.label : ''; }
function aiPdfPing(id, rel, ms) {
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(false); } }, ms);
    try {
      fetch(aiPdfMirUrl(rel, id), { headers: { Range: 'bytes=0-1' }, cache: 'no-store' })
        .then(r => { if (!done) { done = true; clearTimeout(t); resolve(!!r && (r.status === 206 || r.ok)); } })
        .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(false); } });
    } catch (e) { if (!done) { done = true; clearTimeout(t); resolve(false); } }
  });
}
async function aiPdfMirPick(rel) {
  if (!aiPdfOnline()) return '';
  const cur = aiPdfMirId();
  const order = PDF_MIRS.map(m => m.id).sort((a, b) => (a === cur ? -1 : b === cur ? 1 : 0));
  for (const id of order) {
    if (await aiPdfPing(id, rel, id === cur ? 3000 : 2500)) { aiPdfMirSave(id); return id; }
  }
  return cur || PDF_MIRS[0].id;
}
let AI_PDF_MIR_BUSY = false;
function aiPdfMirWarm(rel) {
  if (!aiPdfOnline() || AI_PDF_MIR_BUSY || aiPdfMirId()) return;
  AI_PDF_MIR_BUSY = true;
  try { aiPdfMirPick(rel).then(() => { AI_PDF_MIR_BUSY = false; }).catch(() => { AI_PDF_MIR_BUSY = false; }); }
  catch (e) { AI_PDF_MIR_BUSY = false; }
}
/* 阅读器本体（viewer.html + 3 个 js，约 3.7 MB）先悄悄拉一遍：
   SW 是「先用缓存、后台更新」，拉一遍就进缓存了，第一次点「看原页」不用现等。 */
let AI_PDF_VIEWER_WARM = false;
function aiPdfViewerWarm() {
  if (AI_PDF_VIEWER_WARM) return;
  AI_PDF_VIEWER_WARM = true;
  const base = aiPdfBase();
  const files = aiPdfLiteFirst()
    ? ['pdfjs/lite.html', 'pdfjs/v4/pdf.min.mjs', 'pdfjs/v4/pdf.worker.min.mjs']
    : ['pdfjs/web/viewer.html', 'pdfjs/web/viewer.css', 'pdfjs/web/viewer.mjs', 'pdfjs/build/pdf.mjs', 'pdfjs/build/pdf.worker.mjs'];
  files.forEach((p, i) => { setTimeout(() => { try { fetch(base + p).catch(() => {}); } catch (e) {} }, 1500 + i * 400); });
}
function aiPdfAbs(h) {
  const rel = String(aiPdfHref(h) || '').split('#')[0];
  if (!rel) return '';
  if (!aiPdfOnline()) return aiPdfBase() + rel;
  return aiPdfMirUrl(rel, aiPdfMirId() || PDF_MIRS[0].id);
}
/* 站内网页阅读器（pdfjs\web\viewer.html，2026-10-16 新增）：
   安卓 / iOS 的浏览器不认内嵌 PDF（iframe 直接空白，安卓 Chrome 还会把文件整份拉下来），
   系统阅读器那条路在「加到主屏的 App」里也会变成没反应。这个阅读器是纯 JS 画的（pdf.js），
   手机上照样能看，能翻页 / 缩放 / 双指放大 / 搜文字，还走 Range 边下边看。 */
function aiPdfViewerHref(h) {
  const abs = aiPdfAbs(h);
  if (!abs) return '';
  const anchor = h.pdfp || h.page;
  return aiPdfBase() + 'pdfjs/web/viewer.html?file=' + encodeURIComponent(abs) + (anchor ? '#page=' + anchor : '');
}
/* 按「相对路径 + 页码 + 线路」直接拼阅读器地址（换线路时用） */
function aiPdfViewerUrl(rel, anchor, id) {
  const abs = aiPdfMirUrl(rel, id || aiPdfMirId() || PDF_MIRS[0].id);
  return aiPdfBase() + 'pdfjs/web/viewer.html?file=' + encodeURIComponent(abs) + (anchor ? '#page=' + anchor : '');
}
/* 兼容写法：不用后台线程（在主线程里解析）。华为平板那类 WebView 上，模块 worker 可能起不来，
   表现就是「阅读器页面明明加载了，文档却永远打不开、也不报错」—— 这个参数正好绕开 worker。
   （pdf.js 自带支持：#disableworker=true，见 viewer.mjs 的 _parseHashParams。） */
function aiPdfViewerUrlCompat(rel, anchor, id) {
  const u = aiPdfViewerUrl(rel, anchor, id);
  return u + (u.indexOf('#') >= 0 ? '&' : '#') + 'disableworker=true';
}
/* 站内阅读器能不能在这台设备上跑：pdf.js 5 靠一堆 ES2022 的东西。
   旧 iPad（iOS 15.4 之前）/ 旧安卓浏览器会直接白屏 —— 那就别硬上，改走系统阅读器（原生渲染/下载）。
   （Promise.withResolvers 和 URL.parse 已经由 pdfjs\web\compat.js 垫住了，这里只查没垫的那几个。） */
function aiPdfViewerOK() {
  try {
    return typeof Object.hasOwn === 'function'
      && typeof Array.prototype.at === 'function'
      && typeof [].findLast === 'function'
      && typeof structuredClone === 'function'
      && typeof ''.replaceAll === 'function';
  } catch (e) { return false; }
}
/* 这台设备上站内阅读器试过不行（看门狗抓到的）：记住它，以后直接给系统阅读器，
   别再让人对着白屏发呆。想再试一次：参考资料里那颗「再试一次站内阅读器」会清掉这个标记。 */
const PDF_NOVIEWER_LS = 'qbank.pdfnoviewer.v1';
function aiPdfNoViewer() { try { return localStorage.getItem(PDF_NOVIEWER_LS) === '1'; } catch (e) { return false; } }
function aiPdfNoViewerSet(on) { try { if (on) localStorage.setItem(PDF_NOVIEWER_LS, '1'); else localStorage.removeItem(PDF_NOVIEWER_LS); } catch (e) {} }
/* 这台设备上「为什么打不开」的自检报告：让用户能一键复制发给我 */
function aiPdfDiagText(extra) {
  const L = [];
  const P = (k, v) => L.push(k + '：' + v);
  try {
    P('时间', new Date().toLocaleString('zh-CN'));
    P('页面', location.href);
    P('UA', navigator.userAgent);
    P('平台', (navigator.platform || '?') + ' / 触点 ' + (navigator.maxTouchPoints || 0) + ' / 主屏App ' + (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
    P('线路', (aiPdfMirId() || '(默认 ①)') + ' / 线上模式 ' + aiPdfOnline() + ' / 触屏判定 ' + aiPdfTouch());
    P('站内阅读器可用', aiPdfViewerOK() + ' / 已被标记打不开 ' + aiPdfNoViewer());
    const apis = ['URL.parse', 'Promise.withResolvers', 'Object.hasOwn', 'structuredClone'];
    P('关键 API', apis.map(a => {
      try { return a + '=' + (a === 'Object.hasOwn' ? typeof Object.hasOwn : (a === 'URL.parse' ? typeof URL.parse : (a === 'Promise.withResolvers' ? typeof Promise.withResolvers : typeof structuredClone))); } catch (e) { return a + '=缺'; }
    }).join('  '));
    P('模块 Worker', (function () { try { const w = new Worker(URL.createObjectURL(new Blob([''], { type: 'text/javascript' })), { type: 'module' }); w.terminate(); return '支持'; } catch (e) { return '不支持：' + (e && e.message); } })());
    P('屏幕', screen.width + '×' + screen.height + ' @' + (window.devicePixelRatio || 1) + 'x');
    const fid = document.getElementById('pdfFs');
    if (fid) {
      const f = fid.querySelector('iframe');
      let st = '没有 iframe';
      try {
        const w = f && f.contentWindow;
        st = 'viewer=' + !!(f && f.contentDocument && f.contentDocument.querySelector('#viewer'))
          + ' app=' + !!(w && w.PDFViewerApplication)
          + ' pdfDoc=' + !!(w && w.PDFViewerApplication && w.PDFViewerApplication.pdfDocument)
          + ' err=' + JSON.stringify(((f && f.contentDocument && f.contentDocument.getElementById('errorMessage')) || {}).textContent || '').slice(0, 80);
      } catch (e) { st = '读不到 iframe：' + e.message; }
      P('整屏阅读器状态', st);
    } else P('整屏阅读器状态', '(没开)');
    if (extra) P('补充', extra);
  } catch (e) { L.push('自检本身出错：' + (e && e.message)); }
  return L.join('\n');
}
/* 深入自检：把「pdf.js 在这台设备上到底卡在哪一步」逐个试出来。
   背景：华为平板的 ArkWeb 上，阅读器页面能加载、却永远停在「文档没打开」且不报错 ——
   像是卡死（卡在 worker 启动 / 或者卡在流式读取）。这里把可能的几条路逐个试：
     A. URL 方式建模块 Worker（pdf.js 默认用法）
     B. 把 worker 源码拉下来做 blob Worker（绕开 URL worker）
     C1 默认打开 / C2 直连原站对照 / C3 关 Range / C4 关流式 / C5 blob worker
   试完把结果复制给开发者，就能对症下药。 */
async function aiPdfDeepDiag(push) {
  const base = aiPdfBase();
  const rel = 'pdf/' + encodeURIComponent('病理') + '/' + encodeURIComponent('1.结核_110-117.pdf');
  const url = aiPdfMirUrl(rel, aiPdfMirId() || PDF_MIRS[0].id);
  const direct = base + rel;
  push('A. URL 方式建模块 Worker：');
  try {
    const w = new Worker(base + 'pdfjs/build/pdf.worker.mjs', { type: 'module' });
    const r = await new Promise(res => {
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; res('4 秒内没报错'); } }, 4000);
      w.onerror = e => { if (!done) { done = true; clearTimeout(t); res('报错：' + ((e && e.message) || e.type || '?')); } };
      try { w.postMessage({}); } catch (e) { if (!done) { done = true; clearTimeout(t); res('postMessage 抛错：' + e.message); } }
    });
    push('   ' + r);
    try { w.terminate(); } catch (e) {}
  } catch (e) { push('   抛错：' + e.message); }
  let blobWorker = null;
  push('B. 把 worker 源码拉下来做 blob Worker：');
  try {
    const rs = await fetch(base + 'pdfjs/build/pdf.worker.mjs', { cache: 'no-store' });
    const txt = await rs.text();
    push('   源码 HTTP ' + rs.status + '，' + txt.length + ' 字节');
    blobWorker = new Worker(URL.createObjectURL(new Blob([txt], { type: 'text/javascript' })), { type: 'module' });
    push('   blob Worker 建好了');
  } catch (e) { push('   失败：' + e.message); }
  let lib = null;
  push('C. 动态 import pdf.mjs：');
  try { lib = await import(base + 'pdfjs/build/pdf.mjs'); push('   ok，version=' + (lib.version || '?')); }
  catch (e) { push('   失败：' + ((e && e.message) || e)); }
  if (lib) {
    const tries = [
      ['C1 默认（workerSrc = URL）', { url: url }],
      ['C2 直连原站（对照）', { url: direct }],
      ['C3 关 Range', { url: url, disableRange: true }],
      ['C4 关流式+关预取', { url: url, disableStream: true, disableAutoFetch: true }],
    ];
    for (const [name, opt] of tries) {
      const t0 = Date.now();
      try {
        lib.GlobalWorkerOptions.workerSrc = base + 'pdfjs/build/pdf.worker.mjs';
        try { lib.GlobalWorkerOptions.workerPort = null; } catch (e) {}
        const task = lib.getDocument(opt);
        const doc = await Promise.race([task.promise, new Promise((_, rej) => setTimeout(() => rej(new Error('25 秒超时')), 25000))]);
        push('   ' + name + '：成功，' + doc.numPages + ' 页（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
        try { doc.destroy(); } catch (e) {}
      } catch (e) { push('   ' + name + '：' + String((e && e.message) || e).slice(0, 130) + '（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）'); }
    }
    if (blobWorker) {
      const t0 = Date.now();
      try {
        lib.GlobalWorkerOptions.workerPort = blobWorker;
        const task = lib.getDocument({ url: url });
        const doc = await Promise.race([task.promise, new Promise((_, rej) => setTimeout(() => rej(new Error('25 秒超时')), 25000))]);
        push('   C5 blob worker：成功，' + doc.numPages + ' 页（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）');
        try { doc.destroy(); } catch (e) {}
      } catch (e) { push('   C5 blob worker：' + String((e && e.message) || e).slice(0, 130) + '（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）'); }
      try { lib.GlobalWorkerOptions.workerPort = null; } catch (e) {}
      try { blobWorker.terminate(); } catch (e) {}
    }
  }
  push('（深入自检完）');
}
async function aiPdfDiagShow() {
  let extra = '';
  try {
    const rel = 'pdf/' + encodeURIComponent('病理') + '/' + encodeURIComponent('1.结核_110-117.pdf');
    const t0 = Date.now();
    const id = await aiPdfMirPick(rel);
    extra = '线路探测：' + (id || '无') + '，' + (Date.now() - t0) + 'ms';
    for (const m of PDF_MIRS) {
      const t = Date.now();
      const ok = await aiPdfPing(m.id, rel, 6000);
      extra += '\n  · ' + m.label + '（' + m.id + '）：' + (ok ? '通' : '不通') + ' ' + (Date.now() - t) + 'ms';
    }
    const u = aiPdfMirUrl(rel, aiPdfMirId() || PDF_MIRS[0].id);
    const t1 = Date.now();
    try { const r = await fetch(u, { headers: { Range: 'bytes=0-99' }, cache: 'no-store' }); extra += '\n  实测拉 100 字节：HTTP ' + r.status + '  ' + (Date.now() - t1) + 'ms'; }
    catch (e) { extra += '\n  实测拉 100 字节：失败 ' + String(e).slice(0, 60); }
  } catch (e) { extra = '探测出错：' + (e && e.message); }
  const txt = aiPdfDiagText(extra);
  const box = document.createElement('div');
  box.id = 'pdfDiagBox';
  box.style.cssText = 'position:fixed;inset:0;z-index:9995;background:rgba(6,10,18,.85);display:flex;flex-direction:column;gap:9px;padding:14px';
  box.innerHTML = '<div style="color:#fff;font-size:13.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
    + '<span style="flex:1 1 180px">这台设备的 PDF 自检报告（复制发给我就行）</span>'
    + '<button class="btn tiny" type="button" id="pdfDiagDeep">▶ 深入自检（试四种取法，约 1 分钟）</button>'
    + '<button class="btn tiny" type="button" id="pdfDiagCopy">复制</button>'
    + '<button class="btn tiny" type="button" id="pdfDiagClose">关闭</button></div>'
    + '<textarea id="pdfDiagTa" spellcheck="false" style="flex:1;width:100%;border-radius:12px;padding:10px;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.5"></textarea>';
  document.body.appendChild(box);
  const ta = document.getElementById('pdfDiagTa');
  ta.value = txt;
  on('pdfDiagDeep', async () => {
    const b = document.getElementById('pdfDiagDeep');
    if (b) { b.disabled = true; b.textContent = '正在深入自检…'; }
    const push = m => { ta.value += '\n' + m; ta.scrollTop = ta.scrollHeight; };
    try { await aiPdfDeepDiag(push); } catch (e) { push('深入自检出错：' + (e && e.message)); }
    ta.value += '\n—— 就这些，点上面「复制」发给我 ——';
    if (b) { b.disabled = false; b.textContent = '▶ 再试一次深入自检'; }
  });
  on('pdfDiagCopy', () => { try { ta.select(); document.execCommand('copy'); toast('已复制，粘给我就行'); } catch (e) { toast('复制失败，手动全选复制'); } });
  on('pdfDiagClose', () => box.remove());
}
/* 轻量阅读器（pdfjs 4.6.82 legacy + 自己写的界面，2026-10-16）
   为什么需要：官方那份 pdf.js 6.5 的阅读器要靠一堆最新的 JS API，华为平板那种内核（ArkWeb）上
   直接报 Uint8Array.toHex / Map.getOrInsertComputed 缺失 —— 而且 worker 里也在用，垫主线程没用。
   这份 v4 的 legacy 构建是专为老引擎转译的，界面只要翻页 / 跳页 / 缩放，还自己建 worker（三种方式回退）。 */
function aiPdfLiteUrl(rel, anchor) {
  const abs = aiPdfMirUrl(rel, aiPdfMirId() || PDF_MIRS[0].id);
  return aiPdfBase() + 'pdfjs/lite.html?file=' + encodeURIComponent(abs) + (anchor ? '&page=' + anchor : '');
}
function aiPdfLiteHref(h) {
  const rel = String(aiPdfHref(h) || '').split('#')[0];
  if (!rel) return '';
  return aiPdfLiteUrl(rel, h.pdfp || h.page || '');
}
/* 华为 / 鸿蒙那一类内核：官方阅读器基本跑不起来，直接用轻量的 */
function aiPdfLiteFirst() {
  try { if (window.__pdfLiteFirst != null) return !!window.__pdfLiteFirst; } catch (e) {}
  try { return /ArkWeb|HuaweiBrowser|HarmonyOS|OpenHarmony/i.test(navigator.userAgent || ''); } catch (e) { return false; }
}
/* 触屏设备（手机 / 平板）：内嵌 iframe 一律没用（白屏 + 白下载几十 MB），走网页阅读器。
   window.__pdfTouch 是给探针用的开关，能强扮手机 / 电脑。 */
function aiPdfTouch() {
  try { if (window.__pdfTouch != null) return !!window.__pdfTouch; } catch (e) {}
  try { return (navigator.maxTouchPoints || 0) > 0 && !!(window.matchMedia && window.matchMedia('(hover: none)').matches); } catch (e) { return false; }
}
/* 展开块的正文：有 PDF 的篇**就是 PDF 本身**（默认内嵌阅读器，不再给提取出来的文字 ——
   讲义是手写/带图的，提取文字只留给 AI 自己搜和引用）；没 PDF（手机 / 线上 / 文件不在）才给文字。 */
function aiPdfBlockHtml(h, full) {
  const pdf = aiPdfOk() ? aiPdfHref(h) : '';
  if (!pdf) {
    /* 手机 / 线上：没有 PDF，只能给文字。存下来的参考资料只存了摘要（没存正文），
       就把摘要拿出来当正文，总比空一块强 */
    const t = String(full || h.snip || '');
    return '<div class="aisrc-text">' + esc(t).replace(/\n/g, '<br>')
      + (t ? '' : '<span class="muted">（这条只存了出处：' + esc(h.doc || '') + '）</span>') + '</div>';
  }
  const label = h.page ? ('打开 PDF 第 ' + h.page + ' 页') : '打开 PDF';
  const title = '《' + aiSrcName(h) + '》' + (h.page ? ' 第 ' + h.page + ' 页' : '');
  const rel = String(pdf).split('#')[0];
  const anchor = h.pdfp || h.page || '';
  /* 直链（系统阅读器 / 下载）保留 #page=N，原生阅读器能直接跳页；阅读器的 file= 参数里去掉锚点 */
  const direct = aiPdfBase() + rel + (anchor ? '#page=' + anchor : '');
  try { aiPdfMirWarm(rel); } catch (e) {}
  try { aiPdfViewerWarm(); } catch (e) {}
  /* 手机 / 平板：不嵌 iframe（安卓浏览器不认，只会白屏；还会白跑几十 MB 流量），
     直接给站内网页阅读器 —— 它跟普通网页一样，在浏览器 / 加到主屏的 App 里都能开。 */
  const viewer = aiPdfViewerHref(h);
  const lite = aiPdfLiteHref(h);
  /* 浏览器太旧（跑不动 pdf.js 5）、或者这台设备上看门狗已经确认打不开：
     别给阅读器，直接给「系统阅读器打开」那条路 */
  if (viewer && (!aiPdfViewerOK())) {
    return '<div class="pdfrow" style="margin:0 0 8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      + '<a class="btn tiny primary" href="' + esc(direct + (anchor ? '#page=' + anchor : '')) + '" target="_blank" rel="noopener" title="用系统阅读器 / 浏览器直接打开这一节（原站直链）">📄 ' + label + ' ↗</a>'
      + '</div>'
      + '<div class="small muted pdf-touch-hint" style="margin:0 0 9px">这台设备的浏览器版本较旧（跑不动站内阅读器），已经改成用系统阅读器打开。</div>';
  }
  if (viewer && aiPdfTouch()) {
    /* 这台设备上「标准阅读器」以前失败过（华为内核 / 看门狗标记）→ 直接用轻量的那个 */
    const useLite = !!lite && (aiPdfLiteFirst() || aiPdfNoViewer());
    const primary = useLite ? lite : viewer;
    const plabel = useLite ? '📖 看原页（轻量阅读器）' : '📖 看原页（网页阅读器）';
    return '<div class="pdfrow" style="margin:0 0 8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      + '<button class="btn tiny primary pdf-full" type="button" data-pdf="' + esc(primary) + '" data-rel="' + esc(rel) + '" data-anchor="' + esc(anchor) + '" data-lite="' + (useLite ? '1' : '0') + '" data-title="' + esc(title) + '" title="在本站里打开原页（纯网页渲染，安卓 / iPhone / 华为平板都行；Esc 或右上角关闭退出）">' + plabel + '</button>'
      + '<a class="btn tiny" href="' + esc(direct) + '" target="_blank" rel="noopener" title="直接打开 PDF 文件本身（手机会交给下载 / PDF 应用处理）">' + label + ' ↗</a>'
      + ((useLite || !lite) ? '' : '<button class="btn tiny pdf-lite" type="button" data-pdf="' + esc(lite) + '" data-rel="' + esc(rel) + '" data-anchor="' + esc(anchor) + '" data-lite="1" data-title="' + esc(title) + '" title="轻量阅读器：给官方那份跑不起来的老内核用">轻量阅读器</button>')
      + '</div>'
      + '<div class="small muted pdf-touch-hint" style="margin:0 0 9px">手机上看原页：点左边那颗「看原页」，本站的阅读器会直接翻开这一页（走加速线路，比直连快十几倍），能翻页、双指放大。</div>';
  }
  /* 电脑：内嵌也改成阅读器（因为加速线路返回的是 octet-stream，原生内嵌会变成「下载」） */
  return '<div class="pdfrow" style="margin:0 0 8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
    + '<button class="btn tiny pdf-full" type="button" data-pdf="' + esc(viewer) + '" data-rel="' + esc(rel) + '" data-anchor="' + esc(anchor) + '" data-title="' + esc(title) + '" title="把阅读器放大到整屏（不离开本站，Esc 退出）">⛶ 全屏看原页</button>'
    + '<a class="btn tiny" href="' + esc(direct) + '" target="_blank" rel="noopener" title="用本机的 PDF 阅读器打开这一节（原站直链，加载慢一点）">' + label + ' ↗</a>'
    + '</div>'
    + '<div class="pdf-embed" style="margin:0 0 9px">'
    + '<iframe src="' + esc(viewer) + '" loading="lazy" title="' + esc(title) + '" style="width:100%;height:74vh;min-height:460px;border:1px solid var(--line);border-radius:var(--r-s);background:var(--card)"></iframe>'
    + '<div class="small muted" style="margin:4px 0 0">这一页由站内阅读器渲染，PDF 从 <b>' + esc(aiPdfMirLabel(aiPdfMirId() || PDF_MIRS[0].id)) + '</b> 取（实测比直连快十几倍）；半天不出来就点上面的「' + esc(label) + ' ↗」用系统阅读器看。</div>'
    + '</div>';
}
/* ⛶ 全屏看原页：站内覆盖一整屏的阅读器（不想看小窗时用；Esc / 点遮罩 / 关闭 都能退） */
function aiPdfFullscreen(pdf, title, rel, anchor) {
  const old = document.getElementById('pdfFs');
  if (old) old.remove();
  const box = document.createElement('div');
  box.id = 'pdfFs';
  box.style.cssText = 'position:fixed;inset:0;z-index:9990;background:rgba(6,10,18,.78);display:flex;flex-direction:column;padding:13px;gap:9px';
  box.innerHTML = '<div style="display:flex;align-items:center;gap:10px;color:#fff;font-size:13.5px;flex-wrap:wrap">'
    + '<span style="flex:1 1 200px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(title || 'PDF') + '</span>'
    + (rel && aiPdfOnline() ? '<button class="btn tiny" type="button" id="pdfFsSwap" title="这条线路取不到就换一条（加速线路①→②→直连）">换条线路</button>' : '')
    + '<a class="btn tiny" target="_blank" rel="noopener" href="' + esc(pdf) + '">新窗口打开 ↗</a>'
    + '<button class="btn tiny" type="button" id="pdfFsClose">关闭（Esc）</button>'
    + '</div>'
    + '<iframe src="' + esc(pdf) + '" title="' + esc(title || 'PDF') + '" style="flex:1 1 auto;width:100%;border:0;border-radius:12px;background:#fff"></iframe>'
    + '<div class="pdfFsTip small" style="color:#cbd5e1;margin:0"></div>';
  document.body.appendChild(box);
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => {
    box.remove(); document.removeEventListener('keydown', onKey, true);
    try { if (box.__rmTimers) box.__rmTimers(); } catch (e) {}
  };
  document.addEventListener('keydown', onKey, true);
  const btn = document.getElementById('pdfFsClose');
  if (btn) btn.onclick = close;
  box.addEventListener('click', e => { if (e.target === box) close(); });
  const sw = document.getElementById('pdfFsSwap');
  /* 看门狗：站内阅读器是**同源**的，可以直接问它「PDF 打开了没」。
     14 秒还没打开（老浏览器 / 线路不通 / 设备不让跨域）就在顶上补一条出路，别让人对着白屏发呆。 */
  const directUrl = rel ? (aiPdfBase() + rel + (anchor ? '#page=' + anchor : '')) : '';
  /* 两个时间点，不用计数器，省得绕：
       12 秒 —— 还没打开，先自动换成「不用 worker」的地址再试一次；
       28 秒 —— 还不行才弹提示条 + 记住这台设备（下次直接给系统阅读器）。 */
  const openedNow = () => {
    try {
      const fr = box.querySelector('iframe'), w = fr && fr.contentWindow;
      return !!(w && w.PDFViewerApplication && w.PDFViewerApplication.pdfDocument);
    } catch (e) { return false; }
  };
  const tip = t => { try { const el = box.querySelector('.pdfFsTip'); if (el) el.textContent = t; } catch (e) {} };
  const tRetry = setTimeout(() => {
    if (!box.isConnected || openedNow() || !rel) return;
    if (document.getElementById('pdfFsFail')) return;
    try {
      const f = box.querySelector('iframe');
      const cur = (f && f.getAttribute('src')) || '';
      if (cur.indexOf('lite.html') < 0) {          /* 标准阅读器没开出来 → 换成轻量阅读器再试一次 */
        if (f) f.src = aiPdfLiteUrl(rel, anchor);
        tip('第一次没打开，正在换成「轻量阅读器」再试一次…');
      }
    } catch (e) {}
  }, 12000);
  const tGiveUp = setTimeout(() => {
    if (!box.isConnected || openedNow() || document.getElementById('pdfFsFail')) return;
    try {
      aiPdfNoViewerSet(true);                     /* 记住：这台设备上阅读器打不开，以后直接给系统阅读器 */
      const bar = document.createElement('div');
      bar.id = 'pdfFsFail';
      bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:rgba(255,255,255,.12);border-radius:10px;padding:8px 10px;color:#fff;font-size:13px';
      bar.innerHTML = '<span>这一页在这台设备上没打开成功（以后这里会优先用轻量阅读器）。</span>'
        + '<button class="btn tiny" type="button" id="pdfFsLite">试试轻量阅读器</button>'
        + '<button class="btn tiny" type="button" id="pdfFsAgain">换条线路重试</button>'
        + (directUrl ? '<a class="btn tiny" target="_blank" rel="noopener" href="' + esc(directUrl) + '">用系统阅读器直接打开 ↗</a>' : '')
        + '<button class="btn tiny" type="button" id="pdfFsWhy">为什么打不开？</button>';
      const head = box.firstElementChild;
      if (head && head.parentNode) head.parentNode.insertBefore(bar, head.nextSibling);
      const liteBtn = bar.querySelector('#pdfFsLite');
      if (liteBtn) liteBtn.onclick = () => { try { close(); aiPdfFullscreen(aiPdfLiteUrl(rel, anchor), title, rel, anchor); } catch (e) {} };
      const again = bar.querySelector('#pdfFsAgain');
      if (again) again.onclick = () => { const f = box.querySelector('iframe'); if (f) f.src = f.src; };
      const why = bar.querySelector('#pdfFsWhy');
      if (why) why.onclick = () => { try { aiPdfDiagShow(); } catch (e) {} };
    } catch (e) { try { toast('PDF 打不开。可以点「打开 PDF」用系统阅读器看'); } catch (e2) {} }
  }, 28000);
  const _rmTimers = () => { clearTimeout(tRetry); clearTimeout(tGiveUp); };
  box.__rmTimers = _rmTimers;
  if (sw && rel) sw.onclick = function () {
    if (sw.dataset.busy) return;
    sw.dataset.busy = '1'; sw.textContent = '正在试别的线路…';
    const cur = aiPdfMirId();
    const others = PDF_MIRS.map(m => m.id).filter(id => id !== cur);
    (async () => {
      let okId = '';
      for (const id of others) { if (await aiPdfPing(id, rel, 2600)) { okId = id; break; } }
      delete sw.dataset.busy;
      if (!okId) { sw.textContent = '线路都不通，稍后再试'; setTimeout(() => { sw.textContent = '换条线路'; }, 2600); return; }
      aiPdfMirSave(okId);
      const f = box.querySelector('iframe');
      const url = aiPdfViewerUrl(rel, anchor, okId);
      if (f) f.src = url;
      sw.textContent = '已换到' + aiPdfMirLabel(okId);
      setTimeout(() => { sw.textContent = '换条线路'; }, 2600);
    })();
  };
}
/* 「⛶ 全屏看原页」按钮的绑定 */
function aiBindPdfInline(root) {
  (root || document).querySelectorAll('.pdf-full, .pdf-lite').forEach(btn => {
    btn.onclick = () => aiPdfFullscreen(btn.dataset.pdf || '', btn.dataset.title || 'PDF', btn.dataset.rel || '', btn.dataset.anchor || '');
  });
  /* 「再试一次站内阅读器」：清掉「这台设备打不开」的标记，下次又给阅读器 */
  (root || document).querySelectorAll('[data-pdf-retryviewer]').forEach(btn => {
    btn.onclick = () => {
      aiPdfNoViewerSet(false);
      toast('好，下次会再试一次站内阅读器', 3000);
      try { if (typeof render === 'function') render(); } catch (e) {}
    };
  });
  /* 「看看为什么？」：出个自检报告，可以一键复制发我 */
  (root || document).querySelectorAll('[data-pdf-diag]').forEach(a => {
    a.onclick = ev => { ev.preventDefault(); try { aiPdfDiagShow(); } catch (e) { toast('自检失败了：' + (e && e.message)); } };
  });
}
/* 同一份资料的重复段落合并成一个：同一文件 + 同一页（没页码就算同一文件）只留第一条。
   检索回来时合一次（省提示词、省得面板上摆两份一样的），画参考资料时再兜一次（防别的调用方塞重复的进来） */
function aiUniqHits(hits) {
  const seen = new Set();
  return (hits || []).filter(h => {
    const key = String(h.file || h.doc || '') + '#' + (h.pdfp || h.page || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/* 参考资料标签上的名字：优先用源文件名（如「1.1 外科 颈部疾病」），没有就用节标题 */
function aiSrcName(h) {
  const f = String(h.file || '').split(/[\\\/]/).pop();
  const base = (f || h.doc || '资料').replace(/\.[a-z0-9]+$/i, '').replace(/\s+/g, ' ').trim();
  return base || h.doc || '资料';
}
/* 展开的是哪一条：按「这一组参考资料的内容签名」记，重心画之后自动展回去
   （云同步、翻页、切页都会整页重画，以前点开的东西会被一起收起来） */
const AI_SRC_OPEN = {};
function aiSrcSig(hits) {
  return (hits || []).map(h => String(h.file || h.doc || '') + '#' + (h.pdfp || h.page || '') + '#' + String(h.head || '')).join('|');
}
function aiSrcAnyOpen() { try { return !!document.querySelector('.aisrc-full'); } catch (e) { return false; } }
/* 「更多」旁边那个空位：本次 AI 解析用了几条资料，就显示一个小小的「📎 资料 3」。
   点它 → 直接在按钮旁边摊开列表，点某条就地看原文（web178 第 ⑦ 条：不再只是把你滚过去）。 */
let AI_SRC_HITS = [];
function aiSrcJump(n, names) {
  let el = null;
  try { el = document.getElementById('srcJump'); } catch (e) {}
  if (!el) return;
  if (!n) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = '📎 资料 ' + n;
  el.title = '这次解析引用了 ' + n + ' 条资料' + (names ? '：' + names : '') + '（点一下直接看原文）';
  if (!el.__bound) {
    el.__bound = 1;
    el.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      aiSrcPanel(el);
    });
  }
}
let AI_SRC_PANEL = null;
function aiSrcPanel(anchor) {
  const close = () => { if (AI_SRC_PANEL) { AI_SRC_PANEL.remove(); AI_SRC_PANEL = null; } };
  if (AI_SRC_PANEL) { close(); return; }
  const hits = AI_SRC_HITS || [];
  if (!hits.length) return;
  const box = document.createElement('div');
  box.className = 'srcpop';
  box.innerHTML = '<div class="srcpop-h">参考资料 · ' + hits.length + ' 条<span class="srcpop-x" title="关掉">✕</span></div>'
    + hits.map(function (h, i) {
      return '<button type="button" class="srcpop-i" data-i="' + i + '">'
        + '<b>[' + (i + 1) + '] ' + esc(aiSrcName(h)) + (h.page ? ' 第 ' + h.page + ' 页' : '') + '</b>'
        + '<span>' + esc(String(h.head || h.snip || '').slice(0, 90)) + '</span></button>';
    }).join('');
  document.body.appendChild(box);
  AI_SRC_PANEL = box;
  const r = anchor.getBoundingClientRect(), br = box.getBoundingClientRect();
  let x = Math.min(r.left, window.innerWidth - br.width - 8);
  let y = r.bottom + 6;
  if (y + br.height > window.innerHeight - 8) y = Math.max(8, r.top - br.height - 6);
  box.style.left = Math.max(8, x) + 'px';
  box.style.top = y + 'px';
  box.querySelector('.srcpop-x').onclick = close;
  Array.prototype.forEach.call(box.querySelectorAll('.srcpop-i'), function (b) {
    b.onclick = function () {
      const h = hits[+b.getAttribute('data-i')];
      if (!h) return;
      close();
      aiSrcModal(h);
    };
  });
  setTimeout(function () {
    document.addEventListener('click', function onDoc(e) {
      if (!AI_SRC_PANEL) { document.removeEventListener('click', onDoc, true); return; }
      if (AI_SRC_PANEL.contains(e.target)) return;
      close(); document.removeEventListener('click', onDoc, true);
    }, true);
  }, 0);
}
/* 原文弹窗：整节正文，可滚动 */
function aiSrcModal(h) {
  const old = document.getElementById('srcModal');
  if (old) old.remove();
  const full = String(h.full || h.text || h.snip || '');
  const m = document.createElement('div');
  m.className = 'mask show srcmodal';
  m.id = 'srcModal';
  m.innerHTML = '<div class="sheet srcsheet"><div class="srcsheet-h">《' + esc(aiSrcName(h)) + '》'
    + (h.page ? '第 ' + h.page + ' 页' : '') + (h.head ? '　·　' + esc(h.head) : '')
    + '<span class="srcsheet-x" title="关掉">✕</span></div><div class="srcsheet-b">' + aiPdfBlockHtml(h, full) + '</div></div>';
  document.body.appendChild(m);
  aiBindPdfInline(m);
  const close = function () { m.remove(); };
  m.querySelector('.srcsheet-x').onclick = close;
  m.addEventListener('click', function (ev) { if (ev.target === m) close(); });
  document.addEventListener('keydown', function esc2(ev) {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc2, true); }
  }, true);
}
window.aiSrcPanel = aiSrcPanel;
window.aiSrcModal = aiSrcModal;
/* 调试/探针用：直接塞一批 hits，看资料面板长什么样。
   ⚠️ 千万不要再叫 window.aiSrcHits —— 下面那个同名函数（aiSrcHits(v)，把 {hits,ts} / 裸数组都认成数组）
   才是 aiSrcNorm / aiSrcMergeIn / aiSrcFor 依赖的真身；顶层函数声明在全局对象上是可写的，
   在这里给它赋值会把它整个顶掉，于是 {hits,ts} 被当成数组去 .slice()，
   报错原文「(h || []).slice is not a function」，云同步整条跟着失败（web178 踩过）。 */
window.aiSrcDebugHits = function (h) { AI_SRC_HITS = Array.isArray(h) ? h.slice() : []; };
function aiPaintSrc(host, ctx) {
  const box = host.querySelector('.aisrc');
  if (!box) return;
  if (ctx && ctx.hits) ctx = Object.assign({}, ctx, { hits: aiUniqHits(ctx.hits) });
  if (!ctx || !ctx.hits || !ctx.hits.length) {
    box.innerHTML = (typeof kbList === 'function' && kbList().length)
      ? '<span class="small muted">本次没用知识库（没勾选，或没命中相关内容）</span>'
      : '';
    AI_SRC_HITS = [];
    aiSrcJump(0, '');
    return;
  }
  const sig = aiSrcSig(ctx.hits);
  AI_SRC_HITS = ctx.hits.slice();
  aiSrcJump(ctx.hits.length, ctx.hits.map(h => aiSrcName(h)).slice(0, 4).join('、'));
  box.innerHTML = '参考资料：' + ctx.hits.map((h, i) => {
    const pg = h.page ? ' 第 ' + h.page + ' 页' : '';
    const tip = (h.head ? h.head + '　' : '') + (h.snip || '');
    return '<span class="aitag" data-src="' + i + '" title="' + esc(tip) + '">[' + (i + 1) + '] ' + esc(aiSrcName(h)) + pg + '</span>';
  }).join('') + (ctx.note ? ' <span class="small muted">（' + esc(ctx.note) + '）</span>' : '');
  /* 点标签展开这一节的完整原文（不是截取的那几百字）——做题时直接看讲义原话 */
  const openHit = (i, el) => {
    const h = ctx.hits[i];
    if (!h) return;
    const cur = box.querySelector('.aisrc-full');
    if (cur) cur.remove();
    box.querySelectorAll('.aitag').forEach(x => x.classList.remove('on'));
    const full = String(h.full || h.text || '');
    const d = document.createElement('div');
    d.className = 'aisrc-full';
    d.dataset.i = String(i);
    d.innerHTML = '<div class="small muted" style="margin:0 0 6px">《' + esc(aiSrcName(h)) + '》'
      + (h.page ? '第 ' + h.page + ' 页' + (h.pages ? '（共 ' + h.pages + ' 页）' : '') : '')
      + (h.head ? '　·　' + esc(h.head) : '') + '</div>'
      + aiPdfBlockHtml(h, full);
    box.appendChild(d);
    aiBindPdfInline(d);
    if (el) el.classList.add('on');
    AI_SRC_OPEN[sig] = i;                      /* 记下来：万一页面重画（云同步等），自动展开回去 */
  };
  box.querySelectorAll('.aitag').forEach(el => {
    el.onclick = () => {
      const i = +el.dataset.src;
      const cur = box.querySelector('.aisrc-full');
      if (cur && cur.dataset.i === String(i)) { cur.remove(); el.classList.remove('on'); delete AI_SRC_OPEN[sig]; return; }
      openHit(i, el);
    };
  });
  /* 上一次是展开着的（多半是云同步把页面重画了）：直接展回去，不用再点一次 */
  if (AI_SRC_OPEN[sig] != null && ctx.hits[AI_SRC_OPEN[sig]]) {
    const el = box.querySelector('.aitag[data-src="' + AI_SRC_OPEN[sig] + '"]');
    openHit(AI_SRC_OPEN[sig], el);
  }
}
async function aiRun(host, userQ) {  const st = AI_LAST[host.dataset.aiid];
  if (!st || st.running) return;
  if (!AIC.base || !AIC.model) { aiState(host, '先在「设置 / 知识库」里填接口地址和模型', 'bad'); return; }
  const fresh = !userQ;
  if (fresh) { st.text = ''; st.msgs = []; st.hist = []; st.curQ = ''; }
  else if (st.text) {                       /* 追问：先把上一轮收进历史，免得被新回答顶掉 */
    st.hist = st.hist || [];
    st.hist.push({ q: st.curQ || '', a: st.text });
  }
  st.curQ = userQ || '';
  st.running = true; st.ctl = new AbortController();
  st.host = host; st.sels = aiSels(host, st.k); st.ts = Date.now(); st.endTs = 0;
  const H = () => (aiFindHost(st) || host);       /* 重画之后画到「当前活着的那个宿主」里，流不会断 */
  H().querySelector('.ai-stop').disabled = false;
  H().querySelector('.ai-go').disabled = true;
  aiState(H(), '正在准备资料库…');
  /* 首次用要下 4.8MB 知识库 + 建索引：这里每半秒把进度写到面板上，
     不然那几十秒里界面一动不动，看着就像卡死了（用户 2026-10-16 报的）。 */
  const progT = setInterval(() => {
    try {
      const t = (typeof kbProgressText === 'function') ? kbProgressText() : '';
      aiState(H(), t || '正在检索资料…');
    } catch (e) {}
  }, 500);
  let ctx = { hits: [], text: '', count: 0 };
  try { ctx = await aiContext(st.q, userQ); } catch (e) {} finally { clearInterval(progT); }
  const rec = aiMyRecText(st.k);
  if (!st.msgs.length) {
    const u = aiUserText(st.q, ctx.text, userQ, st.k) + (rec ? '\n\n' + rec : '');
    st.msgs = [{ role: 'system', content: aiSysText() }, { role: 'user', content: u }];
  } else {
    st.msgs.push({ role: 'user', content: (ctx.text ? '【参考资料】\n' + ctx.text + '\n\n' : '') + (userQ || '继续') });
  }
  st.ctx = ctx;
  aiPaintSrc(H(), ctx);
  aiPaintHist(H());
  aiPaintOut(H(), fresh ? '' : st.text, true);
  try { aiPaintFollow(H(), false); } catch (e) {}   /* §3.6-P1⑤：重新生成时先把上一轮的快捷追问收起来 */
  aiState(H(), ctx.count ? ('已取 ' + ctx.count + ' 段资料，正在生成…') : '正在生成…');
  try {
    const full = await aiChat(st.msgs, (txt, rz) => {
      const h = H();
      /* 面板连宿主都没了（用户切页 / 把面板关了）：请求立刻中止，别在后台白烧 token
         —— 顺带把 st.running 收掉，否则「生成中」会一直挂着、答题快捷键也一直被锁 */
      if (!h || !h.isConnected) { try { st.ctl.abort(); } catch (e) {} return; }
      st.text = txt; st.reason = rz || st.reason;
      if (!txt && st.reason) {                       /* 推理模型在「想」的阶段：别让框子看起来是死的 */
        const o = h.querySelector('.aiout');
        if (o) o.innerHTML = '<span class="small muted">模型正在思考…（已想 ' + st.reason.length + ' 字）</span>';
        aiState(h, '正在思考…', '');
        return;
      }
      aiPaintOut(h, txt);
    }, st.ctl.signal);
    st.text = full || st.text;
    let onlyReason = false;
    if (!st.text && st.reason) {                     /* 正文为空但有思考过程：把这个情况说清楚 */
      st.text = st.reason; st.reason = ''; onlyReason = true;
    }
    st.msgs.push({ role: 'assistant', content: st.text });
    aiPaintOut(H(), st.text, true);
    if (onlyReason) aiState(H(), '模型只回了思考过程，没给正文，点「继续问」试试', 'bad');
    else aiState(H(), st.text ? ('完成' + aiTempNoteText()) : '模型没返回内容', st.text ? 'ok' : 'bad');
  } catch (e) {
    const c = aiErrInfo(e);
    if (c.msg === '已停止') aiState(H(), '已停止', '');
    else {
      const out = H().querySelector('.aiout');
      if (out) out.innerHTML = '<span class="bad-text">AI 出错：' + esc(c.msg) + '</span><div class="small muted" style="margin-top:6px">' + esc(c.hint) + '</div>';
      aiState(H(), '出错', 'bad');
    }
  } finally {
    st.running = false; st.endTs = Date.now(); st.ts = Date.now();
    try { aiPaintFollow(H(), !!(st && st.text)); } catch (e) {}   /* §3.6-P1⑤：出完就给三个快捷追问 */
    try { H().querySelector('.ai-stop').disabled = true; H().querySelector('.ai-go').disabled = false; } catch (e) {}
  }
}
/* ---------- 存下来的「参考资料」 ----------
   AI 面板里那份参考资料（含「点开就是 PDF」）本来只活在这次会话里：一「存入本题解析」、面板一收就没了。
   所以保存时把命中的资料清单写进 qbank.aisrc.v1[题目key]（只存身份：库/文件/页码/标题/一句摘要，
   不存正文 —— 正文在 知识库.js 和 PDF 里，存一份反而废空间），以后在解析下面用同一套渲染画出来，
   不用重新跑一次 AI 也能看 PDF。 */
const AISRC_LS = 'qbank.aisrc.v1';
function aiSrcAll() { try { return JSON.parse(localStorage.getItem(AISRC_LS) || '{}') || {}; } catch (e) { return {}; } }
/* 存量格式有两种：老的是裸数组 all[题号] = [hit,…]，现在换成 all[题号] = { hits, ts }
   （ts 是云同步按时间戳合并用的；老数据读出来当 ts=0，下次再存就升级成新格式） */
function aiSrcHits(v) { return Array.isArray(v) ? v : ((v && Array.isArray(v.hits)) ? v.hits : []); }
function aiSrcTs(v) { return Array.isArray(v) ? 0 : (+((v || {}).ts) || 0); }
function aiSrcSaveFor(k, hits) {
  if (!k || !hits || !hits.length) return false;
  const all = aiSrcAll();
  all[k] = {
    hits: aiUniqHits(hits).slice(0, 8).map(h => ({
      kb: h.kb, file: h.file || '', page: h.page, pdfp: h.pdfp, pages: h.pages,
      doc: h.doc, head: h.head, snip: String(h.snip || '').slice(0, 160)
    })),
    ts: Date.now()
  };
  /* 跟解析 / 便签一样走「合并写入」：多标签不互盖，删除才能跟着墓碑走 */
  if (typeof mergeWrite === 'function') return mergeWrite(AISRC_LS, all, 'aisrc') !== false;
  try { localStorage.setItem(AISRC_LS, JSON.stringify(all)); return true; } catch (e) { return false; }
}
function aiSrcFor(k) { return aiSrcHits(aiSrcAll()[k]); }
/* 解析被删掉时就把它一起清掉（下面那个 tombAdd 包装会在 tombAdd('note', 键) 时叫到这里），
   并且记一笔墓碑 —— 否则别的设备一同步，云端的旧副本又把它带回来了 */
function aiSrcDrop(k) {
  if (!k) return;
  const all = aiSrcAll();
  if (Object.prototype.hasOwnProperty.call(all, k)) {
    delete all[k];
    try { localStorage.setItem(AISRC_LS, JSON.stringify(all)); } catch (e) {}
  }
  if (typeof tombAdd === 'function') { try { tombAdd('aisrc', k); } catch (e) {} }
}
/* 云同步用：规范形状（老数组格式顺手升级），以及把云端那份并进本机（同一条按 ts 新的为准）*/
function aiSrcNorm() {
  const all = aiSrcAll(), out = {};
  Object.keys(all).forEach(k => {
    const hits = aiSrcHits(all[k]);
    if (hits.length) out[k] = { hits: hits, ts: aiSrcTs(all[k]) };
  });
  return out;
}
function aiSrcMergeIn(map) {
  if (!map || typeof map !== 'object') return 0;
  const mine = aiSrcAll();
  let added = 0;
  Object.keys(map).forEach(k => {
    const th = map[k], hits = aiSrcHits(th);
    if (!hits.length) return;
    const mi = mine[k];
    if (!mi) { mine[k] = { hits: hits, ts: aiSrcTs(th) }; added++; return; }
    if (aiSrcTs(th) > aiSrcTs(mi)) mine[k] = { hits: hits, ts: aiSrcTs(th) };
  });
  if (typeof mergeWrite === 'function') mergeWrite(AISRC_LS, mine, 'aisrc');
  else { try { localStorage.setItem(AISRC_LS, JSON.stringify(mine)); } catch (e) {} }
  return added;
}
try {
  const _tombAdd = window.tombAdd;
  if (typeof _tombAdd === 'function' && !_tombAdd.__aiSrcWrapped) {
    const wrapped = function (kind, key) {
      const out = _tombAdd.apply(this, arguments);
      try { if (kind === 'note') aiSrcDrop(key); } catch (e) {}
      return out;
    };
    wrapped.__aiSrcWrapped = true;
    window.tombAdd = wrapped;
  }
} catch (e) {}
/* 解析下面那行参考资料：就地画出来（数据是存下来的，不需要重新生成） */
function aiSrcPaintFor(container, k) {
  if (!container || !container.querySelector || !k) return;
  /* 容器本身可能就是那个 .aisrc-saved（richBindAll 就是拿它当 host 传进来的），先认一下自己 */
  const box = (container.classList && container.classList.contains('aisrc-saved'))
    ? container : container.querySelector('.aisrc-saved');
  if (!box) return;
  const hits = aiSrcFor(k);
  if (!hits.length) { box.innerHTML = ''; return; }
  let inner = box.querySelector('.aisrc');
  if (!inner) {
    inner = document.createElement('div');
    inner.className = 'aisrc';
    box.appendChild(inner);
  }
  aiPaintSrc(box, { hits: hits });
}
function aiSaveOut(host) {
  const st = AI_LAST[host.dataset.aiid];
  if (!st) { toast('这个面板过期了，重新点一下「AI 解析」', 2600, 'bad'); return; }
  const text = (st.text || '').trim();
  /* 以前这里没内容就直接 return，用户看到的就是「点了没反应」（实测反馈）。现在都给一句话。 */
  if (!text) {
    const sb = host.querySelector('.ai-save');
    if (sb) { sb.disabled = false; }
    toast(st.running ? '还在生成中，等它写完再存' : '还没有内容：先点上面的「生成解析」', 2800, 'bad');
    return;
  }
  if (typeof st.onUse === 'function') {
    if (st.k && st.ctx && st.ctx.hits && st.ctx.hits.length) aiSrcSaveFor(st.k, st.ctx.hits);
    st.onUse(text); toast('已写进解析框，记得点保存', 2600); return;
  }
  if (!st.k || typeof NOTES === 'undefined') { toast('这道题没有可保存的位置', 2600, 'bad'); return; }
  /* 页面上那条解析自己的键：套卷 / 临时卷 / 编辑态下有可能跟面板的键不是一个
     （用户 2026-10-16 报「按了无数下，上面那条解析不变」）。不管谁对，
     两边的键都写一份 —— 保证眼前这条一定更新。 */
  let extraKey = '';
  try {
    const wraps = document.querySelectorAll('.exp-wrap[data-note-for]');
    if (wraps.length === 1) {                    /* 只有页面上只有一条解析时才敢这么做（答题页就是）*/ 
      const k2 = wraps[0].getAttribute('data-note-for');
      if (k2 && k2 !== st.k) extraKey = k2;
    }
  } catch (e) {}
  if (st.ctx && st.ctx.hits && st.ctx.hits.length) { try { aiSrcSaveFor(st.k, st.ctx.hits); if (extraKey) aiSrcSaveFor(extraKey, st.ctx.hits); } catch (e) {} }   /* 参考资料跟着解析一起存下（出错也不拦存正文） */
  const old = NOTES[st.k] || {};
  NOTES[st.k] = { text: text, imgs: old.imgs || [], ts: Date.now(), ai: true };
  if (extraKey) {
    const o2 = NOTES[extraKey] || {};
    NOTES[extraKey] = { text: text, imgs: o2.imgs || [], ts: Date.now(), ai: true };
  }
  if (!saveNotes()) { toast('保存失败：浏览器存储满了', 2800, 'bad'); return; }
  // 让主区域重新拿回滚动权：存完/重画完，如果焦点落在了可编辑的解析文字里（触屏上会变成选文字），就放开它
  try {
    const ae = document.activeElement;
    if (ae && ae.isContentEditable) ae.blur();
  } catch (e) {}
  toast('已存为本题解析（' + text.length + ' 字）');
  const stid = st.id;
  if (typeof render === 'function') render();
  /* 重画之后（面板会被 aiReopenFor 恢复回来）就地给一个看得见的确认：
     按钮变字 + 面板里多一行「存哪去了」并滚到眼前 —— 之前只在底部弹一下就没了，
     用户看着面板会以为「点了没反应」（2026-10-16 实测反馈）。 */
  setTimeout(() => {
    try {
      const h2 = document.querySelector('[data-aiid="' + stid + '"]') || host;
      const sb = h2.querySelector('.ai-save');
      if (sb) { sb.textContent = '✓ 已存入本题解析'; sb.disabled = true; }
      if (h2.querySelector('.ai-saved-tip')) return;
      const tip = document.createElement('div');
      tip.className = 'small muted ai-saved-tip';
      tip.style.cssText = 'margin:6px 0 0;color:var(--ok)';
      tip.textContent = '✓ 已存进本题解析 —— 就在本题下面的「解析」里（同步、备份都会带上它）';
      const panel = h2.querySelector('.aipanel') || h2;
      panel.appendChild(tip);
      try { tip.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      /* 再把页面上那条解析本身滚到眼前 + 闪一下 —— 用户说「按了好几次、上面都不更新」，
         其实就是存在下面而人没看到；顺便当个自检：找不到解析块就把键打在提示里。 */
      try {
        const key = String(st.k || '');
        const wrap = document.querySelector('.exp-wrap[data-note-for="' + key.replace(/"/g, '\\"') + '"]');
        if (wrap) {
          /* 不再依赖「重画」：直接把正文写进页面上那条解析里（storage 里也已经写了一份）。
             用户 2026-10-16 报「存了但上面不变」——不管中间哪一步抽风，这一步能把眼前这条改成新内容。 */
          setTimeout(() => {
            try {
              const ed = document.querySelector('.exp.rich-edit[data-note-for="' + key.replace(/"/g, '\\"') + '"]');
              if (ed && typeof renderRich === 'function') {
                ed.innerHTML = renderRich(key, text);
                const lb = wrap.querySelector('.lb');
                if (lb && lb.textContent.indexOf('自定义') < 0) lb.textContent = (lb.textContent || '解析').replace(/：\s*$/, '') + '（自定义）：';
              }
            } catch (e) {}
            try { wrap.scrollIntoView({ block: 'center' }); } catch (e) {}
            wrap.style.transition = 'box-shadow .25s';
            const prev = wrap.style.boxShadow;
            wrap.style.boxShadow = '0 0 0 2px var(--ok)';
            setTimeout(() => { wrap.style.boxShadow = prev || ''; }, 1800);
          }, 120);
          tip.textContent = '✓ 已存进本题解析（键 ' + (key || '?') + (extraKey ? ' + ' + extraKey : '') + ' · ' + text.length + ' 字）—— 就是下面这条（已经滚过去闪了一下）';
        } else {
          tip.textContent = '✓ 已存进本题解析（键 ' + (key || '?') + (extraKey ? ' + ' + extraKey : '') + ' · ' + text.length + ' 字）—— 页面上没找到对应的解析块';
        }
      } catch (e) {}
      setTimeout(() => { if (sb) { sb.disabled = false; sb.textContent = h2.dataset.aiuse === '1' ? '写进解析框' : '存入本题解析'; } if (tip.isConnected) tip.remove(); }, 6000);
    } catch (e) {}
  }, 80);
}
function aiCopy(t, host) {
  if (!t) { toast('还没有内容'); return; }
  const done = () => { if (host) aiState(host, '已复制', 'ok'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(done, () => aiCopyFallback(t, done));
  } else aiCopyFallback(t, done);
}
function aiCopyFallback(t, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (done) done();
  } catch (e) { toast('复制失败，请手动选中'); }
}

/* ---------- #/kb 页面：AI 配置 + 知识库 + 试用说明 ---------- */
function aiConfigHtml() {
  const L = [];
  L.push('<div class="card kbcard">');
  L.push('<div class="kbhead">① AI 服务 <span class="small muted">配置只存在本机浏览器，不会上传</span></div>');
  L.push('<div class="tools"><span class="tl">服务</span><select class="num" id="aiPreset"></select>');
  L.push('<button class="btn" id="aiTestBtn">测试连接</button>');
  L.push('<button class="btn" id="aiDetectBtn" title="自动扫描本机常见的 AI 服务（Ollama 11434 / LM Studio 1234 / 8080 / 8000）">自动检测本机服务</button>');
  L.push('<button class="btn" id="aiReloadCfg" title="重新读取站点目录里的 AI配置.js（可选，见《使用说明.md》）">重新读取 AI配置.js</button>');
  L.push('<button class="btn" id="aiWipe" title="清掉这台电脑浏览器里存的那份配置（接口地址 / 模型 / API Key）。站点文件里本来就没有你的 Key。">清空本机配置</button>');
  L.push('<span class="aistate" id="aiState"></span></div>');
  L.push('<div class="tools"><span class="tl">接口地址</span><input class="num grow" id="aiBase" placeholder="http://127.0.0.1:11434/v1"></div>');
  L.push('<div class="tools"><span class="tl">模型</span><input class="num grow" id="aiModel" list="aiModelList" placeholder="qwen2.5:7b"><datalist id="aiModelList"></datalist>');
  L.push('<button class="btn" id="aiGetModels">拉取模型列表</button></div>');
  L.push('<div class="small muted" id="aiModelHint"></div>');
  /* 拉到的模型做成一条看得见、点得动的列表（原来只塞进 datalist：得先点一下模型框才弹出来，等于看不见） */
  L.push('<div id="aiModelPick" style="display:none">'
    + '<span class="tl">可选的模型</span>'
    + '<select class="inp" id="aiModelSel"></select>'
    + '<input class="inp" id="aiModelFilter" placeholder="筛一下（几个字）" title="模型多的时候按关键字筛">'
    + '<span class="small muted ai-model-hint" id="aiModelCount"></span></div>');
  L.push('<div class="tools"><span class="tl">API Key</span><input class="num grow" id="aiKey" type="password" placeholder="本地模型留空就行"><button class="btn" id="aiKeyShow">显示</button></div>');
  L.push('<div class="tools"><span class="tl">温度</span><input class="num" id="aiTemp" type="number" min="0" max="2" step="0.1" style="width:78px">'
    + '<span class="small muted" id="aiTempTip"></span>');
  L.push('<span class="tl" title="每次回答问题，从知识库里捞几段资料给它当参考。片段本身最长约 560 字；一般 4 段够用，想让 AI 多做对比就 5~6 段。">检索片段数</span><input class="num" id="aiTopK" type="number" min="0" max="12" step="1" style="width:78px">');
  L.push('<span class="tl" title="这些参考资料加起来最多送给模型多少字。要跟上面的片段数配套：片段数 × 620 字以内才不会被截断。">资料上限</span><input class="num" id="aiMaxChars" type="number" min="600" max="20000" step="200" style="width:92px">');
  L.push('<label class="chk"><input type="checkbox" id="aiStream"> 流式输出</label></div>');
  L.push('<div class="small muted" id="aiRagTip"></div>');
  L.push('<div class="row" style="margin-top:6px"><span class="tl" title="填了就启用向量检索（知识库混合检索里的向量票）。要填服务端支持 /embeddings 的模型名，例如 text-embedding-3-small、bge-m3、nomic-embed-text。留空＝只用本地轻量字符向量（不联网、不花钱，但只能补词形相近）。">向量模型</span><input class="txt" id="aiEmbModel" placeholder="留空＝只用本地轻量向量" style="flex:1"></div>');
  L.push('<div class="tools"><label class="chk"><input type="checkbox" id="aiExpand"> 检索前让模型把题目扩写成几组检索词</label>'
    + '<label class="chk"><input type="checkbox" id="aiRerank"> 让模型给捞回来的段落重排</label></div>');
  L.push('<div class="small muted" id="aiSearchTip"></div>');
  L.push('<div class="tools"><span class="tl">额外要求（可选）</span><input class="num grow" id="aiSys" placeholder="例如：只讲 B 为什么错 / 用表格对比四个选项 / 200 字内"></div>');
  L.push('<div class="tools"><label class="chk"><input type="checkbox" id="aiTmpl"> 套用「答案 / 为什么 / 其它选项 / 易错点」模板</label><span class="small muted">不勾就完全按你的要求写，不套任何固定格式</span></div>');
  L.push('<div class="small muted" id="aiTip"></div>');
  L.push('<div class="small" id="aiCfgNote"></div>');
  L.push('</div>');
  return L.join('');
}
function aiHelpHtml() {
  const L = [];
  L.push('<div class="card kbcard">');
  L.push('<div class="kbhead">④ 怎么用</div>');
  L.push('<div class="small">1）先在①里配好 AI：<b>没有任何模型</b>就先装 <a href="https://ollama.com/download" target="_blank" rel="noopener">Ollama</a>，装完在命令行跑 <code>ollama pull qwen2.5:7b</code>，然后点「测试连接」。</div>');
  L.push('<div class="small" style="margin-top:6px">2）在②里建知识库：小资料直接粘贴或导入 txt/md；<b>整本书</b>放到站点目录的 <code>资料/</code> 里，双击 <code>转知识库.bat</code>，刷新页面就会自动出现。</div>');
  L.push('<div class="small" style="margin-top:6px">3）做题时点题目下方的「AI 解析」：它会先用③里能命中的资料片段当参考，再让模型写解析；满意就点「存入本题解析」。</div>');
  L.push('<div class="small" style="margin-top:6px">4）AI 面板顶上那排就是 <b>选知识库</b>：标签前面写着「<b>用哪些资料</b>」，<b>点一下亮 / 再点灭</b>，能多选；第一个 <b>总库 · 全部</b> 是一键全选；一个都不选就是纯靠模型知识回答（右边会有小字提醒）。你选过之后会记住，下次打开还是这些。</div>');
  L.push('<div class="small" style="margin-top:6px">5）<b>自带资料库 / 加自己的书</b>：这个站点已经内置 5 个资料库（外科 86 篇、内科 76 篇、生化 34 篇、生理 12 篇、病理 27 篇，共 235 篇、约 184 万字），在②里能看到、能单独勾选。要把自己的书加进来：丢进站点目录的 <code>资料\</code> 文件夹，双击 <code>转知识库.bat</code>（需要 Python），刷新网页就有——重跑是<b>合并</b>的：同一个库按 id 替换、别的库保留，每个文件算 md5，没改过的直接复用（想整份重来加 <code>--overwrite</code>）；也可以在②里直接粘贴文本建小库。如果你也在用 Chatbox，双击 <code>从Chatbox导入.bat</code> 可以把它的 API Key/模型和各个知识库一并搬过来。</div>');
  L.push('<div class="small" style="margin-top:6px">6）Chatbox 本体没有对外接口（无端口/无命令行），所以刷题站没法替你点它。要用 Chatbox 答，就在面板上点 <b>复制提问</b>：题目＋命中资料＋要求都复制走，粘进 Chatbox 问，再把答案贴回「写解析」即可。</div>');
  L.push('<div class="small muted" style="margin-top:8px">隐私：资料只在你的电脑上；用本地 Ollama 时一个字都不出网。用云端 API 时，只把命中的那几段资料连同题目发出去。</div>');
  L.push('<div class="small muted" style="margin-top:4px">出问题看 <code>使用说明.md</code>（先看这份）和 <code>AI知识库说明.md</code>：里面写了怎么配 API、Ollama 跨域设置、用 <code>本地服务器.bat</code> 打开站点、Word/PDF 怎么转文字。</div>');
  L.push('</div>');
  return L.join('');
}
function aiFillModels(ids) {
  ids = (ids || []).map(String).filter(Boolean);
  const dl = $('aiModelList');
  if (dl) dl.innerHTML = ids.map(i => '<option value="' + esc(i) + '"></option>').join('');
  if (ids.length) AIC.models = ids.slice(0, 500);            /* 记下来：重画 / 下次进来还在 */
  if (ids.length && !AIC.model) { AIC.model = ids[0]; if ($('aiModel')) $('aiModel').value = ids[0]; aiSave(); }
  else if (ids.length) aiSave();
  aiPaintModelPick(ids.length ? ids : (AIC.models || []));
}
/* 画那条可点选的模型列表（筛过的、没筛的都走这里） */
function aiPaintModelPick(ids) {
  const box = $('aiModelPick'), sel = $('aiModelSel');
  if (!box || !sel) return;
  ids = (ids || []).map(String).filter(Boolean);
  if (!ids.length) { box.style.display = 'none'; return; }
  box.style.display = '';
  const fEl = $('aiModelFilter');
  const f = (fEl && fEl.value ? fEl.value : '').trim().toLowerCase();
  const list = f ? ids.filter(x => x.toLowerCase().indexOf(f) >= 0) : ids;
  sel.innerHTML = list.length
    ? list.map(i => '<option value="' + esc(i) + '"' + (i === AIC.model ? ' selected' : '') + '>' + esc(i) + '</option>').join('')
    : '<option value="">（没有匹配的）</option>';
  if (list.length && !list.some(i => i === AIC.model)) sel.value = list[0];
  const cnt = $('aiModelCount');
  if (cnt) cnt.textContent = '共 ' + ids.length + ' 个'
    + (f ? '，筛出 ' + list.length + ' 个' : '')
    + '（点一下就换成它' + (AIC.model ? '；现在是 ' + AIC.model : '') + '）';
}
function aiReadForm() {
  const v = id => { const el = $(id); return el ? el.value : undefined; };
  if (v('aiBase') != null) AIC.base = (v('aiBase') || '').trim();
  if (v('aiModel') != null) AIC.model = (v('aiModel') || '').trim();
  if (v('aiKey') != null) AIC.key = v('aiKey');
  if (v('aiTemp') != null) AIC.temp = +v('aiTemp') || 0;
  if (v('aiTopK') != null) AIC.topK = Math.max(0, Math.min(12, +v('aiTopK') || 0));
  if (v('aiMaxChars') != null) AIC.maxChars = Math.max(600, Math.min(20000, +v('aiMaxChars') || 3500));
  if ($('aiStream')) AIC.stream = !!$('aiStream').checked;
  if (v('aiEmbModel') != null) { writeLS('qbank.kb.embmodel.v1', String(v('aiEmbModel') || '').trim()); if (typeof kbEmbSetModel === 'function') kbEmbSetModel(v('aiEmbModel')); }
  if ($('aiExpand')) AIC.expand = !!$('aiExpand').checked;
  if ($('aiRerank')) AIC.rerank = !!$('aiRerank').checked;
  if ($('aiTmpl')) AIC.tmpl = !!$('aiTmpl').checked;
  if (v('aiSys') != null) AIC.sys = (v('aiSys') || '').trim();
  AIC.cfgAuto = false;        /* 你自己改过，就不再让 AI配置.js 覆盖 */
  aiSave();
  aiPaintTempTip();
  if (typeof aiRagTip === 'function') aiRagTip();
}
/* 「检索片段数 × 资料上限」的实时提示：知识库一个片段最长约 560 字，这两个数要配套才不会白截 */
function aiRagTip() {
  const el = $('aiRagTip');
  if (!el) return;
  const k = Math.max(0, Math.min(12, +AIC.topK || 0));
  const mc = Math.max(600, +AIC.maxChars || 3500);
  if (!k) { el.innerHTML = '检索片段数 = 0：这次回答<b>不用知识库</b>，只靠模型自己知道的东西。'; return; }
  const per = Math.max(400, Math.floor(mc / k));
  const keep = Math.max(1, Math.floor(mc / 620));      /* 560 字正文 + 约 60 字出处行 */
  const fit = Math.max(1, Math.floor(mc / (per + 60)));  /* 截断后真正塞得进去几段 */
  if (per >= 620) {
    el.innerHTML = '当前配法：<b>' + k + ' 段</b>，每段最多 ' + per + ' 字（片段最长约 560 字，所以每段都是<b>整段</b>）→ 一次最多送出约 ' + (k * 620 / 1000).toFixed(1) + ' 千字参考资料。<b>这样是合适的。</b>';
  } else {
    el.innerHTML = '<span class="aistate bad">当前配法：' + k + ' 段，但每段只剩 ' + per + ' 字</span> → 片段本身有 500 多字，会<b>被截断</b>；而且总量一到 ' + mc + ' 字就停，实际只进得去约 ' + fit + ' 段（还都是残段）。想每段都完整：把「检索片段数」降到 <b>' + keep + '</b>，或把「资料上限」提到 <b>' + (k * 620) + '</b> 字左右。';
  }
}
function aiPaintTempTip() {
  const el = $('aiTempTip');
  if (!el) return;
  el.textContent = aiTempFixed(AIC.model) ? '这个模型只收 1（已经自动按 1 走了）' : '';
}
function aiPaintForm() {
  const sel = $('aiPreset');
  if (sel) {
    sel.innerHTML = Object.keys(AI_PRESETS).map(p => '<option value="' + p + '">' + esc(AI_PRESETS[p].label) + '</option>').join('');
    sel.value = AIC.preset || 'ollama';
  }
  const set = (id, v) => { const el = $(id); if (el) el.value = v == null ? '' : v; };
  set('aiBase', AIC.base); set('aiModel', AIC.model); set('aiKey', AIC.key);
  set('aiTemp', AIC.temp); set('aiTopK', AIC.topK); set('aiMaxChars', AIC.maxChars); set('aiSys', AIC.sys || '');
  set('aiEmbModel', readLS('qbank.kb.embmodel.v1', ''));
  aiPaintTempTip();
  if ($('aiTmpl')) $('aiTmpl').checked = !!AIC.tmpl;
  const ms = (AI_PRESETS[AIC.preset] || {}).models || [];
  const known = (AIC.models && AIC.models.length) ? AIC.models.slice() : ms;
  if (ms.length && !(AIC.models && AIC.models.length)) aiFillModels(ms);   /* 常用模型名直接进下拉，不用先联网拉 */
  else aiPaintModelPick(known);                                            /* 拉过的清单：重画也在 */
  if ($('aiModelHint')) $('aiModelHint').innerHTML = ms.length
    ? '这个服务常用的模型：' + ms.map(m => '<code>' + esc(m) + '</code>').join(' / ') + '（也可以点「拉取模型列表」拿服务端真实可用的名字，拉到的名字会列在下面，点一下就选中。）'
    : '点「拉取模型列表」可以从服务端拿真实可用的模型名（本地服务要先启动）；拉到的名字会列在下面，点一下就选中。';
  if ($('aiStream')) $('aiStream').checked = !!AIC.stream;
  if ($('aiExpand')) $('aiExpand').checked = AIC.expand !== false;
  if ($('aiRerank')) $('aiRerank').checked = AIC.rerank !== false;
  if ($('aiSearchTip')) $('aiSearchTip').innerHTML = (AIC.expand !== false || AIC.rerank !== false)
    ? '上面两个开关是治「检索回来的东西跟题目对不上」的：关键词检索只能碰相同的字，'
      + '资料里写「切除修复」、你问「怎么修」就找不到。开着它们，会先用一次模型调用把你的题目换成教材会用的说法再查（扩写），'
      + '再把捞回来的候选段落给模型过一眼、重排顺序（重排）。贵不了多少，但慢几秒；本地 7B 模型嫌慢就关掉重排。'
      + '模型报错或超时（这一阶段合计最多等 12 秒）会自动退回纯关键词检索，不会卡住回答。'
    : '<span class="muted">两个开关都关着：只用关键词检索，最快，但资料里换了说法就找不到。</span>';
  if ($('aiTip')) $('aiTip').textContent = (AI_PRESETS[AIC.preset] || {}).tip || '';
  if (typeof aiRagTip === 'function') aiRagTip();
  if ($('aiCfgNote')) {
    if (window.__AICFG__ && AIC.cfgAuto !== false) {
      $('aiCfgNote').innerHTML = '<span class="aistate ok">已从 AI配置.js 自动填好</span>（生成于 ' + esc(window.__AICFG__.at || '') + '，来源：' + esc(window.__AICFG__.provider || '') + '）。在这里改过任意一项后，它就不再自动覆盖；想重新读入点上面的按钮。';
    } else if (window.__AICFG__) {
      $('aiCfgNote').innerHTML = '<span class="muted">AI配置.js 在，但你手改过配置，当前用手填的；点「重新读取 AI配置.js」可以再切回去。</span>';
    } else {
      $('aiCfgNote').innerHTML = '<span class="muted">想省事：用上面①里的「服务」下拉选一个（DeepSeek / Kimi），把 API Key 粘进去，点「测试连接」就行 —— 配置只存在这台电脑的浏览器里。也可以照《使用说明.md》把 <code>AI配置.示例.js</code> 改名成 <code>AI配置.js</code> 预置好；装了 Chatbox 的话双击 <code>从Chatbox导入.bat</code> 也能自动填。</span>';
    }
  }
}
function aiBindConfig() {
  on('aiPreset', e => {
    const p = e.target.value;
    AIC.preset = p;
    const def = AI_PRESETS[p] || {};
    if (def.base) AIC.base = def.base;
    const ms = def.models || [];
    /* 换了服务就把模型也换成这个服务能用的：现在填的名字不在清单里就换成默认的 */
    if (ms.length && ms.indexOf(AIC.model) < 0) AIC.model = (def.model && ms.indexOf(def.model) >= 0) ? def.model : ms[0];
    else if (!AIC.model && def.model) AIC.model = def.model;
    AIC.models = null;      /* 换了服务，上次拉到的清单就不作数了 */
    aiSave();
    aiPaintForm();          /* 地址、模型、下拉清单、提示一次性刷新 */
  }, 'change');
  on('aiModelSel', () => {
    const sel = $('aiModelSel');
    if (!sel || !sel.value) return;
    AIC.model = sel.value;
    const inp = $('aiModel'); if (inp) inp.value = sel.value;
    AIC.cfgAuto = false;
    aiSave();
    aiPaintModelPick(AIC.models || []);
    aiPaintTempTip();
    const st = $('aiState');
    if (st) { st.textContent = '模型已设成 ' + sel.value; st.className = 'aistate ok'; }
  }, 'change');
  on('aiModelFilter', () => { aiPaintModelPick(AIC.models || []); }, 'input');
  on('aiTmpl', aiReadForm, 'change');
  on('aiWipe', () => {
    if (!confirm('清空这台电脑的浏览器里保存的 AI 配置（接口地址 / 模型 / API Key）？\n\n注意：站点文件夹里本来就没有你的 Key；这里清掉的是浏览器里存的那份。')) return;
    try { localStorage.removeItem(AI_LS); } catch (e) {}
    AIC = {};
    Object.keys(AI_DEF).forEach(k => { AIC[k] = AI_DEF[k]; });
    aiSave();
    aiPaintForm();
    const st = $('aiState'); if (st) { st.textContent = '已清空本机配置'; st.className = 'aistate ok'; }
  });
  ['aiBase', 'aiModel', 'aiKey', 'aiTemp', 'aiTopK', 'aiMaxChars', 'aiSys', 'aiExpand', 'aiRerank', 'aiEmbModel'].forEach(id => on(id, aiReadForm, 'change'));
  on('aiStream', aiReadForm, 'change');
  on('aiTestBtn', aiTest);
  on('aiDetectBtn', () => aiDetect(false));
  on('aiReloadCfg', () => {
    aiLoadCfgFile();
    const c = window.__AICFG__;
    if (c) { aiApplyCfgFile(true); const st = $('aiState'); if (st) { st.textContent = '已从 AI配置.js 读入（' + (c.at || '') + '）'; st.className = 'aistate ok'; } }
    else { const st = $('aiState'); if (st) { st.textContent = '站点目录里没有 AI配置.js：在①里填一次就行（会记住），或用 AI配置.示例.js / 从Chatbox导入.bat。'; st.className = 'aistate bad'; } }
  });
  on('aiGetModels', async () => {
    aiReadForm();
    const st = $('aiState');
    if (st) { st.textContent = '拉取中…'; st.className = 'aistate'; }
    try {
      const ids = await aiModels();
      aiFillModels(ids);
      if (st) { st.textContent = '拿到 ' + ids.length + ' 个模型，在下面「可选的模型」里挑一个'; st.className = 'aistate ok'; }
    } catch (e) {
      const c = aiErrInfo(e);
      if (st) { st.textContent = c.msg + '　' + c.hint; st.className = 'aistate bad'; }
    }
  });
  on('aiKeyShow', () => { const el = $('aiKey'); if (el) el.type = el.type === 'password' ? 'text' : 'password'; });
}
/* ---------- #/kb 的四个标签页：① AI 服务 / ② 知识库 / ③ 试检索 / ④ 怎么用 ----------
   只切 display、不调 render()：切标签不丢已经填进表单的配置，也不会整页闪一下。
   当前标签只记在内存里（刷新回到①），不写 localStorage，免得云同步多带没用的东西。 */
let KB_TAB = 'cfg';
const KB_TABS = [['cfg', '① AI 服务'], ['kb', '② 知识库'], ['try', '③ 试检索'], ['help', '④ 怎么用']];
function kbPanId(k) { return 'kbPan' + k.charAt(0).toUpperCase() + k.slice(1); }
function kbTabsHtml() {
  return '<div class="kbtabs" id="kbTabs" role="tablist">' + KB_TABS.map(t =>
    '<button class="kbtab" type="button" role="tab" data-kbtab="' + t[0] + '"'
    + (KB_TAB === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + '</button>').join('') + '</div>';
}
function kbPanelsHtml() {
  const L = [];
  L.push('<div class="kbpanel" id="kbPanCfg">' + aiConfigHtml() + '</div>');
  L.push('<div class="kbpanel" id="kbPanKb">'
    + (typeof kbLibHtml === 'function' ? kbLibHtml() : (typeof kbSectionHtml === 'function' ? kbSectionHtml() : ''))
    + '</div>');
  L.push('<div class="kbpanel" id="kbPanTry">' + (typeof kbTryHtml === 'function' ? kbTryHtml() : '') + '</div>');
  L.push('<div class="kbpanel" id="kbPanHelp">' + aiHelpHtml() + '</div>');
  return L.join('');
}
function kbTabPaint() {
  KB_TABS.forEach(t => {
    const pan = $(kbPanId(t[0]));
    if (pan) pan.style.display = (t[0] === KB_TAB ? '' : 'none');
    const btn = document.querySelector ? document.querySelector('.kbtab[data-kbtab="' + t[0] + '"]') : null;
    if (btn) { if (t[0] === KB_TAB) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current'); }
  });
}
function kbTabShow(k) {
  if (!KB_TABS.some(t => t[0] === k)) return;
  KB_TAB = k;
  kbTabPaint();
}
function kbTabsBind() {
  const box = $('kbTabs');
  if (!box || box.__kbtabsBound) return;
  box.__kbtabsBound = 1;
  box.addEventListener('click', e => {
    const b = e.target.closest ? e.target.closest('[data-kbtab]') : null;
    if (b) kbTabShow(b.dataset.kbtab);
  });
}
function renderKb() {
  /* 知识库列表要等 知识库.js 挂上才有内容：懒加载，加载完再重画一次 */
  if (typeof kbEnsureFilesLoaded === 'function') kbEnsureFilesLoaded().then(r => { if (r && r.added) { try { render(); } catch (e) {} } });
  if (typeof aiIngestCfg === 'function') aiIngestCfg();
  $('view').innerHTML = '<h2 class="sec">AI 与知识库</h2>' + kbTabsHtml() + kbPanelsHtml();
  aiPaintForm();
  aiBindConfig();
  if (typeof kbBind === 'function') kbBind($('view'));
  kbTabsBind();
  kbTabPaint();
}

/* 有没有 AI 正在流式生成 —— 答题页的键盘快捷键靠它让路（生成期间敲 A–H / Enter / ←→ / S 不该动页面） */
window.aiBusy = aiIsRunning;

/* 启动：如果站点目录里有 AI配置.js（chatbox-import.py 生成），自动读进来 */
function aiIngestCfg() { aiLoadCfgFile(); }
setTimeout(() => { try { aiLoadCfgFile(); } catch (e) {} }, 400);
