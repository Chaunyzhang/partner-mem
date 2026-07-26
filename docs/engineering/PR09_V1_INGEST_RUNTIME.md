# PR #9 Construction Sheet：V1 Ingest and Runtime

## 基本信息

- 模式：`Clean Foundation Strict`。
- 新 PR：是，预计 PR #9。
- base：PR #8 合并后的 `main@559edafd53590a57312a864f93d7dc0eb1d9771c`。
- branch：`agent/v1-ingest-runtime`。
- stacked：禁止。
- dirty worktree：创建分支前必须 clean；只允许本表范围。
- commit/push/PR/merge：用户已授权，门禁通过后执行。

## 目标、owner 与 scope

用户效果：只有最终可见完整文字能写入；问题先建节点，回答只精确补到同一节点；失败不阻塞 Harness。

canonical owners：

- `TurnIngestService`（唯一写入语义 owner）；
- `PartnerMemRuntime`（唯一内部命令验证与调度 owner）；
- `PartnerMemStore` 仍是唯一持久化 owner。

允许：

- `src/ingest/turn-ingest-service.ts`
- `src/runtime/{runtime-contracts,partner-mem-runtime,jsonl-server,cli}.ts`
- `src/storage/{partner-mem-store,schema}.ts`
- `src/storage/migrations/002_v1_immutability.sql`
- `src/index.ts`
- `test/{ingest,runtime,storage}/**`
- `package.json`、`README.md`、本施工单

禁止：公开 Tool、检索排序、Harness 插件、自动重试、持久 turn counter/receipt、正文/时间/数组位置配对。

frontend projection：无。本 PR 没有 UI；任何前端都不得拥有写入、配对、身份或失败语义。

## Code Evidence

- `docs/PRD.md §2.2` 证明只允许最终可见完整文字，后台写失败不得改变正常对话。
- `docs/PRD.md §2.3-2.4` 证明一个 node 最多一个 question 和一个 answer，重启后只能按精确 source message mapping 恢复。
- `src/storage/migrations/001_v1_foundation.sql` 已提供 `turn_nodes`、正式 ID mapping、reply endpoint 数据库约束；本 PR 不创建第二事实表。
- `src/storage/partner-mem-store.ts` 已是 PR #8 合并后的唯一 SQLite owner；本 PR 只增加 message lookup、answer-side 单次补充和 reply lookup。
- `test/storage/schema.test.ts` 已证明旧 schema 拒绝、正式 ID 不能绕过、原文保留；本 PR 在此基础上增加不可变与 migration 原子性证明。

证据支持精确写入路线；没有证据支持 receipt、retry、历史扫描或推断配对。宿主如何证明最终可见属于 PR #11 adapter 的生命周期合同，本 PR 内部命令不伪造该事实。

## 新契约

`record_question`（记录最终问题）：输入 trusted `harness_id` 与来源 conversation/message/author/thread 字段，以及完整文字、role、visible time/order；输出仅供 adapter 内部暂存的 `node_id`。

`record_answer`（记录最终回答或最终宿主侧字段）：必须提供当前运行期 `node_id`、能精确恢复已有节点的 source message anchor，或 `question_was_absent: true`（中文翻译：适配器明确确认该 turn 没有问题文字节点）；禁止猜测。若 answer 没有文字，只能向已有 question node 一次性保存宿主结构字段；两侧均无文字时禁止建 node。

`question_was_absent` 只表示该 turn 没有问题文字节点，不等于宿主没有用户消息。若该侧只有附件而没有文字，`question_source_message_id`、`question_role`、`question_source_author_id`、`question_visible_at`、`question_display_order` 仍按宿主事实保存，但不得生成替代文字。

`record_reply`：两端来源 message ID 必须映射到已保存文字。

`final_visible` 不作为持久字段。只有进入上述命令的事件才表示 adapter 已确认最终可见。

`get_node`（内部精确读取）：必须同时提交 trusted `harness_id + node_id`；只允许 adapter/internal consumer 使用，不注册为模型 Tool；跨 Harness 统一返回 `NOT_FOUND`。

JSONL response（内部行协议返回）：写命令只返回 `harness_id`、`node_id` 或 `edge_id`，不把完整 node 或写入状态投影进 Harness 正常对话。

## 字段职责

所有 question/answer 字段 producer 是适配器生命周期；storage 是 `turn_nodes`；consumer 是检索返回。`visible_at` 缺失保存 `null`；后台提交时间只写 `created_at/updated_at`，不得代替宿主显示时间。

`node_id` producer 是内核；storage 是 node 主键；consumer 是 adapter 临时 map、内部精确读取、graph 起点；Harness 正常对话和模型写入接口不得读取写入结果。

`question_was_absent` 允许值只有 `true | false/缺失`；producer 是 adapter 对当前 host turn 的明确事实；不持久化；consumer 只有 `TurnIngestService`；`true` 允许 answer-only，禁止与已有 `node_id` 并用，禁止覆盖已存在的问题原文。

`source_*_id`（宿主来源标识）producer 是 adapter；storage 只进入 `source_object_mappings.source_object_id`；consumer 是 ID resolver；轮次节点只保存正式 ID。模型、UI 和正文不得生成它。

`source_access_agent_id`（本次宿主事件中被可信上下文确认可访问该 conversation 的来源 Agent ID）允许缺失或一个非空来源 ID；producer 是 adapter 的当前 Agent 上下文；storage 通过正式 agent mapping 写入 `agent_conversation_access`；consumer 是 PR #10 的 `agent_conversations` scope。它不得从 `answer_agent_id` 推断，因为“实际生成回答的 Agent”和“被宿主授权访问历史的 Agent”回答不同问题。question-only turn 也必须能产生 access；同一 conversation 可以显式授予多个 Agent。

`updated_at`（内部最后一次合法持久写入时间）producer 是 store；storage 是 node；不得代替 `question_visible_at` 或 `answer_visible_at`，不得用于配对或检索证据排序。

## API、persistence 与 migration

新增内部 API：

- `TurnIngestService.recordQuestion(...)`
- `TurnIngestService.recordAnswer(...)`
- `TurnIngestService.recordReply(...)`
- `PartnerMemStore.findTurnNodeByMessageId(...)`
- `PartnerMemStore.attachAnswer(...)`
- `PartnerMemRuntime.handle(...)`
- `serveJsonLines(...)`

修改 schema loader：每个 migration 在一个 `BEGIN IMMEDIATE / COMMIT` transaction（中文翻译：整份 migration 要么全部成功，要么全部回滚）中执行；初始化失败必须关闭数据库句柄。

`002_v1_immutability` 只新增 trigger，不新增第二事实表。它禁止 source mapping 更新/删除、node identity 替换、已保存 question/answer 侧字段覆盖、node 删除、reply edge 更新/删除；answer side 只允许从全部为空变成一次合法保存。

删除 API：无；PR #8 已删除全部旧 runtime/public API。未删除但禁止新读写的旧路径：无。

## Old path disposition

- persistent receipt/counter：delete。
- batch capture 与 history scan：forbid。
- inferred pair、neighbor pair、revision：forbid。
- 第二回答、覆盖原文、编辑/撤回同步：forbid。
- PR #8 的低层 store：retain as canonical persistence owner。

## 实施顺序

runtime contracts → store lookup/单次 side write → migration 原子性/不可变 trigger → ingest service → JSONL transport → tests → gates。

## Tests

Positive：question-only、answer-only、question+answer、无文字侧宿主字段、重启后精确 message mapping、重复相同提交、reply edge、question-only/multi-Agent access、PR #8 数据库升级。

Negative：两侧无文字不建 node；第二 answer 拒绝；metadata-only side 不可覆盖；不同正文重复拒绝；未知 node 不建 answer-only；无明确 absence 不建 answer-only；absence 与已有 question 冲突时拒绝；即使同 conversation 存在相邻时间/相似正文候选也不得猜配对；跨 Harness/cross-conversation answer 不可补充；reply 缺原文端点拒绝；跨 Harness `get_node` 不可读；migration 中途失败全部回滚且修复后可重开；错误不污染后续请求。

## Gates

- Source：扫描 `receipt|turn_counter|retry|FOLLOWS|RAW_NEAR_RAW|topic|revision|similarity` 在正常写入源码无命中。
- Behavior：`corepack pnpm test:ingest`、`corepack pnpm test`、`corepack pnpm build`，以及 built CLI JSONL smoke。
- Type：`corepack pnpm typecheck`。
- Diff：`git diff --check`，逐文件审计 status/name-status/stat。
- Mechanical：version `0.3.0`；migration 只新增 canonical immutability triggers；不出现 public tools；不提交 DB、dist、node_modules、`.DS_Store` 或 `* 2.*` 同步冲突副本。

## Mechanical acceptance

- [ ] branch 确实从 `main@559edaf` 创建，非 stacked。
- [ ] runtime write response 只含内部 ID。
- [ ] 相同 source message + 相同原文返回同一 node。
- [ ] 第二 answer、不同原文、跨 conversation/harness 精确读取全部拒绝。
- [ ] migration 失败无部分 schema，修复冲突后可恢复。
- [ ] 正常源码无旧 owner、公开 Tool 或自动重试。
- [ ] 全部门禁通过后才能 commit/push/PR/merge。

## Failure conditions

任何路径能覆盖原文、自动重试、持久化运行期 turn map、或在缺少精确锚点时配对，立即停止。
