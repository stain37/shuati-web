/* Service Worker：让刷题站能离线打开、能装到手机主屏
   策略：
     · 页面导航：网络优先，断网回落首页；
     · 静态资源（js/css/图标）：stale-while-revalidate —— 先用缓存立刻出页面，
       同时在后台拉最新的写回缓存（下一次打开就是新的）；
     · 知识库.js / AI配置.js（可能几 MB）：网络优先，成功写缓存，断网时吃缓存 ——
       这样第一次加载不会白等，离线也能用资料；知识库.js 同时在安装时预缓存一份，
       所以装到手机主屏之后断网打开，资料库照样能搜。
   改了 app.js / style.css 等内容后，把 VERSION 加一即可让旧缓存失效。 */
const VERSION = 'shuati-v68-web241';  // web236: 修好 index.html / sw.js 的 GBK 乱码（整个页面被当成文本显示、标签和换行丢失）；web227: 题目右上角新增批注/白板/重做/导出，批注跟着题走、空白板存本机手稿历史，可导出 HTML/PDF；web226: 答题条左侧新增「重做题库 / 仅错题」，错题可被订正（fixed），累计错次仍保留；web224: 删掉正在考的那份套卷会同时结束考试，不再反复提示；web223: 模拟考试离开不再弹确认框、倒计时真的暂停并可续；web222: 云同步合并按时间戳取新（旧云端不再冲掉刚做的复习排期）；web221: 文件夹墓碑（删了不再复活）、SRS 不再反复重入；web220: 「📎 看资料」按钮挪到「⋯ 更多」旁边、小章不再丢；web219 只看资料；web218 大字模式
// web217: SRS 认识/模糊/忘记三档各自算间隔 + 更多抽屉居中且速刷也有 + win95开始按钮不再压科目栏 + 解析就地粘贴表格 + 题库删除账本
const CORE = [
  /* 只预缓存「能打开页面」的最小一组：装到主屏后断网也能进站。
     其它 js/css/字体第一次用到时由下面的 stale-while-revalidate 自动进缓存，
     不再每次升版本都把整套（约 2 MB）重下一遍 —— 那是手机上流量掉得快的真凶。 */
  './',
    './style.css',
  './app.js'
];

const SITE_CACHE = 'shuati-site-' + VERSION;   /* 站点资源：升版本时清空 */
const DATA_CACHE = 'shuati-data-v1';           /* 资料 / 配置：跨版本保留 */

/* 条件重验：带 no-cache 让浏览器用 If-None-Match 问服务器，没变就是 304（几乎不耗流量） */
/* 静态资源按 pathname 存取：index.html 里 js/css 都带 ?v=戳，带参就用不上缓存 */
const STATIC_RE = /\.(js|css|mjs|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/i;
function cacheKey(req) {
  try {
    const u = new URL(req.url);
    if (u.origin !== location.origin) return req;
    if (STATIC_RE.test(u.pathname)) return new Request(u.origin + u.pathname);
  } catch (e) {}
  return req;
}

function revalidate(req) {
  let r;
  try { r = new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }); }
  catch (e) { r = req; }
  return fetch(r).then(res => {
    if (res && res.status === 200 && res.type === 'basic') {
      const copy = res.clone();
      caches.open(SITE_CACHE).then(c => c.put(cacheKey(req), copy)).catch(() => {});
    }
    return res;
  }).catch(() => null);
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SITE_CACHE)
      .then(c => Promise.all(CORE.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== SITE_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;

  /* PDF 一律不管（直接放给服务器）：
     ① 站点目录里的 pdf\ 是本机几十 MB 的精编版，不该进 SW 缓存；
     ② 导航到 PDF 如果被 SW 接管，一旦取不到就会回落成缓存的 index.html ——
        用户看到的是「刷题站首页」而不是 PDF（2026-10-16 踩到的坑）；
     ③ Chrome 的 PDF 阅读器需要 Range 请求原生处理，绕开 SW 最稳。 */
  let isPdf = false;
  try { isPdf = /\.pdf$/i.test(decodeURIComponent(url.pathname)); } catch (err) {}
  if (isPdf) return;

  /* 站内网页阅读器（pdfjs\，手机看原页用的）：它是个**普通网页**，只是常常以 iframe 的形式被打开。
     ① 它的导航请求不能走下面那条「取不到就回落 index.html」——不然阅读器框里会跳出整个刷题站首页（跟 PDF 那条红线同一类坑）；
     ② 它的静态资源（viewer.mjs / pdf.worker.mjs 那 4 MB）走普通静态资源的缓存策略就对了。*/
  let isViewer = false;
  try { isViewer = /\/pdfjs\//.test(decodeURIComponent(url.pathname)); } catch (err) {}

  /* 页面导航：网络优先，断网回落首页（阅读器除外） */
  if (req.mode === 'navigate' && !isViewer) {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  /* 资料 / 配置（可能几 MB）：网络优先（本地服务器上很快），成功就更新缓存，断网回落缓存 */
  let dataFile = false;
  try { dataFile = /\/(知识库|AI配置)\.js$/.test(decodeURIComponent(url.pathname)); } catch (err) {}

  if (dataFile) {
    e.respondWith((async () => {
      const dc = await caches.open(DATA_CACHE);
      const hit = await dc.match(cacheKey(req));
      /* 先问服务器变没变：304 就继续用缓存（几乎不耗流量）；200 才整份重下 */
      let fresh = null;
      try {
        const r = await fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }));
        if (r && r.status === 200 && r.type === 'basic') fresh = r;
      } catch (err) {}
      if (fresh) { dc.put(cacheKey(req), fresh.clone()).catch(() => {}); return fresh; }
      if (hit) return hit;
      return fetch(req);
    })());
    return;
  }

  /* 其它静态资源：缓存优先；后台只做条件重验（没变 304，几乎不耗流量） */
  e.respondWith((async () => {
    const hit = await caches.match(cacheKey(req));
    const netP = revalidate(req);
    if (hit) {
      e.waitUntil(netP.then(() => null).catch(() => null));
      return hit;
    }
    const res = await netP;
    if (res) return res;
    if (isViewer) return new Response('离线，而且阅读器还没缓存过', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return (await caches.match('./index.html')) || Response.error();
  })());
});
