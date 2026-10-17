/* ============================================================
   刷题站 · 新手引导 guide.js
   ————————————————————————————————————————————————
   解决的事：
     1) 第一次打开这个站（本机还没有任何数据）→ 自动弹一遍「真小白」流程：
        导入题库 → 制作题库 → 配知识库 → 配 AI（API Key）→ 云同步；
     2) 每一步「点哪里、填什么」都写在卡片里，页面上的对应位置会用虚线框挖出来；
     3) 随时能「跳过全部」；已经用过这个站/走过一遍的，不再自动弹；
     4) 忘了或误跳过的：⚙ 设置 →「🎓 新手引导 / 基础用法」，
        点哪一段看哪一段（快捷键帮助面板 ? 里也有入口）。

   状态：qbank.guide.v1 = { done, skipped, ts }
     - done   = 完整走过一遍
     - skipped = 用户跳过 / 关掉过（都不再自动弹）
   本文件不依赖任何框架；页面重画不影响它（挂 body 上，跟 #view 无关）。
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'qbank.guide.v1';

  function $id(id) { return document.getElementById(id); }
  function E(s) {
    if (typeof window.esc === 'function') return window.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function readState() {
    try { var v = JSON.parse(localStorage.getItem(KEY)); return (v && typeof v === 'object') ? v : {}; }
    catch (e) { return {}; }
  }
  function writeState(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
  }
  /* 本机已经用过这个站吗（有作答 / 自建题库 / 套卷）——用过就不再自动弹，别烦人 */
  function hasUsed() {
    try {
      var a = JSON.parse(localStorage.getItem('qbank.answers.v2') || '{}');
      if (a && Object.keys(a).length) return true;
      var b = JSON.parse(localStorage.getItem('qbank.local.v2') || '[]');
      if (Array.isArray(b) && b.length) return true;
      var p = JSON.parse(localStorage.getItem('qbank.papers.v2') || '[]');
      if (Array.isArray(p) && p.length) return true;
      /* 配过 AI / 配过云同步也算「用过」——但要注意：光打开 #/kb 页面，ai.js 会把默认模型清单写进
         qbank.ai.v1（base/默认模型），那不算用户配置。这里只认「填过 Key」或「自己改过配置」。 */
      var ai = JSON.parse(localStorage.getItem('qbank.ai.v1') || '{}');
      if (ai && (ai.key || ai.cfgAuto === false)) return true;
      var sy = JSON.parse(localStorage.getItem('qbank.sync.v1') || '{}');
      if (sy && (sy.owner || sy.token)) return true;
    } catch (e) {}
    return false;
  }

  /* ---------- 每一段引导的内容 ---------- */
  var WELCOME = {
    id: 'hello', center: true, route: '#/',
    title: '第一次用？先花两分钟看一遍',
    html: '<p>这个站是<b>纯本机</b>的刷题站：题库和作答记录都存在你自己的浏览器里。</p>'
      + '<p>下面按顺序走一遍，一共 6 段，每段两三步：</p>'
      + '<ul><li><b>导入题库</b> —— 把现成的题库文件放进来</li>'
      + '<li><b>制作题库</b> —— 没有现成的？照着格式自己写</li>'
      + '<li><b>配知识库</b> —— 让 AI 写解析时能引用教材资料</li>'
      + '<li><b>配 AI</b> —— 填一个 API Key（或用本机免费模型）</li>'
      + '<li><b>云同步</b> —— 电脑和手机共用一份记录</li>'
      + '<li><b>AI 对话</b> —— 一个对话框：出题 / 问知识点 / 分析题库</li></ul>'
      + '<p class="muted small">不想看可以「跳过全部」；以后忘了：底部 ⚙ 设置 →「🎓 新手引导 / 基础用法」，点哪段看哪段。</p>'
  };

  var CHAPTERS = [
    {
      id: 'import', name: '导入题库', menuLabel: '① 导入现成题库', menuNote: '从 .txt / .json 文件或粘贴导入',
      steps: [
        {
          id: 'import-1', title: '① 把现成的题库导进来',
          route: '#/import', target: '#ta',
          html: '<p>题库就是一个 <b>.txt / .json</b> 文件（群里拿的、老师发的、学长整理的都行）。两种办法二选一：</p>'
            + '<ul><li>点下面的「<b>从文件读取</b>」，选中那个文件；</li>'
            + '<li>或者用记事本打开，全选复制，粘到<b>高亮的大框</b>里。</li></ul>'
            + '<p class="muted small">粘完先别急着保存 —— 下一步先「解析预览」。</p>'
        },
        {
          id: 'import-2', title: '先预览，再保存',
          target: '#view .actions',
          html: '<p>点「<b>解析预览</b>」：下面会显示认出来几道题；如果和已有题库重复，它只提醒、不拦。</p>'
            + '<p>没问题再点「<b>保存题库</b>」。保存后回首页，这个题库就在列表里了，点「开始」就能刷。</p>'
            + '<p class="muted small">小提示：题干和选项有错的，可以先导入、再在「题目管理」里改或删。</p>'
        }
      ]
    },
    {
      id: 'make', name: '制作题库', menuLabel: '② 自己做题库（格式）', menuNote: '照模板改，三分钟做出第一套',
      steps: [
        {
          id: 'make-1', title: '② 自己做题库：格式就几行',
          route: '#/import', target: '#view details.card',
          html: '<p>没有现成题库也能自己做。一条题就这几行：</p>'
            + '<pre># 我的题库\n\n1. 题干写在这里\nA. 选项一\nB. 选项二\nC. 选项三\nD. 选项四\n答案：D\n解析：写为什么（可留空）</pre>'
            + '<ul><li><b># 名称</b> = 题库名；<b>## 病例</b> = 后面题的共用题干（B 型题很好用）</li>'
            + '<li>多选把答案连写：<b>答案：ABD</b></li>'
            + '<li>也认 JSON（模板最后一页有例子）</li></ul>'
        },
        {
          id: 'make-2', title: '用「填入示例格式」起步',
          target: '#doFormat',
          html: '<p>不知道从哪下手：点这个「<b>填入示例格式</b>」，框里会填好一段范例题。</p>'
            + '<p>照着抄、改成你的题 →「解析预览」→「保存题库」，第一套题库就成了。</p>'
            + '<p class="muted small">以后想批量做：用 Excel 或记事本按上面的格式整理好，粘进来一次导入。</p>'
        }
      ]
    },
    {
      id: 'kb', name: '配知识库', menuLabel: '③ 配知识库（资料库）', menuNote: '内置 5 套资料；也能加自己的书',
      steps: [
        {
          id: 'kb-1', title: '③ 知识库：AI 的「参考资料」',
          route: '#/kb', tab: 'kb', target: '#kbRows',
          html: '<p>知识库就是你的教材 / 讲义全文。点「AI 解析」时，它会先在里面搜相关段落，解析下面还能点开「参考资料」看到 PDF 第几页。</p>'
            + '<p>这个版本已经内置 5 套：<b>外科 / 内科 / 生化 / 生理 / 病理</b>，就是下面这些条目。</p>'
            + '<p class="muted small">第一次打开时资料库要下载几秒钟，列表会自己出现。每一行左边的勾选框 = 这道题用不用它。</p>'
        },
        {
          id: 'kb-2', title: '加自己的资料',
          target: '#kbPick',
          html: '<p>三种加法，按资料大小选：</p>'
            + '<ul><li>小段笔记：粘到下面的框里 →「加入知识库」；</li>'
            + '<li>txt / md 文件：点高亮的「<b>导入文件</b>」（可多选）；</li>'
            + '<li><b>整本书</b>：把文件放进站点目录的 <code>资料/</code> 文件夹，双击 <code>转知识库.bat</code>，刷新页面就会自动出现（电脑要装 Python）。</li></ul>'
            + '<p class="muted small">Word / PDF 先转成 txt（另存为或复制粘贴）。上面的「目标知识库」可以新建一个库专门放它。</p>'
        },
        {
          id: 'kb-3', title: '勾选「用哪些」',
          target: '#kbAll',
          html: '<p>这些勾选框决定 AI 检索的范围：全选 = 都用；只留内科 = 只在内科里搜。</p>'
            + '<p>做题时 AI 面板最上面那排也能临时开关，选过一次会记住。</p>'
            + '<p class="muted small">下一段：给 AI 填一个 API Key，它才能真的写解析。</p>'
        }
      ]
    },
    {
      id: 'api', name: '配 AI', menuLabel: '④ 获取 / 填写 API Key', menuNote: 'DeepSeek / Kimi / 本机 Ollama 都行',
      steps: [
        {
          id: 'api-1', title: '④ 配 AI：先准备一个接口',
          route: '#/kb', tab: 'cfg', target: '#aiPreset',
          html: '<p>站里不自带模型，需要一个「OpenAI 兼容」的接口。三种常见选法：</p>'
            + '<ul><li><b>免费、离线</b>：装 <a href="https://ollama.com/download" target="_blank" rel="noopener">Ollama</a>，命令行跑 <code>ollama pull qwen2.5:7b</code>；地址 <code>http://127.0.0.1:11434/v1</code>，Key 留空。</li>'
            + '<li><b>DeepSeek</b>：<code>platform.deepseek.com</code> 注册 → API Keys → 创建 → 复制 <code>sk-…</code>；地址 <code>https://api.deepseek.com/v1</code>。</li>'
            + '<li><b>Kimi / Moonshot</b>：<code>platform.moonshot.cn</code> 生成 Key；地址 <code>https://api.moonshot.cn/v1</code>。</li></ul>'
            + '<p class="muted small">左边「服务」下拉选一个，地址和模型会自动帮你填好。</p>'
        },
        {
          id: 'api-2', title: '填：地址 / 模型 / API Key',
          target: '#aiBase',
          html: '<p>三个空各管一段：</p>'
            + '<ul><li><b>接口地址</b>：一般以 <code>/v1</code> 结尾；</li>'
            + '<li><b>模型</b>：点「拉取模型列表」挑一个（没有就手写模型名）；</li>'
            + '<li><b>API Key</b>：粘进去，只存在这台设备，不会上传。</li></ul>'
            + '<p class="muted small">填完点「测试连接」——下一处高亮的就是它。</p>'
        },
        {
          id: 'api-3', title: '测一下，通了就能用',
          target: '#aiTestBtn',
          html: '<p>看到绿色的「连接成功」就配好了。做题时点「AI 解析」，生成完满意就「存入本题解析」。</p>'
            + '<p>连不上：先看本页的「④ 怎么用」，再翻《AI知识库说明.md》（里面有 Ollama 跨域、报错码对照）。</p>'
        }
      ]
    },
    {
      id: 'sync', name: '云同步', menuLabel: '⑤ 配云同步', menuNote: 'GitHub / 码云私有仓库当云盘',
      steps: [
        {
          id: 'sync-1', title: '⑤ 云同步：两台设备共用记录',
          route: '#/sync', target: '#syncProvider',
          html: '<p>云同步 = 拿一个<b>私有仓库</b>当云盘，换电脑、清缓存都不丢记录（错题、收藏、解析、便签…）。</p>'
            + '<p>先去平台上建一个私有仓库，名字随意，比如 <code>shuati-sync</code>：</p>'
            + '<ul><li>GitHub：右上角 + → New repository → 选 <b>Private</b>；</li>'
            + '<li>码云 Gitee：新建仓库 → 选 <b>私有</b>（国内访问更快）。</li></ul>'
        },
        {
          id: 'sync-2', title: '生成令牌，填进来',
          target: '#syncToken',
          html: '<p>令牌（token）就是给这个站的钥匙：</p>'
            + '<ul><li><b>GitHub</b>：头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens → 只选那个仓库，权限勾 <b>Contents: Read and write</b>；</li>'
            + '<li><b>码云</b>：设置 → 私人令牌 → 勾仓库读写。</li></ul>'
            + '<p>把 用户名 / 仓库名 / 令牌 填到上面这排，点「<b>测试连接</b>」。</p>'
        },
        {
          id: 'sync-3', title: '点「立即同步」',
          target: '#syncNow',
          html: '<p>测试通过 → 点「立即同步」。以后每 2 分钟自动同步一次（间隔和同步范围都能在下面调）。</p>'
            + '<p>手机想省事：电脑上点「<b>复制配置链接</b>」发到手机，点开就自动填好并同步。</p>'
            + '<p class="muted small">同步的是记录和自建题库；重要数据还是建议偶尔「导出全部数据」备份一份。</p>'
        }
      ]
    },
    {
      id: 'chat', name: 'AI 对话', menuLabel: '⑥ AI 对话：出题 / 问知识点 / 分析题库', menuNote: '选知识库，打字就能出题；题库拖进去做分析',
      steps: [
        {
          id: 'chat-1', title: '⑥ AI 对话：一个对话框搞定三件事',
          route: '#/chat', target: '.chat-kb-row',
          html: '<p>这个页面能直接对话（就像聊天）：</p>'
            + '<ul><li><b>问知识点</b>：先查知识库，再回答，底下列参考资料；</li>'
            + '<li><b>出题</b>：说一句「给我出 5 道心衰的题」，它会按站内格式出题，能一键存题库 / 直接开做；</li>'
            + '<li><b>分析题库</b>：把题库 / 目录拖进来，它带着你的作答记录总结易错点。</li></ul>'
            + '<p class="muted small">上面那排就是「用哪些资料」，与 AI 面板共用同一份勾选。</p>'
        },
        {
          id: 'chat-2', title: '打字就行：出题 / 问知识点',
          target: '#chatTa',
          html: '<p>先在顶上选好知识库，再在框里输入：</p>'
            + '<ul><li>「给我出 5 道「心肌梗死」的题」→ 出题（Enter 发送）</li>'
            + '<li>「慢阻肺和哮喘怎么鉴别？」→ 问知识点</li></ul>'
            + '<p>下面的「模式」默认是<b>自动识别</b>，识错了就手动选「问知识点 / 出题 / 分析题库」。</p>'
            + '<p class="muted small">也可以点「＋ 文件」或把图片拖进来（支持看图的模型才能读图）；把一整文件夹题库文件拖进来会直接识别。</p>'
        },
        {
          id: 'chat-3', title: '把题库拖进对话做分析',
          route: '#/', target: '#chatEntry',
          html: '<p>主页这张卡片就是对话入口：把<b>题库卡片 / 目录</b>直接拖到它上面（文件、文件夹也行），会自动带着它进对话。</p>'
            + '<p>也可以在题库卡片的「⋯」菜单里点「<b>💬 让 AI 分析这个题库</b>」，目录菜单里点「让 AI 分析这个目录」。</p>'
            + '<p class="muted small">分析会带上你的作答次数 / 错题次数和考点标签，让它说“为什么错、先补什么”。</p>'
        }
      ]
    }
  ];

  /* 结尾卡片由 paintEnd() 统一画（不再单独占一个步骤，免得「都介绍完了」出现两遍） */

  /* ---------- 导览引擎 ---------- */
  var T = null;                    // { list, idx, mode, chapterId, nextChapterId }
  var WRAP = null, HOLE = null, CARD = null, TICK = null;

  function ensureDom() {
    if (WRAP && WRAP.isConnected) return;
    WRAP = document.createElement('div');
    WRAP.className = 'gd-wrap';
    WRAP.innerHTML = '<div class="gd-hole" id="gdHole"></div>'
      + '<div class="gd-card" id="gdCard" role="dialog" aria-modal="true" aria-label="新手引导"></div>';
    document.body.appendChild(WRAP);
    HOLE = $id('gdHole');
    CARD = $id('gdCard');
    WRAP.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-gd]') : null;
      if (!b) return;
      var act = b.getAttribute('data-gd');
      if (act === 'next') goStep(T ? T.idx + 1 : 0);
      else if (act === 'prev') goStep(T ? T.idx - 1 : 0);
      else if (act === 'skip') closeTour('skip');
      else if (act === 'done') closeTour('done');
      else if (act === 'replay') startTour(fullSteps(), 0, 'full');
      else if (act === 'nextchapter') startChapterById(T && T.nextChapterId);
      else if (act === 'import') { closeTour('skip'); if (typeof go === 'function') go('#/import'); }
      else if (act === 'home') { closeTour('done'); if (typeof go === 'function') go('#/'); }
    });
  }

  function teardown() {
    if (TICK) { clearInterval(TICK); TICK = null; }
    if (WRAP && WRAP.parentNode) WRAP.parentNode.removeChild(WRAP);
    WRAP = HOLE = CARD = null;
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) {
    if (!T) return;
    if (e.key === 'Escape') { e.preventDefault(); closeTour(T.mode === 'full' ? 'skip' : 'close'); }
  }
  function closeTour(mark) {
    var st = readState();
    st.ts = Date.now();
    if (mark === 'skip') st.skipped = true;
    else if (mark === 'done') st.done = true;
    writeState(st);
    T = null;
    teardown();
    if (mark === 'done' && typeof toast === 'function') { try { toast('引导看完了，去刷题吧', 1600, 'ok'); } catch (e) {} }
  }

  function withChapter(step, ch) {
    var s = {};
    for (var k in step) if (Object.prototype.hasOwnProperty.call(step, k)) s[k] = step[k];
    s.chapterName = ch ? ch.name : '';
    return s;
  }
  function chapterSteps(ch) {
    return (ch.steps || []).map(function (s) { return withChapter(s, ch); });
  }
  function fullSteps() {
    var out = [withChapter(WELCOME, null)];
    CHAPTERS.forEach(function (c) { chapterSteps(c).forEach(function (s) { out.push(s); }); });
    return out;
  }

  function startTour(list, idx, mode, chapterId) {
    ensureDom();
    T = { list: list, idx: Math.max(0, idx || 0), mode: mode || 'full', chapterId: chapterId || null, nextChapterId: null };
    if (mode === 'chapter') {
      var at = CHAPTERS.findIndex(function (c) { return c.id === chapterId; });
      T.nextChapterId = (at >= 0 && at < CHAPTERS.length - 1) ? CHAPTERS[at + 1].id : null;
    }
    if (!TICK) TICK = setInterval(function () { try { place(); } catch (e) {} }, 500);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    goStep(T.idx);
  }
  function startChapterById(id) {
    if (!id) { openMenu(); return; }
    var ch = CHAPTERS.find(function (c) { return c.id === id; });
    if (!ch) return;
    startTour(chapterSteps(ch), 0, 'chapter', id);
  }
  function startChapter(id) { startChapterById(id); }

  function paintCard(step, i) {
    if (!CARD) return;
    var total = T.list.length;
    var last = i >= total - 1;
    CARD.innerHTML =
      '<div class="gd-head">'
      + '<span class="gd-step">' + (i + 1) + ' / ' + total + '</span>'
      + (step.chapterName ? '<span class="gd-ch">' + E(step.chapterName) + '</span>' : '')
      + '<span class="spacer-grow"></span>'
      + '<button class="gd-x" type="button" data-gd="skip" title="跳过引导">✕</button>'
      + '</div>'
      + '<div class="gd-title">' + E(step.title || '') + '</div>'
      + '<div class="gd-body">' + (step.html || '') + '</div>'
      + '<div class="gd-acts">'
      + (i > 0 ? '<button class="btn small" type="button" data-gd="prev">上一步</button>' : '')
      + '<span class="spacer-grow"></span>'
      + '<button class="btn small" type="button" data-gd="skip">跳过全部</button>'
      + '<button class="btn small primary" type="button" data-gd="next">' + (last ? '完成' : '下一步') + '</button>'
      + '</div>';
    CARD.classList.toggle('gd-center', !step.target);   /* 没有高亮目标的步骤（欢迎 / 收尾）：卡片居中 */
    CARD.scrollTop = 0;
    void CARD.offsetWidth;
    place();
  }

  function paintEnd() {
    if (!CARD) return;
    var chapterMode = T && T.mode === 'chapter';
    var chName = '';
    if (chapterMode) {
      var ch = CHAPTERS.find(function (c) { return c.id === T.chapterId; });
      chName = ch ? ch.name : '';
    }
    CARD.innerHTML =
      '<div class="gd-head"><span class="gd-step">' + (chapterMode ? '这一段' : '完成') + '</span><span class="spacer-grow"></span>'
      + '<button class="gd-x" type="button" data-gd="skip" title="关闭">✕</button></div>'
      + '<div class="gd-title">' + (chapterMode ? ('「' + E(chName) + '」看完了') : '都介绍完了 👏') + '</div>'
      + '<div class="gd-body">'
      + (chapterMode
        ? '<p>这段就是全部要点。要接着看下一段，或者先去试试都行。</p>'
        : '<p>记住三件事：数据在<b>本机浏览器</b>里，重要就定期「导出全部数据」；忘了怎么配：⚙ 设置 →「🎓 新手引导 / 基础用法」；按 <b>?</b> 看快捷键。</p>')
      + '</div>'
      + '<div class="gd-acts">'
      + '<span class="spacer-grow"></span>'
      + (chapterMode
        ? (T.nextChapterId
          ? '<button class="btn small" type="button" data-gd="done">结束</button><button class="btn small primary" type="button" data-gd="nextchapter">看下一段</button>'
          : '<button class="btn small primary" type="button" data-gd="done">结束</button>')
        : '<button class="btn small" type="button" data-gd="replay">再走一遍</button><button class="btn small primary" type="button" data-gd="home">开始刷题 →</button>')
      + '</div>';
    CARD.classList.add('gd-center');
    if (HOLE) HOLE.style.display = 'none';
    CARD.style.left = '';
    CARD.style.top = '';
  }

  function goStep(i) {
    if (!T) return;
    if (i < 0) return;
    if (i >= T.list.length) { paintEnd(); return; }
    T.idx = i;
    var step = T.list[i];
    paintCard(step, i);
    /* 需要换页 / 切标签的步骤 */
    if (step.route) {
      var cur = location.hash || '#/';
      if (cur !== step.route && typeof go === 'function') go(step.route);
    }
    var tries = 0;
    (function waitReady() {
      tries++;
      if (step.tab && typeof kbTabShow === 'function' && document.querySelector('.kbtabs')) {
        try { kbTabShow(step.tab); } catch (e) {}
      }
      var el = step.target ? document.querySelector(step.target) : null;
      if (!el && tries < 26) { setTimeout(waitReady, 150); return; }
      if (el) {
        try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
      }
      setTimeout(place, 280);
    })();
  }

  /* 把高亮框和卡片摆到目标元素旁边 */
  function place() {
    if (!T || !CARD || !HOLE) return;
    var step = T.list[T.idx];
    if (!step) return;
    if (!step.target) { HOLE.style.display = 'none'; CARD.classList.add('gd-center'); return; }
    if (CARD.classList.contains('gd-center')) return;
    var el = document.querySelector(step.target);
    if (!el) { HOLE.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    if ((!r.width && !r.height) || r.bottom < 0 || r.top > window.innerHeight) {
      HOLE.style.display = 'none';
      return;
    }
    HOLE.style.display = '';
    var pad = 6;
    HOLE.style.left = Math.round(r.left - pad) + 'px';
    HOLE.style.top = Math.round(r.top - pad) + 'px';
    HOLE.style.width = Math.round(r.width + pad * 2) + 'px';
    HOLE.style.height = Math.round(r.height + pad * 2) + 'px';
    var cw = CARD.offsetWidth, ch = CARD.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var gap = 14;
    var top = r.bottom + gap;
    if (top + ch > vh - 10) top = r.top - ch - gap;
    if (top < 10) top = Math.max(10, Math.min(vh - ch - 10, r.top));
    var left = Math.min(Math.max(10, r.left + r.width / 2 - cw / 2), Math.max(10, vw - cw - 10));
    CARD.style.left = Math.round(left) + 'px';
    CARD.style.top = Math.round(top) + 'px';
  }

  /* ---------- 入口：设置菜单 / 帮助面板 ---------- */
  function openMenu() {
    if (!window.BFUI || !BFUI.pick) { startTour(fullSteps(), 0, 'full'); return; }
    var items = CHAPTERS.map(function (c) {
      return { value: c.id, label: c.menuLabel, note: c.menuNote };
    });
    items.push({ value: '__all', label: '▶ 从头完整走一遍', note: '含欢迎页，约 2 分钟' });
    BFUI.pick({
      title: '新手引导 / 基础用法',
      desc: '点哪一段看哪一段：高亮框会指到页面上对应的位置，跟着填就行。',
      items: items
    }).then(function (v) {
      if (!v) return;
      if (v === '__all') startTour(fullSteps(), 0, 'full');
      else startChapterById(v);
    });
  }

  /* 设置弹窗 / 帮助面板里的按钮：用事件委派，两处元素什么时候出现都能接上 */
  function bindEntry() {
    if (bindEntry._done) return;
    bindEntry._done = true;
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('#goGuide2,#helpGuide') : null;
      if (!t) return;
      e.preventDefault();
      var hm = $id('helpMask');
      if (hm && typeof hideMask === 'function') { try { hideMask(hm); } catch (err) {} }
      try { if (typeof closeAll === 'function') closeAll(); } catch (err) {}
      openMenu();
    });
  }

  /* ---------- 自动弹：只有「第一次来 + 本机没用过 + 没跳过/没看过」才弹 ---------- */
  function maybeAutoStart() {
    var st = readState();
    if (st.done || st.skipped) return;
    if (hasUsed()) return;
    startTour(fullSteps(), 0, 'full');
  }

  window.GUIDE = {
    start: function () { startTour(fullSteps(), 0, 'full'); },
    startChapter: startChapterById,
    openMenu: openMenu,
    state: readState,
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} },
    hasUsed: hasUsed
  };

  /* boot：晚一点再弹，别抢首页渲染 / 知识库预热 */
  function boot() {
    bindEntry();
    setTimeout(function () { try { bindEntry(); maybeAutoStart(); } catch (e) {} }, 1400);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
