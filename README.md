# 刷题站

纯静态的刷题网站：选择题即时判分，**选错立刻出解析**；错题自动进错题本，带统计、可以改解析、可以按需导出。
题库随时可以往里加。

> 这一份是**分享版**：原作者的 `AI配置.js`（含明文 API Key）已删除，另外附了《使用说明.md》。拿到手先看它。

## 怎么用

**本机用（最简单）**：双击 `index.html` 即可，不装东西、不联网。
（Chrome / Edge / Safari 都行。作答记录存在浏览器本地，换浏览器或清缓存会丢，重要数据记得导出备份。）

**放到网上**：整个文件夹丢 GitHub Pages / Vercel / Netlify / 任意静态空间，无需构建、无需后端。

## 功能

**导航**
- 左上角「⌂ 主页」随时回首页（在首页时不显示）
- 右上角「错题」「收藏」「搜索」；答题页额外有「题号」「设置」
- 考试进行中会隐藏这三个入口；若用其它方式离开考试页，会弹确认（倒计时不会在背后偷跑）

**刷题**
- 点选项即判分，选错立刻显示「正确答案 / 你的选择 / 解析」；答对默认也显示解析（可在设置关掉）
- 多选题：选完点「提交答案」，错选漏选都算错
- 分类：全部 / 单选 / 多选 / **错题** / **收藏**
- 「题号」面板看全局进度（灰未做、绿对、红错）并可跳转
- 「再答一次」可以重做，**统计不会被清掉**
- 设置：答对也显示解析、答对自动跳下一题、随机顺序
- 键盘：`A`–`D` 或 `1`–`4` 选答案，`Enter` 提交/下一题，`←` `→` 翻页

**收藏**
- 题目右上角「☆ 收藏」；顶部「收藏」进入收藏列表
- 收藏列表按题库分类、可排序、可批量导出、可补解析

**间隔重复（SRS）· 错题复习**
- **只对「做错过」的题排期**：从没做错过的题不进复习队列（“每日复习”就是错题集的复习）
- 每题记录 `ivl`（当前间隔天）、`ease`（难度系数，默认2.5）、`due`（下次到期）
- **答对**：间隔 1 → 3 → round(ivl×ease) → …（约 1/3/8/20/50 天）
- **答错**：间隔打回 1 天，难度 -0.2（最低 1.3），并且**当天就回到队列**
- **入口就在错题本里**：顶部「今天有 N 道错题到期该复习」+「开始复习」；筛选里可以「只看今天该复习的」
- 答题页的分类条也有「待复习 N」（指该题库里做错过且到期的题）
- 「清空作答/错误次数」把错次归零后，这题就不再排期了
- 套卷 / 模考里作答**同样会更新原题的 SRS**

**模拟考试**
- 在错题本 / 收藏 / 待复习里勾选题目 → 「模拟考试」→ 设名称、题数（会随机抽取）、时长 → 开考
- 考试中：顶部倒计时（最后 5 分钟变红）、到点自动交卷；**不显示对错**，答完不写入统计
- 「☆ 标记」可疑题，题号面板看得到（黄点）
- 交卷后统一批改：得分（百分制）、答对/答错/未答、用时，逐题显示对错与解析
- 交卷时才一次性写入：本次成绩计入错题次数，**并累加回原题、更新复习排期**
- 刷新页面不丢考试进度（存在 sessionStorage）；未交卷时关页面会提醒
- 首页会列出未删的「试卷」，可继续或删除

**搜索**
- 右上角「搜索」，关键词匹配 **题干 + 共用题干 + 选项 + 解析**
- 范围可限：全部 / 错题 / 收藏 / 待复习 / 没做过的
- 结果直接复用错题本那套卡片，可展开、写解析、收藏

**PWA / 离线**
- 放到 http(s) 上后：能装到手机主屏，断网也能刷（Service Worker 缓存）
- 双击本地 `file://` 打开时不注册 SW（浏览器不允许），其它功能不受影响
- 改了代码想刷新缓存：把 `sw.js` 里的 `VERSION` 加一

**错题本**
- 答错的题自动进来；顶部「错题」进入
- 内部按**题库分类**，点哪个题库只看哪个题库的错题
- **统计**：错题数、还没做对的题数、累计作答、累计答错、总正确率
- **排序**：错次 / 正确率 / 作答次数 / 最近作答 / 题号；**同一个按钮点第二次就反向**（↑↓ 有箭头提示）
- **筛选**：错次 ≥ N、只看还没做对的
- 展开看完整题面（正确项标绿、我选的标红）、我的选择、最近作答时间、解析
- **批量操作**（先全选 / 反选 / 逐个勾）：
  - ☆ 收藏 / 取消收藏
  - 清空作答·错误次数（题目留着，次数归零）
  - 移除记录（二次确认）
  - **组成套卷重做**：把选中的题拼成一份临时卷，做完后对了错了几次**累加回原题**的统计上
- **改解析**：支持 Markdown（`**加粗**`、`*斜体*`、`` `代码` ``、`# 标题`、`- 列表`、`> 引用`、`[链接](url)`），支持**插入图片**（自动压缩后存在本地），可随时「恢复默认解析」
- **导出**：勾选要导出的题（全选 / 反选 / 逐个勾），四个开关：
  - **含解析**、**含图片**、**含我的选择（错项）**、**含错次统计**
  - 格式：Markdown（`.md`）/ HTML（`.html`，打印→另存为 PDF）/ JSON（`.json`）
  - 可以「导出选中」或「导出当前列表」
- 每条可以单独「移除记录」（会二次确认）

**临时套卷**
- 在错题本 / 收藏列表里勾选 → 「组成套卷重做」→ 起个名字 → 生成
- 套卷是独立的一份卷，**答题结果会累加到原题的作答次数和错次上**
- 首页会列出未删的套卷，可以「继续」或「删除套卷」

**数据备份**
- 首页底部「导出全部数据」：把作答记录、自建题库、收藏、自定义解析打包成一个 JSON
- 「导入数据（恢复）」：合并导入（同一条以导入的为准，不会删掉其它记录）
- 设置里的「清空作答记录」只清对错和次数，**不会动收藏和自定义解析**

## 怎么加题库

### 1. 网页里直接导入（不用碰代码，最常用）

首页「＋ 导入 / 新建题库」→ 粘题目 → 「解析预览」→「保存题库」。

```
# 生化 第一章 蛋白质

1. 蛋白质分子中四级结构的特征是
A. 在三级结构的基础上进一步折叠而成
B. 分子中必定含有辅因子
C. 依赖肽键维系稳定性
D. 一定由两条或两条以上的多肽链组成
答案：D
解析：四级结构由两条以上多肽链（亚基）聚合而成。

2. 关于炎症，下列说法正确的有
A. 扩张血管
B. 趋化作用
C. 引起发热
D. 引起疼痛
答案：ACD
解析：趋化作用主要由白三烯B₄、C5a等介导。
```

| 写法 | 作用 |
| --- | --- |
| `# 名称` | 题库名称 |
| `## 说明` | 之后的题目共用这段题干（病例题、B 型题用它） |
| `1.` / `1、` / `1 ` | 题号，可写可省 |
| `A.` `A、` `A)` `A：` | 选项行 |
| `答案：D` | 单选写一个字母，多选连写，如 `答案：ABD` |
| `解析：` | 解析，可写多行，直到下一题 |

也支持 JSON：`[{"stem":"…","options":["…","…"],"answer":["D"],"explain":"…"}]`，或 `{"title":"题库名","questions":[...]}`。
每个题库都能「导出」成 JSON，导出的文件再导入即可（备份、分享、换电脑都靠它）。

### 2. 放一个题库文件进 `banks/`

在 `banks/` 里新建 `你的题库.js`：

```js
registerBank({
  id: 'biochem-ch1',              // 唯一标识，别和别的重复
  title: '生化 第一章',
  subtitle: '人卫第9版',
  questions: [
    { id: 1, stem: '题干…', options: ['选项A','选项B','选项C','选项D'],
      answer: ['D'], explain: '解析…' },
    // 病例题可选：group（共用题干）、groupTitle（标签）
    { id: 2, groupTitle: '2-3题共用题干', group: '男性，58岁…',
      stem: '最可能的诊断是', options: ['…','…','…','…'], answer: ['A'], explain: '…' }
  ]
});
```

然后在 `index.html` 底部加一行（放在 `app.js` 之前）：

```html
<script src="banks/你的题库.js"></script>
```

`answer` 一个字母＝单选，多个字母＝多选。

### 3. 或者不碰文件

直接打开网页，用首页的「＋ 导入 / 新建题库」粘贴题目文本或导入 JSON ——
这样建的题库存在浏览器里（`qbank.local.v2`），换浏览器 / 清缓存会丢，记得导出备份。

> 这份是在线版：原作者的内置模考卷 `banks/mock-exam-2027.js` 已移除，`banks/` 目录是空的。

## 文件说明

```
index.html                  页面外壳（所有模块加载完后统一调用 render()）
style.css                   样式
app.js                      核心：题库 / 判分 / SRS / 导入解析器 / 存储 / 路由
collection.js               错题本、收藏、待复习、搜索、统计、Markdown、图片、导出
exam.js                      模拟考试（倒计时 / 标记 / 交卷 / 统一批改）
kb.js  ai.js                 本地知识库（检索）／AI 写解析
tags.js                     考点标签（词表可批量导入或让 AI 起一份；AI 读题从词表里挑标签，
                            统计页「按考点」汇总贴好的标签与薄弱点）
report.js                   AI 学情诊断（周报）（#/report：把学情摘要交给模型写诊断，报告存在本机）
sw.js  manifest.json  icons/ PWA（离线缓存 + 主屏图标）
robots.txt                  禁止搜索引擎收录（资料库有版权，别被索引）
v2-sample.html  v2-sample.css   §8 视觉 v2 的**两屏样板**（首页 + 答题页，可现场切明暗 / 主色 / 宽度）；
                            只是给人看效果的独立页面，不被站点引用，删掉也不影响任何功能
上传步骤.md                 怎么放到网上（Cloudflare Pages / Netlify Drop / GitHub Pages）+ 手机装 App + 数据搬家
UI优化方案.md               UI / 交互优化执行方案（第一批「设置分层 / 复习曲线档位 / #kb 标签页 / 触屏收起快捷键提示」
                            已做完上线；后面还有第二批导航重构、第三批细节、§3.5 候补池 8 条、第四批视觉焕新）
banks/                     题库目录（本包为空，内置模考卷已移除）
  说明.txt                 怎么加自己的题库
  你的题库.js               放这里，再去 index.html 加一行

从 Chatbox 搬资料的几个文件（不想用可以删，站点照常跑）：
chatbox-import.py           读 Chatbox 的 config.json / 知识库库文件，生成下面两个 .js
从Chatbox导入.bat            双击跑上面这个脚本（Windows）
make-kb.py  转知识库.bat      把「资料/」文件夹（txt/md/pdf/docx）转成 知识库.js
本地服务器.bat                起一个本地 http 服务（PWA 离线缓存要用 http）
AI配置.js                    自动填 AI 地址 / 模型 / Key（★ 含明文 Key；分享版已删除，可复制 AI配置.示例.js 改名）
知识库.js                    自动挂载的知识库正文（★ 是你的资料，别上传）
```

## 数据存在哪（升级时别搞丢）

浏览器 localStorage：

| 键 | 内容 |
| --- | --- |
| `qbank.answers.v2` | 每题的作答：`{ sel, ok, tries, wrong, ts, redo, ivl, ease, due }` |
| `qbank.favs.v2` | 收藏 |
| `qbank.notes.v2` | 自定义解析（Markdown + 图片） |
| `qbank.local.v2` | 自己导入的题库 |
| `qbank.papers.v2` | 临时套卷 |
| `qbank.settings.v2` | 设置 |
| `qbank.srs.v1` | 复习曲线（模式 + 12 个参数） |
| `qbank.answerfix.v1` | 手工修正过的答案 `{ 题目键: ['A','B'] }` |
| `qbank.ai.v1` | AI 配置（地址 / 模型 / Key / 温度 / 检索条数…） |
| `qbank.kb.list.v1` | 知识库列表（名字、字数、段数） |
| `qbank.kb.sel.v1` | 勾选了哪些知识库（`null`＝没选过，默认全选） |
| `qbank.kb.data.v1.<id>` | 网页导入的知识库正文（文件库不存在这，读 `知识库.js`） |
| `qbank.kb.skip.v1` | 「删掉了、别再自动挂载」的库黑名单 |
| `qbank.tomb.v1` | 多标签页用的删除墓碑 `{ ans:{键:时间}, …, wipe:{ans:时间} }`，7 天自动过期 |
| `qbank.tags.v1` | 每题的考点标签 `{ 题库id#题号: ['慢阻肺','气道炎症'] }` |
| `qbank.tagvocab.v1` | 考点词表（AI 批量打标签时**只允许**从这里挑词） |
| `qbank.view.v1` | 首页 / 搜索页用「卡片」还是「列表」看题库（`'cards'` / `'list'`） |
| `qbank.report.v1` | 学情诊断报告历史（**只留最近 20 份**，`{ id, ts, from, to, markdown, … }`） |

知识库正文优先放 IndexedDB（`shuati-kb` / `kb`），`file://` 下 IndexedDB 不可用时退回 localStorage。

**兼容老数据**：早先只有 `{ sel, ok }` 的记录会在读取时自动补上 `tries / wrong / ts / ivl / ease / due`，不会被清空。
`tries`＝作答次数，`wrong`＝答错次数，`redo`＝是否点了「再答一次」，`ivl/ease/due`＝间隔重复的排期。
模拟考试的临时状态存在 sessionStorage 的 `shuati.exam`（关标签页就清）。

## 本次修复（相对上一版）

（缓存版本 **shuati-v67-web64**）

最近几轮按倒序说清各自动了什么：
- **shuati-v67-web64（§3.6-P2⑥ 骨架屏：大题库 / 知识库 / 统计换页先铺一层灰条）**：详见《更新说明.md》最上面那节。
- **shuati-v67-web63 / web62（收拾加粗点重、全角星号也当星号）**：详见《更新说明.md》同一天晚上那两节。
- **shuati-v67-web61（§3.6-P1⑤ 解析 ↔ 选项联动 + AI 快捷追问）**：见下面第一张表往下数两行。
- **shuati-v67-web60（参考资料跟解析一起存）**：详见《更新说明.md》同一轮那节。
- **shuati-v67-web54（§8 视觉 v2 铺到在用的站点上）**：就是下面第一张表。
- **shuati-v66-web53（修深色模式下「改答案」勾选看不出高亮 + 病理知识库补页码）**：`body.dark .fixopt` → `body.dark .fixopt:not(.on)`（同理 `body.dark .kbrow:not(.on)`）；`make-kb.py` 新增 `page_from_filename()`（没书签的 PDF 从文件名取页码，和页数对不上就不采信），病理 27 篇补上页码。
- **shuati-v63-web49（方案九 + 方案十，外加图标视图的「⋯」、批量模式支持目录）**：下面第二张表。
- **shuati-v57-web43（题库视图三档卡片 + 减少动态效果开关）**：`qbank.view.v1` 从两档扩成大/中/小卡片 + 列表，设置面板加 `#setReduceMotion`（`SET.reduceMotion`，接通 `uiMotionOK()` 与 `body.reduce-motion`），`sync.js` 的指纹补上考点标签 / 词表；批量管理里也能选目录了。
- **shuati-v54-web40（§8 视觉 v2 样板）**：只**新增** `v2-sample.html` + `v2-sample.css`（首页 + 答题页两屏样板，顶上能现场切明暗 / 主色 / 宽度，离线可开、不引外链），**在用的 `style.css` / `index.html` / `app.js` / `collection.js` 一行没动**。线上：`https://stain37.github.io/shuati-web/v2-sample.html`。体检 `工作1\v2-sample-check.py`（28 条 0 fail，本地 + 线上都查），截图 `工作1\shots\v2-*.png`。
- **shuati-v53-web39（进阶交互包）**：下面第二张表（专注模式 / 判分揭示 / 待复习角标 / 解析浮条）。

| 问题 | 说明 |
| --- | --- |
| 点进大题库 / 知识库会白一下 | **§3.6-P2⑥ 骨架屏**：`index.html` 的 `#view` 里写了**静态首屏骨架**（`.skel` + 带主色渐变的 `.sk-hero` + `.sk-card` + `.sk-grid` 两块小卡，`aria-hidden="true"`），JS 没跑起来就能看见；`app.js` 新增 `skelHtml(kind)`（`home` / `kb` / `quiz` 三种形状）/ `skelNeeded(r)`（考试页不铺；答题页要 `bankById(r.bankId).questions.length >= SKEL_BIG_Q`（`= 200`）；`kb` / `search` / `stats` 一律铺）/ `skelPaint(r)` / `skelDrop()`（只摘 `#view` 的直接子 `.skel`）；`render()` 判断「真换页 + 该铺」时先铺骨架再把真渲染 `setTimeout(…, 0)` 让出一帧，`viewEnter()` 里 `skelDrop()` 兜底。CSS 在 `style.css` 末尾 `§3.6-P2⑥` 一节（`.sk-bl` 用 `color-mix(in srgb, var(--text) 11%, var(--card))`，`@keyframes skPulse`，reduced-motion 不闪，窄屏合成一列） |
| 老探针的断言过期了 | 新探针 `工作1\p26-probe.py` **44 条 / 0 fail**（浏览器 22 + 源码 22）：四种形状的卡数 / 灰条数、阈值 200、`aria-hidden`、`skelDrop()` 不留残渣；真换页用 `MutationObserver` 数「中间铺过几次」= 大题库 1 次 / 小题库 0 次 / 知识库 1 次 / 统计 1 次，且画完内容都在。截图 `工作1\shots\r18-skel-home.png` / `r18-skel-kb.png` / `r18-skel-quiz.png` |
| 看完解析想对照选项，得来回滚 | **§3.6-P1⑤ 解析 ↔ 选项联动**：解析（`.exp.rich-edit`）/ AI 输出（`.aiout`）/ AI 解析折叠区（`.aih-a`）里单独出现的 A–H 由 `uiOptHtml()` 包成 `<b class="optjump" data-k="B">B</b>`（`uiOptLetters()` 用 `TreeWalker` 走文本节点，跳过 `.opt` / 代码块 / 链接；题里没有的字母会还原成纯文字）；点字母 → 上面那个选项 `.opt-hit` 闪一圈并滚过去，点选项 → 解析里提到它的字母 `.on` 变实心（1.1 秒）。两个方向都绑在 `#view` 上做事件委托，翻题 / 重渲染不用重绑。存回去之前 `collection.js` 的 `stripOptJump()` 会把字母壳脱掉（`mdFromHtml()` 里那一步），**解析原文一个字节都不会被污染** |
| AI 答完想追问，还得自己打字 | **AI 快捷追问 chips**：`ai.js` 的 `AI_FOLLOW`（再详细点 / 换个说法 / 出变式题）+ `aiPaintFollow(host, show)`；`aiRun()` 一开跑先收起来，`finally` 里按「有没有答案」决定显不显示，`aiRestore()` 重开题目时同一条件；点 chip 带着原题和这轮回答再跑一次 |
| 老探针的断言过期了 | 新探针 `工作1\p15-probe.py` **52 条 / 0 fail**（浏览器 25 + 源码 27，含「题里没有的 E 会还原成纯文字」「存回 Markdown 里没有 `<b class="optjump">`」「点 chip 会再跑一次 AI」）。⚠️ 字母胶囊的样式必须用站点自己的 `--primary` / `--primary-soft` / `--primary-line`；**别再造 `--a` 这种不存在的变量** —— `color-mix()` 里出现未定义变量会让整条声明静默失效（探针 52 条全绿、截图里却看不见底色，就是这么来的） |
| 站点还是「工具站审美」，跟样板两回事 | **§8 铺开的 token 层**：`style.css` 的 `:root` / `body.dark` / `html[data-theme=…]` 换成样板那套 —— 卡片圆角 `--radius:16px → 22px`、按钮 12px、一套配色（背景 `--bg:#eef1f7` + `--bg-wash` 双径向渐变，深色 `#080c14` / 卡 `#121826`），**四套主题色名字对齐样板**：`teal`（默认，`#0d9488`）/ `indigo` / `warm`（蓝 + 暖橙）/ `violet`，`app.js` 的 `THEME_COLORS` 与 `index.html` 的 `#setColor` 选项同步；`SET_DEF.color` 默认 `'teal'`，另加 `SET_DEF.wash`（设置里能关背景渐变）。存储一个字节没动 |
| 首页看不出「今天该干什么」 | **首页 Bento**：`cat.js` 的 `homeHtml()` 在 hero 下面插一段 `bentoHtml` —— 继续刷题大卡（`.vb-card.span2`，题库名 / 上次做到第几题 / 正确率 / 进度条 / 继续刷题）、今日复习圆环（`.vb-ring`，`--p` = 待复习 / (待复习 + 到期)）、「今天」卡（今日已答 / 正确率 / 近 7 天）、学习热力图、四个快捷入口（搜索全部 / 学习统计 / 错题本 / 收藏）；原来的目录树 / 工具条 / 题库列表 / 本机题库文件 / 数据备份**原样保留**，hero 里重复的那排「今日」小统计用 `.hero .hstat.today{display:none}` 收掉（DOM 保留） |
| 想一眼看出「这阵子有没有在学」 | **§3.6-P1④ 学习热力图**：`app.js` 新增 `heatStats(weeks)`，拿现有 `ANS[k].ts` 按天分桶（纯读，**不新增存储**），`w` 限 4–26 默认 12 周，首页渲成 `12×7` 的 `.hm` 格子（`data-l` 五档，`color-mix` 跟主色走），空格底色 `color-mix(in srgb, var(--text) 9%, var(--card))` 深浅两态都看得见 |
| 答题页选项下面摊着一排管理按钮，吵 | **答题页「⋯ 更多」抽屉**：`renderQuiz()` 里那排 `.actions` 改成 `.actions.qz-more`，只留 `#doSubmit`（X 型题）与一颗 `#doMore`（`⋯ 更多`）；点开是从底部升起的 `#qSheet`（`.qsheet` + `.qscrim` 遮罩 + `.qgrip` 抓手 + `role="dialog"`），里面还是那五件事（`#doRedo` / `#doNote` / `#doFix` / `#doAI` / `#doVariant`）。`qSheetToggle(on)` 负责开关，Esc 分支改成「先退专注 → 再关抽屉 → 最后 `closeAll()`」，开抽屉时给 `body` 挂 `.qsheet-on`。存储没动 |
| 老探针的断言过期了 | `batch4-probe.py` 的「主题色」一节改成真话（四套 = `teal` 默认 / `indigo` / `warm` / `violet`，浅色默认主色 `#0d9488`，深色底 `#080c14`）→ **71 条 / 0 fail**；`batch6-probe.py` 的 Esc needle 改成 `… uiSetFocus(false); return; } qSheetToggle(false); closeAll();` → **119 条 / 0 fail**；新探针 `工作1\v2-site-probe.py` **68 条 / 0 fail**（四套主色变量、wash 开关、Bento 各块、`heatStats` 桶数、`[data-qsheet]` 抽屉开 / Esc 关 / 五件事都在） |
| 问题 | 说明 |
| --- | --- |
| 刷完一套题要一题一题点「下一题」 | **方案九 · ⚡ 速刷**：`SET.quizMode`（`'normal'｜'speed'｜'recite'`，不新增存储 key）+ `QUIZ_MODES` 三 chip 模式条（`.qmode`，`data-qm`）；`uiSpeedFx(bank,q,ok)` 在判分后往 `#view .card` 叠 `#spFx.sp-fx.ok/.bad`（「✓ 对」/「✗ 答案 X」+ `#spStop` 停下看解析），`SP_JUMP = setTimeout(…, 1200)` 到点前先确认 `String(QZ.cur) === qid` 再 `step(1)`；`uiSpeedStop()` 在换题 / 重画 / 切模式时收干净；速刷下把「再答一次 / 改解析 / 改答案 / AI 解析 / 变式题」整排用 `${speed ? '' : …}` 收掉（`#doSubmit` 留在外面，X 型照旧手动提交）；`judge()` 里那句 `SET.autoNext` 的自动跳加了 `&& SET.quizMode !== 'speed'`，免得连跳两题 |
| 速刷想掐时间 | **方案九 · 限时**：`SET.speedSec`（`SET_DEF` 默认 0 = 不限时，`Math.max(0, Math.min(300, …))` 夹住），`index.html` 设置面板加 `#setSpeedSec`；`uiSpeedClock(bank,q,sec)` 每秒刷 `#spClock`（≤5 秒加 `.hot`），到点 `if (!answered(k) && String(QZ.cur) === String(q.id)) judge(bank, q, [])` —— 走的是和普通答错同一条写入路径 |
| 只想背答案，不想做题 | **方案九 · 📖 背题**：`locked = !recite && answered(k)`、选项在背题时 `cls += ' ro'`（`.opt.ro` 只读）+ 正确答案加 `right`，点一下只 `toast('背题模式直接看答案，不用作答…')`；解析由 `uiReciteFb(bank, q)` 直接摊开（`.fb.show.rec` + `📖 背题：正确答案 X`），**全程不写 `ANS`**，收藏照旧；「本题作答 N 次」标签加 `!recite &&` |
| 模拟考试藏得太深 | **方案九 · ⏱ 模考入口**：`cat.js` 的 `bankMenu()` 加三项（`modeSpeed` / `modeRecite` / `modeExam`），后者走新增的 `startExam(id)`（Fisher-Yates 打乱 → `makePaper(title + ' · 模拟考试', keys, { exam: true, duration: keys.length * 60 })`）；**`exam.js` 一行没改**（源码级断言反查 `!quizMode`） |
| 图标视图（默认那档）里没有菜单，速刷 / 背题 / 模考点不到 | **图标视图补「⋯」**：`cat.js` 的 `bankIconHtml(b)` 末尾加 `<button class="nb-more" data-act="more" data-id="…" title="更多：速刷 / 背题 / 模拟考试 / 移动 / 导出…">⋯</button>`（批量模式 `pick` 时不出现）；点击天然安全 —— `bind()` 里 `.nb-bank` 的 click / dblclick 都有 `if (e.target.closest('[data-act]')) return;`，会走 `doAct()` 的 `case 'more': bankMenu(id)`。样式在 `cat.css`：`.nb-icon{position:relative}` + `.nb-more` 绝对定位右上角、默认 `opacity:0`，`.nb-icon:hover / :focus-within` 才亮，`@media (hover:none)` 常显半透明 |
| 解析要改只能弹个大编辑框 | **方案十 · 就地编辑**：`showFb()` / `uiReciteFb()` 里的解析块换成 `richBox(k, text, custom, '解析')` → `.exp-wrap > .exp.rich-edit[contenteditable]`（观感沿用 `.exp`，聚焦描边、空态 placeholder、`.exp-state` 状态提示）；`richBind()` / `richBindAll(root)` 绑 `input`（只标脏）、失焦 / 切题 / `visibilitychange` 交给 `richFlush()` 写 `NOTES[k].text`（不每次敲字都写 LS）；`step()` / `renderQuiz` / `render` / 点「改解析」进完整编辑器前都先 `richFlush()`；**存储仍是 Markdown**，所以新增 `mdFromHtml(root)`（块模型：`blocks[]` / `flush()`，块间 `\n\n`，`hasBlockChild()` 认得出 `.tbl-wrap` 这类外壳）+ `mdEscText` / `mdEscLineStart` / `mdColorHex`，`mdToHtml()` 入口加 `mdEscOpen()`、出口加 `mdColorEnd`，把用户手打的 `*` `==` `` ` `` `[` 转义掉（HTML→MD→HTML 往返一致，探针里逐条比 `h1 === h2`）；粘贴强制纯文本（`insertText` 失败时退回插文本节点 + 派发 `input`） |
| 浮条只会往 textarea 里插符号 | **方案十 · 浮条改 DOM**：`fmtBarInit(el)` 按 `el.isContentEditable` 分流到 `fmtDomCmd` / `fmtDomWrap`（`mark` / `<span style="color:…">` 手动 wrap）/ `fmtDomClear`（先沿 `start → .rich-edit` 收集包裹元素——`mark` / `span[style*=color]` / `font[color]`——再逐个解包，避免"选区整段在 mark 里、共同祖先就是它自己"查不到）；`B` 是开关（点第二次取消），`execCommand('bold')` 前先 `el.focus({ preventScroll: true })` |

| 问题 | 说明 |
| --- | --- |
| 判完分「啪」一下全亮，眼睛不知道看哪 | **§3.6-P0② 判分仪式感**：新增 `uiReveal(bank, q, st)` —— 先把对错色摘掉（`plan.forEach(m => m.el.classList.remove('right','wrong'))`），正确的那个先翻牌（`.opt.flip-in` + `@keyframes optFlip`），错项随后淡入，节奏 `90 + i * 110` ms；结果框先 `.fb.fb-hold`（`opacity:0`）按住，最后 `fbPop` 亮出来。`judge()` 里改成 `uiReveal(bank, q, ANS[k] || { ok: ok })`；`uiMotionOK()` 为假（系统开了减少动态效果）时整段 `return`，判完直接出结果 |
| 答对答错都一个样，没点「连击」的感觉 | **§3.6-P0② 连对 streak**：`QZ` 里加 `streak: 0`（只在内存，不落盘）；`uiStreakBump(ok)` 答对 +1、答错清零，`n === 3 \|\| (n > 3 && n % 5 === 0)` 时 `toast('连对 ' + n + ' 题 🔥', 1600, 'ok')`（刻意不上 `fx.js` 彩带，答题时太吵） |
| 今天欠多少复习，得点进去才知道 | **§3.6-P0③ 待复习角标**：`uiDueCount()` 数 `wrong > 0` 且 `due <= now`（与 `isDue()` 同一套判据），`uiPaintBadge()` 把数字挂到 `#btnGoWrong` 和底部导航「错题」那个按钮上（`.nb-badge`，>99 显示 `99+`，`title` 写「今天有 N 道错题到期该复习」，`data-due` 留痕，**0 就把角标摘掉**）；刷新点在 `renderInner()` 收尾（`try { uiPaintBadge(); } catch (e) {}`）。纯读 `ANS`，不新增字段 |
| 自己写解析，想标个红/加粗只能手敲语法 | **§9 解析编辑器浮条**：`collection.js` 编辑器段加 `FMT_COLORS`（红/橙/绿/蓝/紫/灰）+ `fmtBarEl()` / `fmtBarHide()` / `fmtPlace(bar, x, y)`（clamp 在视口内）/ `fmtHasSel()` / `fmtWrap(ta, open, close, refresh)`（已包着再点一下就脱掉；`open` 为空时用正则剥掉 `**` / `==` / 反引号 / `*` / `<font color>` / `<span style=color>`）/ `fmtBarInit(ta)`；`paintEditor()` 里 `fmtBarInit(ta)`，三处关闭编辑器都 `fmtBarHide()`。浮条 `mousedown` 里 `preventDefault()` 保住选区，`mouseup` / `touchend` / `keyup` 唤出，`blur` / 滚动 / Esc / 点别处收起；**存进去的仍是纯 Markdown**（`==高亮==` / `<font color>` 都是 `mdToHtml()` 本来就认的），样式 `.fmt-bar` 放 `style.css` 末尾 |

| 问题 | 说明 |
| --- | --- |
| 错题不想再练了，但要一道道手动选 | **核心功能 ②**：错题本（和「待复习」）展开题目后操作行多一个「**✗ 剔除错题**」（`data-act="kick"`）。只做一件事：`a.wrong = 0`（`inSrs()` 判的就是 `wrong > 0`，清掉就不算错题、也不再排复习），**tries / 正确率 / 收藏 / 自定义解析全留着**；顺带 `a.upd = Date.now()`，云同步不会被别的设备的旧记录盖回来 |
| 批量那块只有收藏 / 移除记录 / 套卷 | **核心功能 ③**：批量折叠条里补 **✗ 剔除错题（保留记录）**（`data-batch="kick"`）、**✓ 标记已掌握**（`data-batch="mastered"`：`wrong=0` + `ok=true` + `redo=false`；这两个只在错题本出现）、**+ 加考点标签**（`data-batch="tagAdd"`：`#tagRow` 输入行 + `<datalist id="batchTagList">` 给词表候选，走 `TAGS.add` / `TAGS.set`，新词进 `qbank.tagvocab.v1`） |
| 撤销点了一点反应都没有 | `mergeWrite()` 按 `recTs = max(ts, upd, updatedAt, createdAt)` 判新旧 —— 撤销时把老快照原样写回会被「刚才那条更新的记录」挡掉，**必须再推一次时间戳**：`snap.upd = Date.now(); ANS[k] = snap;`（批量版：`v.upd = Date.now(); ANS[k] = v;`）。删记录类的撤销还要删墓碑 |

| 问题 | 说明 |
| --- | --- |
| 想换个主色、又不想动 CSS | **第四批**：设置里加「主题色」下拉 `#setColor`（蓝默认 / 靛 / 青 / 紫）。`app.js` 的 `THEME_COLORS` + `applyLook()` 往 `<html>` 写 `data-theme`，`style.css` 用 `html[data-theme="…"]` 覆盖 `--primary / --primary-weak / --primary-line / --primary-soft / --grad`（深色再叠一层，如靛+深色 `#8f9bff`）；值存 `qbank.settings.v2` 的 `color` |
| 换了主题，首页大卡片还是蓝的 | `--grad` 原来只有蓝色一套（`:root` / `body.dark`），四套主题现在各有一份浅色与深色渐变；按钮、选中态、进度条、底栏高亮本来就走 `--primary`，自动跟着变 |
| 点目录树里的目录没反应 | **§7.1**：`cat.js` 的 `bind(host)` 原来给 `[data-trow]` 逐个绑 click，但 `#nbTree` 是点「展开 / 收起目录树」（`doAct('expandAll')`）之后才注入 `treeHtml()` 的，那批节点赶不上绑定 → 改成在 `#nbTree` 上做**事件委托**（`tree.__trowBound` 防重复），点行调 `openDir(row.dataset.trow)`，行内「打开」按钮同路 |
| 题库多了以后一屏看不下几个 | **§7.2**：加 **▦ 卡片 / ☰ 列表** 视图切换（`.nb-view` 的 `.vb[data-act="view"]`），列表行 = 图标 + 名称 + 「N 题 · 已答 N · 错题 N · 正确率 N%」+ 进度条 + 操作按钮；选择存 `qbank.view.v1`，搜索页共用同一套 |
| 页面切换有点硬 | `#view` 加 0.18s 淡入（`@keyframes viewIn`），`prefers-reduced-motion: reduce` 下自动禁用；`h2.sec` 竖条改主色渐变 |

| 问题 | 说明 |
| --- | --- |
| 顶栏堆了一排按钮，换页时忽隐忽现 | **第二批 2.1**：顶栏只留「⌂ 主页（非首页时）/ 标题 / 进度 / ◐」；`错题 / 收藏 / 搜索 / AI / ⚙设置` 五个按钮**原 id 搬进**新的底部导航 `#bnav`（`index.html`），所以 `app.js` 的 `on(...)` 绑定、`markTop()` 高亮、`renderInner()` 显隐都不用重写；新增「首页」`#bnHome` |
| 底部只有答题条，别的页面没有导航 | `#bnav` 常显：**首页 · 错题 · 收藏 · 搜索 · AI · 同步 · 设置**（图标在上文字在下；`flex:1 1 0`+`min-width:0`+省略号，320px 宽七个也排得开、每个 ≥38px 可点）；答题页它是第二行，叠在 `#nav`（上一题 / 答题卡 / 下一题）上面（`body.quiz .bnav{bottom:74px}`），正文留白 `62px` / 答题 `158px`（≤400px 时 166px） |
| 「同步」按钮跑到哪去了 | 它一直是 `sync.js` 自己插的：`syncTopBtn()` 找 `#btnGoKb` 往后插（原来插在顶栏），`#btnGoKb` 搬进底部导航后它自动跟过去，成了第七个入口 |
| 答题页顶栏的「题号 / 设置」与新导航重复 | `renderInner()` 里把 `#btnGrid` / `#btnQuizSet` 统一 `display:none`（元素留在 DOM 里，老引用不报错）：答题卡从 `#jumpInfo` 进、设置从底部导航进 |
| 气泡 / 云同步提示会被新导航挡住 | `.toast` 抬到 `bottom:76px`（答题页 `176px`）、`#syncTip` 抬到 `76px`；设置弹窗（`.mask`，z-index 40）照旧盖在导航（20）上面 |

| 问题 | 说明 |
| --- | --- |
| 答完题还得滚回底部才能翻页 | 反馈区底部加「**下一题 →**」（`showFb()` 里的 `.fbnext` / `#fbNext`），走同一个 `step(1)`；最后一题按钮变灰、文案改「已经是最后一题」（3.1） |
| 手机上选项太小、点不准 | `style.css` 的 `@media(hover:none)` 里把 `.opt` 加到 `padding:13px 14px; min-height:46px`（3.2） |
| 手机上翻题只能点底部按钮 | **候补池 A**：答题页卡片支持左右滑动翻题（`uiBindSwipe()`：横向位移 ≥30px、明显大于纵向、900ms 内；从选项 / 输入框 / 按钮起手不算；`touchend` 里 `preventDefault()` 压掉误触 click） |
| 判分那一下没什么感觉 | **候补池 B**：`uiFeedbackPulse()` 给命中选项加 `.pulse-ok` / `.pulse-bad` 光晕（700ms），触屏再震一下（对 18ms / 错 22-60-22ms），答错弹「已记入错题本」；`prefers-reduced-motion` 时只留文案 |
| 第一次打开、一道题都没有时不知道干嘛 | **候补池 C**：`firstGuideHtml()` 渲染「三步就能开始」卡（导入 / AI / 云同步，三个按钮走 document 事件委托）；因为首页正文其实是 `cat.js` 的目录视图接管，所以 `cat.js` 的 `homeHtml()` 也调它取一次 |
| 追问几轮之后，面板里全是历史 | **候补池 D**：`aiPaintHist()` 把上一轮问答收进「之前的 N 轮追问」折叠块，面板上加「清空对话」（`ai-clear`） |
| 手滑取消收藏 / 移除错题没法回头 | **候补池 E**：`toast(msg, ms, kind, { label, fn })` 支持气泡上的动作按钮；取消收藏与错题本移除都带「撤销」（5 秒）；撤销收藏时要把同步墓碑 `TOMB.fav[k]` 一起删掉，否则 `saveFav()` 合并时又会被过滤 |
| 想随机刷题得进设置 | **候补池 F**：题库工具条加「随机 开 / 关」chip（`#chipShuffle`），直接切 `SET.shuffle` 并落盘 |
| 错题本只能按题库筛 | **候补池 G**：`collection.js` 加「按考点」chips（`data-t`，只列当前列表里真有的标签、按题数排）、「找词」输入框（`#lkw` + `hayOf()`，多个词空格分开、命中处高亮）、「错次 ≥ N」（`#minW`），三者与题库 chip / 只看没做对 / 只看今天到期都能叠加 |
| 手机上看题想复制题干 / 收藏要点好几下 | **候补池 H**：长按题干 600ms 弹 `#stemMenu`（复制题干 / AI 解析 / 收藏 / 关闭），只认 `pointerType === 'touch'` |

| 问题 | 说明 |
| --- | --- |
| AI 输出没法标重点 | `ai.js` 的系统提示教它写 `==高亮==` / `<font color="red">`；`collection.js` 的 Markdown 渲染加白名单（`mdValidColor` 只认颜色名或 `#hex`）与占位符染色（`mdColorize` → `esc()` → `mdColorEnd`），`==x==`→`<mark>`、`<font color>`/`<span style="color:…">`→`<span style="color:…">`，其余 HTML 照样转义 |
| 别的标签页改数据会把正在生成的面板冲掉 | `ai.js` / `variant.js` 的会话加 `ts`（刚打开的空面板也算活的）并导出 `aiPanelOpen()` / `variantPanelOpen()`；`app.js` 的 storage 防抖重画加守卫：面板开着只更新内存、不重画 |
| `make-kb.py` 每次整份重生成、PDF 只能整本切 | 改成读现有 `知识库.js` 合并（同名库按 id 替换）、按 md5 清单 `知识库.清单.json` 增量；PDF 带书签时按顶层书签切小节；新增 `--overwrite/--skip-pdf/--no-bookmarks/--pdf-pages/--max-chars/--dry` |
| `__pycache__\*.pyc` 会被带上线 | `工作1\gh-pages-deploy.mjs` 的上传排除表加 `__pycache__` / `*.pyc` / `知识库.清单.json` |

| 问题 | 说明 |
| --- | --- |
| 多开标签页互相覆盖作答记录 | `writeLS` → `saveAns/saveFav/saveNotes/saveFix/savePapers`（走 `mergeWrite`：先读回存档、按 `ts/upd` 合并、按 `qbank.tomb.v1` 挡删除）；另加 `storage` 事件同步内存（打字中只同步不重画） |
| `知识库.js` 每次打开都拉一遍、又不在缓存里 | `kbEnsureFilesLoaded()` 懒加载（打开 AI 面板 / `#/kb` / `kbSearch` / `aiContext` 时才挂）+ `kbWarmUp()` 空闲预热；`sw.js` 对它改「网络优先 + 写缓存 + 断网回落」，其余资源改 SWR |
| 「导出全部数据」不含知识库 | `exportAllData()` 升到 version 4，多一段 `kb`（`kbExportAll()` / `kbImportAll()`）；文件库不进备份并在提示里说明 |
| 首页「共占用 X MB」只数 localStorage | 改用 `navigator.storage.estimate()`（`storageUse()` / `paintStorageUse()`），不支持时才退回 `storageBytes()` |
| 搜索每敲一字重建全部 haystack | `HAY_CACHE` + `bumpHay()`（`hayListOf(b)` 按题库缓存，库里题目数或版本变了才重建） |
| 首次检索全量建索引卡主线程 | `kbPreheatIndex()` 在 `requestIdleCallback` 里逐库建索引，每轮 `timeRemaining()>4` 就让出 |
| 模块顶层抛错就白屏 | `render()` 拆成 `renderInner()` + try/catch → `showFatal()`（`#fatalBar` 提示条，可复制错误 / 重载 / 关闭），另接 `window.onerror`、`unhandledrejection` |
| 删题库不清「上次做到哪」 | 删题库时 `localStorage.removeItem('qbank.last.' + b.id)` |
| 拉取到的模型「看不见」 | `aiFillModels()` 只填 `<datalist>`（要聚焦+按方向键才弹）；现在同时填一块可见的
`#aiModelPick`（`<select id="aiModelSel">` + 过滤框），清单记进 `AIC.models` 一起存/同步 |
| （已删）考纲页覆盖度每次重算、题多就卡 | 当时的 `syllabus.js` 改成两层缓存（按题 2-gram + 整块结果），
题×考点 > 20000 时先画壳再分片算；实测 600×40 从 384 ms → 45 ms，缓存命中 0.10 ms |
| 云同步带不上标签 | `SYNC_DEF.scope` 加 `tag`（考纲那项 `syl` 后来随功能一起删了），payload 带 `data.tags` / `data.tagVocab`，
墓碑加 `tomb.tag` / `tomb.syl`，合并走 `TAGS.mergeIn()`（本机优先）与 `SYLLABUS.mergeIn()`（按 ts 取新） |

上一版（v14）：

| 问题 | 说明 |
| --- | --- |
| 「检索片段数」该填几 | 片段最长 560 字（实测 8346 段的中位 521）；每段分到 `资料上限 ÷ 片段数` 字，**≥620 才是整段**。默认 4 段 / 3500 字 = 每段 875 字，正好整段；8 段以上要同时把上限提到 5000+。`#/kb` ①区已加实时提示 `#aiRagTip`（`ai.js` 的 `aiRagTip()`） |

| 问题 | 说明 |
| --- | --- |
| 直接打开 `#/exam/...` 或 `#/kb` 白屏 | 原来 `render()` 在 `collection.js` 末尾调用，那时 `exam.js` / `kb.js` 还没加载；现在挪到 `index.html` 最后一个 `<script>`，全部模块就绪后再渲染 |
| 模拟考试判分没走「修正答案」 | `exam.js` 交卷时改用 `ansOf(q._srcKey \|\| kOf(bank,q), q)`，和答题页一致 |
| 文件知识库的单篇文档能点「删」 | 只读库不再显示单篇删除按钮，展开明细会说明；`kbDropDoc` 也会拒绝 |
| AI 模型名不存在 | `deepseek-v4-flash` → `deepseek-flash`（官方只有 `deepseek-flash` / `deepseek-v4-pro`）；`chatbox-import.py` 也加了自动改名兜底 |
| 每次开 AI 面板都重扫知识库 | `kbIngestFiles(force)` 加了一次性标志，恢复被删库时强制重挂 |
| `ai.js` 往题目对象挂 `q.__k` | 改为显式传题目键 |
| PWA 缓存缺图标 | `sw.js` 的 `CORE` 补 `./icons/icon-192.png`、`./icons/icon-512.png` |

## 已知取舍
- 没有后端：换浏览器/清缓存会丢记录；多人共享进度做不到。图片存在 localStorage，浏览器一般给 5MB 左右，图片会自动压到宽 1100px 以内，太多会被提示。
- 题库文件用 `.js` 而不是 `.json`，是为了双击本地打开（`file://`）时也能加载 —— 浏览器不允许 `file://` 下 fetch 本地 JSON。
- 多标签页现在是「按时间戳合并 + 墓碑」，能防丢；但两个标签页同时改**同一条**记录时仍是后写的那条赢（不会合并到字段级）。
- **`AI配置.js` 里有你的明文 API Key，`知识库.js` 里是资料正文：别传到公开仓库。** 想分享站点，删掉 `AI配置.js` 即可（本分享版就是这么做的，并附了 `AI配置.示例.js` 模板），站点会自动退回「AI 面板手工填 Key」的模式。
