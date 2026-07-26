# PR #9 Construction Sheet：V1 Ingest and Runtime

## 基本信息

- 模式：`Clean Foundation Strict`。
- 新 PR：是，预计 PR #9。
- base：PR #8 合并后的 `main`；创建分支前必须 fetch 并记录实际 `origin/main` hash。
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

允许：`src/ingest/**`、`src/runtime/**`、必要 storage 方法、对应 tests、migration `002`、package/README。

禁止：公开 Tool、检索排序、Harness 插件、自动重试、持久 turn counter/receipt、正文/时间/数组位置配对。

## 新契约

`record_question`（记录最终问题）：输入 trusted `harness_id` 与来源 conversation/message/author/thread 字段，以及完整文字、role、visible time/order；输出仅供 adapter 内部暂存的 `node_id`。

`record_answer`（记录最终回答）：必须提供当前运行期 `node_id`、能精确恢复已有节点的 source message anchor，或 `question_was_absent: true`（中文翻译：适配器明确确认该 turn 没有问题节点）；禁止猜测。

`record_reply`：两端来源 message ID 必须映射到已保存文字。

`final_visible` 不作为持久字段。只有进入上述命令的事件才表示 adapter 已确认最终可见。

## 字段职责

所有 question/answer 字段 producer 是适配器生命周期；storage 是 `turn_nodes`；consumer 是检索返回。`visible_at` 缺失保存 `null`；后台提交时间只写 `created_at/updated_at`，不得代替宿主显示时间。

`node_id` producer 是内核；storage 是 node 主键；consumer 是 adapter 临时 map、内部精确读取、graph 起点；Harness 正常对话和模型写入接口不得读取写入结果。

## Old path disposition

- persistent receipt/counter：delete。
- batch capture 与 history scan：forbid。
- inferred pair、neighbor pair、revision：forbid。
- 第二回答、覆盖原文、编辑/撤回同步：forbid。
- PR #8 的低层 store：retain as canonical persistence owner。

## 实施顺序

contracts → store attach/lookup → ingest service → runtime command validation → JSONL transport → tests → gates。

## Tests

Positive：question-only、answer-only、question+answer、重启后精确 message mapping、重复相同提交、reply edge、agent access。

Negative：空/片段/草稿事件没有写接口；第二 answer 拒绝；不同正文重复拒绝；未知 node 不建 answer-only；无明确 absence 不建 answer-only；无时间/正文猜测；reply 缺原文端点拒绝；错误不污染后续请求。

## Gates

- Source：扫描 `receipt|turn_counter|retry|FOLLOWS|RAW_NEAR_RAW|topic|revision|similarity` 在正常写入源码无命中。
- Behavior：targeted ingest/runtime tests、restart tests、full tests。
- Mechanical：version `0.3.0`；migration 仅新增 canonical 表/索引；不出现 public tools。

## Failure conditions

任何路径能覆盖原文、自动重试、持久化运行期 turn map、或在缺少精确锚点时配对，立即停止。
