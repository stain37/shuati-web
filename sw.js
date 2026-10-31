/* Service Worker：让刷题站能离线打开、能装到手机主屏
   策略：
     · 页面导航：网络优先，断网回落首页；
     · 静态资源（js/css/图标）：stale-while-revalidate —— 先用缓存立刻出页面，
       同时在后台拉最新的写回缓存（下一次打开就是新的）；
     · 知识库.js / AI配置.js（可能几 MB）：网络优先，成功写缓存，断网时吃缓存 ——
       这样第一次加载不会白等，离线也能用资料；知识库.js 同时在安装时预缓存一份，
       所以装到手机主屏之后断网打开，资料库照样能搜。
   改了 app.js / style.css 等内容后，把 VERSION 加一即可让旧缓存失效。 */
const VERSION = 'shuati-v68-web188';  // 2026-10-18：AI 操作层阶段 1 加固（web101）+ 导入页 AI 标准化（web103）+ 技能包（web104）+ agent loop（web105）+ 图表渲染（web106）+ 技能内置化（web107）+ 批量删除标签（web108）+ 考点词表一键清除（web109）+ 记忆曲线按自然日（web110）+ 清除残留 tml>（web111）+ 速刷答错停住/随机跳题（web112）+ 改解析拖拽图片（web113）+ 专注模式隐藏返回键（web114）+ AI 标签重打/套卷标签行（web115）+ 一键到底/到顶（web116）+ AI 模糊搜索（web117）+ 词表按钮修复（web118）+ 标签无关键词筛选（web119）+ 五大基本标签（web120）+ 五科批量/互斥（web121）+ 题库工具折叠（web122）+ 目录角标/长按时间窗（web123）+ 六科基本标签/特征库（web124）+ 刷题六科筛选（web125）+ 套卷六科按原题/未选（web126）+ 抽屉遮挡/模考结果逐题改（web127）+ 内置默认词表/按考点两排筛选（web128）+ 题目→标签判别库/清除已打标签（web129）+ 考点列表分页/搜索（web130）+ 主界面翻页/套卷搜索/总导航（web131）+ 图标大小分页容量（web132）+ 进目录不弹顶（web133）+ 可拖动吸附总导航（web134）+ 底栏滑动指示器（web135）+ 判分轻反馈（web136）+ 标签同步墓碑（web137）+ 答题页隐藏标签（web138）+ 打标签不丢六科（web139）+ 10 套配色 / 背景氛围（web140）+ 视频背景（web141）+ 背景亮度/面板透明度（web142）+ 答题抽屉层级（web143）+ 批 A：题库改名真正落盘/套卷改名/加移出错题本/主页上传入口/变式单删+同步/长按排除选项/人文候选池/单库一键分类（web144）+ 搜索按题库筛选/题库名与标签进命中范围/库内 AI 模糊开关/变式单选多选分开/解析颜色浮条不串台（web145）+ 表格转义竖线/图片尺寸语法/解析图片拖宽/粘贴与拖拽插图/答题页改题目/KaTeX 公式渲染（web146）+ 一键贴标签整批重试/开跑快照可撤销/写后校验（web147）+ 解析块排序第一轮：块把手拖动换整块位置（段落/表格/图片）（web148）+ 西综 165 题 / 300 分分值按题号计分（web149）+ 知识库标题路径加权字段/参考资料 ID·Path 装配/AI 规划器 few-shot 与一次重试（web150）+ 参考资料按段编号/切片重排缓存/重排喂料带标题（web151）+ 题库排序新增「按名称 / 最近添加」（建库时间落盘，web152）+ 解析块操作条：复制 / 上移 / 下移 / 插入空段落 / 删除，操作即落盘（web153）+ 图片区 ⠿ 拖动调整图片先后顺序并落盘（web154）+ 题干 / 共用题干 / 选项里的 $公式$ 也渲染 KaTeX（web155） + markdown 编辑器：代码块语言名与复制按钮 / 嵌套列表 / 任务清单勾选框 / 删除线 / 行首斜杠菜单插块（web156） + 解析编辑撤销/重做（Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y，块操作与斜杠换块也能撤）+ 浮条按选区矩形定位并反显当前格式（web157） + 对话历史按 token 预算整组裁剪 / 等待分级提示（10/15/45 秒）/ 知识库低置信段落过滤、空命中与单源提示（web158） + agent 工具轨迹四态（✅成功/⚠失败/⏳未执行/♻复用）+ 耗时 + 重复动作检测（web159） + markdown 提示框 > [!tip]/[!warning] 与斜杠菜单「提示框」，双向往返（web160） + 右键菜单：解析块右键（复制/上移/下移/插入/删除、加粗斜体删除线、行内代码、转成标题清单引用）+ 题目卡片右键（打开/收藏/错题本/复制题干解析，多选批量）+ 触屏长按 480ms（web163） + 题库选择器改成居中弹层不再压住筛选栏 / 块排序把手热区加宽并在左侧沟槽也能唤出 / 答题浮块拖完不再被点击切回且能拉大小 / 考点标签回到正文内联（面板按钮可点）/ 「口诀思路」改成只在本页的独立浮窗（可拖可缩放）/ 解析折叠 / 正文颜色自选 + 标签同步按逐题时间戳（云端较新的覆盖本机，web164） + 第 6 条题型筛选（A1/A2/B1/X，答题页 / 错题 / 收藏 / 搜索）/ 考点词表按六大科目分组并可往指定科加考点 / 标签搜索 AI 模糊（考点行 / 错题本 / 搜索页）/ 变式题解析渲染公式与图表 / 题块拖动吸附与缩放 / 导入页 AI 标准化长内容分段整理并可保存后先复习 N 道（web172） + 题干/共用题干/选项里的公式与行内 markdown 渲染、标签同步按题库名+题号重映射（web174） + 预缓存只留最小外壳（升版本不再整套重下）、AI 面板按网络状况延迟加载资料库、同步页显示本次流量、标签墓碑不再永久挡住重打（web175） + 资料库拆成目录 + 按库分片，打开页面不再拉 6.4 MB，只下用到的那一本、知识库.js 从 6.11 MB 变 446 字节（web176） + 选项字母放开到 L（改答案面板 / 键盘 A–L）、右键菜单跟随滚动只搬不关、解析最后一块也能删、口诀浮窗右上角 × 可点、解析里的图片可拖动换位置、列表 Tab 缩进与空项 Enter 退出、附件可删可悬停预览、「资料 N」点开浮层看原文、参考资料不再被压扁、无技能时「根据知识点出题」不再错路由、双反斜杠 LaTeX 与 root(( )) 思维导图不再漏出源码（web178） + 调试钩子 window.aiSrcHits 与真身重名导致云同步报「(h || []).slice is not a function」，钩子改名 aiSrcDebugHits、同步页参考资料读取与云端合并各加兜底、重画页面出错不再冒充「同步失败」（web179） + 知识库资料挂载与 AI配置.js 各加「只挂一次」标记，修掉打开知识库页 render 自己叫自己、5 秒重挂 1000 多次脚本导致整页点不动打不了字（web180） + AI 设置新增「向量接口地址」（留空＝同上面的接口地址），聊天走云端、向量走本机 127.0.0.1 自建 embeddings 服务可并存（web181） + 修 web180 引入的回归：知识库页的 6 本内置资料库一度整排消失（引导脚本异步挂 kb/manifest.js，目录晚到就被「只挂一次」挡住了），现在到点自动补书单（web182） + ② 知识库加「一键建向量」：按钮 + 进度条，自动分段/逐段建/存浏览器，断了能续（web183） + 复习日历（按月翻页、点某天看卡片、未来 30 天只读预览）+ 三档反馈（认识/模糊/忘记，做完自己选，默认对=认识、错=忘记）+ 逾期卡片堆到当天开关 + 把未来 30 天的卡片加到今天（web184） + 界面风格（皮肤）7 套：清爽/新野兽派/毛玻璃/粘土拟态/编辑杂志/像素 8-bit/极简扁平，在 设置 → 外观 里切，边框/圆角/阴影/字体气质一起变（web185） + 17 套界面风格（新增 Y2K 千禧/孟菲斯/包豪斯/Risograph/复古怀旧/赛博霓虹/铅笔手绘/水彩晕染/哥特/酸性平面），设置里改成缩略图点选 + 换风格时自动配一套主推主题色（web186） + 界面风格扩到 50 套（新古典/巴洛克/装饰艺术/新艺术/蒸汽朋克/维多利亚/点彩/波普/草图/手账/超现实/暗色调/瑞士/功利/奢华字体/世纪中叶/材料/北欧/赛博朋克/涂鸦/垃圾摇滚/合成波/蒸汽波/迪斯科/中国水墨/日式禅意/浮世绘/青花瓷/曼海蒂/阿拉伯几何/莫兰迪/马卡龙/单色调），设置里按 7 大类筛选点选；其中 24 套叠了自绘 SVG 材质（pat/*.svg，波普网点、浮世绘青海波、阿拉伯星格、扫描线等）（web187） + 50 套皮肤重排：删掉 10 套跟别人太像的（维多利亚/孟菲斯/蒸汽波/材料/单色调/涂鸦/垃圾摇滚/北欧/功利/赛博），补 10 套全新的（复古窗口 95/蓝图/终端/报纸/贴纸/票根/全息/极光/植物图鉴/珐琅徽章），其余皮肤改背景、形状、字体把反差拉开（新古典金框、巴洛克酒红、装饰艺术放射线、瑞士红条、杂志书脊线、水墨装裱、浮世绘海浪、青花缠枝、星格拱顶…），深色皮肤的首页渐变条也压暗了（web188）
const CORE = [
  /* 只预缓存「能打开页面」的最小一组：装到主屏后断网也能进站。
     其它 js/css/字体第一次用到时由下面的 stale-while-revalidate 自动进缓存，
     不再每次升版本都把整套（约 2 MB）重下一遍 —— 那是手机上流量掉得快的真凶。 */
  './',
  './index.html',
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
