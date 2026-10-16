/* ============================================================
   刷题站 · 云同步 sync.js
   · 用一个【私有】仓库当云盘（服务商可选：GitHub / 码云 Gitee）：
     电脑和手机各自把记录推到云端、再合并回来
   · 页面：#/sync（顶栏「同步」按钮 / 设置里的「云同步」按钮 / 首页卡片都能进）
   · 存的东西：作答记录、错题、收藏、笔记、自定义解析、修正答案、套卷、
              复习曲线、自建题库、自己导入的知识库、AI 配置（含 Key）——不含站点外观设置
   · 合并规则：跟站点自己的多标签合并完全一致 —— 谁的时间戳新用谁的；
              删除会通过「墓碑表」传播，不会被另一台机器复活
   · 知识库两种：站点自带的 5 个「完整版」库在 知识库.js 里（两边打开网址都有，不用同步）；
              你自己导入的资料库正文在 IndexedDB，走 kbExportAll / kbImportAll 同步，
              删掉的会记进 qbank.kb.drop.v1 跟着走，不会被另一台设备推回来
   · 安全：token 只存在本机浏览器的 localStorage（qbank.sync.v1），
          不会进同步内容、只会发给所选服务商的接口
          （GitHub：api.github.com；码云：gitee.com）。
   ============================================================ */

const SYNC_LS = 'qbank.sync.v1';
const SYNC_DEF = {
  provider: 'github', owner: '', repo: '', branch: 'main', path: 'sync/data.json', token: '',
  auto: true, device: '',
  scope: { ans: true, note: true, paper: true, srs: true, banks: true, cat: true, ai: true, kb: true, tag: true },
  lastPull: 0, lastPush: 0, lastAt: 0, lastErr: '', lastSha: '', lastBytes: 0
};
let SYC = readLS(SYNC_LS, null) || {};
Object.keys(SYNC_DEF).forEach(k => { if (SYC[k] == null) SYC[k] = SYNC_DEF[k]; });
SYC.scope = Object.assign({}, SYNC_DEF.scope, SYC.scope || {});
function syncSave() { writeLS(SYNC_LS, SYC); }
function syncReady() { return !!(SYC.owner && SYC.repo && SYC.token); }
function syncSlug() { return SYC.owner + '/' + SYC.repo; }

/* 同步范围（界面上那几行勾选框） */
const SYNC_SCOPES = [
  { k: 'ans', label: '作答记录 · 错题 · 收藏', tip: '对错、次数、复习排期、错题本、收藏' },
  { k: 'note', label: '笔记 · 自定义解析 · 修正答案', tip: '你写过的东西，还有手动改过的正确答案' },
  { k: 'paper', label: '套卷（组卷）', tip: '临时套卷的定义' },
  { k: 'srs', label: '背诵 / 复习曲线', tip: '间隔重复的档位设置' },
  { k: 'cat', label: '分类目录', tip: '自建题库的分类树' },
  { k: 'banks', label: '自建题库', tip: '你在网页上导入的题库（可能几 MB，同步会慢一点）' },
  { k: 'tag', label: '考点标签', tip: '你导入 / AI 生成的那份考点词表，以及 AI 给每道题贴的标签（统计页「按考点」用的就是它）' },
  { k: 'kb', label: '自己导入的资料库', tip: '在「AI 与知识库」页导入的 txt / pdf / md 等（正文在浏览器数据库里；网站自带的 5 个「完整版」库不用同步，两边打开网址就有）' },
  { k: 'ai', label: 'AI 配置（含 API Key）', tip: '⚠️ Key 会明文存进你的私有仓库' }
];
/* 自建题库没勾上时，分类目录多半也没意义，但由用户自己决定，不做联动 */

/* ---------- 服务商：GitHub / 码云 Gitee ----------
   两边都是「私有仓库当云盘」，接口形状几乎一样，差别只在域名、鉴权方式、
   新仓库的默认分支（GitHub 是 main，码云是 master）和建仓库的能力。 */
const SYNC_PROVIDERS = {
  github: {
    key: 'github', label: 'GitHub', host: 'api.github.com', branch: 'main', speed: '国外，国内偶尔要等一两秒',
    tokenLabel: '访问 token', tokenPh: 'ghp_… 或 github_pat_…',
    tokenTip: 'github.com/settings/tokens（classic，勾 repo）',
    repoHint: '在你账号下建一个同名私有仓库（需要 token 有建仓库权限）',
    api: p => 'https://api.github.com' + p,
    hdrs: function (accept) { return { 'Authorization': 'Bearer ' + SYC.token, 'Accept': accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
  },
  gitee: {
    key: 'gitee', label: '码云 Gitee', host: 'gitee.com', branch: 'master', speed: '国内，快（推荐）',
    tokenLabel: '私人令牌', tokenPh: '码云 → 设置 → 安全设置 → 私人令牌',
    tokenTip: 'gitee.com → 头像 → 设置 → 安全设置 → 私人令牌（勾 projects）',
    repoHint: '码云要在网页上手动新建一个私有仓库',
    api: function (p) { return 'https://gitee.com/api/v5' + p + (p.indexOf('?') >= 0 ? '&' : '?') + 'access_token=' + encodeURIComponent(SYC.token); },
    hdrs: function (accept) { return { 'Accept': accept || 'application/json' }; }
  }
};
function syncP() { return SYNC_PROVIDERS[SYC.provider] || SYNC_PROVIDERS.github; }

/* ---------- 小工具 ---------- */
function syncBytes(s) { try { return new Blob([s]).size; } catch (e) { return s.length * 2; } }
function syncB64Encode(str) {
  const b = new TextEncoder().encode(str);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
  return btoa(s);
}
function syncB64Decode(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(u8);
}
function syncDevice() {
  const ua = navigator.userAgent || '';
  let os = '设备';
  if (/iPhone/.test(ua)) os = 'iPhone'; else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = /Mobile/.test(ua) ? '安卓手机' : '安卓平板';
  else if (/Mac OS X/.test(ua)) os = 'Mac'; else if (/Windows/.test(ua)) os = 'Windows 电脑';
  else if (/Linux/.test(ua)) os = 'Linux';
  let br = '';
  if (/Edg\//.test(ua)) br = 'Edge'; else if (/OPR\//.test(ua)) br = 'Opera';
  else if (/Firefox\//.test(ua)) br = '火狐'; else if (/Chrome\//.test(ua)) br = 'Chrome';
  else if (/Safari\//.test(ua)) br = 'Safari';
  return os + (br ? '·' + br : '');
}
function syncTime(ts) { return ts ? fmtTime(ts) : '从没同步过'; }
function syncAgo(ts) {
  if (!ts) return '从没同步过';
  const d = Date.now() - ts;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
  return Math.floor(d / 86400000) + ' 天前';
}
/* 页面上的小日志：出问题时要能看见到底哪一步失败 */
let SYNC_LOG = [];
function syncLog(msg, bad) {
  SYNC_LOG.unshift((bad ? '✗ ' : '· ') + new Date().toLocaleTimeString('zh-CN') + '  ' + msg);
  if (SYNC_LOG.length > 12) SYNC_LOG.length = 12;
  const el = document.getElementById('syncLogBox');
  if (el) el.innerHTML = SYNC_LOG.map(x => '<div>' + esc(x) + '</div>').join('');
}
function syncState(text, cls) {
  const el = $('syncState');
  if (el) { el.textContent = text || ''; el.className = 'aistate' + (cls ? ' ' + cls : ''); }
}

/* ---------- 云端接口（GitHub / 码云共用这一套） ---------- */
function syncHdrs(accept) { return syncP().hdrs(accept); }
const syncApi = p => syncP().api(p);
const syncRepoUrl = p => syncApi('/repos/' + encodeURIComponent(SYC.owner) + '/' + encodeURIComponent(SYC.repo) + p);
function syncPathEnc() { return String(SYC.path || 'sync/data.json').split('/').map(encodeURIComponent).join('/'); }
async function syncReq(method, url, body, accept) {
  let res;
  const hdrs = syncHdrs(accept);
  if (body != null) hdrs['Content-Type'] = 'application/json';   /* 码云必须带，不然 406 */
  try {
    res = await fetch(url, { method: method, headers: hdrs, cache: 'no-store', body: body == null ? undefined : JSON.stringify(body) });
  } catch (e) {
    const err = new Error('连不上 ' + syncP().host + '（网络被挡或断网）');
    err.hint = SYC.provider === 'github'
      ? '国内偶尔会连不上 GitHub。换个网络、或开代理后再点一次；也可以把「服务商」换成码云 Gitee（国内快很多）。'
      : '检查网络后再点一次；实在连不上就先「导出全部数据」手动搬。';
    throw err;
  }
  const txt = await res.text();
  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const j = JSON.parse(txt); if (j.message) msg += '：' + j.message; else if (j.error) msg += '：' + j.error; } catch (e) {}
    const err = new Error(msg);
    err.status = res.status;
    if (res.status === 401) err.hint = syncP().tokenLabel + '不对或过期了，重新生成一个再填（' + syncP().tokenTip + '）。';
    else if (res.status === 403) err.hint = '权限不够：' + (SYC.provider === 'github' ? 'token 要有 Contents 读写（经典 token 勾 repo）' : '私人令牌要勾上 projects（仓库读写）') + '。也可能是请求太频繁，等一会儿再试。';
    else if (res.status === 404) err.hint = '仓库不存在，或者 token 没有这个仓库的权限' + (SYC.provider === 'gitee' ? '；也看看「分支」对不对（码云新仓库默认是 master）' : '') + '。';
    else if (res.status === 422) err.hint = '请求被拒：仓库名可能已经存在（存在就直接用，不用再建），或者名字不合法。';
    else if (res.status === 409) err.hint = syncP().label + ' 报「状态冲突」（多半是刚提交完、服务端还没同步完）：等两三秒再点一次就好。';
    throw err;
  }
  return txt;
}
async function syncWhoAmI() {
  const me = JSON.parse(await syncReq('GET', syncApi('/user')));
  const login = me.login || me.name;
  if (!login) throw new Error('token 能连上，但读不到账号名');
  return login;
}
function syncSleep(ms) { return new Promise(r => setTimeout(r, ms)); }
/* 云端数据文件：先拿 sha（顺便判断有没有）。GitHub 偶尔在刚提交完时返回 409，等一下重试一次；
   码云对「文件不存在」不给 404，而是返回一个空数组 []，所以这里统一归一化成 null */
async function syncCloudMeta(retry) {
  try {
    const txt = await syncReq('GET', syncRepoUrl('/contents/' + syncPathEnc() + '?ref=' + encodeURIComponent(SYC.branch)));
    const j = JSON.parse(txt);
    if (!j || Array.isArray(j) || !j.sha) return null;
    return j;
  } catch (e) {
    if (e.status === 409 && !retry) { await syncSleep(1200); return syncCloudMeta(1); }
    throw e;
  }
}
/* 写云端：码云新建文件必须用 POST、改文件用 PUT（不带 sha 的 PUT 会 400「sha is missing」）；
   409（并发 / 服务端还没同步完）、422 或 400（文件已存在却没带 sha）时，重拿 sha 再试一次 */
async function syncCloudPut(body) {
  const url = syncRepoUrl('/contents/' + syncPathEnc());
  const way = () => (SYC.provider === 'gitee' && !body.sha) ? 'POST' : 'PUT';
  try { return await syncReq(way(), url, body); }
  catch (e) {
    if (e.status !== 409 && e.status !== 422 && e.status !== 400) throw e;
    await syncSleep(1200);
    let sha = null;
    try { sha = ((await syncCloudMeta()) || {}).sha; } catch (e2) {}
    if (sha && sha !== body.sha) { body.sha = sha; return await syncReq(way(), url, body); }
    throw e;
  }
}
async function syncCloudRead(meta) {
  if (meta && meta.content && meta.encoding === 'base64') return syncB64Decode(meta.content);
  if (SYC.provider === 'gitee') {            /* 码云：超过 1 MB 的文件直接走 raw 接口 */
    return await syncReq('GET', syncRepoUrl('/raw/' + syncPathEnc() + '?ref=' + encodeURIComponent(SYC.branch)));
  }
  const txt = await syncReq('GET', syncRepoUrl('/git/blobs/' + meta.sha), null, 'application/vnd.github.raw');
  return txt;
}

/* ---------- 打包 / 合并 ---------- */
/* 知识库：站点自带的 5 个「精编版（完整版）」库是知识库.js 里的网站文件，不进同步（两边打开网址就有）；
   这里同步的是你自己在「AI 与知识库」页导入的资料库 —— 正文平时躺在 IndexedDB 里，
   所以走 kb.js 自己的 kbExportAll / kbImportAll，而不是读 localStorage。
   删除也要能传播，不然 A 删了、B 一推又被带回来：用一本本机账本 qbank.kb.drop.v1 记时间戳。 */
const SYNC_KB_DROP = 'qbank.kb.drop.v1';
function syncKbDrops() { const m = readLS(SYNC_KB_DROP, null); return (m && typeof m === 'object') ? m : {}; }
function syncKbDropAdd(id) { const m = syncKbDrops(); m[id] = Date.now(); writeLS(SYNC_KB_DROP, m); }
async function syncKbPack() {
  if (typeof kbExportAll !== 'function') return null;
  try {
    const o = await kbExportAll();
    delete o.sel;        /* 勾选了哪些库是各设备自己的偏好，不跟着走 */
    delete o.autoN;
    return o;
  } catch (e) { syncLog('知识库读不出来：' + (e.message || e), true); return null; }
}
/* 把云端的知识库并进本机：先处理「删掉的」，再把本机没有的补进来（同 id 以本机为准） */
function syncKbMerge(o, drops) {
  if (typeof kbImportAll !== 'function' || typeof kbList !== 'function') return 0;
  const mine = syncKbDrops();
  let changed = false;
  Object.keys(drops || {}).forEach(id => {
    if (!mine[id] || drops[id] > mine[id]) {
      mine[id] = drops[id]; changed = true;
      const k = kbList().find(x => x.id === id);
      if (k && !k.auto && typeof kbRemove === 'function') { try { kbRemove(id); } catch (e) {} }
    }
  });
  if (changed) writeLS(SYNC_KB_DROP, mine);
  if (!o || typeof o !== 'object') return 0;
  if (Array.isArray(o.skip) && o.skip.length) kbImportAll({ list: [], data: {}, skip: o.skip });   /* 文件库的删除名单 */
  const have = {};
  kbList().forEach(k => { have[k.id] = 1; });
  const list = (o.list || []).filter(k => k && k.id && !mine[k.id] && !have[k.id] && o.data && o.data[k.id]);
  if (!list.length) return 0;
  const data = {};
  list.forEach(k => { data[k.id] = o.data[k.id]; });
  kbImportAll({ list: list, data: data });
  syncLog('知识库并进来 ' + list.length + ' 个：' + list.map(k => k.name).join('、'));
  return list.length;
}
async function syncPayload() {
  const s = SYC.scope, d = {};
  if (s.ans) { d.answers = ANS; d.favs = FAV; }
  if (s.note) { d.notes = NOTES; d.fixes = FIX; }
  if (s.paper) d.papers = PAPERS;
  if (s.cat) d.cats = catRows();
  if (s.srs) d.srs = SRS;
  if (s.banks) d.banks = LOCAL;
  if (s.ai && typeof AIC !== 'undefined') d.ai = AIC;
  if (s.tag && typeof TAGS !== 'undefined') { d.tags = TAGS.data(); d.tagVocab = TAGS.vocab(); }
  if (s.kb) { const kb = await syncKbPack(); if (kb && (kb.list || []).length) d.kb = kb; }
  const tomb = {};
  ['ans', 'fav', 'note', 'fix', 'paper'].forEach(k => { if (s.ans || s.note || s.paper) tomb[k] = TOMB[k] || {}; });
  if (s.tag) tomb.tag = TOMB.tag || {};
  tomb.wipe = TOMB.wipe || {};
  const out = { app: 'shuati-sync', v: 1, updatedAt: Date.now(), device: SYC.device || syncDevice(), scope: s, data: d, tomb: tomb };
  if (s.kb) out.kbDrop = syncKbDrops();
  return out;
}
/* 把云端的这份数据并进本机（本机自己那套合并写入负责时间戳和墓碑） */
function syncMergeCloud(cloud) {
  if (!cloud || cloud.app !== 'shuati-sync') throw new Error('云端文件不是刷题站的同步数据');
  const d = cloud.data || {}, ct = cloud.tomb || {}, s = SYC.scope;
  let added = 0;

  /* 1) 先并墓碑：在别的设备上删掉的题，不能在本机复活 */
  ['ans', 'fav', 'note', 'fix', 'paper', 'tag'].forEach(k => {
    const mine = TOMB[k] = TOMB[k] || {}, theirs = ct[k] || {};
    Object.keys(theirs).forEach(x => { if (!mine[x] || theirs[x] > mine[x]) mine[x] = theirs[x]; });
  });
  TOMB.wipe = TOMB.wipe || {};
  Object.keys(ct.wipe || {}).forEach(k => { if (!TOMB.wipe[k] || ct.wipe[k] > TOMB.wipe[k]) TOMB.wipe[k] = ct.wipe[k]; });
  writeLS(TOMB_KEY, TOMB);

  /* 2) 记录类：先并进内存，再走站点自己的 mergeWrite（新的赢、墓碑优先） */
  const put = (mem, cloudObj) => {
    if (!cloudObj) return;
    Object.keys(cloudObj).forEach(k => { if (!mem[k]) added++; });
    Object.assign(mem, cloudObj);
  };
  if (s.ans) { put(ANS, d.answers); saveAns(); put(FAV, d.favs); saveFav(); }
  if (s.note) { put(NOTES, d.notes); saveNotes(); put(FIX, d.fixes); saveFix(); }

  /* 3) 数组类：同 id 以本机为准（本机的可能更新），云端独有的补进来 */
  if (s.paper && Array.isArray(d.papers)) { d.papers.forEach(p => { if (p && p.id && !PAPERS.some(x => x.id === p.id)) { PAPERS.push(p); added++; } }); savePapers(); }
  if (s.banks && Array.isArray(d.banks)) { d.banks.forEach(b => { if (b && b.id && !LOCAL.some(x => x.id === b.id)) { LOCAL.push(b); added++; } }); writeLS(LS.banks, LOCAL); invalidateBanks(); }
  if (s.cat && Array.isArray(d.cats) && d.cats.length) {
    try {
      if (typeof CAT !== 'undefined' && CAT && CAT.importCats) { const r = CAT.importCats(d.cats) || {}; added += (r.added || 0); }
    } catch (e) {}
  }

  /* 4) 整体设置类（复习曲线 / AI 配置）：只有云端比本机上次上传更新时才采纳 */
  const newer = (+cloud.updatedAt || 0) > (+SYC.lastPush || 0);
  if (s.srs && d.srs && newer) { Object.assign(SRS, d.srs); writeLS(LS.srs, SRS); }
  if (s.ai && d.ai && newer && typeof AIC !== 'undefined') { Object.assign(AIC, d.ai); aiSave(); }

  /* 5) 知识库：自己导入的资料库按 id 补进来；云端删掉的按时间戳在本机也删掉 */
  if (s.kb) added += syncKbMerge(d.kb, cloud.kbDrop);

  /* 6) 考点标签：同一道题以本机为准，本机没有的补进来；词表取并集 */
  if (s.tag && typeof TAGS !== 'undefined' && TAGS.mergeIn) { try { added += (TAGS.mergeIn(d.tags, d.tagVocab) || 0); } catch (e) {} }

  migrate(); invalidateBanks();
  return { added: added, updatedAt: +cloud.updatedAt || 0, device: cloud.device || '另一台设备' };
}

/* ---------- 同步动作 ---------- */
let SYNC_BUSY = false, SYNC_DIRTY = false, SYNC_TIMER = 0;
function syncBusy(on, msg) {
  SYNC_BUSY = !!on;
  document.querySelectorAll('.syncSpin').forEach(el => { el.style.display = on ? 'inline' : 'none'; });
  if (on) syncState(msg || '同步中…');
  else if ($('syncState') && !SYC.lastErr) syncState('');
  if (document.getElementById('btnGoSync')) syncTopBtn();
}
/* 有 AI 正在生成时别重画整页：render() 会把正在写的「AI 解析」一起冲掉 */
function syncSafeRender() {
  try {
    if (typeof AI_LAST === 'object' && AI_LAST
      && Object.keys(AI_LAST).some(k => AI_LAST[k] && AI_LAST[k].running)) { syncAfterRender(); return; }
  } catch (e) {}
  render();
}
/* 上传后回读一次做确认：有些服务商对「写」的响应不带跨域头，浏览器读不到回包，
   fetch 会直接抛错，但文件其实已经写进去了 —— 回读（GET 是能读的）来判定真伪 */
async function syncWrittenOk(text) {
  try {
    const meta = await syncCloudMeta();
    if (!meta) return false;
    const got = await syncCloudRead(meta);
    return String(got).trim() === String(text).trim();
  } catch (e) { return false; }
}
async function syncPush(silent) {
  if (!syncReady()) throw new Error('还没配置仓库和 token');
  const text = JSON.stringify(await syncPayload());
  const bytes = syncBytes(text);
  if (bytes > 25 * 1024 * 1024) throw new Error('数据太大（' + (bytes / 1048576).toFixed(1) + ' MB）：先别勾「自己导入的资料库」和「自建题库」，或者把它们做成 知识库.js');
  let sha = null;
  try { sha = ((await syncCloudMeta()) || {}).sha; } catch (e) { if (e.status !== 404 && e.status !== 409) throw e; }
  const body = {
    message: 'sync ' + new Date().toLocaleString('zh-CN') + ' ← ' + (SYC.device || syncDevice()),
    content: syncB64Encode(text), branch: SYC.branch
  };
  if (sha) body.sha = sha;
  try {
    await syncCloudPut(body);
  } catch (e) {
    if (await syncWrittenOk(text)) { syncLog('（服务商没回执，但回读确认已经写进去了，按成功算）'); }
    else {
      /* 写不进去最常见的原因就是 token / 权限，用一次 GET 把真正的原因问出来 */
      try { await syncWhoAmI(); } catch (e2) { throw e2; }
      if (!e.status) e.hint = (e.hint ? e.hint + '　' : '') + '写请求没能确认：'
        + (SYC.provider === 'gitee' ? '码云可能不允许网页直接写（跨域），或者私人令牌没勾 projects。' : '检查 token 权限（Contents 读写）。');
      throw e;
    }
  }
  SYC.lastPush = Date.now(); SYC.lastBytes = bytes; SYC.lastErr = '';
  syncSave();
  if (!silent) syncLog('已上传 ' + (bytes / 1024).toFixed(0) + ' KB（' + syncDevice() + '）');
  return bytes;
}
async function syncNow(silent) {
  if (!syncReady()) { if (!silent) toast('先填仓库和 token'); return { ok: false }; }
  if (SYNC_BUSY) { if (!silent) toast('正在同步，稍等'); return { ok: false }; }
  SYNC_BUSY = true; syncBusy(true, '正在同步…');
  try {
    let cloud = null, meta = null;
    try { meta = await syncCloudMeta(); } catch (e) { if (e.status !== 404 && e.status !== 409) throw e; }
    if (meta) cloud = JSON.parse(await syncCloudRead(meta));
    let merged = null;
    if (cloud) merged = syncMergeCloud(cloud);
    SYC.lastPull = Date.now();
    const bytes = await syncPush(true);
    SYC.lastAt = Date.now(); SYC.lastSha = (meta && meta.sha) || '';
    syncSave();
    const tip = merged
      ? '已同步：云端 ' + (merged.added ? '补进 ' + merged.added + ' 条，' : '') + '本机上传 ' + (bytes / 1024).toFixed(0) + ' KB'
      : '云端还是空的，已把本机数据上传（' + (bytes / 1024).toFixed(0) + ' KB）';
    syncLog(tip + '　' + (merged ? '云端来自 ' + merged.device : ''));
    syncBusy(false); syncState('已同步 · ' + syncAgo(SYC.lastAt), 'ok');
    if (!silent) toast(tip, 4200);
    syncSafeRender();
    return { ok: true, added: merged ? merged.added : 0 };
  } catch (e) {
    SYC.lastErr = e.message || String(e); syncSave();
    syncLog('同步失败：' + SYC.lastErr + (e.hint ? '　' + e.hint : ''), true);
    syncBusy(false); syncState('同步失败：' + SYC.lastErr, 'bad');
    if (!silent) toast('同步失败：' + SYC.lastErr, 5200);
    return { ok: false, err: e };
  } finally { SYNC_BUSY = false; if (route().name === 'sync') syncPaintStatus(); }
}
async function syncPullOnly() {
  if (!syncReady()) return toast('先填仓库和 token');
  if (SYNC_BUSY) return toast('正在同步，稍等');
  SYNC_BUSY = true; syncBusy(true, '正在下载…');
  try {
    const meta = await syncCloudMeta();
    if (!meta) throw new Error('云端还没有数据');
    const cloud = JSON.parse(await syncCloudRead(meta));
    const r = syncMergeCloud(cloud);
    SYC.lastPull = Date.now(); SYC.lastErr = ''; syncSave();
    syncLog('已从云端合并：新进 ' + r.added + ' 条（云端来自 ' + r.device + '）');
    toast('已合并云端的 ' + r.added + ' 条新记录', 3600);
    syncSafeRender();
  } catch (e) {
    syncLog('下载失败：' + (e.message || e), true);
    toast('下载失败：' + (e.message || e), 4600);
  } finally { SYNC_BUSY = false; syncBusy(false); if (route().name === 'sync') syncPaintStatus(); }
}
async function syncForcePush() {
  if (!syncReady()) return toast('先填仓库和 token');
  if (!confirm('把本机这份数据整个覆盖到云端？\n\n其它设备下次打开时会以云端为准（本机没有的记录会补上，本机多的记录不会丢）。')) return;
  try { const b = await syncPush(false); toast('已上传 ' + (b / 1024).toFixed(0) + ' KB'); render(); }
  catch (e) { syncLog('上传失败：' + (e.message || e), true); toast('上传失败：' + (e.message || e), 4600); }
}
async function syncTest() {
  syncState('正在测试…');
  try {
    const login = await syncWhoAmI();
    let repo = '（还没有这个仓库）';
    try { const r = JSON.parse(await syncReq('GET', syncRepoUrl(''))); repo = r.full_name + (r.private ? '（私有）' : '（⚠️ 公开！）'); } catch (e) { /* 仓库不存在时不算失败 */ }
    syncState('token 有效：' + login + '　仓库：' + repo, 'ok');
    syncLog('测试通过：' + login + '　' + repo);
  } catch (e) {
    syncState('测试失败：' + e.message, 'bad');
    syncLog('测试失败：' + e.message + (e.hint ? '　' + e.hint : ''), true);
  }
}
async function syncCreateRepo() {
  if (!SYC.token) return toast('先填 ' + syncP().tokenLabel);
  if (!SYC.repo) return toast('先填仓库名');
  if (SYC.provider === 'gitee') {
    /* 码云 API 建的仓库默认是公开的，私有可能要付费——不替用户冒这个险，让他自己在网页上建 */
    toast('码云请自己在网页上新建一个私有仓库（已帮你打开页面），建好回来填仓库名即可', 7000);
    try { window.open('https://gitee.com/projects/new', '_blank'); } catch (e) {}
    syncLog('码云：点「创建私有仓库」不会代建（怕建成了公开仓库）。请在 gitee.com/projects/new 手动新建，'
      + '仓库名填 ' + (SYC.repo || 'shuati-sync') + '，选「私有」，不要勾「初始化仓库」。');
    return;
  }
  try {
    await syncReq('POST', syncApi('/user/repos'), {
      name: SYC.repo, private: true, auto_init: true,
      description: '刷题站 跨设备云同步数据（私有仓库，浏览器端读写）'
    });
    syncLog('已创建私有仓库 ' + syncSlug());
    toast('已创建私有仓库 ' + syncSlug(), 3600);
    syncTest();
  } catch (e) { syncLog('创建仓库失败：' + e.message, true); toast('创建失败：' + e.message, 4600); }
}

/* ---------- 自动同步 ---------- */
function syncFp() {
  let s = '';
  [LS.ans, LS.fav, LS.note, LS.fix, LS.paper, LS.cat, LS.srs, TOMB_KEY].forEach(k => { s += k + '=' + (localStorage.getItem(k) || '') + '|'; });
  try { if (typeof AI_LS === 'string') s += AI_LS + '=' + (localStorage.getItem(AI_LS) || '') + '|'; } catch (e) {}
  const b = localStorage.getItem(LS.banks);            // 自建题库可能几 MB，只看长度
  s += LS.banks + '=' + (b ? b.length : 0);
  /* 知识库：正文在 IndexedDB 里，指纹看不进去；目录 + 删除名单 + 删除账本变了就够触发了 */
  try {
    ['qbank.kb.list.v1', 'qbank.kb.skip.v1', SYNC_KB_DROP].forEach(k => { s += '|' + k + '=' + (localStorage.getItem(k) || ''); });
  } catch (e) {}
  /* 考点标签：贴标签会写墓碑（TOMB_KEY 变），但**只改词表不贴题**时不会 —— 词表也要算进指纹，
     否则「加/删一个考点词」不会触发自动同步，得等别的数据变了才顺带过去。 */
  try {
    ['qbank.tags.v1', 'qbank.tagvocab.v1'].forEach(k => { s += '|' + k + '=' + (localStorage.getItem(k) || ''); });
  } catch (e) {}
  return s;
}
let SYNC_FP = '';
function syncTick() {
  if (!syncReady() || !SYC.auto) return;
  const fp = syncFp();
  if (!SYNC_FP) { SYNC_FP = fp; return; }
  if (fp === SYNC_FP) return;
  SYNC_FP = fp; SYNC_DIRTY = true;
  clearTimeout(SYNC_TIMER);
  SYNC_TIMER = setTimeout(() => { if (SYNC_DIRTY) { SYNC_DIRTY = false; syncNow(true); } }, 12000);
}
function syncStart() {
  SYNC_FP = syncFp();
  setInterval(syncTick, 10000);
  window.addEventListener('storage', e => {
    if (!e || !e.key || String(e.key).indexOf('qbank.') !== 0 || e.key === SYNC_LS) return;
    SYNC_DIRTY = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (SYNC_DIRTY && syncReady() && SYC.auto) { SYNC_DIRTY = false; syncNow(true); } }
  });
  if (syncReady() && SYC.auto) setTimeout(() => syncNow(true), 2500);   // 打开页面先对一次
}

/* ---------- 界面 ---------- */
function syncStatusHtml() {
  if (!syncReady()) return '<span class="aistate">还没配置</span>';
  if (SYC.lastErr) return '<span class="aistate bad">上次失败：' + esc(SYC.lastErr) + '</span>';
  if (!SYC.lastAt) return '<span class="aistate">已配置，还没同步过</span>';
  return '<span class="aistate ok">上次同步 ' + esc(syncAgo(SYC.lastAt)) + '（' + esc(syncTime(SYC.lastAt)) + '）</span>';
}
function syncCardHtml() {
  const L = [];
  L.push('<div class="card kbcard">');
  L.push('<div class="kbhead">云同步 <span class="small muted">用一个私有仓库当云盘（GitHub / 码云）：电脑 ↔ 手机都能读同一份记录</span></div>');
  L.push('<div class="tools"><span id="syncStatusLine">' + syncStatusHtml() + '</span><span class="syncSpin small muted" style="display:none">同步中…</span><span class="aistate" id="syncState"></span></div>');
  L.push('<div class="tools"><span class="tl">云盘</span><select class="num" id="syncProvider">'
    + Object.keys(SYNC_PROVIDERS).map(k => '<option value="' + k + '"' + (SYC.provider === k ? ' selected' : '') + '>'
      + esc(SYNC_PROVIDERS[k].label) + '　' + esc(SYNC_PROVIDERS[k].speed) + '</option>').join('')
    + '</select><span class="small muted">码云在国内快得多（实测 0.2–0.4 秒 vs 1.2–1.7 秒）</span></div>');
  L.push('<div class="tools"><span class="tl">仓库</span>'
    + '<input class="num" id="syncOwner" placeholder="用户名" style="width:130px" value="' + esc(SYC.owner) + '">'
    + '<span class="tl">/</span><input class="num grow" id="syncRepo" placeholder="仓库名，例如 shuati-sync" value="' + esc(SYC.repo) + '">'
    + '<button class="btn" id="syncCreateRepo" title="' + esc(syncP().repoHint) + '">' + (SYC.provider === 'gitee' ? '去码云建私有仓库' : '创建私有仓库') + '</button></div>');
  L.push('<div class="tools"><span class="tl">分支</span><input class="num" id="syncBranch" style="width:90px" value="' + esc(SYC.branch) + '">'
    + '<span class="tl">数据文件</span><input class="num grow" id="syncPath" value="' + esc(SYC.path) + '"></div>');
  L.push('<div class="tools"><span class="tl">' + esc(syncP().tokenLabel) + '</span><input class="num grow" id="syncToken" type="password" placeholder="' + esc(syncP().tokenPh) + '" value="' + esc(SYC.token) + '">'
    + '<button class="btn" id="syncTokShow">显示</button><button class="btn" id="syncTest">测试连接</button></div>');
  L.push('<div class="tools"><span class="tl">这台设备叫</span><input class="num" id="syncDevice" style="width:170px" placeholder="' + esc(syncDevice()) + '" value="' + esc(SYC.device) + '">'
    + '<label class="chk"><input type="checkbox" id="syncAuto"' + (SYC.auto ? ' checked' : '') + '> 自动同步（改了就上传，打开页面先对一次）</label></div>');
  L.push('<div class="tools">' + SYNC_SCOPES.map(x => '<label class="chk" title="' + esc(x.tip) + '"><input type="checkbox" class="syncScope" data-k="' + x.k + '"' + (SYC.scope[x.k] ? ' checked' : '') + '> ' + esc(x.label) + '</label>').join('') + '</div>');
  L.push('<div class="actions"><button class="btn primary" id="syncNow">立即同步（先拉后推）</button>'
    + '<button class="btn" id="syncPull">只从云端合并下来</button>'
    + '<button class="btn" id="syncPushOnly">把本机覆盖上传</button>'
    + '<button class="btn danger" id="syncWipe">断开（清掉本机 token）</button></div>');
  L.push('<div class="actions"><button class="btn" id="syncCopyCfg">复制「一键配置」链接（发给手机，点开自动填好）</button></div>');
  L.push('<div class="small muted" style="margin-top:8px">同步内容里 <b>不含</b>：站点外观设置（换主题、字号只跟这台设备）。「自己导入的资料库」「考点标签」各有一个勾选，勾上就一起同步；资料库要传正文（几 MB），考点词表和标签很小。token 只存在这台设备的浏览器里，不会进同步内容。</div>');
  L.push('<div class="hint" id="syncLogBox" style="margin-top:10px;font-family:ui-monospace,Consolas,monospace;white-space:pre-wrap"></div>');
  L.push('</div>');
  return L.join('');
}
function syncHelpHtml() {
  const url = location.origin + location.pathname;
  const p = syncP();
  const isGit = SYC.provider === 'github';
  const L = [];
  L.push('<div class="card kbcard">');
  L.push('<div class="kbhead">怎么让手机和电脑通上（当前：' + esc(p.label) + '）</div>');
  L.push('<div class="small">1）先准备一个<b>私有仓库</b>和一枚 <b>' + esc(p.tokenLabel) + '</b>：'
    + (isGit
      ? '<b>token</b> 去 github.com/settings/tokens 生成（classic 勾 <code>repo</code>；或 fine-grained 只勾这个仓库的 <b>Contents: Read and write</b>）。'
        + '仓库点上面的「创建私有仓库」就能建。'
      : '<b>私人令牌</b>去 gitee.com → 头像 → 设置 → 安全设置 → 私人令牌（勾 <code>projects</code>）。'
        + '仓库去 gitee.com/projects/new 新建，<b>一定要选「私有」</b>。')
    + '</div>');
  L.push('<div class="small" style="margin-top:6px">2）在这里填好<b>仓库</b>和 <b>' + esc(p.tokenLabel) + '</b>，点「测试连接」→「立即同步」。云端就有第一份数据了。</div>');
  L.push('<div class="small" style="margin-top:6px">3）手机浏览器打开同一个网址 <code>' + esc(url) + '</code>（可以「添加到主屏幕」，像 App 一样用）：'
    + '<button class="btn tiny" id="syncCopyUrl">复制网址</button></div>');
  L.push('<div class="small" style="margin-top:6px">4）手机上进<b>设置 → 云同步</b>，把<b>同样的仓库、同一枚 token</b> 填进去，「立即同步」。之后就自动互传了：手机做的题回电脑能看见，电脑写的解析回手机也能看见。'
    + '　（懒人办法：电脑这边配好后点上面的「复制一键配置链接」，把链接发到手机点开，它会自己填好并同步，不用手打。）</div>');
  L.push('<div class="small muted" style="margin-top:6px">换云盘服务商：把上面的「云盘」换成码云（国内快很多），分支会自动从 <code>main</code> 换成 <code>master</code>，其余照填即可；两边用的是各自独立的仓库，互不影响。</div>');
  L.push('<div class="note" style="margin-top:10px"><b>关于 token（重要）</b>：它相当于这个仓库的钥匙，只存在你的浏览器里。'
    + (isGit
      ? '更安全的做法是用 <b>fine-grained token</b>：GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → 只勾 <b>Only select repositories: ' + esc(SYC.repo || 'shuati-sync') + '</b>，权限只给 <b>Contents: Read and write</b>。'
        + '这样即使 token 泄露，别人也只能碰这一个私有仓库，动不了你别的代码。用经典 token（ghp_…）的话要带 <code>repo</code> 权限，权限偏大，别在公共电脑上填。'
      : '码云的私人令牌在「设置 → 安全设置 → 私人令牌」里生成（勾 <code>projects</code> 就够了），可以随时删除作废。'
        + '注意：码云新建仓库默认是<b>公开</b>的，务必自己确认仓库是「私有」，别把刷题记录公开出去。')
    + '</div>');
  L.push('<div class="small muted" style="margin-top:8px">合并规则：<b>谁的时间戳新用谁的</b>；删掉的记录会在 7 天内带着「墓碑」传播，不会被另一台机器复活。'
    + '每次同步在仓库里留一个提交，历史都能翻：改坏了就在 ' + esc(p.label) + ' 上回退到上一个提交，然后再同步一次。</div>');
  L.push('<div class="small muted" style="margin-top:4px">冲突了怎么办：两台设备同时改同一条，会以后同步那台的时间戳为准（不会丢整份数据，只是这一条以新为准）。</div>');
  L.push('</div>');
  return L.join('');
}
function renderSync() {
  $('view').innerHTML = '<h2 class="sec">云同步</h2>' + syncCardHtml() + syncHelpHtml();
  syncPaintStatus();
  syncBind();
}
function syncPaintStatus() {
  const el = document.getElementById('syncStatusLine');
  if (el) el.innerHTML = syncStatusHtml();
  const box = document.getElementById('syncLogBox');
  if (box) box.innerHTML = SYNC_LOG.map(x => '<div>' + esc(x) + '</div>').join('');
}
function syncReadForm() {
  const v = id => { const el = $(id); return el ? el.value : null; };
  const pv = v('syncProvider'); if (pv) SYC.provider = pv;
  [['syncOwner', 'owner'], ['syncRepo', 'repo'], ['syncBranch', 'branch'], ['syncPath', 'path'], ['syncToken', 'token'], ['syncDevice', 'device']].forEach(p => {
    const x = v(p[0]); if (x != null) SYC[p[0] === 'syncToken' ? 'token' : p[1]] = x.trim();
  });
  if ($('syncAuto')) SYC.auto = !!$('syncAuto').checked;
  document.querySelectorAll('.syncScope').forEach(el => { SYC.scope[el.getAttribute('data-k')] = !!el.checked; });
  SYC.scope.ans = !!SYC.scope.ans;
  if (!SYC.branch) SYC.branch = syncP().branch;
  if (!SYC.path) SYC.path = 'sync/data.json';
  syncSave();
  if (window.SYNC) SYNC.cfg = SYC;
}
function syncBind() {
  ['syncOwner', 'syncRepo', 'syncBranch', 'syncPath', 'syncToken', 'syncDevice', 'syncAuto'].forEach(id => on(id, syncReadForm, 'change'));
  on('syncProvider', () => {
    const before = SYC.provider;
    syncReadForm();
    if (before !== SYC.provider) {
      const oldDef = (SYNC_PROVIDERS[before] || {}).branch;      /* 换服务商时顺手把「默认分支」也换掉 */
      if (!SYC.branch || SYC.branch === oldDef) SYC.branch = syncP().branch;
      syncSave();
      toast('已切到 ' + syncP().label + '　分支默认是 ' + syncP().branch + '，别忘了换 token');
      renderSync();
    }
  }, 'change');
  document.querySelectorAll('.syncScope').forEach(el => el.addEventListener('change', syncReadForm));
  on('syncTokShow', () => { const el = $('syncToken'); if (el) el.type = el.type === 'password' ? 'text' : 'password'; });
  on('syncTest', () => { syncReadForm(); syncTest(); });
  on('syncNow', () => { syncReadForm(); syncNow(false); });
  on('syncPull', () => { syncReadForm(); syncPullOnly(); });
  on('syncPushOnly', () => { syncReadForm(); syncForcePush(); });
  on('syncCreateRepo', () => { syncReadForm(); syncCreateRepo(); });
  on('syncCopyUrl', () => {
    const t = document.createElement('textarea');
    t.value = location.origin + location.pathname; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); toast('网址已复制，发给手机就能打开'); } catch (e) { toast('复制失败，请手动选中'); }
    t.remove();
  });
  on('syncCopyCfg', () => {
    syncReadForm();
    if (!syncReady()) { toast('先把属主、仓库名、token 填完'); return; }
    const link = syncCfgLink();
    const t = document.createElement('textarea');
    t.value = link; document.body.appendChild(t); t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    t.remove();
    toast(ok ? '配置链接已复制：发到手机点开，它会自己填好并同步' : '复制失败，链接是：' + link, ok ? 5000 : 8000);
  });
  on('syncWipe', () => {
    if (!confirm('断开云同步？\n\n会清掉这台设备上保存的 token（记录本身不动）。下次要用得重新填。')) return;
    try { localStorage.removeItem(SYNC_LS); } catch (e) {}
    SYC = readLS(SYNC_LS, null) || {};
    Object.keys(SYNC_DEF).forEach(k => { if (SYC[k] == null) SYC[k] = SYNC_DEF[k]; });
    SYC.scope = Object.assign({}, SYNC_DEF.scope, SYC.scope || {});
    syncLog('已断开，token 已从这台设备清除');
    toast('已断开云同步');
    syncSafeRender();
  });
}

/* ---------- 顶栏按钮 / 首页卡片 ---------- */
function syncTopBtn() {
  let btn = document.getElementById('btnGoSync');
  if (!btn) {
    btn = document.createElement('button');
    btn.className = 'btn tg'; btn.id = 'btnGoSync';
    const kb = document.getElementById('btnGoKb');
    if (kb && kb.parentNode) kb.parentNode.insertBefore(btn, kb.nextSibling);
    else document.querySelector('.top .row').appendChild(btn);
    btn.addEventListener('click', ev => {
      if (ev.shiftKey || ev.altKey) { go('#/sync'); return; }        /* Shift / Alt + 点 = 打开设置页 */
      if (!syncReady()) { go('#/sync'); toast('云同步还没配置：填一下服务商 / 属主 / 仓库 / 令牌'); return; }
      syncNow(false);                                                /* 点一下 = 立即同步（先拉后推） */
    });
    btn.addEventListener('contextmenu', ev => { ev.preventDefault(); go('#/sync'); });
  }
  btn.textContent = SYNC_BUSY ? '同步中' : (SYC.lastErr ? '同步!' : '同步');
  btn.title = (syncReady() ? ('云同步：' + syncSlug() + '（点一下 = 立即同步；Shift+点 或 右键 = 打开设置）　' + syncAgo(SYC.lastAt)) : '云同步：还没配置（点一下去填）')
    + (SYC.lastErr ? ('　上次失败：' + (SYC.lastErr.message || SYC.lastErr.status || '')) : '');
  btn.style.color = SYC.lastErr ? 'var(--bad)' : '';
  return btn;
}
function syncHomeCard() {
  const v = $('view');
  if (!v) return;
  let card = document.getElementById('syncHomeCard');
  if (card) card.remove();
  card = document.createElement('div');
  card.id = 'syncHomeCard';
  card.className = 'card';
  card.style.marginBottom = '12px';
  if (!syncReady()) {
    card.innerHTML = '<b>云同步</b> <span class="small muted">让手机和电脑共用一份刷题记录（可选，用 GitHub / 码云 私有仓库）</span>'
      + '<div class="actions" style="margin-top:8px"><button class="btn small" id="syncHomeGo">去配置</button></div>';
  } else {
    card.innerHTML = '<b>云同步</b> <span class="small muted">' + esc(syncSlug()) + '　' + esc(SYC.lastErr ? '上次失败：' + SYC.lastErr : '上次同步：' + syncAgo(SYC.lastAt)) + '</span>'
      + '<div class="actions" style="margin-top:8px"><button class="btn small" id="syncHomeNow">立即同步</button>'
      + '<button class="btn small" id="syncHomeGo">设置</button></div>';
  }
  v.insertBefore(card, v.firstChild);
  on('syncHomeGo', () => go('#/sync'));
  on('syncHomeNow', () => syncNow(false));
}
function syncAfterRender() {
  const name = (typeof route === 'function' ? route().name : 'home');
  const btn = syncTopBtn();
  /* 以前「同步」按钮在顶栏，答题时会被收起来（免得答题时手滑点到）。
     第二批 2.1 之后它搬进了底部统一导航，是那一条上的第七个常驻入口：
     再按页面显隐会让底部导航一会儿 6 个一会儿 7 个（宽度还会跳），所以一律常显。 */
  btn.style.display = '';
  if (name === 'home') { try { syncHomeCard(); } catch (e) {} }
}
/* ---------- 一键配置链接 ----------
   ?cfg=<base64url(JSON)> —— 手机上懒得手打时，把电脑这边生成好的链接发过去点开即可：
   自动填好服务商 / 属主 / 仓库 / 分支 / token，然后立刻「测试连接 + 立即同步」，并把地址栏里的
   参数清掉（免得留在历史记录里）。JSON 形如 {provider,owner,repo,branch,path,token} */
function syncCfgFromLink() {
  let raw = '';
  try { raw = new URLSearchParams(location.search).get('cfg') || ''; } catch (e) { return false; }
  if (!raw) return false;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64 + '==='.slice((b64.length + 3) % 4))));
    const c = JSON.parse(json);
    if (!c || !c.owner || !c.repo || !c.token) { toast('链接里的云同步配置不完整'); return false; }
    SYC.provider = String(c.provider || 'gitee');
    SYC.owner = String(c.owner).trim();
    SYC.repo = String(c.repo).trim();
    SYC.branch = String(c.branch || syncP().branch).trim();
    SYC.path = String(c.path || SYC.path || 'sync/data.json');
    SYC.token = String(c.token).trim();
    SYC.lastErr = ''; SYC.lastSha = ''; SYC.lastAt = 0;
    writeLS(SYNC_LS, SYC);
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    toast('已按链接填好云同步配置，正在测试连接…', 4000);
    setTimeout(async () => {
      const r = await syncTest();
      if (r && r.ok) { toast('连接成功，开始同步…', 3000); await syncNow(false); }
      else toast('配置已填好，但连接失败：' + ((r && r.err && r.err.message) || '看页面上的提示'), 6000);
    }, 600);
    return true;
  } catch (e) {
    toast('链接里的配置读不出来（' + (e.message || '格式不对') + '）');
    return false;
  }
}
/* 站点自己那套「导出配置 / 复制给手机」用的编码 */
function syncCfgLink() {
  const c = { provider: SYC.provider, owner: SYC.owner, repo: SYC.repo, branch: SYC.branch, path: SYC.path, token: SYC.token };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(c)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return location.origin + location.pathname + '?cfg=' + b64 + '#/sync';
}
window.addEventListener('hashchange', syncAfterRender);
window.addEventListener('load', () => { try { syncAfterRender(); } catch (e) {} });
/* 每次 render() 之后都要补一次（render 会整个换掉 #view，首页卡片会被清掉） */
try {
  const _render = window.render;
  if (typeof _render === 'function' && !_render.__syncWrapped) {
    const wrapped = function () { const out = _render.apply(this, arguments); try { syncAfterRender(); } catch (e) {} return out; };
    wrapped.__syncWrapped = true;
    window.render = wrapped;
  }
} catch (e) {}
/* 设置面板里的「云同步（电脑 ↔ 手机）」按钮 */
try { on('goSync2', () => { if (typeof closeAll === 'function') closeAll(); go('#/sync'); }); } catch (e) {}
/* 删掉一个「自己导入的资料库」时记一笔账，别的设备同步时也跟着删（不然会被推回来） */
try {
  const _kbRemove = window.kbRemove;
  if (typeof _kbRemove === 'function' && !_kbRemove.__syncWrapped) {
    const wrapped = function (id) {
      const out = _kbRemove.apply(this, arguments);
      try { if (String(id).indexOf('file:') !== 0) syncKbDropAdd(id); } catch (e) {}
      return out;
    };
    wrapped.__syncWrapped = true;
    window.kbRemove = wrapped;
  }
} catch (e) {}
setTimeout(() => {
  let fromLink = false;
  try { fromLink = syncCfgFromLink(); } catch (e) {}
  if (fromLink) { try { go('#/sync'); renderSync(); } catch (e) {} }
  try { syncStart(); syncAfterRender(); } catch (e) {}
}, 800);

window.SYNC = {
  now: syncNow, pull: syncPullOnly, push: syncForcePush, test: syncTest,
  cfg: SYC, payload: syncPayload, fp: syncFp, device: syncDevice, render: renderSync
};
