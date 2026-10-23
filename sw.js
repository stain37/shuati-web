/* Service Worker：让刷题站能离线打开、能装到手机主屏
   策略：
     · 页面导航：网络优先，断网回落首页；
     · 静态资源（js/css/图标）：stale-while-revalidate —— 先用缓存立刻出页面，
       同时在后台拉最新的写回缓存（下一次打开就是新的）；
     · 知识库.js / AI配置.js（可能几 MB）：网络优先，成功写缓存，断网时吃缓存 ——
       这样第一次加载不会白等，离线也能用资料；知识库.js 同时在安装时预缓存一份，
       所以装到手机主屏之后断网打开，资料库照样能搜。
   改了 app.js / style.css 等内容后，把 VERSION 加一即可让旧缓存失效。 */
const VERSION = 'shuati-v68-web146';  // 2026-10-18：AI 操作层阶段 1 加固（web101）+ 导入页 AI 标准化（web103）+ 技能包（web104）+ agent loop（web105）+ 图表渲染（web106）+ 技能内置化（web107）+ 批量删除标签（web108）+ 考点词表一键清除（web109）+ 记忆曲线按自然日（web110）+ 清除残留 tml>（web111）+ 速刷答错停住/随机跳题（web112）+ 改解析拖拽图片（web113）+ 专注模式隐藏返回键（web114）+ AI 标签重打/套卷标签行（web115）+ 一键到底/到顶（web116）+ AI 模糊搜索（web117）+ 词表按钮修复（web118）+ 标签无关键词筛选（web119）+ 五大基本标签（web120）+ 五科批量/互斥（web121）+ 题库工具折叠（web122）+ 目录角标/长按时间窗（web123）+ 六科基本标签/特征库（web124）+ 刷题六科筛选（web125）+ 套卷六科按原题/未选（web126）+ 抽屉遮挡/模考结果逐题改（web127）+ 内置默认词表/按考点两排筛选（web128）+ 题目→标签判别库/清除已打标签（web129）+ 考点列表分页/搜索（web130）+ 主界面翻页/套卷搜索/总导航（web131）+ 图标大小分页容量（web132）+ 进目录不弹顶（web133）+ 可拖动吸附总导航（web134）+ 底栏滑动指示器（web135）+ 判分轻反馈（web136）+ 标签同步墓碑（web137）+ 答题页隐藏标签（web138）+ 打标签不丢六科（web139）+ 10 套配色 / 背景氛围（web140）+ 视频背景（web141）+ 背景亮度/面板透明度（web142）+ 答题抽屉层级（web143）+ 批 A：题库改名真正落盘/套卷改名/加移出错题本/主页上传入口/变式单删+同步/长按排除选项/人文候选池/单库一键分类（web144）+ 搜索按题库筛选/题库名与标签进命中范围/库内 AI 模糊开关/变式单选多选分开/解析颜色浮条不串台（web145）+ 表格转义竖线/图片尺寸语法/解析图片拖宽/粘贴与拖拽插图/答题页改题目/KaTeX 公式渲染（web146）
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
  './guide.js',
  './guide.css',
  './chat.js',
  './skills.js',
  './ai-ops.js',
  './chat.css',
  './diagram.css',
  './diagram.js',
  './motion.css',
  './motion.js',
  './bf.js',
  './bfui.js',
  './bfui.css',
  './bf-folder.js',
  './bf-folder.css',
  './知识库.js',
  './vendor/katex/katex.min.js',
  './vendor/katex/katex.min.css',
  './vendor/katex/fonts/KaTeX_AMS-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Main-Bold.woff2',
  './vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2',
  './vendor/katex/fonts/KaTeX_Main-Italic.woff2',
  './vendor/katex/fonts/KaTeX_Main-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2',
  './vendor/katex/fonts/KaTeX_Math-Italic.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2',
  './vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Script-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size1-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size2-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size3-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Size4-Regular.woff2',
  './vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2',
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
