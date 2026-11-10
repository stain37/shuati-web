/* Service Worker：让刷题站能离线打开、能装到手机主屏
   策略：
     · 页面导航：网络优先，断网回落首页；
     · 静态资源（js/css/图标）：stale-while-revalidate —— 先用缓存立刻出页面，
       同时在后台拉最新的写回缓存（下一次打开就是新的）；
     · 知识库.js / AI配置.js（可能几 MB）：网络优先，成功写缓存，断网时吃缓存 ——
       这样第一次加载不会白等，离线也能用资料；知识库.js 同时在安装时预缓存一份，
       所以装到手机主屏之后断网打开，资料库照样能搜。
   改了 app.js / style.css 等内容后，把 VERSION 加一即可让旧缓存失效。 */
/* web278（2026-11-05）：作答页新增「🔍 相似题」—— sim.js 本地 2-gram 余弦 + 标签加成排候选，可让 AI 精排并给理由，点条目直接跳过去 */
const VERSION = 'shuati-v68-web689';  /* web272: 删掉「隐藏批注」整套（工具行那颗 👁 与右侧浮起的按钮都不再有，批注永远显示）；批注显示层只在答题/模考页出现，回到主界面立刻收起清空；反馈面板带解析时不再自动收起（只有没解析的纯对错反馈才 18 秒后收）。 web271: 小窗按钮改由题目工具行直接渲染（不再由 pip.js 900ms 后插入，翻题不再有迟到插入造成的跳动）；速刷答错那条悬浮 6 秒自动淡出、点一下立刻收；答错反馈面板 18 秒才自动收起且滚动/触摸会重新计时；翻题回顶改瞬时。 web269: 设置里加「动效速度」（慢 .7 / 标准 1 / 快 1.4 / 很快 1.8），fxs.css 与 anim.css 的时长都乘 --fx-inv，TR 换页与 MO 缓动也跟它走 */
// web268: 去掉答对/答错时反馈行 .fb .res 的缩放（整行块级元素 scale 会被看成左右晃）
// web267: 新增 fxs.css / fxs.js，把 20 个动效规格逐条落到具体位置（答题换题左右滑、列表错开入场、toast 自上下落、反馈面板上滑、收藏星标弹跳、弹窗缩小淡出、思考三点、骨架脉冲、进度条光泽、底栏胶囊形态过渡、正文链接下划线绘制…）；web266: 换页转场（照 MUI Transitions：Grow 从你点的位置长出来 / 平级页面按底栏顺序左右滑 / Fade 兜底，旧页先退场 120ms）；web265: 底栏胶囊 / 掌握度进度条改走弹簧缓动（先冲过头约 6% 再回坐），退出专注按钮移到右上角，答错后的反馈面板 10 秒自动收起、留一颗「❌ 答错了 · 点开看解析」胶囊可再展开，暗色下反馈面板改深底；web264: 掌握度页行布局（刷错题按钮不再被裁）；web263: 缓动引擎 MO（每帧朝目标逼近，可打断+吸附）驱动底栏胶囊、右侧阅读进度条、掌握度进度条；web262: 数字滚动 + 按钮涟漪 + 修首页奶油卡片白字看不清；web261: 手机平台层（dvh / 触控回弹 / 悬停粘滞 / 输入框放大 / 状态栏配色）；web260: 手机答题页工具行重排（专注·口诀·收藏在右上、其余横滑一行、卡片顶部系统式拖动横杠、长按排除整格、横向误触翻题已挡住）；web259: 换页入场动画不再闪两下（.view-enter 摘下后回落到 #view{animation:viewIn} 会重播一遍，用 #view:not(.view-enter){animation:none} 按住）； web258: 新增 csv.js（题库 CSV 导入导出）+ mastery.js（掌握度复盘：按科目/考点看正确率，差考点可一键组套卷）+ 手机答题页筛选开关；web256: 手机答题页把「六科 / 全部·没做·单选…」两行收进顶栏「筛选」开关（默认收起，点 chip 自动收起）；web255: 手机答题页单手规格——题目工具行改成单行横向滑动（题干提前一屏）、选项触控 56px/16px、题干 16px/1.7；web254: 动效层 anim.css（animate.css 思路：列表错峰入场、面板弹出、toast 回弹、导航按压、骨架扫光）；web253: 白板大改（笔迹按 Excalidraw freedraw 重写：重采样+压力配宽+起收笔收尖，新增选择移动/撤销重做/快捷键/整笔擦/虚线填充/导出PNG）；web252: 知识库页改成文件管理器式——搜索 / 排序(字数·段数·篇数·名字·时间) / 网格-列表切换 / 批量条(导出·删除·取消勾选) / 删除可撤销 / 各库段数占比条 / 空态；web251: 分页继续压留白——本页放不下的题会把「解析」续到下一页（题干选项不拆），不够省页时自动不拆；web250: 导出 PDF 改成内容感知分页——整题不切断、每页带页眉页脚和页码，并修掉老版「导出只剩笔迹没有题目」的整图替换；web236: 修好 index.html / sw.js 的 GBK 乱码（整个页面被当成文本显示、标签和换行丢失）；web227: 题目右上角新增批注/白板/重做/导出，批注跟着题走、空白板存本机手稿历史，可导出 HTML/PDF；web226: 答题条左侧新增「重做题库 / 仅错题」，错题可被订正（fixed），累计错次仍保留；web224: 删掉正在考的那份套卷会同时结束考试，不再反复提示；web223: 模拟考试离开不再弹确认框、倒计时真的暂停并可续；web222: 云同步合并按时间戳取新（旧云端不再冲掉刚做的复习排期）；web221: 文件夹墓碑（删了不再复活）、SRS 不再反复重入；web220: 「📎 看资料」按钮挪到「⋯ 更多」旁边、小章不再丢；web219 只看资料；web218 大字模式
  // web260: 答题页顶部横杠（取代 ⠿ 拖动钮）、专注/口诀置右加大、工具行独立可横滑不误触翻页、长按排除整格生效、整页入场动画关闭；
// web254: 动效层 anim.css（animate.css 思路：列表错峰入场、面板弹出、toast 回弹、导航按压、骨架扫光）
// web217: SRS 认识/模糊/忘记三档各自算间隔 + 更多抽屉居中且速刷也有 + win95开始按钮不再压科目栏 + 解析就地粘贴表格 + 题库删除账本
const CORE = [
  /* 只预缓存「能打开页面」的最小一组：装到主屏后断网也能进站。
     其它 js/css/字体第一次用到时由下面的 stale-while-revalidate 自动进缓存，
     不再每次升版本都把整套（约 2 MB）重下一遍 —— 那是手机上流量掉得快的真凶。 */
  './',
    './style.css',
  './app.js',
  './install.js',
  './manifest.json'
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
