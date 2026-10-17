# 刷题站 · 人机交互地图 & AI 动作清单

> 用途：先盘点「人现在能点 / 选 / 输入 / 上传」的地方，再把它收敛成 AI 可以组合的「原子动作」。
> 日期：2026-10-17
> 原则：**AI 不点控件，AI 调动作。** 控件清单是地图，动作清单才是接口。
>
> **2026-10-17 web99 实现状态**：Phase 0/1 已落地，`ai-ops.js` 里实际注册的 **31 个动作**以 `AI_OPS.actions()` 为准；下面 98 条是全量地图，`status` 可能滞后于代码。

---

## 0. 先给结论

可行，但必须分两层：

1. **动作层**：每个动作有唯一 id、参数、上下文、前置条件、确认级别、撤销快照。
2. **意图层**：把一句话拆成动作计划（JSON），先预览，再逐步执行，失败即停，整份计划一次撤销。

不能直接做「列出所有按钮 → 让模型点」：
- 同一功能有多个入口（删题库在题库卡、目录、批量页都有），按控件找会点错。
- 按钮不带参数和前置条件，AI 不知道删的是哪个、能不能删。
- 多步组合一旦中途点错，数据就没了；必须走白名单动作 + 快照/撤销。

---

## 1. 全站交互地图（人可以操作的地方）

### 1.1 全局 / 顶栏
- 返回、回首页、文件、学习统计、收藏、错题、搜索、知识库、同步、设置。
- 主题切换（深/浅/跟随系统）。
- 专注模式（隐藏顶栏/底栏，Esc 退出）。
- 返回键（非首页固定在左上角）。

### 1.2 主页
- 顶部统计：题库数、题数、已答、正确率、错题、收藏、待复习 → 跳到对应页。
- 继续刷题 / 导入新建题库 / 今日复习 / 随机抽 30 题 / 错题本 / 收藏 / 搜索 / 学习统计 / 快捷键。
- 目录树：展开/收起、根目录、逐级目录、点目录跳转。
- 工具栏：＋新建/导入题库、今日复习、随机抽 30、批量管理题库、新建分类、批量导入文件夹。
- 搜索框：按目录名/题库名搜索，Enter 执行。
- 题库/目录卡：单击打开、拖拽移动、⋯ 菜单（让 AI 分析、重命名、移动、删除等）。
- 视图切换：图标 / 列表 / 详细信息；图标大小。
- 选择：普通模式方框多选、批量模式单击选中、全选、取消；选择结果一键加进 AI 对话或拖入对话。
- 本机题库文件：保存到本机文件 / 打开题库文件 / 另存为 / 自动保存。
- 数据备份：导出全部数据、导入数据（恢复）。
- AI 对话卡片：输入、发送、附件、选题库、历史、全屏、拖动调高。

### 1.3 答题页 / 背题
- 开始/继续/今日复习/随机抽题/错题重做。
- 选项选择、提交答案（多选）、上一题 / 下一题、题号导航、答题卡。
- 收藏 / 取消收藏。
- 专注模式。
- 考点标签：＋ 标签（手动添加/删除）、AI 标签（从词表挑 1–3 个）。
- 口诀 / 思路 文本框（本机保存）。
- ⋯ 更多：再答一次、改解析、改答案、AI 解析、AI 变式题、删除本题。
- 背题模式、显示答案、解析展开、来源/资料引用。
- 速刷模式：倒计时、停下看解析、自动下一题。

### 1.4 题目管理 / 套卷
- 题目列表、筛选、搜索、单题编辑、单题删除、批量删除。
- 改答案、改解析、改分类、移动题目。
- 套卷（临时卷）生成、删除套卷、套卷内作答。

### 1.5 学习统计 / 错题 / 收藏 / 搜索
- 总览：题量、已答、正确率、错题数、收藏数、热力图、时间范围（近 7/30 天等）。
- 按章节/按考点统计、标签筛选、薄弱点。
- 错题本：列表、筛选、单题操作、清空错题标记。
- 收藏：列表、筛选、取消收藏、清空收藏。
- 搜索：关键词、目录/题库名、题目搜索、结果跳转。
- 考点词表：加一个考点、批量导入（一行一个/粘贴）、让 AI 起一份、从已打标签补全。
- 让 AI 给没标签的题批量贴标签、停止、进度/失败提示。
- 标签统计：按考点看题目/正确率、点标签筛选。

### 1.6 设置 / 同步 / 备份
- 外观：主题、字号、主题色。
- 答题：自动下一题、答对也显示解析、随机顺序、速刷时长。
- 动效：减少动画、答对特效、普通题库特效。
- 专注模式。
- 复习：SRS 模式、错题是否计入今日复习、重置复习数据。
- 数据：导出全部数据、导入数据（恢复）、清空全部数据。
- 云同步：服务商/仓库/分支/Token、立即同步、上传/下载、冲突处理。

### 1.7 AI 与知识库
- AI 服务：服务商预设、Base URL、API Key、模型名、测试连接。
- 知识库：新建知识库、选择目标库、导入文件（txt/md/csv/html/json）、粘贴文本、命名、加入。
- 知识库选择：全选、清空选择、逐库勾选。
- 检索：输入题干关键词、检索、查看命中片段、引用。
- 删除/重建索引、查看已删/跳过列表。
- PDF 阅读器：打开、翻页、缩放、跨域线路选择。

### 1.8 导入 / 上传
- 粘贴题目文本、填题库名、解析预览、保存题库、填入示例。
- 从文件读取（txt/json/md）、批量导入文件夹。
- 拖拽文件到页面/对话卡片（PDF、图片、doc/docx、txt、json、html 等）。
- 导入备份 JSON、恢复数据。

### 1.9 AI 对话
- 发送、停止、Shift+Enter 换行、附件、选题库、拖题库/目录进对话。
- 多会话：新对话、切换、删除、历史抽屉、全屏、拖动调高。
- 消息工具：复制、重试、编辑、撤销。
- 指令：删题库/删题/标签/收藏/错题/设置/导出/存题库并收藏/撤销。
- 当前题上下文：给这道题打标签、AI 标签。

---

## 2. 动作注册表

### 2.1 一个动作长什么样

```json
{
  "id": "bank.delete",
  "title": "删除题库",
  "group": "题库",
  "params": [{ "name": "bankId", "type": "bank", "required": true }],
  "context": ["currentBank"],
  "preconditions": ["bank.source === 'local'", "!bank.paper"],
  "confirm": "destructive",
  "undo": ["qbank.local.v2", "qbank.answers.v2", "qbank.favs.v2", "qbank.notes.v2", "qbank.tags.v1", "qbank.tomb.v1"],
  "ui": "题库卡 ⋯ → 删除",
  "status": "ready",
  "command": "删除题库《X》"
}
```

- `confirm`：`none` / `normal` / `destructive`；`destructive` 必须弹确认。
- `undo`：动作前快照哪些 localStorage 键；一个计划共用一份快照。
- `context`：可以从当前状态自动补的参数（当前题库、当前题、上次位置）。
- `status`：`ready` 已有指令 / `ui` 仅界面 / `todo` 未接 / `blocked` 需要人工或系统权限。

### 2.2 动作表

#### 导航 / 视图

| ID | 动作 | 参数 / 上下文 | UI 入口 | 现状 |
|---|---|---|---|---|
| `nav.goto` | 去某个页面 | route（首页/统计/错题/收藏/搜索/知识库/同步/对话） | 顶栏、底栏、按钮 | 🟡 仅 UI |
| `nav.back` | 返回上一页 | 无 | 左上返回键 | 🟡 仅 UI |
| `view.set` | 切换图标/列表/详细信息 | mode | 题库区右上 | 🟡 仅 UI |
| `search.run` | 搜索题目/题库 | keyword, scope | 搜索框 | 🟡 仅 UI |
| `focus.toggle` | 专注模式 | on/off | 答题页、设置 | 🟡 仅 UI |
| `theme.toggle` | 切换深浅色 | mode | 顶栏月亮/太阳 | ✅ 设 `set.theme` |

#### 题库 / 目录

| ID | 动作 | 参数 / 上下文 | UI 入口 | 现状 |
|---|---|---|---|---|
| `bank.open` | 打开题库 | bankId | 题库卡 | 🟡 仅 UI |
| `bank.create` | 新建题库 | title, source | ＋新建/导入 | 🟡 仅 UI |
| `bank.importText` | 粘贴文本建库 | title, text | 导入页 | 🟡 仅 UI |
| `bank.importFile` | 从文件建库 | file | 导入页、拖拽 | 🟡 仅 UI |
| `bank.importFolder` | 批量导入文件夹 | folder | 主页批量 | 🟡 仅 UI |
| `bank.rename` | 重命名题库 | bankId, title | ⋯ 菜单 | 🟡 仅 UI |
| `bank.move` | 移动题库到目录 | bankId, catId | 拖拽、⋯ 菜单 | 🟡 仅 UI |
| `bank.delete` | 删除题库 | bankId | ⋯ 菜单 | ✅ `删除题库《X》` |
| `bank.batchDelete` | 批量删除题库 | bankIds | 批量管理 | ✅ `批量删除《A》《B》` |
| `bank.export` | 导出题库文件 | bankId, format | 新命令 | ✅ `导出题库《X》` |
| `bank.saveFile` | 保存到本机文件 | bankId | 本机题库文件 | ⛔ 需文件系统 |
| `bank.openFile` | 打开题库文件 | file | 本机题库文件 | ⛔ 需文件选择 |
| `bank.autoSave` | 自动写回文件 | on/off | 本机题库文件 | ⛔ 需文件句柄 |
| `cat.create` | 新建分类 | title, parent | ＋新建分类 | 🟡 仅 UI |
| `cat.rename` | 重命名目录 | catId, title | ⋯ 菜单 | 🟡 仅 UI |
| `cat.move` | 移动目录 | catId, parent | 拖拽 | 🟡 仅 UI |
| `cat.delete` | 删除目录（连内容） | catId | ⋯ 菜单 | 🟡 仅 UI |
| `batch.select` | 批量选中 | refs | 批量管理 | 🟡 仅 UI |
| `select.marquee` | 方框多选 | rect | 题库区空白拖框 | ✅ 选择条「加进 AI 对话」 |
| `selection.toChat` | 把选中项加进对话 | refs | 选择条 / 拖入 | ✅ UI |

#### 题目 / 作答

| ID | 动作 | 参数 / 上下文 | UI 入口 | 现状 |
|---|---|---|---|---|
| `question.open` | 打开某题 | bankId, qid | 题号、答题卡 | 🟡 仅 UI |
| `question.select` | 选选项 | qid, options | 选项 | 🟡 仅 UI |
| `question.submit` | 提交答案 | qid, options | 提交 | 🟡 仅 UI |
| `question.next` / `prev` | 下一题/上一题 | 无 | 底部按钮 | 🟡 仅 UI |
| `question.goto` | 跳到第 n 题/题号 | n | 答题卡 | 🟡 仅 UI |
| `question.favorite` | 收藏/取消收藏 | bankId, qids | ☆ 收藏 | ✅ `收藏《X》第n题` |
| `question.markWrong` | 标为错题 | bankId, qids | 更多/错题 | ✅ `标为错题` |
| `question.markMastered` | 错题标为已掌握 | bankId, qids | 错题本 | ✅ `错题标为已掌握` |
| `question.clearWrong` | 清除错题标记 | bankId/all | 错题本 | ✅ `清除题库里的错题集` |
| `question.clearAnswers` | 清空作答记录 | bankId, qids | 更多 | ✅ `清空作答记录` |
| `question.redo` | 再答一次 | qid | 更多 | 🟡 仅 UI |
| `question.editAnswer` | 改答案 | bankId, qid, answer | 更多 → 改答案 | 🟡 仅 UI |
| `question.editExplain` | 改解析 | bankId, qid, text | 更多 → 改解析 | 🟡 仅 UI |
| `question.note` | 口诀/思路 | qid, text | 答题页文本框 | 🟡 仅 UI |
| `question.delete` | 删除本题 | bankId, qid | 更多 → 删除本题 | ✅ `删除《X》第n题` |
| `question.bulkDelete` | 批量删题 | bankId, nums | 新命令 | ✅ `删除第3-5题` |
| `question.aiExplain` | AI 写解析 | qid | 更多 → AI 解析 | 🟡 仅 UI |
| `question.aiVariant` | AI 变式题 | qid, n | 更多 → AI 变式 | 🟡 仅 UI |
| `question.saveAIExplain` | 存入本题解析 | qid, text | AI 解析面板 | 🟡 仅 UI |
| `question.recite` | 背题 | qid | 背题按钮 | 🟡 仅 UI |
| `quiz.start` | 开始/继续刷题 | bankId, mode | 开始/继续 | 🟡 仅 UI |
| `quiz.review` | 今日复习 | count | 主页 | 🟡 仅 UI |
| `quiz.random` | 随机抽题 | n | 主页 | 🟡 仅 UI |
| `quiz.speed` | 速刷/停止 | on/off | 速刷开关 | 🟡 仅 UI |
| `paper.delete` | 删除套卷 | paperId | 套卷菜单 | 🟡 仅 UI |

#### 标签 / 统计 / 错题 / 收藏

| ID | 动作 | 参数 / 上下文 | UI 入口 | 现状 |
|---|---|---|---|---|
| `tag.add` | 给题打标签 | bankId, qids, tags | ＋标签 / 对话 | ✅ |
| `tag.remove` | 去掉标签 | bankId, qids, tag | 标签 chip × | 🟡 仅 UI |
| `tag.aiOne` | AI 给这道题打标签 | bankId, qid | 考点行「AI 标签」/ 对话 | ✅ |
| `tag.aiAll` | AI 给所有未标签题打标签 | 词表 | 统计页 / 对话 | ✅ |
| `tag.stop` | 停止 AI 打标签 | 无 | 统计页 | ✅ 对话「撤销」会停 |
| `tag.vocabImport` | 导入考点词表 | lines | 统计页 / 对话 | ✅ |
| `tag.vocabGenerate` | 让 AI 起一份词表 | 无 | 统计页 / 对话 | ✅ |
| `tag.filter` | 按标签筛选 | tag | 统计页 | 🟡 仅 UI |
| `stats.open` | 打开学习统计 | range | 底栏/按钮 | 🟡 仅 UI |
| `wrong.open` | 打开错题本 | filter | 底栏 | 🟡 仅 UI |
| `fav.open` | 打开收藏 | filter | 底栏 | 🟡 仅 UI |
| `srs.review` | 开始复习 | 无 | 今日复习 | 🟡 仅 UI |

#### 设置

| ID | 动作 | 参数 | UI | 现状 |
|---|---|---|---|---|
| `set.theme` | 深色/浅色/跟随系统 | mode | 设置/顶栏 | ✅ |
| `set.font` | 字号 | s/m/l/xl | 设置 | ✅ |
| `set.color` | 主题色 | blue/indigo/teal/violet | 设置 | ✅ |
| `set.autoNext` | 自动下一题 | on/off | 设置 | ✅ |
| `set.expOnOk` | 答对也显示解析 | on/off | 设置 | ✅ |
| `set.shuffle` | 随机顺序 | on/off | 设置 | 🟡 仅 UI |
| `set.speedSec` | 速刷时长 | 秒 | 设置 | 🟡 仅 UI |
| `set.focus` | 专注模式 | on/off | 设置 | 🟡 仅 UI |
| `set.reduceMotion` | 减少动画 | on/off | 设置 | 🟡 仅 UI |
| `set.confetti` | 答对特效 | on/off | 设置 | 🟡 仅 UI |
| `set.normalBankFx` | 普通题库特效 | on/off | 设置 | 🟡 仅 UI |

#### 数据 / 同步 / 知识库 / 文件

| ID | 动作 | 参数 | UI | 现状 |
|---|---|---|---|---|
| `data.exportAll` | 导出全部数据 | 无 | 设置/备份 | ✅ |
| `data.importBackup` | 导入备份 | file | 设置/备份 | ⛔ 需文件选择 |
| `data.resetAll` | 清空全部数据 | 无 | 设置 | 🟡 仅 UI（高危） |
| `sync.config` | 配置云同步 | owner/token/repo | 同步页 | 🟡 仅 UI |
| `sync.now` | 立即同步 | 无 | 同步页 | 🟡 仅 UI |
| `kb.addText` | 粘贴文本入库 | name, text | 知识库页 | 🟡 仅 UI |
| `kb.uploadFiles` | 上传文件入库 | files | 知识库页 | ⛔ 需文件选择 |
| `kb.select` | 勾选参与检索的库 | ids | 知识库页 | 🟡 仅 UI |
| `kb.search` | 检索资料 | query | 知识库页/答题 AI | 🟡 仅 UI |
| `kb.delete` | 删除/重建库 | id | 知识库页 | 🟡 仅 UI |
| `kb.export` | 导出知识库/按关键词导出 | libIds, keyword | 对话 | ✅ |
| `pdf.open` | 打开 PDF 阅读器 | file/url | 知识库/附件 | 🟡 仅 UI |

#### 导入 / 对话

| ID | 动作 | 参数 | UI | 现状 |
|---|---|---|---|---|
| `import.paste` | 粘贴题目文本 | text | 导入页 | 🟡 仅 UI |
| `import.preview` | 解析预览 | text | 导入页 | 🟡 仅 UI |
| `import.saveBank` | 保存为题库 | parsed | 导入页 | 🟡 仅 UI |
| `import.folder` | 批量导入文件夹 | files | 主页 | 🟡 仅 UI |
| `chat.send` | 发消息 | text, atts | 对话框 | ✅ |
| `chat.stop` | 停止生成 | 无 | 停止 | 🟡 仅 UI |
| `chat.attach` | 加附件 | files | 📎 / 拖入 | ⛔ 需文件选择 |
| `chat.pickBanks` | 选题库 | refs | 选题库面板 | 🟡 仅 UI |
| `chat.new` | 新对话 | 无 | 侧栏 | 🟡 仅 UI |
| `chat.switch` | 切换会话 | chatId | 侧栏 | 🟡 仅 UI |
| `chat.delete` | 删除会话 | chatId | 侧栏 × | 🟡 仅 UI |
| `chat.undo` | 撤销上一步操作 | 无 | 消息下方 | ✅ |
| `chat.fullscreen` | 全屏对话 | 无 | ⤢ 全屏 | 🟡 仅 UI |
| `chat.resize` | 调高主页对话 | px | 右下角拖动 | 🟡 仅 UI |
| `quiz.exam.start/submit` | 套卷/考试 | bankId | 考试页 | 🟡 仅 UI |

---

## 3. 组合计划示例

### 例 1：把这章错题打上「糖酵解」并导出

用户说：**把这章错题打上糖酵解标签，然后导出错题**

```json
{
  "intent": "给当前题库的错题打标签并导出",
  "steps": [
    { "action": "resolveBank", "from": "current" },
    { "action": "filterQuestions", "bank": "$1", "where": { "wrong": true } },
    { "action": "tag.add", "bank": "$1", "targets": "$2", "tags": ["糖酵解"] },
    { "action": "exportWrong", "bank": "$1", "format": "md" }
  ],
  "preview": { "questions": 12, "tags": 1, "files": 1 },
  "confirm": true
}
```

执行前说清楚：**将给 12 道错题打「糖酵解」，并导出 1 个文件。** 执行后一个「↶ 撤销」恢复标签和文件操作前的数据。

### 例 2：删掉《X》第 3–5 题并更新统计

```json
{
  "steps": [
    { "action": "resolveBank", "title": "X" },
    { "action": "question.bulkDelete", "bank": "$1", "nums": [3, 4, 5] },
    { "action": "stats.recalc", "bank": "$1" }
  ],
  "preview": { "deleteQuestions": 3, "bank": "X" },
  "confirm": "destructive"
}
```

### 例 3：把刚才的题存题库、收藏、打标签

```json
{
  "steps": [
    { "action": "chat.lastQuiz" },
    { "action": "bank.saveFromQuiz", "quiz": "$1" },
    { "action": "question.favorite", "bank": "$2", "targets": "all" },
    { "action": "tag.aiOne", "bank": "$2", "targets": "all" }
  ],
  "preview": { "newBank": "心肌梗死专项", "questions": 3, "favorite": 3 },
  "confirm": true
}
```

### 例 4：知识库关键词导出 + 出题

用户说：**把知识库有关心衰的内容导出，再按这些内容出 5 道题**

```json
{
  "steps": [
    { "action": "kb.export", "keyword": "心衰", "format": "md" },
    { "action": "quiz.generateFromKB", "keyword": "心衰", "count": 5 }
  ],
  "preview": { "files": 1, "questions": 5 },
  "confirm": false
}
```

---

## 4. 执行规则（必须先定）

1. **动作白名单**：只有注册表里的动作能执行；模型不能发明动作。
2. **参数必须解析成 id**：题库/题目/目录都要落到 id，不接受「右边那个」。
3. **先预览再执行**：显示将改动的题库数、题目数、文件数；破坏性操作默认要确认。
4. **一个计划一份快照**：执行前快照相关 localStorage 键；撤销一次回退整份计划。
5. **失败即停**：某一步失败，停止后续步骤，报告第几步/原因，保留已完成的撤销入口。
6. **不假装能操作系统**：文件选择器、GitHub 登录、付费、外部网站，只能提示用户手动完成。
7. **可审计**：记录「谁（用户/指令）→ 哪个计划 → 改了哪些 id → 能否撤销」。

---

## 5. 现有能力 vs 缺口

### 已经能通过对话执行
- 删除题库 / 批量删题库；删除题目 / 范围删题；删除当前题。
- 手动打标签（题库 / 题号 / 这道题）、AI 给这道题打标签、AI 批量打标签、停止。
- 词表导入、让 AI 起一份词表。
- 收藏 / 取消收藏 / 清空收藏。
- 错题标为已掌握 / 标为错题 / 清除错题标记 / 清空作答记录。
- 深/浅色、字号、主题色、答对显示解析、自动下一题。
- 导出知识库（关键词过滤）、导出题库、导出错题/收藏、导出全部数据。
- 存 AI 出的题为新题库并收藏。
- 撤销最近一步。

### 还缺（建议优先补）
1. 题库/目录：新建、重命名、移动、删除目录、批量移动。
2. 题目：改答案、改解析、加题、移动题。
3. 标签：去掉标签、按标签筛选。
4. 设置：随机顺序、速刷时长、专注、减少动画、特效。
5. 导入/备份：从文件导入题库、恢复备份（需要文件选择）。
6. 知识库：粘贴入库、上传文件、勾选库、检索、删除。
7. 导航：打开某题库/某题、开始复习/随机抽题。
8. 多步计划执行器：预览、顺序执行、失败停止、计划级撤销。

---

## 6. 实施顺序

- **P0（照现有能力包装）**：把已经能用的指令包成 `actions`，加 `plan` 外层；先支持单步 + 计划级快照。
- **P1（补安全动作）**：题库/目录 CRUD、改答案/解析、去标签、设置开关、导航。
- **P2（文件/知识库）**：导出类已可用；导入类先做「提示用户选文件 + 读入后执行」，不假装能替用户点系统对话框。
- **P3（计划执行器）**：规则解析 + 模型兜底 → 计划 JSON → 预览 → 执行 → 撤销；先跑 3 个试点场景。
- **P4（扩展）**：把更多 UI 动作接入注册表，补权限/审计/多步撤销。

---

## 7. 需要你拍板的点

1. **动作范围**：先只做「数据 + 设置 + 导出」，还是连「打开某题/开始复习/答题」也接？
2. **确认策略**：删除/批量改动必须确认；打标签/收藏是否也要确认，还是直接做 + 撤销？
3. **撤销粒度**：目前只保留最近一步；是否要改成「每个计划一份、保留最近 5 份」？
4. **文件类**：导入/上传必须由你选文件，AI 只负责读入后处理；这个边界你接受吗？
5. **模型权限**：模型只输出计划 JSON，不直接执行；执行器校验后运行。是否同意？

> 这份清单先不动代码；你确认结构和优先级后，我再把动作注册表落成代码，并用 3 个组合场景试点。
