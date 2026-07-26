# PR #10 Construction Sheet：V1 Retrieval and Tools

## 基本信息

- 模式：`Clean Foundation Strict`。
- 新 PR：是，预计 PR #10。
- base：PR #9 合并后的 `main`；创建前记录实际 hash。
- branch：`agent/v1-retrieval-tools`。
- stacked：禁止；工作区必须 clean。
- commit/push/PR/merge：用户已授权，门禁通过后执行。

## 目标与 owners

用户效果：Agent 只能调用 keyword、vector、graph 三种独立检索；每个结果直接带完整问答原文；空结果不跨边界猜测。

canonical owners：

- `KeywordSearchService`
- `VectorSearchService`
- `ReplyGraphTraversalService`
- `RetrievalFacade`（统一可信身份、输入验证、输出 envelope）

## Scope

允许：`src/retrieval/**`、`src/tools/**`、`src/embedding/**`、storage 查询方法、migration `003`、对应 tests、schema artifact generator。

禁止：Harness 插件、自动 context 注入、hybrid/RRF、query audit 持久化、模型可见 status/get_node/index API。

## Public contracts

`scope`（查询范围）只允许：

- `current_conversation`：默认；trusted `harness_id + conversation_id`；
- `agent_conversations`：同一 trusted harness 中 `agent_conversation_access` 授权给 trusted `agent_id` 的 conversations。

模型只能选择名称，不能提交正式 ID。

`status` 只允许 `ok | empty | error`；producer 是 `RetrievalFacade`；不持久化；consumer 是 Harness Agent；不得从它推断写入或数据库健康。

`retrieval_type` 只允许 `keyword | vector | graph`；只说明本次调用哪种检索，不得用于跨 Tool 分数比较。

三个 Tool 名固定：

- `partner_mem_keyword_search`
- `partner_mem_vector_search`
- `partner_mem_graph_traverse`

输入、默认值、上限、direction、depth、truncated 和 evidence item 完全按 PRD 2.7。

## Persistence

`turn_fts`：question/answer 完整原文的可重建 FTS5 表。

`node_vectors`：`node_id`、provider/model/dimensions/vector blob、indexed_at；最多一条 active vector per node/provider contract；不是证据。

不得写 retrieval run、candidate、path selection、score 或 query。

## Ordering

Keyword：scope filter 后 `bm25()`，稳定 tie-break `node_id`。

Vector：scope filter后 cosine distance，稳定 tie-break `node_id`；question 在前、answer 在后拼接；不返回 distance。

Graph：每次一个起点；BFS；depth 1–3；同层 host display order → visible time → `node_id`；每读起点、边、目标均做权限校验；返回实际持久路径。

## Old path disposition

旧 Tool 名、candidate/recall/timeline/status、hybrid、time-window 和 cross-agent override：delete/forbid，无 alias。

## Tests

Positive：中英文 keyword BM25、每 turn 一个向量、两个 scope、完整原文 envelope、graph 三方向/三深度/排序/循环/截断。

Negative：identity 注入字段拒绝；limit/depth 越界；empty 不跨 conversation；unauthorized graph branch 停止；get_node/status/hybrid 未注册；score 不返回；query 不持久化；embedding unavailable 返回稳定 error。

## Gates

- generated schemas 与 TypeScript source deep-equal。
- 公开 Tool 名集合严格等于三个。
- targeted retrieval/tool tests、full tests、typecheck、build。
- source scan 禁止旧 Tool、candidate、hybrid、RRF、model-visible identity。
- version `0.4.0`。

## Failure conditions

任何 Tool 需要二次读取原文、任何结果泄露跨域节点、任何内部 score 被当作 evidence、或 vector 失败影响其他 Tool，立即停止。
