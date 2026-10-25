# 刷题站 · AI 操作执行层方案（当前实现版，web99）

> 文档性质：**as-built（按代码实际写成的方案）**，不是目标蓝图。
> 用途：交给另一个 AI 做架构评审 / 找漏洞 / 提改进。第 13 节是已知边界，第 14 节是希望评审 AI 优先回答的问题。
> 代码事实来源：`ai-ops.js`（执行核 + 31 个动作）、`chat.js`（意图层 + 预览卡 UI）、`AI动作清单.md`（全量人机交互地图）、`ai-actions.json`（设计期注册表初稿）。
> 版本：本地 `shuati-v67-web99`；**未部署**，线上保持原样。
> 日期：2026-10-17。
> **评审后更新（2026-10-17）**：§13 列出的缺陷经代码复查又补了 7 条（D-1…D-7），阶段 1 修补已在代码里落地并通过全部探针；实际改动与验证结果见 §18，后续阶段见 §19。

---

## 0. 一句话结论

这个站现在只有**一条 AI 写通道**：

```
用户一句话
  → chat.js 意图层（规则解析 / 模型规划）
  → AI_OPS.preview()（dry-run，参数物化，顺序预演）
  → 聊天里的预览卡（影响数量 / 风险 / 是否可撤销 / hash）
  → 用户点「执行计划」
  → AI_OPS.execute()（票据校验 / 计划锁 / 幂等 / WAL / 失败补偿）
  → 消息下面「↶ 撤销」（WAL 逆序 + 版本校验）
```

AI **不点 DOM**，只调用白名单动作；动作调用站点自己的 store / 全局数据层。预览和执行共用同一份 `run(ctx, params)`，靠 `ctx.mode = 'dry' | 'apply'` 区分。

---

## 1. 目标与非目标

### 1.1 目标

- 用户用自然语言完成站内操作：删题库、删题、打考点标签、收藏、错题管理、设置外观、导出文件。
- 支持多步组合，例如「把这章错题打上糖酵解标签，然后导出错题」。
- 写操作必须先看到影响面；执行后尽量可撤销。
- 预览说影响多少，执行就只动多少；预览后数据变了要拦下。
- 不要求用户记按钮位置；同一功能多入口不影响 AI。
- 文件类导出要给真文件（Blob 下载），不能只把内容贴在对话里。

### 1.2 非目标（当前不做）

- 不做后端 service / 数据库事务；站点是纯静态、无构建、无框架。
- 不做跨设备同步保证；WAL 只在 localStorage。
- 不自动操作系统文件选择器、GitHub 登录、交卷。
- 不做考试模式下的答题/交卷自动执行。
- 不做计划级全量快照、对象级锁、完整字段级 diff（这些是评审重点）。

---

## 2. 运行环境与数据边界

- 纯原生静态站：多文件 `<script>`，全局作用域，不是 ES module；无构建、无框架。
- 页面由 `render()` 整页重画 `#view`；聊天主页内嵌 + `#/chat` 整页两种形态。
- 数据主要在 `localStorage`；知识库正文在 IndexedDB；PDF 在站点目录（不进 localStorage）。
- 浏览器要求：现代 Chromium / Edge；代码使用 `async/await`。
- 站点有 Service Worker；部署走 GitHub Pages。

### 2.1 与操作层相关的 localStorage 键

| 键 | 内容 |
|---|---|
| `qbank.local.v2` | 自建题库数组（题目正文、标题、目录归属） |
| `qbank.answers.v2` | 作答记录 / 错题次数 |
| `qbank.favs.v2` | 收藏 |
| `qbank.notes.v2` | 自定义解析 |
| `qbank.tags.v1` | 题目考点标签 |
| `qbank.tagvocab.v1` | 考点词表 |
| `qbank.tomb.v1` | 删除墓碑（防其它标签页/云端复活） |
| `qbank.papers.v2` | 套卷定义 |
| `qbank.qtn.v1` | 口诀 / 思路便签 |
| `qbank.answerfix.v1` | 手动修正答案 |
| `qbank.srs.v1` | 间隔重复调度 |
| `qbank.cats.v1` | 目录树 |
| `qbank.settings.v2` | 外观 / 答题设置 |
| `qbank.lastbank.v1` | 上次做到哪道题 |
| `qbank.chat.v2` | 多会话聊天树（含预览卡节点） |
| `qbank.kb.list.v1` | 知识库清单 |
| `qbank.aiops.wal.v1` | 变更日志（WAL） |
| `qbank.aiops.plans.v1` | 计划记录 |
| `qbank.aiops.audit.v1` | 审计日志 |
| `qbank.aiops.steps.v1` | 步骤幂等缓存 |
| `qbank.aiops.lock.v1` | 计划级锁 |
| `qbank.aiops.kill.v1` | 全局 kill switch |
| `qbank.aiops.tickets.v1` | 预览确认票据（按 hash 存，最多 12 个） |

---

## 3. 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│ chat.js · 意图层                                              │
│  isChatCommand() → autoPlan()                                 │
│    ├─ planSaveQuiz()      存题库 + 可选打标签                  │
│    ├─ planSplit()         多步拆分                             │
│    ├─ planStep()          单步规则解析                         │
│    └─ planByModel()       模型输出 JSON 计划（兜底）            │
│  opsRun() → AI_OPS.preview() → 预览卡节点                      │
│  预览卡按钮 → opsExecute() / opsUndo() / 停止后台任务           │
└───────────────────────────┬──────────────────────────────────┘
                            │ 只传 {action, params}
┌───────────────────────────▼──────────────────────────────────┐
│ ai-ops.js · 动作层 + 执行核                                    │
│  register / alias / getAction / actions / catalog              │
│  preview / execute / runNow / undoPlan / rollback / resume     │
│  WAL / 票据 / 计划锁 / 幂等缓存 / 审计 / kill switch            │
│  31 个动作：每个动作 resolve + run(ctx, params)                │
└───────────────────────────┬──────────────────────────────────┘
                            │ 调业务函数，不碰 DOM
┌───────────────────────────▼──────────────────────────────────┐
│ app.js / cat.js / tags.js / variant.js / kb.js / exam.js …     │
│  addTags / saveFav / delBankQuestion / CAT.deleteBanks / …      │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ localStorage / IndexedDB / Blob 下载                           │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 两条硬规则

1. **动作只调 service / store，不点 DOM。** 选择器会随 UI 改动失效，且绕过业务校验。
2. **dry 与 apply 共用同一个 `run()`。** 不另写一套预览校验函数，避免「预览 12 题、执行删 30 题」。

---

## 4. 动作注册表

### 4.1 动作元数据

```js
{
  id: 'bank.delete',
  title: '删除题库',
  risk: 'R0' | 'R1' | 'R2' | 'R3' | 'R4',
  reversible: true | false,
  readOnly: true | false,
  hidden: true | false,        // 别名不在 actions() 里显示
  paramsHint: '...',           // 给模型看的参数提示
  resolve(ctx, params) -> params,  // 可选：预览前物化目标
  run(ctx, params) -> { ok, impact?, text?, changed?, result?, virtual?, warnings? }
}
```

### 4.2 当前 31 个可见动作（运行时导出）

| id | 标题 | 风险 | 可撤销 | 参数（提示） |
|---|---|---|---|---|
| `bank.delete` | 删除题库 | R3 | 是 | `{bankTitles:["名"]}` 或 `{bankIds:["id"]}` |
| `bank.rename` | 重命名题库 | R1 | 是 | `{bankTitle:"旧名", title:"新名"}` |
| `bank.move` | 移动题库到目录 | R1 | 是 | `{bankTitle:"名", catTitle:"目录"}`；空=顶层 |
| `cat.create` | 新建目录 | R1 | 是 | `{title:"名", parentTitle:"上级（可空）"}` |
| `cat.rename` | 重命名目录 | R1 | 是 | `{catTitle:"旧名", title:"新名"}` |
| `cat.move` | 移动目录 | R1 | 是 | `{catTitle:"名", parentTitle:"新上级（空=顶层）"}` |
| `question.delete` | 删除题目 | R3 | 是 | `{bankTitle:"名", nums:[3,5]}` 或 `{currentQ:true}` |
| `question.favorite` | 收藏/取消收藏 | R1 | 是 | `{bankTitle:"名", nums:[1,3], on:true}`；不带题库且 `on:false` = 清空全部收藏 |
| `question.markWrong` | 标为错题 | R1 | 是 | `{bankTitle:"名", nums:[...]}` |
| `question.mastered` | 错题标为已掌握 | R1 | 是 | `{bankTitle:"名", wrong:true}` |
| `question.clearAnswers` | 清空作答记录 | R3 | 是 | `{bankTitle:"名", nums:[...]}` 或 `{all:true}` |
| `tag.add` | 给题打考点标签 | R1 | 是 | `{bankTitle:"名", nums:[1,2], tags:["心衰"]}`；`bank:"$new"` = 刚存的题库 |
| `tag.aiOne` | AI 给这道题打标签 | R1 | 是 | `{currentQ:true}` 或 `{bankId,qid}` |
| `tag.aiAll` | AI 批量打标签（后台） | R2 | **否** | `{}` |
| `tag.vocabImport` | 导入考点词表 | R1 | 是 | `{text:"心衰、利尿、炎症"}` |
| `tag.vocabGenerate` | 让 AI 起一份考点词表 | R2 | 是 | `{}` |
| `settings.theme` | 切换深浅色 | R1 | 是 | `{theme:"dark|light|auto"}` |
| `settings.font` | 调整字号 | R1 | 是 | `{fs:"s|m|l|xl"}` |
| `settings.color` | 切换主题色 | R1 | 是 | `{color:"blue|teal|indigo|violet|warm"}` |
| `settings.autoNext` | 自动下一题 | R1 | 是 | `{on:true|false}`（也兼容 `{autoNext:...}`） |
| `settings.expOnOk` | 答对也显示解析 | R1 | 是 | `{on:true|false}`（也兼容 `{expOnOk:...}`） |
| `export.bank` | 导出题库文件 | R0 | — | `{bankTitle:"名"}` |
| `export.wrong` | 导出错题 | R0 | — | `{all:true}` 或 `{bankTitle:"名"}` |
| `export.fav` | 导出收藏 | R0 | — | `{all:true}` 或 `{bankTitle:"名"}` |
| `export.all` | 导出全部数据备份 | R0 | — | `{}` |
| `export.kb` | 导出知识库 | R0 | — | `{name:"知识库名（可空）", keyword:"心衰（可空）"}` |
| `save.quiz` | 把上一条 AI 出题存成题库 | R1 | 是 | `{sourceNode:"用户消息id", favorite:true|false}` |
| `open.bank` | 打开题库 | R0 | — | `{bankTitle:"名"}` |
| `quiz.start` | 开始刷题 | R0 | — | `{bankTitle:"名"}` |
| `quiz.review` | 开始今日复习 | R0 | — | `{}` |
| `stats.recalc` | 刷新统计 | R0 | — | `{}` |

隐藏别名（不在 `AI_OPS.actions()` 里显示，但 `getAction` 可用）：

- `favorite.toggle` → `question.favorite`
- `set.theme` / `set.font` / `set.color` / `set.autoNext` / `set.expOnOk` → 对应 `settings.*`

### 4.3 风险分级

| 级别 | 含义 | 当前处理 |
|---|---|---|
| R0 | 只读 / 导出 / 导航 | `runNow()` 直接执行，不打票据、不进 WAL，无预览卡 |
| R1 | 可逆、低风险 | 预览卡 → 执行 → 可撤销 |
| R2 | 批量 / 可逆 | 预览卡 → 执行 → 可撤销；`tag.aiAll` 例外，标不可撤销 |
| R3 | 删除 / 清空 / 破坏性 | 预览卡红色按钮 + 警告；有 WAL 逆操作，但失败时不自动补偿 |
| R4 | 外发 / 系统级 | 当前没有接入；文件选择器、GitHub 登录、交卷均人工 |

计划的 `risk` = 所有步骤的最大风险；计划的 `reversible` = 所有动作 `reversible !== false`。

---

## 5. 计划、票据与 hash

### 5.1 计划输入

模型/意图层只产出：

```json
{
  "steps": [
    { "action": "question.delete", "params": { "bankTitle": "病理学", "nums": [3, 5] } },
    { "action": "stats.recalc", "params": {} }
  ]
}
```

执行核 `normalize()`：

- 校验 `steps` 非空、≤ 20 步、每一步 action 已在注册表；
- 参数做 JSON 深拷贝；
- 不信任模型输出的原文，只信解析后的 action + params。

### 5.2 票据（Ticket）

预览成功后写入 `qbank.aiops.tickets.v1`：

```js
{
  hash: 'a1b2c3d4',
  steps: [{ action, params, title, risk, reversible }],  // 已物化
  createdAt: 1792...,
  expiresAt: 1792...,   // createdAt + 5 分钟
  used: false
}
```

- 票据按 `hash` 存在一个对象里，最多 12 个；多张预览卡可以同时存在。
- 执行时校验：存在、hash 匹配、未使用、未过期。
- 执行开始前把 `used = true`；失败后也不能复用，必须重新预览。
- 票据是 localStorage 数据，不绑定具体聊天节点 id；绑定的是 hash。

### 5.3 hash

`hashPlan(steps)` = FNV-1a 32 位，输入是**物化后的** `action + params` 的 canonical JSON（对象键排序，数组保持顺序）。

- hash 覆盖解析后的参数与目标 id，不覆盖模型输出原文。
- 预览卡展示 hash 前 8 位。
- 执行时用票据里的 hash；调用方传进来的 plan 对象不会覆盖票据内容。

---

## 6. 预览（dry-run）流程

`AI_OPS.preview(plan)`：

1. `normalize(plan)`。
2. 维护 `virtual = { deleted: {} }`。
3. 逐步：
   - `p = clone(step.params)`；
   - 如果有 `resolve`，先物化目标（题库 id、题目 id 列表、目录 id 等）；
   - 以 `ctx.mode='dry'` 调 `run(ctx, p)`；
   - 收集 `impact` / `warnings`；
   - `mergeVirtual(virtual, r.virtual)`。
4. 生成票据并写入 `qbank.aiops.tickets.v1`。
5. 返回：

```js
{
  ok: true,
  hash: 'a1b2c3d4',
  risk: 'R3',
  reversible: true,
  steps: [
    { action, title, risk, reversible, params, impact: { summary, questions, ... }, warnings: [] }
  ],
  plan: { steps: [...] }   // 已物化，可直接交给 execute
}
```

失败返回 `{ ok:false, error:'第 N 步（动作名）：原因' }`。

### 6.1 参数物化（关键安全属性）

预览时把「人话目标」落成固定 id：

- `targetBanks(params)` 支持：
  - `bankIds` / `bankId`；
  - `bankTitles` / `bankTitle`（精确名、唯一子串）；
  - `current` / `bank:'current'`；
  - `bank:'$new'`（上一步刚创建的新题库）；
  - `allBanks`（全库操作，如「清除我题库里的错题集」）。
- `selectQs(bank, params)` 支持：
  - `qids`；
  - `currentQ`；
  - `nums`（第几题）；
  - `wrong`（错题）；
  - `all`（全部）。
- 结果写入：

```js
params.targets = [
  { bankId: 'b1', title: '病理学', qids: ['q1','q3'], nums: [1,3] }
]
```

- 执行时只用票据里的 `targets`。因此：
  - 预览后有人删了其中一道题 → 执行前 `checkTargets` 拦下「《X》里有题被删了，请重新预览」；
  - 预览后有人新增题 → 不会多删/多改，只动 `qids` 里的题。

### 6.2 顺序预演（virtual world 的轻量版）

- `save.quiz` dry 返回 `virtual.newBank = { id:'$new', title, qids }`；
  下一步 `tag.add { bank:'$new' }` 在预览时能算出「给新题库 N 道题打标签」，执行时再换成真实 bank id。
- `question.delete` dry 返回 `virtual.deleted = ['b1#q3', ...]`；
  后续步骤的 `materialize` 会把这些题剔除。
  - 同一计划里「先删 q2，再给 q2 打标签」→ 预览阶段就报「没有符合条件的题目」。
  - 「先删 q2，再给全库打标签」→ 预览数量自动少 1。

这不是完整的影子世界：只虚拟化了「新建题库」和「删除题目」，没有模拟改名、收藏、打标签、设置等后续状态。见第 13 节。

### 6.3 dry 模式纪律

- 动作在 `ctx.mode === 'dry'` 时必须在第一个写操作之前返回。
- `ctx.capture()` 在 dry 下会直接抛错，防止 handler 误写 WAL。
- 预览不写业务数据；只写票据（localStorage）。
- 预览本身不校验 kill switch；执行时才拦截。

---

## 7. 执行流程

`AI_OPS.execute(plan, token, opts)`：

1. **kill switch**：`qbank.aiops.kill.v1` 为 true → 直接拒绝（撤销仍然可用）。
2. **票据校验**：存在 / hash 匹配 / 未使用 / 未过期（5 分钟）。
3. **计划级锁**：`qbank.aiops.lock.v1`，TTL 120 秒；同一时间只允许一个计划执行。
4. 标记票据已使用。
5. 写入计划记录（`qbank.aiops.plans.v1`），状态 `running`。
6. 逐步执行：
   - 计算 `stepId = hash(planId:index:action:params)`；
   - 查幂等缓存 `qbank.aiops.steps.v1`，已成功则跳过；
   - 如果是 `$new` 相关步骤，按当前 `virtual.newBank` 重新物化；
   - **R0 步骤**：直接 apply，不进 WAL；
   - **写步骤**：
     - 先以 dry 再校一次前置条件；
     - `ctx.capture(keys)`：读取 before 值，**严格写入 WAL**；写失败则中止（业务数据还没动）；
     - `run(ctx, p)` 执行；
     - `finalizeStep(sid, true/false)`：记录 afterHash、状态、committed；
     - 写步骤幂等缓存；
     - `mergeVirtual`。
   - 每步完成后更新计划记录的 `done`。
7. 全部成功：计划 `completed`，记录 `completedAt`，写审计。
8. 失败：
   - 当前步骤 `finalizeStep(false)`；
   - `compensatePlan(planId)`：逆序处理本计划中 `running/committed/failed` 且未补偿的 WAL 条目；
     - R1/R2：按 afterHash 校验后恢复 before；
     - R3：标 `compensated='manual'`，**不自动回滚**；
   - 计划 `failed`，记录 error / compensated / conflicts；
   - 返回 `done`（已完成步骤）+ error。
9. `finally` 释放计划锁。

### 7.1 返回结构

成功：

```js
{
  ok: true,
  planId: 'p...',
  changed: true,
  done: [{ index: 1, text: '...', result: {...} }],
  risk: 'R1',
  reversible: true
}
```

失败：

```js
{
  ok: false,
  planId: 'p...',
  error: '第 2 步失败：...',
  done: [...],
  compensated: 1,
  conflicts: 0,
  risk: 'R3'
}
```

### 7.2 计划记录

```js
{
  id, hash, risk, reversible,
  steps: [{ action, params }],
  status: 'running' | 'completed' | 'failed' | 'undone' | 'undo_partial',
  startedAt, completedAt, done,
  error, compensated, conflicts
}
```

### 7.3 幂等

- `stepId` 包含 `planId + index + action + params`。
- 成功步骤写入 `qbank.aiops.steps.v1`，最多 400 条，按时间淘汰。
- `resume()` 续跑时，缓存命中的步骤直接跳过，不重复写。

### 7.4 中断与恢复

- 进程被杀：计划记录停在 `running`。
- `AI_OPS.interrupted()` 返回 `running` / `partial` 计划。
- `AI_OPS.resume(planId)`：
  - 找到计划；
  - 处理 `running` 的 WAL 条目：
    - 如果步骤缓存已成功 → 标 committed（finalize 落盘失败但实际成功）；
    - 否则按 before 恢复（R3 半执行 → 拒绝恢复，要求人工检查）；
  - 用 `execute({steps}, null, {resume:true, planId})` 续跑。
- **不会自动恢复**；当前也没有聊天 UI 提示「上次有中断计划」。这是已知缺口。

### 7.5 只读执行

`AI_OPS.runNow(plan)`：

- 只允许 `maxRisk === 'R0'`；
- 不创建票据、不写 WAL、不加计划锁；
- 逐步 `resolve` + apply；
- 用于导出文件、打开题库、开始刷题、今日复习、刷新统计。

---

## 8. WAL 与撤销

### 8.1 WAL 条目

```js
{
  id: stepId,
  planId,
  seq: 3,
  action: 'bank.delete',
  risk: 'R3',
  keys: [
    {
      key: 'qbank.local.v2',
      before: '...',        // 原始字符串（可能是 null）
      beforeHash: '...',
      afterHash: '...',
      compensated: false
    }
  ],
  status: 'running' | 'committed' | 'failed' | 'compensated',
  committed: true,
  ts: 1792...
}
```

- 粒度是**整个 localStorage 键**，不是字段级 diff。
- before 存原始字符串；大题库会产生较大的 WAL 副本。
- `capture()` 在 handler 写之前严格落盘；`finalizeStep()` 记录 afterHash，容错落盘（失败不会炸穿执行，但可能影响崩溃恢复）。
- WAL 最多 120 条；存储满时先丢最老的已补偿条目，再试；仍失败则严格抛错、中止本次操作（此时业务数据还没写）。

### 8.2 撤销

`AI_OPS.undoPlan(planId, force)`：

1. 如果计划 `reversible === false` 且不是 force → 拒绝（例如 AI 批量打标签）。
2. 找出该计划 `status === 'committed' || 'failed'` 且未完全补偿的条目。
3. 按 `seq` 倒序：
   - 对每个 key：
     - 如果 `afterHash` 存在且当前值 hash 不相等 → 冲突，**保留当前值**；
     - 否则恢复 before（null 则 removeItem）；
   - 全部 key 恢复成功 → 条目标 `compensated`；否则标 `conflict`。
4. 计划状态：无冲突 → `undone`；有冲突 → `undo_partial`。
5. 审计记录 restored / conflicts 数量。
6. UI 撤销成功后会 `location.reload()`，让内存里的 `LOCAL/ANS/FAV/TAGS` 重新从 localStorage 读取。

**冲突策略是保守的：宁可撤销失败，也不覆盖用户执行后手动改过的数据。** 代价是整键粒度的误报（同一键里无关改动也会被标冲突）。

### 8.3 失败补偿与撤销的区别

- 失败补偿：计划执行到一半失败，自动尝试回到执行前；R3 不自动。
- 撤销：计划已经完成（或失败后仍有残留），用户主动点「撤销」；所有带 WAL 的步骤逆序恢复，R3 也可手动撤销。
- `rollback(planId)` = `undoPlan(planId, true)`，强制回滚（用于中断计划）。

---

## 9. 聊天意图层与 UI

### 9.1 指令识别

`isChatCommand(text)` 是启发式：

- 帮助 / 撤销 / 主题 / 字号 / 颜色 / 导出 / 存题库 / 删除 / 标签 / 收藏 / 错题等关键词；
- 含操作动词 + 题库/目录目标；
- 明确的操作句式（开头是「把/给/将/请/帮我/麻烦/删除/清空/收藏…」）；
- 含「分析/总结/解释/为什么/怎么/如何」等 → 不当作指令，交给普通 AI。

误判的代价：要么多一张预览卡（可取消），要么把操作问题交给 AI 回答。当前没有二次澄清。

### 9.2 计划生成顺序

`autoPlan(text, userNode)`：

1. **存题库**：命中 `存成/保存成/存为/保存为/存题库…` → `planSaveQuiz()`：
   - `save.quiz { sourceNode, favorite }`；
   - 如果句子里有标签 → 追加 `tag.add { bank:'$new', tags }`。
2. **多步**：命中 `然后/接着/最后/并且/；/;` 或「再+动词」「并+动词」→ `planSplit()`：
   - 拆开逐段 `planStep()`；任一段不认识就整体回退。
3. **单步**：`planStep()` 规则表（删除/收藏/标签/错题/设置/导出/目录/打开…）。
4. **模型兜底**：`planByModel()` 把 `AI_OPS.catalog()` 和参数示例发给模型，要求只输出 `{"steps":[...]}`。
   - 过滤掉未注册的 action id；
   - 不校验参数语义，交给 `resolve` / dry 校验。

### 9.3 预览卡

`opsRun(steps, userNode, title)`：

- `AI_OPS.preview(steps)`；
- 失败 → 直接回复 `⚠ ...`；
- 风险 R0 → `AI_OPS.runNow()` 直接执行，回复结果；
- 否则 `opsShowPreview()` 创建一个 AI 节点：

```js
{
  role: 'ai',
  text: '**计划：...**（N 步 · 风险）\n\n1. **动作**：影响面\n...\n预览编号 `hash`...',
  acts: [
    { id: 'ops-run', label: '执行计划', danger: risk === 'R3' },
    { id: 'ops-cancel', label: '取消' }
  ],
  ops: {
    hash, steps, risk, reversible, title,
    executed: false, planId: null, undone: false
  }
}
```

- `ops` 字段随聊天树一起存进 `qbank.chat.v2`，刷新后预览卡仍可执行。
- 执行后：`ops.executed = true`，`ops.planId` 记录计划；按钮变成「↶ 撤销这次操作」。
- 不可撤销计划（`tag.aiAll`）：不显示撤销，显示「停止后台打标签」。
- 预览卡隐藏「↻ 重试」图标，避免把计划重试成普通回答。

### 9.4 撤销入口

- 点预览卡/结果卡上的「↶ 撤销」→ `opsUndo(node)`；
- 直接说「撤销」→ `doUndo()`：
  - 先从当前聊天分支往上找带 `ops.planId` 的节点；
  - 找不到再用 `AI_OPS.lastUndoable()`（全局最近一个 completed/failed 计划）；
  - 不可撤销计划会提示，不会跳过去撤销更早的计划。
- 撤销成功后重载页面。

### 9.5 系统提示

`cmdSysNote()` 告诉模型：

- 站内有本地动作层；
- 用户说「帮我分步：<目标>」时，可以只输出严格 JSON 计划；
- 给出动作 id 示例；
- 不要编造 id，不要再说「我没有权限/无法写库」；
- 普通知识问题不要输出计划 JSON。

---

## 10. 文件导出（R0）

导出动作是 R0，直接执行，不弹预览卡：

- `export.bank`：JSON（`{app:'shuati-bank', title, subtitle, questions}`）。
- `export.wrong` / `export.fav`：Markdown，带题干、选项、答案、解析、错题次数。
- `export.all`：调用站点原有的 `exportAllData()`，生成完整备份 JSON（含知识库）。
- `export.kb`：按知识库名/关键词过滤，生成 Markdown；会先 `kbEnsureFilesLoaded()`，再 `kbEnsure(id)` 读取正文。
- 全部走 `downloadFile()`：优先 `window.download`，否则 Blob + `<a download>`。

导出不写业务数据，不进 WAL；撤销不涉及导出。

---

## 11. 安全红线（当前代码遵守）

1. 模型只输出 `{steps:[{action,params}]}`，写操作必经执行核。
2. 动作调 service/store，不模拟点击 DOM。
3. dry 与 apply 共用同一份 `run()`。
4. 预览卡展示影响面；R3 红色按钮 + 明确警告。
5. 计划 hash + TTL + 一次性票据，执行时重校验。
6. WAL 写前落盘；严格失败即中止，业务数据不落。
7. 撤销前按 afterHash 校验；冲突不自动覆盖。
8. kill switch 禁写但不禁撤销。
9. 审计不记录完整业务内容 / 绝对路径；动作只记 id、计划 id、状态、错误。
10. 崩溃不自动恢复，必须用户选择（API 有，UI 暂无）。
11. R3 失败不自动补偿，避免「失败后自动复活/误删」。
12. 文件选择器、GitHub 登录、交卷仍然人工。

---

## 12. 验证与证据

### 12.1 探针

探针在 `C:\Users\chen\Desktop\工作1\`，用 Python 本地 HTTP 服务 + Edge headless + `fetch('/__r',{method:'POST'})` 回报。

| 探针 | 覆盖 | 结果 |
|---|---|---|
| `aiops-probe.py` | dry/hash、错误 hash、执行/撤销、冲突保留手动值、kill switch、失败补偿、tag/favorite、幂等恢复、中断恢复 | 16/16 |
| `ops-ui-probe.py` | 多步标签+导出、删题+统计、存题库+收藏+标签、设置、目录/移动/改名、收藏/清空、模型规划、普通 AI | 30/30 |
| `ops-undo-probe.py` | 删题撤销、标签撤销、跨刷新（点按钮 → reload → 断言） | 11/11 |
| `ops-actions-probe.py` | 31 个动作、错题、目录、导出、设置撤销、AI 标签、漂移拦截、顺序预演、物化、删题库撤销、不可撤销拒绝 | 27/27 |
| `chat-command-probe.py` | 帮助、标签、错题、收藏/取消、主题、删题、删题库、撤销 | 14/14 |
| `chat-ops2-probe.py` | 存题库+收藏、主题、清错题集、导出题库、导出知识库 | 全过 |
| `chat-ai-tag-probe.py` | AI 批量标签、后台停止按钮 | 4/4 |
| `chat-probe.py` / `guide-probe.py` / `qdel-drag-probe.py` / `tag-current-probe.py` | 聊天 UI、引导、拖拽/删题、答题页 AI 标签 | 实际断言全过 |

### 12.2 语法检查

```
ELECTRON_RUN_AS_NODE=1 Chatbox.exe --check chat.js
ELECTRON_RUN_AS_NODE=1 Chatbox.exe --check ai-ops.js
```

两文件均通过。

### 12.3 预览卡实拍

`C:\Users\chen\Desktop\工作1\ops-preview.png`（本轮对话附件也有一份）。

---

## 13. 已知边界与缺陷（评审重点）

> 下面按优先级列出。P0 = 可能导致数据不一致/丢失；P1 = 可用性/可维护性明显不足；P2 = 覆盖面/体验问题。
>
> **状态（2026-10-17）**：复查又发现 7 条（D-1…D-7），其中 D-1/D-2/D-4/D-6/D-7 已在阶段 1 修复，详见 §18；本节其余条目多数仍待阶段 2/3。

### P0：一致性与事务

1. **没有真正的影子世界。**
   - dry-run 在真实 store 上读数据，只虚拟化了「新建题库」和「删除题目」。
   - 同一计划里「改名 → 按新名匹配」「收藏 → 再导出收藏」等依赖前一步写入的步骤，预览用的仍是旧数据，执行时可能不同。
   - 例：`bank.rename X→Y` 后 `tag.add {bankTitle:'Y'}`，预览时 Y 还不存在，可能直接失败；`favorite` 后 `export.fav` 预览数量可能偏少。
2. **没有事务 / savepoint。**
   - handler 直接写多个 localStorage 键；中途抛错时，已写部分只能靠 WAL 补偿。
   - R3 失败不自动补偿，可能留下部分删除。
3. **WAL 是整键粒度。**
   - 删除一个题库会复制整个 `qbank.local.v2`、`qbank.answers.v2` 等键到 WAL；大题库会快速吃满配额。
   - 同一键里任何无关改动都会让撤销冲突（保守但误报高）。
   - 没有字段级 before/after，也没有行版本。
4. **多标签页没有协调。**
   - 计划锁是 localStorage + 120 秒 TTL；两个标签页可能同时通过检查。
   - 没有 `storage` 事件 / BroadcastChannel / 对象级锁 / fencing token。
   - 一个标签页撤销时，另一个标签页的内存状态可能是旧的。
5. **崩溃恢复没有 `probe`。**
   - 没有每个动作的「这一步到底生效了吗」探测；只能靠 WAL 状态 + 步骤缓存判断。
   - 多键写入的 handler 如果只写了一半，`running` 条目恢复时可能误判。
   - R3 半执行要求人工，UI 没有提示。

### P1：机制与语义

6. **票据与计划没有绑定到聊天节点/计划 id。**
   - 票据按 hash 存；相同参数的计划共享同一个 hash/票据。
   - 执行时忽略调用方传入的 plan 对象，完全信任票据内容；票据被盗/误用只能靠 TTL + 一次性。
7. **计划状态机不完整。**
   - 没有 `previewed` / `confirmed` / `stale` / `interrupted` / `needs_review` 等状态；`execute` 前置条件失败直接 `failed`。
   - `interrupted()` 检查 `partial`，但代码没有地方写入 `partial`。
8. **没有对象级锁 / 版本号。**
   - 锁只有计划级；撤销冲突是整键 hash；没有 row_version。
9. **R3 的「可撤销」语义不一致。**
   - 动作 `reversible:true`，风险 R3；预览卡写「破坏性 · 可撤销」。
   - 但 v6 方案里 R3 定义是「无 inverse」。当前实现实际上有 WAL 逆操作，失败时不自动补偿。
   - 没有 >N 条的二次确认/输入确认；只有预览卡一次点击。
10. **AI 批量打标签不可撤销。**
    - 后台任务持续写标签；执行后只能「停止」，已写入的标签保留。
    - 没有「停止 + 恢复执行前标签」的语义。
11. **没有字段覆盖契约。**
    - 没有运行时检查「handler 写的键 ⊆ capture 的键」；靠代码审查和探针。
    - 如果 handler 漏 capture 一个键，撤销不会恢复它，且没有报警。
12. **审计与撤销日志分离，但审计没有 UI。**
    - 审计只存计划 id / 状态 / 错误 / 补偿数；没有 before/after、没有导出、没有用户可看的操作历史。
13. **没有 impact_mismatch 检测。**
    - 预览说 N，执行实际 M，没有比对/告警；只有部分动作在 apply 前 `checkTargets`。

### P1：意图层

14. **规则解析是启发式。**
    - 「删除题库有什么风险？」这类问题可能被当作命令（预览会拦下，但体验不好）。
    - 依赖关键词顺序；同义说法覆盖不全。
15. **模型规划兜底依赖 AI 配置。**
    - 没配 AI 时，未覆盖的说法直接「没认出」。
    - 模型输出只校验 action id，不校验参数语义/类型；错误靠 resolve/dry 报。
    - 没有澄清轮（最多问一轮的方案未实现）。
16. **多步拆分是字符串切分。**
    - 逗号、并、再的边界可能切错；切错就整体回退到模型或「没认出」。
    - 不支持条件/循环/相对指令（「把刚才那批」「除了第 3 题」）。

### P2：动作覆盖面

17. **没有 `question.update`**（改题干/选项/答案/解析），没有便签/口诀编辑、SRS 调度、目录删除。
18. **批量移动只支持单个题库/目录**；没有「把整个目录移动到另一个目录」的单一动作（可拆多步，但没有批量原语）。
19. **套卷只映射了「删除当前题」到原题库**；套卷里的标签/收藏仍按套卷键走，可能不落到原题。
20. **文件导入、备份恢复、PDF、GitHub 登录、交卷**仍然人工。
21. **导出 R0 不经过预览卡**；`export.fav` 在「先收藏再导出」的多步计划里，预览数量可能少于实际。
22. **没有「撤销窗口」概念**；WAL 最多 120 条，没有 7 天保留期，超过上限会丢最老条目。

### P2：存储与性能

23. **大键复制**：`qbank.local.v2`、`qbank.answers.v2` 可能几 MB；每次写前 capture 都复制整键。
24. **票据/步骤缓存/聊天节点都存 localStorage**；预览卡把 `targets` 存进聊天树，题目多时会膨胀。
25. **没有压缩/差量**；没有 IndexedDB 存 WAL 的方案。

### P2：UI/UX

26. **中断计划没有提示**；用户不知道有 `running` 计划可恢复/回滚。
27. **撤销冲突只显示数量**，不列出具体哪些题/哪些键冲突；用户无法逐条选择。
28. **预览卡没有分步折叠/展开**；超长计划（20 步）会很长。
29. **不可撤销计划只标文字**；没有额外确认（输入计划编号/勾选）。
30. **没有操作历史页面**；审计只在 localStorage。

---

## 14. 希望评审 AI 优先回答的问题

> 请针对当前 localStorage 静态站约束回答，不要建议引入重型后端/框架，除非说明迁移成本和降级方案。
>
> 这些问题里，能在阶段 1 用零迁移手段解决的部分已落地（见 §18），其余拆到 §19 的阶段 2/3。

### 14.1 一致性与事务

1. 在纯 localStorage 条件下，如何做一个**轻量影子世界**，让 dry-run 能模拟改名/收藏/打标签/设置等后续步骤，而不复制整个 store？
   - 方案 A：动作只通过 `env.world.read/write` 访问数据，preview 用内存 overlay（Map + 删除集合）。
   - 方案 B：preview 时对相关键做结构化克隆，在克隆上真跑 handler，再丢弃。
   - 方案 C：只做「依赖图 + 目标物化」，不模拟状态，明确禁止依赖前一步写入的组合。
   请比较复杂度、性能、遗漏风险。

2. 没有事务的情况下，如何给多键写入做 savepoint？
   - 是否值得把 WAL 从「整键 before」改成「字段级 before/after」？
   - 字段级 diff 如何定位题目/题库（id 路径）？如何避免同键无关改动误报？
   - 大题库的 WAL 副本如何压缩/分片？

3. 计划内「先删 A，再操作 A」这类依赖，除了当前的 `virtual.deleted`，还应该建模哪些虚拟状态？
   - 新建题库、改名、移动、收藏、标签、设置、目录创建……
   - 是否应该把「动作声明 writes/creates」变成强制契约，用它推导依赖和虚拟状态？

4. 多标签页并发：在 localStorage 上如何实现可靠的对象级锁/租约？
   - `navigator.locks` 是否可用/可降级？
   - BroadcastChannel + fencing token 的方案？
   - 锁过期后被另一个标签页抢走，旧执行者如何停止写入？

5. 崩溃恢复：每个写动作应该提供什么样的 `probe(env,args)`？
   - 删除类：查 id 是否还存在？
   - 修改类：查字段是否等于目标值？
   - 创建类：查 id 是否存在？
   - 无法判定时如何进入 `needs_review`，UI 怎么呈现？

### 14.2 撤销与风险

6. R3 到底应该定义为「无 inverse」还是「有 inverse 但不自动补偿」？
   - 当前实现是后者；预览文案写「可撤销」。
   - 是否应该把 R3 拆成 R3a（可 WAL 撤销的删除）和 R3b（真不可逆）？
   - 超过多少条应该二次确认？输入确认还是勾选？

7. 撤销冲突目前是整键 hash。如何做到「只撤销这次动过的题，保留同键里用户新加/新改的其它题」？
   - 需要怎样的数据结构/合并算法？
   - 冲突时是「逐条让用户选」还是「自动跳过冲突项并报告」？

8. AI 批量打标签这种后台长任务，如何做「停止 + 回滚到执行前」？
   - 任务开始时 capture 整键，停止后无条件恢复（会覆盖用户手动标签）是否可接受？
   - 能否给任务打 token，只恢复该任务写入的标签？

### 14.3 意图与模型

9. 规则解析 + 模型兜底的双层意图层，应该如何约束模型输出？
   - 是否应该给每个动作定义 JSON Schema（params 类型/枚举/必填/互斥）？
   - 模型输出非法参数时，是重试、降级到规则，还是直接让用户澄清？
   - 如何支持「把刚才那批」「除了第 3 题」这类相对指代？

10. 如何避免「删除题库有什么风险？」被误判为命令？
    - 是否需要意图分类器（本地小模型/规则打分）？
    - 预览卡能否兼作澄清（先展示「你可能是想…」而不是直接报错）？

### 14.4 覆盖面与体验

11. 31 个动作还缺哪些高频操作？请按「用户价值 / 实现成本 / 风险」排序。
    - 改题、改解析、批量移动、目录删除、套卷操作、SRS、同步……
12. 预览卡/撤销/中断恢复的 UI 还可以怎么改？
    - 分步折叠、影响面高亮、冲突逐条选择、操作历史、撤销窗口倒计时……
13. 在纯静态站上，是否值得引入 IndexedDB 存 WAL/计划/审计？迁移成本与收益？
14. 有没有更简单的整体替代方案（例如「操作日志 + 命令模式」而不是「计划 + WAL」），能同时满足预览、撤销、崩溃恢复？

---

## 15. 文件与入口

| 文件 | 作用 |
|---|---|
| `ai-ops.js` | 执行核 + 31 个动作；`window.AI_OPS` |
| `chat.js` | 意图解析、预览卡、执行/撤销 UI、模型规划兜底 |
| `AI动作清单.md` | 全量人机交互地图（98 条动作设计稿）；顶部注明以 `AI_OPS.actions()` 为准 |
| `ai-actions.json` | 设计期机器可读注册表初稿；status 可能滞后 |
| `更新说明.md` | 倒序开发记录；web99 条目说明本轮收口 |
| `sw.js` | `VERSION='shuati-v67-web99'`，预缓存 `chat.js` / `ai-ops.js` |
| `index.html` | `chat.js?v=20261029b`、`ai-ops.js?v=20261029c` |

### 15.1 `window.AI_OPS` API

```js
AI_OPS.version                 // 2
AI_OPS.register(def)           // 注册动作
AI_OPS.alias(id, targetId)     // 隐藏别名
AI_OPS.getAction(id)
AI_OPS.actions(includeHidden?) // 31 个可见动作
AI_OPS.catalog()               // 给模型看的文本目录
AI_OPS.preview(plan)           // dry-run → {ok,hash,risk,reversible,steps,plan}
AI_OPS.execute(plan, token, opts) // 执行；opts.resume/planId 用于恢复
AI_OPS.runNow(plan)            // 仅 R0，直接执行
AI_OPS.undoPlan(planId, force)
AI_OPS.rollback(planId)        // force 撤销
AI_OPS.resume(planId)
AI_OPS.interrupted()
AI_OPS.lastUndoable()
AI_OPS.plans()
AI_OPS.state(planId)           // {plan, changes}
AI_OPS.setKill(on) / AI_OPS.isKill()
AI_OPS.hashPlan(steps) / AI_OPS.stepKey(planId, step, index)
```

### 15.2 运行探针

```powershell
& 'C:\Users\chen\AppData\Local\Programs\Python\Python312\python.exe' 'C:\Users\chen\Desktop\工作1\aiops-probe.py'
& 'C:\Users\chen\AppData\Local\Programs\Python\Python312\python.exe' 'C:\Users\chen\Desktop\工作1\ops-ui-probe.py'
& 'C:\Users\chen\AppData\Local\Programs\Python\Python312\python.exe' 'C:\Users\chen\Desktop\工作1\ops-undo-probe.py'
& 'C:\Users\chen\AppData\Local\Programs\Python\Python312\python.exe' 'C:\Users\chen\Desktop\工作1\ops-actions-probe.py'
```

探针会在站点根目录生成 `_t_*.html`；部署脚本用 `^_.*\.html$` 排除，不会上线。

---

## 16. 附录：示例 JSON

### 16.1 预览返回

```json
{
  "ok": true,
  "hash": "ef0db83a",
  "risk": "R3",
  "reversible": true,
  "steps": [
    {
      "action": "bank.delete",
      "title": "删除题库",
      "risk": "R3",
      "reversible": true,
      "params": {
        "bankIds": ["b1"],
        "bankTitles": ["病理学"],
        "qCount": 10
      },
      "impact": {
        "banks": 1,
        "questions": 10,
        "summary": "1 个题库（10 题）：病理学"
      },
      "warnings": []
    }
  ],
  "plan": { "steps": [{ "action": "bank.delete", "params": { "...": "..." } }] }
}
```

### 16.2 WAL 条目

```json
{
  "id": "8f3a2c1d",
  "planId": "pmvc4x39o3ojx6",
  "seq": 1,
  "action": "tag.add",
  "risk": "R1",
  "keys": [
    {
      "key": "qbank.tags.v1",
      "before": "{\"b1#q1\":[\"心衰\"]}",
      "beforeHash": "1a2b3c4d",
      "afterHash": "5e6f7a8b",
      "compensated": false
    }
  ],
  "status": "committed",
  "committed": true,
  "ts": 1792226000000
}
```

### 16.3 计划记录

```json
{
  "id": "pmvc4x39o3ojx6",
  "hash": "ef0db83a",
  "risk": "R3",
  "reversible": true,
  "steps": [{ "action": "bank.delete", "params": { "bankIds": ["b1"] } }],
  "status": "completed",
  "startedAt": 1792226000000,
  "completedAt": 1792226001200,
  "done": 1
}
```

---

## 17. 给评审 AI 的最后一句

请不要只给「应该加事务/加锁」的结论；请针对**纯静态站 + localStorage + 无后端 + 浏览器可能随时被杀**的约束，给出：
- 最小可行改动（能在一两轮内落地）；
- 数据迁移/兼容方案；
- 会牺牲什么（性能/复杂度/用户体验）；
- 如何用现有探针验证。

---

## 18. 评审结论与阶段 1 落地（2026-10-17，已写进代码）

### 18.1 代码复查新发现（D-1…D-7）

| 编号 | 问题 | 证据 | 处理 |
| --- | --- | --- | --- |
| D-1 | 票据键名 bug：K 表只有 `ticket`，没有 `tickets`，`preview/execute` 读写 `K.tickets` 得到 `undefined`，票据实际落进 localStorage 的字面量键 `"undefined"` | 旧 K 表；`preview`/`execute` 里的 `K.tickets` | **已修**：K 表加 `tickets`/`ver`；新增 `migrateLegacyTickets()`，启动时校验 `hash===token` 且 `steps` 是数组后搬回真键并清掉 `"undefined"` 键（别的东西误用该键则不碰） |
| D-2 | `partial` 是死状态：只有 `interrupted()/resume()` 读，没有任何地方写 | 旧 `execute` catch 只写 `failed` | **已修**：失败时若已有完成步骤且（有冲突或一步都没自动补偿）→ 计划状态写 `partial`，随返回值返回 |
| D-3 | `tag.aiAll` 的 dry-run 只查发起标签页内存里的 `TAGS.job.running`，别的标签页看不到 | `tag.aiAll` 的 dry 分支 | 未改（阶段 2：job 状态落 localStorage） |
| D-4 | kill switch 只在 `execute` 开头查一次，长计划中途关权限不生效 | 旧 `execute` 开头 | **已修**：循环内每一步执行前再查一次 |
| D-5 | 撤销/回滚后整页 `location.reload()`，粒度粗 | `opsUndo`/`opsRollbackPlan` | 未改（阶段 2：折叠分片重绘） |
| D-6 | 「帮我分步：…」被规则层抢先解析：`autoPlan` 先跑 `planStep`，模型规划几乎永远到不了 | `autoPlan` 旧顺序 | **已修**：显式前缀 `帮我分步/分步执行/规划并执行/计划：` 直接走 `planByModel`，跳过规则层 |
| D-7 | 「把《X》的错题标为已掌握」被误判成打标签：`cmdTags` 的冒号兜底把整句当标签（得到「测试」「错题标为已掌握」） | `cmdTags` 冒号分支 + `tag.add` 门 | **已修**：`masteredCmd` 正则拦下「标为(已)掌握/标为错题」，`badTag` 按 `/错题|已?掌握/` 判定 |

### 18.2 阶段 1 已落地的机制（零迁移）

1. **数据版本号 + 票据 fencing**：新增 `qbank.state.ver.v1`（`readVer`/`bumpVer`/`verDrift`）。`preview` 把当前版本写进票据 `baseVer`；`execute` 先校验票据的 `baseVer` 是否还等于当前版本，再在**每一步前**用 `verDrift` 复查；自己的每一步成功后 `bumpVer('plan:<id>')` 前移期望版本，失败补偿和撤销也各 `bumpVer` 一次。
   - 效果：预览之后别的标签页或手工改过数据 → 直接拒绝执行，提示「数据在你预览后被改过（版本 X → Y，来源：…），请重新预览」；执行中途被外部改动 → 当步中止，已完成的步骤照旧走补偿。
   - 代价：多标签页并发编辑时用户偶尔要多点一次预览（这是有意的保守）。
2. **每步复查 kill switch**（D-4）：循环内每步执行前查，文案「AI 写权限已关闭（kill switch），计划已中止（撤销仍然可用）」。
3. **`partial` 状态可用**（D-2）：中断/半途失败会留下 `partial`，并进 `lastUndoable()` 白名单（`completed|failed|partial|undo_partial`），「撤销」按钮因此能兜住半途失败。
4. **R3 不再假装可自动回滚**：动作注册项新增 `autoCompensate`（默认「非 R3 才自动补偿」）；补偿时命中 `risk==='R3'` 或 `autoCompensate===false` 就标 `manual` 并保留现场。文案同步改成「破坏性 · 失败后需手动检查」，预览脚注写明「中途失败不会自动回滚，需手动检查；成功执行后仍可撤销」。
5. **未完成计划横幅**：聊天页顶部出现「⚠ 上次有没跑完的操作计划（停在执行第 N 步）」，按钮 =「继续执行」/「回滚这次操作」/「先不管」。刷新/关页面打断后不再静默躺着。
6. **问句豁免**：带「风险/后果/影响/安全/会丢/会删/误删/能不能撤销…」且是疑问句（?/？/吗/呢/会不会/该不该/要不要…）的话不再当操作指令，交回 AI 回答，避免「删除会有什么风险？」被执行成删除。
7. **意图层两处误判修补**（D-6/D-7）。

### 18.3 验证（Edge headless + 本地 http.server 探针，2026-10-17 实测）

| 探针 | 覆盖 | 结果 |
| --- | --- | --- |
| `aiops-probe.py` | dry/apply、错误 hash 拒绝、WAL、撤销冲突、kill、失败自动补偿、tag/fav 写入与撤销、幂等恢复、中断计划列举 | 16 项全 PASS |
| `chat-command-probe.py` | 指令识别、标签/词表、标为已掌握、收藏、深色模式、分析问题仍交给 AI、删题/删库与撤销 | 全通过 |
| `ops-actions-probe.py` | 31 个动作逐个执行、导出、AI 批量标签不可撤销、执行前漂移拦截 | 全 PASS |
| `ops-ui-probe.py` | 多步预览/执行、删题、存题库、设置、目录、移动、改名、收藏、清空、模型规划 | 全 PASS |
| `ops-undo-probe.py` | 刷新后撤销还原、标签计划 undone | 全 PASS |
| `chat-ops2-probe.py` | AI 出题→存题库+收藏、深色模式、清错题、导出题库/知识库 | 全通过 |
| `plan-probe.py` | 多步计划（打标签+导出、删题+统计、存题库+收藏+标签）、模型规划、单步兼容 | 修复探针的「执行计划」按钮选择器与出题节点读取后全 PASS |
| `phase1-probe.py`（新增） | 旧票据迁移、票据落真键、版本 fencing 拒绝、每步 kill→partial、partial 可撤销、问句豁免、横幅出现/「先不管」、回滚恢复数据 | 12 项全 PASS |

---

## 19. 后续阶段（尚未实施）

**阶段 2（机制）**
- 路径级 WAL：`capture(keys)` 之外加 `capturePaths({key:[paths]})`，键内按 `bankId`、`bankId#qid` 记 before 与 hash，撤销按路径逐条恢复，冲突逐条 UI（[保留现状]/[恢复执行前]）；
- 写后漂移检测：apply 前后对同一路径再取一次 hash，检测「同一键里别的记录被改」；
- 三态恢复：`applied / absent / unknown`，unknown 落 `needs_review` 并把计划标 `partial`；
- 破坏性步骤二次确认（输入计划 hash 前 4 位）；
- `tag.aiAll` 的 job 状态落 `qbank.aiops.joblog.v1`（修 D-3），撤销时可回放；
- 撤销/回滚改折叠分片重绘，去掉整页 reload（D-5）。

**阶段 3（扩展）**
- 动作级 `writes` 声明 + `proj` 投影契约，把「哪些写动作会碰哪些键/路径」变成声明式，供冲突检测和 UI 使用；
- `paramsSchema` 小验证器 + 模型输出重试 1 次 + few-shot 示例对 + 相对指代（`lastTargets`）；
- `BroadcastChannel` + `navigator.locks` 做跨标签页互斥（版本号 fencing 已先兜底，属于体验优化）；
- 动作补齐、可选 IndexedDB（真事务）、历史页/自检页。

---

## 20. 落地进度（web144 → web147，2026-10-24）

### 20.1 24 项需求对照

| # | 需求 | 状态 | 版本 | 落点 |
| --- | --- | --- | --- | --- |
| 1 | 改题库名字 | ✅ | web144 | `cat.js` `saveBankOrder()` 把 `title`/`subtitle` 写回 LOCAL 原始对象（以前只同步 cat/ord，改名刷新就回滚） |
| 2 | 解析颜色 | ✅ | web145 | 能力本来就有（`FMT_COLORS`/`fmtBarEl`），修的是浮条串台：只在当前编辑器内取色、关闭时清选择 |
| 3 | 临时套题管理 | ✅ | web144 | 套卷卡片加「改名」（prompt→`savePapers()`），删除原就有 |
| 4 | 单库一键分类 | ✅ | web144 | `tagAll(onlyBankId)`/`classifyBasic(force, onlyBankId)` + `bankScopeHtml()` 下拉（标签页两处） |
| 5 | 一键贴标签质量 | ✅ | web147 | 整批非 JSON 重试 1 次；开跑前 `JOB.snap` 快照 + 「撤销这次打标签」；写后逐题校验（写不进不算打上） |
| 6 | 搜索命中范围 | ✅ | web145 | `hayOf()` 追加标签；`collect()` 里 AI 范围只**加宽**不替换（修「开 AI 后题库名搜不到」） |
| 7 | 错题本 | ✅ | web144 | 独立页 `#/wrong` 本就有；补「加入/移出错题本」按钮（只动 `wrong`，不影响作答统计） |
| 8 | 答题界面改题目 | ✅ | web146 | 抽屉「✎ 改题目」：题干/选项/答案/解析，`updateBankQuestion()` 写回 LOCAL（内置库只读） |
| 9 | 图片粘贴/拖入正文 | ✅ | web146 | 解析块 paste 直接接管剪贴板图片（`input type=image`），drop 按落点插入；不再只会转纯文本 |
| 10 | 主页上传入口 | ✅ | web144 | `#toUpload`「⬆ 上传题库」→ `#/import` |
| 11 | 公式渲染 | ✅ | web146 | KaTeX 0.16.11 本地 vendored（`vendor/katex/`，20 个 woff2，CSS 去掉 woff/ttf 回退）；`mdMathExtract`/`mdMathBack` 在 `mdToHtml` 里 `$$…$$`/`$…$` 转 KaTeX，货币 `$5` 不误判 |
| 12 | 表格渲染 | ✅ | web146 | `splitRow()` 还原 `\|`（表格编辑一次列就错位的根因）；`.tbl-wrap` 样式不再绑 `.exp`；对齐语法 `:--/:-:/--:` 生效 |
| 13 | 变式单选/多选道数 | ✅ | web145 | `variant.js` 面板按方向分组 + 单选/多选分别设道数 |
| 14 | 变式单删 | ✅ | web144 | chip 上的 `data-vdel` + `varqDel` |
| 15 | 移出错题本 | ✅ | web144 | 同上第 7 项 |
| 16 | 搜索按题库筛选 | ✅ | web145 | `paintSearch` 的 `bankOK` + `#sBank` 下拉（全部题库） |
| 17 | 库内 AI 模糊搜索 | ✅ | web145 | `#qlAi` 开关（`qbank.ql.ai.v1`）+ `window.qaiTerms()`/`qaiExpandAny()`，`qlListed` 同时认扩展词 |
| 18 | 题库总分 | ✅ | web144 | `qScore`（X 型 2 分、其余 1.5）+ `bankScore()`，首页卡/题列表/目录页显示满分 |
| 19 | Notion 式块编辑 | ⏳ | — | 按用户要求后置（分 3–4 轮），本轮未动 |
| 20 | 图片拉大拉小 | ✅ | web146 | Markdown 尺寸语法 `![图](url =200x120)`；解析图片右下角手柄拖动存 `NOTES.imgs[i].w` |
| 21 | AI 贴人文标签 | ✅ | web144 | `HUMAN_TAGS` + `TAG_SUB_TAGS["人文"]`，`tagCandidates` 人文不再退回五科全量 |
| 22 | 变式题同步 | ✅ | web144 | `sync.js` 载荷/合并/墓碑都带上 `qbank.var.v1` |
| 23 | 长按排除选项 | ✅ | web144 | 长按 480ms → `QZ.excl`，`judge` 前过滤（第 90 步的判分逻辑） |
| 24 | 每日复习出套卷 | ✅ | web144 | `startReview` 无到期题时从错题本兜底组卷，同一天重复点回到已有复习卷 |

### 20.2 工程改动（本轮新增）

- `collection.js`：`mdMathExtract`/`mdMathBack`（公式）、`splitRow` 转义竖线、图片尺寸语法、`richInsertImgAtRange`、`richImgsBind`（图片拖宽）、解析块 paste/drop 接管。
- `app.js`：`updateBankQuestion`/`openQEditor`（答题页改题）、`#doEditQ`、`#editQHost`、`qScore`/`bankScore`。
- `tags.js`：`tagAll` 批重试 + 快照撤销 + 写后校验；`HUMAN_TAGS`/`tagCandidates` 人文特判；`bankScopeHtml`。
- `style.css`：`.tbl-wrap` 通用表样式、`.rich-img`/`.rich-rz`、`.qeditbox`、KaTeX 容器。
- `sw.js`：CORE 增加 KaTeX（js/css/20 个 woff2），VERSION 到 `shuati-v68-web147`。
- `index.html`：加载 `vendor/katex/katex.min.css|js`，脚本/样式缓存戳 `?v=20261101c`。

### 20.3 验证与上线

- 探针：`search-bank-probe.py` 17/17、`color-probe.py` 10/10、`variant-probe.py` 39/39、`home-page-probe.py` 30/30、`tag-page-probe.py` 15/15；`md-unit.mjs`（公式/表格/图片尺寸/货币反例）全过；`node --check`（Chatbox --check）app/collection/sw/cat/tags/variant 全过。
- 上线：`stain37/shuati-web` → https://stain37.github.io/shuati-web/ ；提交 `59267354`(web144)、`f6eb766b`(web145)、`fb4e1b13`(web146)、`fe6772e0`(web147)、`0d8af39c`(web148)；线上 `sw.js` 与改动文件字节数与本地一致（web145–web148 均实测，web148 的 `collection.js` 120889B / `sw.js` 7981B 已对平）。

### 20.4 下一步

1. 第 19 项：块级编辑（解析块拆块、拖拽排序、表格/图片作为块移动），按 3–4 轮做。**第一轮已上线（web148）**：解析块标题行加「⠿ 块排序」开关，打开后鼠标放到段落 / 表格 / 图片左边的小把手上拖动，整块换位置，拖动过程有落点高亮，松手后按新 DOM 顺序 `mdFromHtml` 重新序列化并标「未保存…」，点到别处自动存盘。**第二轮已上线（web153）**：悬停任意块时上方出现块操作条（`collection.js` `BLKBAR/blkBarEl/blkBarShow/blkAct`），五个按钮：⧉ 复制、↑ 上移、↓ 下移、＋ 下面插入空段落并落光标、🗑 删除（唯一一块时拒绝删）；操作完直接 `blkSaveNow()` 用 `mdFromHtml` 序列化落盘，不等 blur；样式 `style.css` `.blk-bar/.blk-bbtn` 固定定位 z-index 61。新建 `C:\Users\chen\Desktop\工作1\block2-probe.py` **15 通过 / 0 失败**。**第三轮已上线（web154）**：图片区（`.rich-imgs`）里每张图左上角有 `⠿`（`.rich-mv`），拖动它到另一张图的左/右半边即插入到前/后，顺序直接写回 `NOTES[fk].imgs` 并 `saveNotes()`，`data-imgi` 重新编号；红虚线是落点提示。新建 `C:\Users\chen\Desktop\工作1\block3-probe.py` **12 通过 / 0 失败**（探针踩坑：1×1 的测试图 `getBoundingClientRect()` 只有 1px 宽，左/右半边判断失效，改给测试图 `w:120`；图片区在视口外时 `elementFromPoint` 返回 null，要先 `scrollIntoView`）。第 19 条到此三轮齐活：段落 / 表格 / 图片都能整块拖、能复制、能删、能插空段落。

**第 11 条补（web155）**：题干、共用题干、选项以前走 `esc()` 不认公式，现在 `collection.js` 导出 `window.renderMathText(raw)`（只把 `$…$` / `$$…$$` 换 KaTeX、其余纯文本转义），`app.js` 加 `stemHtml()` 用在题干 / 共用题干 / 选项 / 结果页题目上。新建 `C:\Users\chen\Desktop\工作1\math-stem-probe.py` **7 通过 / 0 失败**；`quiz-subject` 17/17 回归。
2. 阶段 2 机制项（路径级 WAL / 写后漂移 / 三态恢复 / 二次确认 / joblog / 去 reload）按 §19 排期。
3. 公式覆盖到题干/选项（现在只覆盖 Markdown 渲染路径：解析、聊天、AI 输出）。



## 21. 网页 AI Agent 与知识库 RAG 优化（依据 page-agent / ragflow 源码分析，web149 → web151）

### 21.1 已落地

| # | 改动 | 落点 | 版本 |
|---|------|------|------|
| 1 | 西综按题号计分：165 题 / 300 分，1–40 每题 1.5、41–115 每题 2、116–135 每题 1.5、136–165 每题 2，按科目段自动认（生理/生化/病理/内科/外科/人文），交卷显示「得分 / 满分」 | `app.js` `XZ_LEN/XZ_PT/XZ_SUB/` `xzSubOf/isXzPaper/qScore/ptAt/bankScore/bankScoreBreak/bankScoreText`；`exam.js` `examPoints()` + 交卷加权 | web149 |
| 2 | 规划器 `planByModel`：三条 few-shot 示例（改名 / 多步 / 只读）、输出解析抽成 `parsePlanObj()`、失败重试一次（把「动作名不存在 / 不是 JSON」回给模型），仍不行才退回规则 | `chat.js` `opsFewShot/parsePlanObj/planByModel` | web149 |
| 3 | 知识库切片带**标题路径**（`h.path`，如「第三章 › 肝硬化」），标题与正文不再混淆；检索打分给短标题轻微加权 | `kb.js` `kbChunk()`（`hp/ps/plen/KB_WP`）、`kbSearch` 打分 | web150 |
| 4 | 参考资料改「按段编号」：上下文里每段前带 `[ID:n]` 与 `[Path:…]`，系统提示要求落笔时用 `[n]` 标注，便于对照原文 | `ai.js` `aiContext()` 装配 + `aiSysText()` | web150 |
| 5 | 重排（rerank）喂料从「每段 170 字、无标题」改成「带【标题】〔路径〕、每段 300 字」，并加 **200 条 LRU 缓存**（同一题反复问不重复花钱，索引重建自动作废） | `kb.js` `kbRerank()` + `KB_RR_CACHE` | web151 |
| 6 | 修 `kb-page-probe` 三处断言（存下来的参考资料自动展开是「开关语义」、阅读器 URL 要解两层编码、直链也算能看原页），现在 **0 fail** | `工作1\kb-page-probe.py` | web151 |

### 21.2 下一步（按价值排序）

1. **引用逐句落地**：把 `[ID:n]` 变成可点的角标，点开跳该段原文 / 原页（现在只是文本标记）。
2. **邻居扩展**：命中段自动带上一段/下一段（RAGFlow 的 parent-child 思路），解决「跨段结论」。
3. **本地同义词表**：高频医学词（DNA 损伤 ↔ 切除修复）不花模型调用就能互查。
4. **trace 面板**：`ai-ops` 每步记录耗时/命中/失败原因，答错了能看出是哪一步（page-agent 的 trace）。
5. **动作参数 schema**：`catalog()` 里给参数加「必需/可选」标记，规划器少自创参数。

### 20.5 web152：题库排序「按名称 / 最近添加」（2026-10-24）

- 主页「我的题库」标题右边新增 `排序：自定义顺序 / 按名称 / 最近添加` 下拉（`cat.js` `bankSortHtml()`，状态记 `qbank.banksort.v1`，`sechead()` 统一渲染，`bind()` 里 `change` 后重画并回第 1 页）。
- `cat.js` `sortBank()` 改为按当前模式排序：`recent` 优先 `createdAt` 倒序，老的没有时间戳的题库按它在 `LOCAL` 里越靠后越新兜底（都是 0 时等价于「倒着入库顺序」）。
- 建库时间落盘：`app.js:normalizeBank` 透传 `createdAt`，新建题库（导入纯文本 `app.js` 新建、`bf-folder.js` 批量导入、`variant.js` 存变式题库）写 `createdAt: Date.now()`。
- 排序样式 `cat.css` `.nb-bsortwrap/.nb-bsort`（窄屏换行）。
- 验证：新建 `C:\Users\chen\Desktop\工作1\sort-probe.py` **10 通过 / 0 失败**（下拉存在、三选项、默认自定义、最近添加 b3 最新在最前、无时间戳的排最后、选择进 localStorage、按名称 A→B→C→D、切页回来自动恢复、切回自定义恢复、无 JS 报错）；`home-page-probe` 回归 30/30；`node --check` app.js/cat.js/variant.js/bf-folder.js 全过。
- 上线：提交 `aeb4fca2`，线上核到 `shuati-v68-web152`，`cat.js` 已含「最近添加」。

## 22. 依据 AQBot / AFFiNE 的改造（web156 → web158，2026-10-24）

### 22.1 markdown 编辑器（AFFiNE / marked 思路）
| 能力 | 落点 | 版本 |
| --- | --- | --- |
| 代码块：语言名 + 一键复制 + 行内代码样式 | collection.js mdFenceHtml / mdCopyInitOnce，style.css .md-code | web156 |
| 嵌套列表（保序、可缩进）双向 | mdListHtml / mdFromHtml → walkList | web156 |
| 任务清单 - [ ] / - [x] 可点勾选、round-trip | mdTaskLine / .md-chk | web156 |
| 删除线 ~~x~~ 双向 | mdToHtml / mdFromHtml | web156 |
| 斜杠菜单 / 与 、（行首或空块）→ 段落/标题/H2/H3/列表/待办/引用/代码/表格/分割线 | slashMap / slashMenu / slashApply | web156 |
| 撤销 / 重做：Ctrl+Z、Ctrl+Shift+Z、Ctrl+Y，块操作与斜杠换块可撤 | undoState / undoSnap / undoStep | web157 |
| 浮条按选区矩形定位，并反显当前加粗/斜体/代码/高亮/颜色 | showAt / markActive | web157 |
| 表格转义竖线、对齐语法、聊天/导出表样式 | splitRow / style.css .tbl-wrap | web146 |
| 图片：=WxH 尺寸语法、粘贴/拖拽内联插图、右下角拖宽、图区拖序 | mdToHtml / richInsertImgAtRange / richImgsBind | web146–154 |
| 提示框（callout）：> [!tip] 文字 / > [!warning] 等五类，图标+类型标签，双向往返；斜杠菜单也有「提示框」 | collection.js CALLOUT_ICON / mdToHtml / mdFromHtml / slashApply | web160 |

### 22.2 AI agent（AQBot / Zed agent 思路）
| 能力 | 落点 | 版本 |
| --- | --- | --- |
| 对话历史按 token 预算裁剪，且一问一答整组保留（不会留下没问题的回答） | chat.js estTok / histMsgs | web158 |
| 等待分级提示：10 秒「还没开始输出」→ 15 秒「可能卡住」→ 45 秒「点停止再 ↻ 重试」 | chat.js tickStatus | web158 |
| 知识库低置信过滤（低于最高分 25% 丢）、空命中给出可执行原因、单源降级提示 | ai.js aiContext | web158 |
| 工具轨迹四态 ✅成功 / ⚠失败 / ⏳未执行 / ♻复用上次结果，每条带耗时 | chat.js agentTraceText | web159 |
| 执行中提示带步数「3/4 正在执行…」；连续两次同一工具同一参数自动收尾，避免空转 | chat.js runAgentChat | web159 |

### 22.3 验证与上线
- 探针：slash 18/18、undo 12/12、md-editor 19/19、color 10/10、block2 15/15、block3 12/12、home-page 30/30、kb-page 0 fail；
ode --check 全过。
- 版本：web156（markdown 批次 + 斜杠菜单，提交含 bump-web156）、web157（撤销/重做 + 浮条，d8a897ab）、web158（agent/RAG，ea915cb4）；线上已核 sw.js = web158、ai.js 91181B、chat.js 122000B 与本地一致。

## 23. 四项进阶（web161 → web162，2026-10-24）

### 23.1 动作参数校验（paramsSchema 轻量版，web161）
`ai-ops.js` 新增 `PARAM_RULES`：每个动作声明 `require`（必须出现）与 `anyOf` / `anyOf2`（各是一组「给其中一个就够了」的键），并给 `example` 格式示例。
- `checkParams(actionId, params)` → `{ ok, missing, example, hint }`，已从 `window.AI_OPS` 导出。
- 预览链路：`preview()` 在 `resolve` **之前**先校验 —— 缺参数直接返回「缺少参数：（bankTitles 或 bankIds）（照这个格式给：…）」，不再先抛「没找到要删除的题库」这种看不出原因的错误。
- agent 链路（`chat.js` runAgentChat）：工具调用前先 `checkParams`，不全就把「还差哪几项 + 格式示例」直接问用户（trace 记一条 ⏳ 参数不全），不拿半截参数去预览。
- 覆盖动作：bank.delete / bank.rename / bank.move / cat.create / cat.rename / cat.move / question.delete / question.mastered / question.favorite / tag.add / tag.remove。

### 23.2 agent 工具轨迹独立面板（web161）
- `chat.js` 每次更新轨迹文本时同时把结构化轨迹存到消息节点 `n.trace`（12 处写入点统一补 `n.trace = trace.slice()`）。
- AI 气泡里渲染可折叠 `<details class="ch-trace">`：标题「工具调用 N 次」，每行 `图标 + 序号. 动作名 + 耗时ms + 结果摘要`（✅ 成功 / ⚠ 失败 / ⏳ 未执行 / ♻ 复用 / 🛠 其它）；正文里的轨迹文本保留，面板只是更好的可读入口。
- `chat.css` 加 `.ch-trace/.ch-trow/.ch-tic/.ch-tres`。

### 23.3 图片图注（Notion 式 caption，web162）
- 语法：`![图](url =200x120 "图注")`（图注可单独出现、尺寸可省）。
- `mdToHtml`：有图注时输出 `<figure class="md-fig"><img …><figcaption class="md-cap">图注</figcaption></figure>`；没有图注保持原来的裸 `<img>`（旧数据零影响）。
- `mdFromHtml`：`figure` 分支取内部 `img`，图注从 `figcaption` 或 `img[data-cap]` 读回，写成 `![]("图注")`。
- 编辑：编辑区里**双击图片** → prompt 写图注（空 = 去掉），DOM 立即变成 figure/figcaption 并落盘。
- `style.css`：`.md-fig/.md-cap`（图居中、图注灰小字、聚焦淡底）。

### 23.4 解析目录（web162）
- 解析框里小标题（h1–h6）≥ 3 个时，`richBindAll` 在 `.exp-wrap` 顶部插入「☰ 目录」按钮（幂等，标题少于 3 个自动移除）。
- 点按钮出浮动面板 `#mdTocPanel`，按层级缩进列出标题；点条目 `scrollIntoView` 并高亮目标小节（`.md-toc-flash`），面板关闭；点别处关闭。
- `style.css`：`.md-toc-btn/.md-toc-panel/.md-toc-i/.md-toc-flash`。

### 23.5 验证与上线
- `params-trace-probe.py` 19 通过 / 0 失败（参数校验 10 项 + 预览拦截 + 轨迹面板 7 项）。
- `caption-toc-probe.py` 14 通过 / 0 失败（目录按钮/面板/条目数/跳转、双击图注/落盘 `"图注"`/清空拆 figure）。
- `md-caption-test.mjs` 6 项全过（图注 figure、尺寸共存、无图注不包 figure、纯图注、标题渲染）。
- 回归：md-editor 19/19、block2 15/15、block3 12/12、color 10/10、math-stem 7/7、slash 18/18、undo 12/12、home-page 30/30。
- 上线：web161（参数校验 + 轨迹面板，提交 34af240d/e03eb5cf）；web162（图注 + 目录，提交 337ebb5c）；线上核到 `sw.js = shuati-v68-web162`、`collection.js` 144010B 含 `md-toc-btn`/`md-fig`、`ai-ops.js` 含 `PARAM_RULES`。

---

## §24 八项界面改进：右键菜单 / 题库选择器 / 折叠 / 拖动面板 / 套卷批量 / 复习不建卷（web163）

### 24.1 需求
1. 照 AppFlowy 的右键菜单与 markdown 编辑器改进本站；
2. 选定题库的所有入口（搜索、贴标签、收藏 / 错题）加「可搜索 + AI 模糊」的题库选择器；
3. 解析可折叠；
4. 答题界面的题目区块可拖动/吸附；
5. 标签面板贴在答题区块旁，可拉伸变形、可隐藏；
6. 临时套卷批量管理；
7. 每日复习不再自动生成套卷；
8. 搜索框 / 选择框美化。

参考代码：`C:\Users\chen\Desktop\工作1\_ref\AQBot-main\AQBot-main`、`C:\appflowy-ref\AppFlowy-main`；
分析结论在 `C:\Users\chen\Desktop\工作1\_ref\ANALYSIS-APPFLOWY.md`（AppFlowy 桌面端其实没有块级右键菜单，
真正的块菜单是 hover ⋮⋮ → 「编辑块」的四项 PopoverAction；右键只有复制/剪切/粘贴/全选）。

### 24.2 逐项落地
- **①右键菜单**（`collection.js` 末尾 `ctxEl/ctxOpen/ctxClose/ctxRichItems/ctxItemItems`，`style.css` `.ctx-menu`）：
  桌面 `contextmenu`、触屏长按 480ms（`CTX_LP`，选项上的长按仍留给「排除选项」）。
  解析块菜单 = 复制/上移/下移/插入空段落/删除 + 加粗/斜体/删除线/行内代码 + 转成标题/无序/有序/引用（转成复用 `slashApply`）；
  题目卡片菜单 = 打开/收藏/错题本/复制题干/复制解析，多选时多一条「选中的 N 道一起加入/移出错题本」。
  菜单规格照 AppFlowy `pop_up_action.dart`：行高 36、图标 20、说明 12px 灰、最小宽 190、最大高 420。
- **②题库选择器**（`cat.js` `bankPickerHtml/bankPickerBind`，带 `bE()` 局部转义——被追加在 IIFE 外，不能用内层 `E`）：
  搜索页、标签页、收藏/错题页共用；支持输入筛选与「AI 模糊」（`window.qaiExpandAny`）。
- **③解析折叠**（`collection.js` `EXPFOLD` / `expFoldToggle` / `.exp-fold` / `.exp-wrap.collapsed`，键 `qbank.expfold.v1`）：
  默认展开；折叠后只留「解析 ▸ 展开」一行。注意解析只有答题后才会渲染（`app.js:2991` 条件），探针必须先答题。
- **④题目区块浮动拖动**（`app.js` `uiQuizFloat` + `.qf-float` + `#qdGrip` + `.qd-guide`，键 `qbank.quizfloat.v1`）：
  把手拖走，靠近左/右/上/下边吸附并出参考线；位置与宽度落盘。
- **⑤标签面板**（`app.js` `uiTagDock` + `body > .tagdock` + `.tagpill`，键 `qbank.tagdock.v1`）：
  正文标签行移出到旁侧面板；拖标题栏移动、右下角拉伸、✕ 隐藏成小钮、小钮恢复；考点仍用 `TAGS.bindRow`。
- **⑥临时套卷批量管理**（`app.js` `deletePapers/renamePaper/exportPapers`；`cat.js` `PAPER_MANAGE/PAPER_SEL`）：
  套卷页每张卡有勾选框，底部批量条 = 全选/反选/删除选中/导出选中/退出；单卡可改名。
- **⑦每日复习不自动建卷**（`app.js` `LIVE_PAPER`）：复习改用临时卷（`opts.transient`），不再写进「临时套卷」；
  没有到期题时不建空卷，只提示。
- **⑧美化**（`style.css`）：输入框/下拉/搜索框统一圆角、聚焦描边、搜索图标。
- **markdown 三处流水线修复**（同批）：行内代码占位符提前到加粗之前、连续的 `> ` 合并成一个引用块（`<br>` 连接）、
  表格列数按表头与数据行的最大值补齐（以前按表头截断会丢列）。

### 24.3 验证
- 新建 `工作1\ctxmenu-probe.py`：18 通过 / 0 失败（卡片菜单项、移出错题本计数归零、菜单自动关闭；
  解析块菜单项齐全、复制后块数 3→4、删除后 4→3、编辑落盘 `qbank.notes.v2`、无 JS 报错）。
- 回归：`batch2b-probe.py` 37/37、`search-bank-probe.py` 18/18、`home-page-probe.py` 30/30。

### 24.4 上线
- `sw.js` `VERSION = 'shuati-v68-web163'`；`index.html` 里 `collection.js`/`style.css` 缓存戳 → `?v=20261106a`。
- 提交 `2a6ac5c7`（增量 190 个文件，跳过 182），随后补 sw.js 版本说明再提交一次。
- 线上核验：`sw.js` 版本 `shuati-v68-web163`、`collection.js` 168155B、`style.css` 149652B，与磁盘字节一致
  （本地文本读取会把 CRLF 折成 LF，比对要用二进制读）。

### 24.5 web164：交互修补与标签同步时间戳

| # | 问题 | 处理 |
|---|---|---|
| 1 | 题库搜索式选择器遮住「基本科目」筛选栏 | `cat.js` 的 `bankPickerHtml/bankPickerBind` 把弹层改成 `position:fixed`、`min(420px, 100vw-24px)` × `min(420px, 62vh)`，水平居中、垂直在视口中部；弹层加标题行 `.bpick-cap` 和 `.bpick-x` 关闭钮；`window.resize` 时重新定位。 |
| 2 | 块排序把手「触发半径还是小」 | `style.css` 把手改 22×30 并用 `::after{inset:-12px}` 外扩热区；`collection.js` 的 `blkHover` 增加「左侧沟槽」判断：鼠标在 `.rich-edit.blk-mode` 左边 28px 内、Y 落在某块上，也算命中（不必压在文字上）。 |
| 3 | 答题页浮块「能拖但吸附不了」 | 根因是拖动结束后紧跟的 `click` 把浮层切回非浮动：`app.js` 用 `let moved` 标记，`onMove` 位移 >4px 置真，`grip.onclick` 见到 `moved` 就跳过本次切换；吸附仍然按左右阈值吸边。 |
| 4 | 浮块不能随意拉大小 | 新增 `rzBind(el)`：浮动时自动插 `.qf-rz`（右下角把手，`pointer` 拖动改宽高），松手写 `qbank.quizfloat.v1` 的 `w/h`；`qfState()` 默认 `h:0`，`applyFloat()` 恢复/保存高度。 |
| 5 | 考点标签面板「按钮按不动」 | 撤掉 `body > .tagdock` 浮动面板与 `uiTagDock`，考点行回正文内联 `tagRowHtml(fk,q)`；渲染时清掉残留的 `body > .tagdock/.tagpill`。 |
| 6 | 「口诀思路」要独立于答题区块、又不能全站可见 | `app.js` 新增 `uiQnPanel(fk)`：面板挂在 `#view` 内的 `section.qnfloat#qnFloat`，标题栏 `.qn-h` 可拖、`.qn-rz` 可缩放、`.qn-x` 关闭，尺寸落 `qbank.qnbox.v1`；换页/回主页即消失；答题卡左侧旧 `aside.qnbox` 删除，题干区加「✎ 口诀」入口。 |
| 7 | 解析收不起来 | 其实已有 `EXPFOLD`（`qbank.expfold.v1`）+ `.exp-wrap.collapsed`，本轮补齐样式与「重画后仍收起」的验证，并在 `style.css` 里把收起后的标题行做成一行可点条。 |
| 8 | 正文颜色要能自选 | 设置里加「正文颜色」`#setTextColor`（自动/墨黑/深蓝/棕褐/墨绿/自定义）+ `#setTextColorPick`；`applyLook()` 写 `html[data-tc]` 与 `--read-c`，题干/选项/解析/反馈区统一读这个变量。 |
| 9 | **标签云同步：pad 上传的标签，手机上还是本地旧的** | 根因：`TAGS.mergeIn` 里「本机这道题已有标签就整条丢弃云端」，而标签没有逐题时间戳，永远判不出谁新。修法：新增 `qbank.tagts.v1`（每道题标签修改时间），`setTags` 任何写入（含清空）都记时间戳；同步上传载荷加 `d.tagTs`；`mergeIn(cloudTags, cloudVocab, cloudTs, cloudTagTs)` 改成——云端逐题时间戳更新 → 用云端覆盖；本机更新 → 保留本机；本机没有 → 补上；老格式云端数据（无 `tagTs`）→ 并集合并，至少不丢。 |

验证：`工作1\fix164-probe.py` **44 通过 / 0 失败**（选择器位置与不重叠、把手尺寸与左侧沟槽热区、拖完仍浮动/吸边/拉大小/尺寸落盘、标签回内联且无 body 级面板、口诀浮窗拖/缩放/落盘/关闭/主页不可见、折叠落盘且重画仍收起、正文颜色与落盘、JS 无报错）；`工作1\tag-sync-probe.py` **15 通过 / 0 失败**（云端新覆盖、本机新保留、老数据并集、载荷带 `tagTs`）。

版本：`sw.js` `shuati-v68-web164`，`index.html` 六个文件缓存戳 `?v=20261106b`，提交 `d21423b4`；线上逐文件二进制比对一致（collection.js 168618B、style.css 150474B、tags.js 175139B、sync.js 50765B、app.js 228246B、cat.js 156514B）。

### 24.6 web165：题库选择器贴按钮 + 弹层最顶层 + SW 预缓存瘦身 + 浮块点回

用户反馈（2026-10-24）：
1. 题库选择器位置还是不好，「最好就放在旁边，并且在图层最顶层」，学习中心最底下那个选择题库「都按不到了」；
2. 选择器里的搜索框 UI「有点丑，里面还有一个🔍」，去掉；
3. 拖完浮块想点回正常排版，第一次点没反应。

改法（`cat.js` / `style.css` / `app.js` / `sw.js`）：

| 问题 | 根因 | 改法 |
|---|---|---|
| 弹层被容器/页面内容压住、底部按钮点不到 | `.bpick-pop` 原来是按钮的绝对定位子元素，会被外层 `overflow`、`position` 上下文和后面绘制的内容遮住 | 打开时 `document.body.appendChild(pop)` 并记 `pop.__home = box`，关闭时再搬回原位；`position: fixed`、`z-index: 2147483000`；位置按按钮矩形算 `below/above`，取较大空间并夹到视口内；每屏最多 420px 高 |
| 学习中心最底部点不到 | 同上 + 旧 `place()` 没考虑「按钮贴近视口底」 | 重写 `place()`：`below = vh - br.bottom - 12`、`above = br.top - 12`，优先放空间大的一侧，`top` 夹在 8 与 `vh - h - 8` 之间 |
| 搜索框里多一个🔍 | `style.css` 全局给 `input[type="search"]` 加了放大镜 SVG 背景 | `.bpick-q` 用 `background-image: none !important` 关掉；输入框只留 placeholder |
| 选完要点一下才收 | 选中后只写隐藏 input | 选中后 `close()` 自动收起并触发 `onChange` |
| 拖动后点回没反应 | `moved` 标记只由下一次 click 消耗，拖完那一下被吞 | `onUp` 里 420ms 后自动把 `moved` 复位（`onUp.__t`），拖手后的合成 click 仍被吞，稍后再点就能切回 |

**SW 预缓存瘦身**：`sw.js` 的 `CORE` 清单原来含 `./知识库.js`（本地资料库，实测 6.11MB），而 CORE 合计 8.19MB——每次改 `VERSION`，每台设备都要重下这 8MB，是这轮流量飙升的主因（web148→web164 二十来次 × 三台设备）。已从 CORE 删掉，改为注释「网络优先、用到才下、下过就缓存」。`工作1/swcheck.py` 实测：CORE 56→55 条、体积 8.19MB→2.08MB（最大只剩 katex 0.26MB、app.js 0.22MB）。

版本与验证：
- 缓存戳 `cat.js` / `style.css` / `app.js` → `?v=20261106b`；`sw.js` `VERSION = 'shuati-v68-web165'`。
- 线上核验：`sw.js` VERSION=web165、CORE 不再含知识库.js；`cat.js` 157562B、`style.css` 150509B、`app.js` 228450B、`collection.js` 168618B 与本地字节一致。
- 探针：`picker2-probe.py` 23/0、`fix164-probe.py` 46/0、`search-bank-probe.py` 18/0、`batch2b-probe.py` 23/0（含「标签行回内联」「拖完再点能恢复排版」）。

流量说明（回答用户「为什么流量跳了 8G」）：探针都打 `127.0.0.1` 不耗外网流量；真凶按大小排是 ① SW 每次升版本重下全部 CORE（已瘦身，单次从 8.19MB 降到 2.08MB）② `pdf/` 目录 476MB 按需拉取 ③ 云同步整份 JSON 来回 ④ 部署本身。约定：以后攒 3–4 项一起部署，探针脚本只连本地。

## 24.7 底栏复原 / 极简加强 / 参考资料邻段衔接（web167）

- **底栏导航恢复原样**：`app.js` 的 `.bnav` 去掉 `position:relative` 与毛玻璃（web166 误加，导致 `fixed` 失效），恢复普通文档流；答题页底栏与 `.nav` 间距回到 82px 原设计。
- **极简模式加强**：`style.css` 的 `html[data-min="1"]` 追加选择器，把阴影 / 渐变 / 毛玻璃 / 圆角装饰全部撤掉，只留文字与可点小钮。
- **知识库参考资料带前后文**：`kb.js` 的 `kbChunkOf()` + `kbDetail()` 为每条命中补 `pre/post`（各截 260 字）；`ai.js` 的 `aiContext()` 写入 `〔衔接上文〕/〔衔接下文〕`，提示里注明「条参考带上了前后文」。
- 单测：`工作1\kb-neighbor-test.py` 用 node stub 加载 `kb.js`，验 36 段切分、邻段截断、首段无上文，**6/6**；`home-page-probe.py` **30/0**。
- 版本：`sw.js` = `shuati-v68-web167`，提交 `17b204f5`；线上逐文件字节一致（app.js 231282 / kb.js 48210 / ai.js 114787 / style.css 153281 / sw.js 10139）。

## 24.8 检索索引落盘 / 检索自检护栏（web168）

按 `工作1\_ref\ANALYSIS-ALLINRAG.md` 的性价比清单，先做不碰检索语义的第 1、2 条。

- **B2 索引落盘**：`kb.js` IndexedDB 升到 v2，新增 `idx` store（结构化克隆，不走 `JSON.stringify`）。新增 `kbIdxSig()`（docs 条数 + 正文字数做签名）/ `kbIdxPut()` / `kbIdxGet()` / `kbIdxDel()`；`kbEnsure()` 先读盘上索引，签名一致直接用（`window.__kbIdxHits`），不一致才 `kbIndexAsync` 重建并写回（`window.__kbIdxBuilds`）。资料增删 / 改正文 / 文件库重切时 `kbIdxDel()` 失效。
- 效果（本机实测）：`file:file-内科` 2179 段；首次建 5 个库索引，刷新后 6 次缓存命中、0 次重建 —— 冷启不再每次重切 361 万字。
- **H1 检索自检**：`kb.js` 新增 `kbEvalSet(n)`（从每个勾选库抽样段，取段内稀有的 8 字原文当查询，自动标注）、`kbEvalRun(n)`（算 Top1 / Recall@5 / MRR）、`kbRunEval()`（知识库页「检索自检」按钮，掉基线 2 点标红）；`window.kbEval` / `window.kbEvalSet` 暴露给探针。
- 基线（60 条自动样本，全库）：**Top1 88.3% / Recall@5 100% / MRR 0.938**。以后改权重、改切段、加同义表，先看这三个数别掉。
- 探针：`工作1\kb-idx-probe.py` **6/6**（建索引 → IDB 有记录带 sig → 刷新命中缓存且 0 重建）；`工作1\kb-eval-probe.py` **9/9**（kbEval 暴露、n=60、三项指标、面板按钮渲染）；`kb-page-probe.py` 全绿（fail=0）。
- 版本：`sw.js` = `shuati-v68-web168`；线上逐文件核字节（kb.js / sw.js）。


## 25. 流量异常（2026-10-24）：根因与修复

### 25.1 现象

用户报「流量直接跳了 8G」。逐项量下来，这不是探针或部署吃掉的，是**站点自己的缓存策略**在每次打开页面时把整套资源重下一遍。

### 25.2 实测数字

| 项 | 体积 | 说明 |
| --- | --- | --- |
| `知识库.js` | 6.11 MB | 走「网络优先」，每次打开页面整份重下 |
| SW `CORE` 预缓存 | 55 条 / 2.09 MB | 去掉 `知识库.js` 前是 56 条 / 8.19 MB |
| `pdfjs/` | 7.07 MB | 第一次开 PDF 阅读器按需下 |
| `vendor/katex` | 0.53 MB | 在 CORE 里 |
| 10-23 之后部署次数 | 27 次 | 每次改 `VERSION`，每台设备重装 CORE 2.09 MB |

按 27 次部署算：单台设备 ≈ 56 MB，三台设备 ≈ 170 MB —— 只占 8G 的 2%。

真正的量级来自「每次打开页面 ≈ 8.2 MB」：

- 旧 SW 的静态策略写着 stale-while-revalidate，实现却是**每次请求都无条件 `fetch()` 最新版**（`e.waitUntil(netP…)`），所以缓存只是「让首屏快」，流量一分没省；
- `index.html` 里每个 js/css 都带 `?v=` 缓存戳，而安装时预缓存的是不带参的 URL → 缓存键**永不命中**，等于每次都整份重下；
- `知识库.js` / `AI配置.js` 走「网络优先」，同样每次打开重下 6.11 MB。

8 GB ÷ 8.2 MB ≈ 1000 次打开，手机后台重载、切页、点开就关都算一次。

### 25.3 修复（`sw.js`，web169）

1. 新增 `cacheKey(req)`：同源、扩展名属于 `js/css/mjs/png/jpg/webp/svg/ico/woff2/ttf` 的请求，按 **pathname** 存取缓存，忽略 `?v=` 戳。
2. 静态资源改为「缓存优先 + 后台条件重验」：命中就立刻返回缓存，后台用 `fetch(new Request(url, { cache: 'no-cache' }))` 让浏览器带 `If-None-Match`，服务器没变则 304、零传输；变了才写回缓存。
3. 新增 `DATA_CACHE = 'shuati-data-v1'`（**不随版本清空**）：`知识库.js` / `AI配置.js` 放这里，同样缓存优先 + 条件重验；`activate` 只清 `shuati-site-*`，资料缓存保留 —— 升版本不再重下 6.11 MB。
4. 站点缓存改名 `SITE_CACHE = 'shuati-site-' + VERSION`，与数据缓存分开。

### 25.4 实测效果（`工作1\sw-traffic-probe.py`，本地带 ETag/304 的服务器）

| 第几次打开 | 修复前 | 修复后 |
| --- | --- | --- |
| 第 1 次（建缓存） | ≈8.2 MB | 3.98 MB（一次性） |
| 第 2 次 | ≈8.2 MB | 0.02 MB |
| 第 3 次 | ≈8.2 MB | 0.00 MB |

稳态从「每次 8 MB」降到「几百字节的条件请求」，降幅约 400 倍。

### 25.5 后续约定

- **攒批部署**：3–4 项改动合成一次部署（用户明确要求）；
- 探针只打 `127.0.0.1`，并在探针里拦掉非本地请求；
- 以后任何「可能几 MB」的数据文件（资料库、题库镜像、索引），一律进 `DATA_CACHE`，绝不进 `CORE`；
- 新增静态资源仍带 `?v=` 戳（缓存键已经忽略它，戳只用于 index.html 层面的强制刷新，不再造成重复下载）。


## 26. RAG：A3 父段回填 + E2 重排分值（web170）

### 26.1 A3 父段回填（小段检索、大段喂料）

以前 `kbDetail` 只取「相邻一段」的前 260 / 后 260 字，遇到「定义在上一段、结论隔了两段」就补不上。现在：

- 新增 `kbSpan(id, d, ci, dir, budget)`：沿 `ci` 往两侧连续扩，最多 4 段，直到预算用完；
- 预算：上文 620 字、下文 520 字（原来是 260 / 260）；
- A4 句边界对齐顺手做：`kbAlignHead` 从上文最后一个句末开始、`kbAlignTail` 在下文句末截断，不再把半句话喂给模型；
- 成本：O(1) 查表（`kbChunkOf` 已有 `_byDC` 按 `d#ci` 索引），不额外建索引。

### 26.2 E2 重排输出分值

原来 `kbRerank` 只要「编号」，只知道顺序、不知道强弱；而低置信过滤用的是重排前的 BM25 原始分，两者可能矛盾。现在：

- 提示词改成「编号:分数（1–10）」，`maxTokens` 32 → 48；
- 解析 `编号:分数` 对，按分数降序，并把分数挂到 `h.rr`；
- 模型不给分数时自动退回「只解析编号」，行为与以前一致（小模型输出不稳的兜底）；
- 重排缓存同时存分数（`key@score`），命中缓存也能还原 `h.rr`；
- `ai.js` 低置信过滤：有 `rr` 就用三态（≥7 强相关 / 4–7 部分相关 / <4 弱相关且提示核对原文），没有才退回 BM25 相对分。

### 26.3 顺手修掉的 bug

`ai.js` 的 `aiContext()` 里 `bridged` 在声明之前就被读取（line 398 vs `let bridged = 0` 在 line 406），只要有知识库命中就会抛 `ReferenceError: Cannot access 'bridged' before initialization`。已把声明提前到过滤之前。

### 26.4 验证

`工作1\kb-a3e2-test.mjs`（node + vm 加载 `kb.js`，stub DOM/aiChat）：12 通过 / 0 失败 —— 覆盖上文跨段 417 字、下文从下一段开头接上、首尾句号对齐、`编号:分数` 排序与 `h.rr` 落值。`工作1\kb-page-probe.py` 回归 33 通过 / 0 失败。

---

## §26 一键贴标签提速（web171）

### 26.1 原来的慢在哪

| 环节 | 原实现 | 代价 |
|---|---|---|
| 逐题问模型 | `tags.js` `tagAll()` 一次只把 1 道题的题干+选项发给模型 | 165 道题 = 165 次串行调用，每批之间还有 `sleep` |
| 不合并同题干 | 同一套卷里材料题共用题干，逐题发 | 同题干被重复问 N 次 |
| 不利用已有知识 | 词表里明明写着「肺炎」，题干里也有「肺炎」，还是问模型 | 大量本可本地判定的题也在排队 |

### 26.2 三个改动（`tags.js`）

| 改动 | 实现 | 效果 |
|---|---|---|
| ① 本地预打 | `TAGS.tagAll()` 开跑前用词表扫每道题的「题干+选项+共用题干」，命中即打标、直接出队，记进 `JOB.pre` | 题干里已有明确考点的题，0 次调用 |
| ② 同题干去重 | `tagKey(txt)` = 去掉空白的题干指纹；同指纹只留第一道做代表，其余进 `JOB.dupe`，模型回填后按指纹分摊 | 材料题只问一次 |
| ③ 三批并发 | 剩余题按 15 道一批进 `batchList`，`TAG_CONC=3` 个批同时跑；每批结果按题号回填 | 墙钟时间约 1/3 |

### 26.3 探针

`C:\Users\chen\Desktop\工作1\tagfast-probe.py`（60 道题：10 道题干含词表词、50 道不含、其中 3 道同题干；`aiChat` 打桩记录并发与送题数）：

```
✔ 全部 60 道都打上了标签（实际 60）
✔ 本地预打命中 10/10 道（没问模型）
✔ job.pre 记录了 10 道本地预打
✔ 同题干合并了 3 道（应为 3）
✔ 实际送给模型的题目数 47（< 60，说明预打+去重省了）
✔ 并发批数达到 3（≥2）
✔ 总耗时 882ms < 串行估算 1740ms 的 75%
✔ JS 报错：无
✔ 未处理的 Promise 拒绝：无
结果：9 通过 / 0 失败
```

### 26.4 上线

- `sw.js` `VERSION = 'shuati-v68-web171'`；`index.html` `tags.js?v=20261106c`
- 提交 `08e38273`（增量），线上核验：`sw.js` 11481B（同本地）、`tags.js` 176481B（同本地）
- 流量：本次只动 `tags.js` + `sw.js`，知识库.js 仍是网络优先（web169 起）

---

## §27 13 项报障修复（web172）

用户一次报了 13 项（m07297），本轮做完 11 项，剩 ② 标签同步等用户的诊断行。

| # | 报障 | 根因 | 改法 | 探针 |
|---|---|---|---|---|
| ① | 解析区 mermaid / 思维导图 / LaTeX 不渲染 | 答题页解析本来就正常；坏在**用 `esc()` 直接输出解析**的两处（`variant.js:229`、`:259`） | 改成 `renderRich('', q.explain)` | imp-probe 前 3 项 |
| ② | 标签还是无法同步 | **两台设备各自导入同一份题库 → 题库 id 不同 → 标签键 `bankId#qid` 对不上**，并集永远 0 条 | 同步时按「题库名 + 题号顺序」把云端 id/题 id 重映射到本机（`sync.js syncTagBankMap`），`TAGS.mergeIn` 增第 5 参 `{map}`；诊断行拆开讲「重映射 N 条 / N 条本机没有」 | tagsync2 10/0 |
| ③ | 拖进度条被当成翻页 | 进度条拖动没拦住 pointer/touch 冒泡 | 加 `preventDefault` + `stopPropagation` 判定 | fix174 组 |
| ④ | 考点搜索不支持 AI 模糊 | `#tagRowAi` 只做了词表精确匹配 | 接 `aiPickTags`：模糊 → 候选 → 点选打标 | tagsub-probe |
| ⑤ | 题库选择器加不进 AI 对话 | 本地实测可用（居中弹层 + `#chatPickBank`） | 未改；证明性探针 | chatpick-probe 10/0 |
| ⑥ | 搜索/错题/收藏不能按 ABX 题型筛 | 全站只有单选/多选标签，无题型字段 | `qTypeOf(q)`（显式 `q.type` → 答案多选 X → 共用题干 B1 → 病例 A2 → A1）+ 四条筛选条 | typefilter 9/0 |
| ⑦ | 标签搜索不支持 AI 模糊 | 词表只有字面前缀匹配 | 同义词/近义表 + `aiPickTags`，考点行 / 错题本 / 搜索页三处按钮 | tagsub 9/0 |
| ⑧ | 统计中心考点要按六大科目增减 | 词表是平铺一列 | `qbank.tagsub.v1` 科目归属 + 分组渲染 + 每组「往这科加考点」 | tagsub 9/0 |
| ⑨ | 选「无技能」时先校准数据/列错题 | 无技能也走了带上下文的老提示 | 无技能时改成直接答，不主动列数据 | fix174 组 |
| ⑩ | 导入 AI 标准化信息不全 | 预览卡只有「解析成功 N 题」 | 预览卡加题型分布、待复习题数与题号、「保存后先复习 N 道」输入 + 「保存并开始复习」（临时套卷不进列表） | imp-probe |
| ⑪ | 导入 AI 标准化可读长度不够 | 硬上限 16000 字直接拒收 | 按空行/换行切 ≤12000 字分批整理再合并（第二段起去掉重复题库名行），上限 20 万字 | imp-probe |
| ⑫ | 主页「最近添加」排序不对 | 老库没有 `createdAt`，回退索引推断 | 建库写 `createdAt`，排序严格按它 | sort-probe 10/0（web165 起） |
| ⑬ | 文件夹不应置顶 | 渲染时按类型分组 | 改成按添加顺序混排 | sort-probe |

### 27.1 上线

- `sw.js` `VERSION = 'shuati-v68-web172'`；`index.html`：`app.js?v=20261108a`、`collection.js`、`tags.js`、`variant.js`、`style.css` 同戳
- 提交 `6a356a69`（增量）；线上核验：VERSION=web172、`app.js` 236746B、`collection.js` 172896B、`tags.js` 184662B、`variant.js` 38395B、`style.css` 155938B，全部与本地一致
- 探针累计：typefilter 9/0、tagsub 9/0、chatpick 10/0、imp 11/0、`node --check` 全过

### 27.2 第二轮补（未上线，攒批）

| 项 | 改法 | 探针 |
|---|---|---|
| ① 剩余渲染面 | 题干/共用题干/选项吃 `$..$` 与行内 markdown：`collection.js` 新增 `hlRich`（含公式就走 `stemHtml` 再高亮），错题/收藏/搜索卡片与题库题卡、`exam.js` 模考卷与回顾、`variant.js` 变式题干全部换 `stemHtml` | rich2 11/0 |
| ② 根因 | 见上表；另修 `mergeIn` 在「表里没这条题库」时按原键试，避免 `d.banks` 未启用时误丢全部云端标签 | tagsync2 10/0 |
| RAG 改写评测 | `kbEvalSet` 每样本带 `txt`；`kbEvalRunPara(n)` 让模型把段落改写成「学生会怎么问」，再比混合 vs 纯关键词（向量票贡献 = 差值）；结果缓存 `qbank.kb.evalpara.v1` | para-eval 13/0（stub 模型） |
| 版本 | 本轮未部署（省流量模式攒批），下次统一升 web174 | — |
