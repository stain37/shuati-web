/* Service Worker：让刷题站能离线打开、能装到手机主屏
   策略：
     · 页面导航：网络优先，断网回落首页；
     · 静态资源（js/css/图标）：stale-while-revalidate —— 先用缓存立刻出页面，
       同时在后台拉最新的写回缓存（下一次打开就是新的）；
     · 知识库.js / AI配置.js（可能几 MB）：网络优先，成功写缓存，断网时吃缓存 ——
       这样第一次加载不会白等，离线也能用资料；知识库.js 同时在安装时预缓存一份，
       所以装到手机主屏之后断网打开，资料库照样能搜。
   改了 app.js / style.css 等内容后，把 VERSION 加一即可让旧缓存失效。 */
const VERSION = 'shuati-v67-web84';   // 2026-10-16：存入本题解析 → 存完直接把正文写进页面上那条解析里（不再依赖重画，绕开「存了不变」）；上一版：确认行加字数
const CORE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './collection.js',
  './exam.js',
  './kb.js',
  './ai.js',
  './sync.js',
  './fx.js',
  './variant.js',
  './tags.js',
  './report.js',
  './cat.js',
  './cat.css',
  './bf.js',
  './bfui.js',
  './bfui.css',
  './bf-folder.js',
  './bf-folder.css',
  './知识库.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.all(CORE.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
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
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  /* 其它静态资源：先用缓存立刻出页面，同时在后台拉最新的写回缓存 */
  const netP = fetch(req)
    .then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
  e.waitUntil(netP.then(() => null).catch(() => null));
  e.respondWith(
    caches.match(req).then(hit => hit || netP.then(res => res || (isViewer ? new Response('离线，而且阅读器还没缓存过', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }) : caches.match('./index.html'))))
  );
});
