# PR #10 Construction Sheet：V1 Retrieval and Tools

## 1. 基本信息

- 确认模式：`Clean Foundation Strict`（中文翻译：最新 PRD 是唯一正常路线；不保留旧 Tool、旧检索阶段或兼容入口）。
- 新 PR：是，GitHub PR #10。
- exact base：`main@1fbbc3a11f27d3e0edc0e1084cf04509fbfba196`，即已合并 PR #9。
- exact branch：`agent/v1-retrieval-tools`。
- head：本施工单不预造；提交后记录实际 commit。
- stacked：禁止；PR 直接以 `main` 为 base。
- dirty-worktree policy：建分支前必须 clean；只提交本施工单列出的文件，生成物、数据库、日志、截图和临时文件不得进入 PR。
- commit/push/PR/merge：用户已授权；本地门禁和 GitHub CI 通过后提交、推送、创建 PR 并 merge。
- pre-branch stop condition：base 不是上述 merge commit、GitHub 历史不可恢复或 diff 混入 PR #11 adapter 时停止。本次创建前均已核验通过。

## 2. 用户效果与 canonical owners

Agent 只能看到三个独立检索 Tool：keyword、vector、graph。每个命中一次调用就直接带完整问题/回答原文；当前 conversation 没有命中时返回空，不从别处补证据。

唯一 owners：

- `KeywordSearchService`（中文翻译：只拥有全文/BM25 候选和排序，不拥有向量或图跳转）。
- `VectorSearchService`（中文翻译：只拥有每 turn 单向量的生成、失效检查和 cosine 排序，不拥有关键词融合）。
- `ReplyGraphTraversalService`（中文翻译：只沿 `explicit_reply_edges` 做授权 BFS，不推断任何边）。
- `RetrievalFacade`（中文翻译：验证可信身份、严格 Tool 输入、统一输出与稳定错误码；不持久化查询工作数据）。
- `PartnerMemStore` 继续是唯一 SQLite owner；retrieval service 只能调用其查询与可重建索引方法。

禁止第二 owner：candidate/recall/evidence resolver、hybrid/RRF、模型可见 `get_node`、page-local/adapter-local 检索实现。

## 3. Code Evidence

已检查：

- `docs/PRD.md` 2.7：证明公开名称、输入字段、两档 scope、完整原文 envelope、图深度/方向/排序和空/错误语义。
- `src/core/contracts.ts` 的 `TurnNode` 与 `ExplicitReplyEdge`：证明完整 turn 是证据单位，显式 reply 是唯一持久关系。
- `src/storage/migrations/001_v1_foundation.sql`：证明 `turn_nodes`、`explicit_reply_edges` 与 `agent_conversation_access` 是授权检索的持久真相。
- `src/storage/migrations/002_v1_immutability.sql`：证明问题不可修改、回答最多填一次、node/edge 永久。
- `src/ingest/turn-ingest-service.ts`：证明 `source_access_agent_id` 由可信 adapter 提供，并写入 Agent conversation access；检索不得从 `answer_agent_id` 反推权限。
- `src/runtime/runtime-contracts.ts`：证明 `get_node` 当前只属于内部 runtime command；本 PR 不将其复制到 Tool schema。
- `src/tools/generated/tool-schemas.json` 与 `src/tools/tool-contracts.ts`：本 PR 的 schema artifact 和 TypeScript 契约，测试必须 deep-equal。

证据支持三个专用检索 owner。没有证据支持自动跨 conversation、旧 Tool alias、query/candidate audit、score 回传或图关系推断。

## 4. Exact scope

允许新增/修改：

- `src/retrieval/**`
- `src/tools/**`
- `src/embedding/**`
- `src/storage/partner-mem-store.ts`
- `src/storage/schema.ts`
- `src/storage/migrations/003_v1_retrieval_indexes.sql`
- `src/index.ts`
- `scripts/copy-migrations.mjs`
- `test/retrieval/**`
- `test/tools/**`
- `test/embedding/**`
- `test/storage/schema.test.ts`
- `package.json`
- `README.md`
- 本施工单与 `V1_ARCHITECTURE.md`

禁止修改：

- Hermes/OpenClaw adapter 与 manifest（PR #11 owner）。
- PR #9 的写入状态机与公开字段语义。
- Harness 生命周期、自动 context 注入或回答生成。
- 旧路线 GitHub 历史。

## 5. Public contracts

### 5.1 可信身份

`TrustedRetrievalIdentity`（中文翻译：adapter 内部注入的正式检索边界，模型不可见）：

- `harness_id`：必填；producer 是已注册 adapter；storage 来自 `harness_instances`；consumer 是所有检索授权；不得从 Tool input 读取。
- `conversation_id`：必填；producer 是来源 conversation 映射；storage 来自 `source_object_mappings`；consumer 是默认 scope 与 graph 当前会话授权；不得使用宿主 raw ID。
- `agent_id`：可空；producer 是可信 adapter；storage 是正式 Agent mapping；consumer 仅为 `agent_conversations` 和跨已授权 conversation 的 graph 读取；不得从 `answer_agent_id` 推断。

Graph 节点可读的唯一公式：同一 trusted `harness_id`，且 node 位于 trusted current `conversation_id`，或 node conversation 存在 trusted `agent_id` 的 `agent_conversation_access` 行。

### 5.2 Tool inputs

`partner_mem_keyword_search` 与 `partner_mem_vector_search`：

- required `query`：trim 后非空 string；
- optional `scope`：`current_conversation | agent_conversations`，默认 `current_conversation`；
- optional `limit`：integer 1–20，默认 10；
- `additionalProperties: false`。

`partner_mem_graph_traverse`：

- required `start_node_id`：非空正式 node ID；
- required `direction`：`parent | replies | both`；
- optional `max_depth`：integer 1–3，默认 1；
- optional `limit`：integer 1–20，默认 10；
- `additionalProperties: false`。

模型禁止提交：`harness_id`、`conversation_id`、`agent_id`、vector、provider/model/dimensions、threshold/score、`edge_type`、graph query/scope、`get_node`。

### 5.3 Unified output

`status`（中文翻译：本次 Tool 调用是否有证据）允许 `ok | empty | error`；producer 是 facade；不持久化；不得表示数据库或写入状态。

`retrieval_type`（中文翻译：本次使用的单一检索 owner）允许 `keyword | vector | graph`；不得跨 Tool 比较分数。

`error_code`（中文翻译：Tool 失败时的稳定机器码）只在 `status: error` 出现，允许：

- `invalid_tool_input`
- `trusted_identity_invalid`
- `embedding_unavailable`
- `partner_mem_unavailable`

`EvidenceItem` 必须包含 `rank`、正式 node/Harness/conversation/thread、完整 `question` 与 `answer` 原文对象；一侧没有文字时整侧为 `null`。原文对象包含 role、message、author、Agent（回答侧）、visible time 与 display order。Graph item 另含实际持久 `path`；BM25、cosine、query、provider 和候选信息不得返回。

## 6. Persistence、索引与迁移

`turn_fts`（中文翻译：完整 question 在前、answer 在后的可重建全文索引）：

- FTS5 ordinary virtual table，tokenizer 为 `trigram`；
- `node_id`、`harness_id`、`conversation_id` 是 UNINDEXED scope 字段；
- migration `003` 回填全部已有 turn；
- node insert trigger 新建一行；
- answer text 首次填入 trigger 删除旧行并重建同一 node 行；
- 三个及以上 Unicode 字符使用 quoted `MATCH` + `bm25()` + `node_id` tie-break；
- 一至两个 Unicode 字符因 trigram 官方限制，在同一 FTS 内容表做 substring scan + `node_id` tie-break；
- FTS 行不是证据，命中后必须解析回 `turn_nodes`。
- FTS 中的 `harness_id` 与 `conversation_id` 只用于重建检查，不拥有权限；query 必须 join durable `turn_nodes`，再用 node 的正式 scope 或 `agent_conversation_access` 授权。伪造、重复或 stale FTS 行不得扩大结果，`limit/truncated` 只按授权并去重后的 node 计算。

`node_vectors`（中文翻译：每个 turn 当前 provider contract 下最多一条可重建向量）字段：

- `node_id`：primary key/producer 是 `VectorSearchService`/consumer 是 exact scan；
- `provider_id`、`model`：部署配置事实，只判断索引是否需重建，不返回模型；
- `dimensions`：positive integer，必须等于 BLOB 中 Float32 数量；
- `content_sha256`：固定 embedding 输入的 SHA-256，仅判断 stale，不是节点内容字段；
- `vector`：little-endian Float32 BLOB；
- `indexed_at`：内部索引时间，不用于宿主排序。

向量原文固定为：question-only 用 question；answer-only 用 answer；两侧都有时用 `question_text + "\n" + answer_text`。回答首次补入时 trigger 删除旧向量。provider/model、原文哈希或维度不匹配时覆盖该 node 的索引行。不得为 question/answer 分别建向量。

provider 返回值和已有 BLOB decode 后都必须通过 Float32 round-trip、每一维 finite、维度一致、finite non-zero norm 和 finite cosine distance 校验；失败统一为 `embedding_unavailable`，不得保存 Infinity/NaN 或用伪排序继续。

`timeout_ms`（中文翻译：单次 embedding HTTP 请求最多等待多久）是部署配置的 positive integer，producer 是 adapter/deployment config，不持久化，consumer 仅是 `OpenAICompatibleEmbeddingProvider`；默认 `10000`，到期 abort 并返回 `embedding_unavailable`，不得阻塞其他 Tool 或写入。

禁止持久化：query、retrieval run、candidate、BM25/cosine、path selection、error、Tool response。

## 7. Service/API requirements

- `KeywordSearchService.search(identity, input)`：先 scope filter，只返回 node；内部 score 不出 service 边界。
- `VectorSearchService.search(identity, input)`：scope 为空时直接 empty；有候选但 provider 缺失/失败时抛出 embedding error；exact cosine scan；稳定 `node_id` tie-break。
- `ReplyGraphTraversalService.traverse(identity, input)`：BFS、循环检测、node 去重；`from_node -> to_node` 表示 reply child 到 parent；每条边必须重新验证 Harness、两端 node/message 和原文存在；无权/无效分支停止。
- graph 同层先按宿主 display order；缺失时把 ISO `visible_at` 解析为 epoch 后排序（正确处理时区 offset），相同时刻用 `node_id` 稳定 tie-break；不可解析时间排在可解析时间之后。
- `RetrievalFacade.invoke(toolName, input, identity)`：唯一 input/error/envelope owner。
- schema artifact 的公开名称集合必须严格等于三个；PR #11 adapter 只能消费这份 artifact，不得重画。
- internal runtime `get_node` 保留为内部接口；不进入 schema artifact。

## 8. Old path disposition

- `partner_mem_search`、`partner_mem_recall`、`partner_mem_timeline`、`partner_mem_status`：delete；只允许在禁止词负向测试或历史说明中出现。
- candidate/recall/evidence stage、hybrid/RRF、time-window、cross-agent override：forbid。
- model-visible identity、status/index/get-node Tool：forbid。
- score/query/retrieval audit tables：forbid。
- 旧路线：historical fact only。

## 9. Implementation order

1. migration `003`、schema migration gate、FTS trigger 与 vector table。
2. `PartnerMemStore` 的 scope/query/index/edge 查询方法。
3. embedding provider 与 vector codec。
4. retrieval contracts、authorization、keyword/vector/graph services。
5. strict Tool schemas、artifact、facade、统一 envelope。
6. schema/keyword/vector/graph/tool/provider tests。
7. exports、build artifact、README/架构/施工单。
8. targeted → full → typecheck → build → source/behavior/diff gates。

## 10. Positive tests

- migration `003` 从 PR #9 schema 回填已有原文；新问题和首次回答更新 FTS。
- 中文、英文、1–2 字短 query；BM25/trigram 正常命中并返回完整原文。
- 默认 current conversation 与明确 Agent history 两档 scope。
- 一个 turn 一条 vector；question→answer 拼接顺序、question-only、answer-only、stale invalidation。
- vector ranking 与稳定 tie-break，不返回距离。
- graph `parent | replies | both`、depth 1–3、BFS、同层显示顺序、循环、去重、截断和真实路径。
- generated schema artifact 与 TypeScript source deep-equal。

## 11. Negative tests

- Tool identity/vector/model/threshold/edge/query 注入字段拒绝。
- query 空、显式 `null` optional、limit 0/21、depth 0/4、非法 direction/scope 拒绝。
- null/array/空白/错误类型 trusted identity 统一返回 `trusted_identity_invalid`。
- current conversation 空结果不读取其他 conversation。
- Agent history 不读取无 access 行的 conversation。
- 伪造或 stale FTS scope 字段不能让隐藏 node 进入 current/Agent scope。
- graph 无权起点返回 empty，不泄漏存在性；无权/无效 target 分支停止。
- Float32 overflow、损坏 BLOB、provider failure/timeout 返回 `embedding_unavailable`；keyword 与 graph 仍能正常调用。
- 带时区 offset 的 `visible_at` 按实际时刻排序；同一时刻稳定按 `node_id`。
- `get_node`、status、旧四 Tool、hybrid 未注册。
- output 不含 score/distance/provider/model/query。
- schema 中不存在 query/candidate/retrieval run。

## 12. Verification gates

- Targeted：`corepack pnpm test:retrieval`。
- Full：`corepack pnpm test`。
- Types：`corepack pnpm typecheck`。
- Build：`corepack pnpm build`，并确认 `dist/tools/generated/tool-schemas.json` 存在。
- Source gate：正常源码不得出现旧 Tool 注册、hybrid/RRF、candidate owner、model-visible identity schema。
- Behavior gate：真实 facade 调用覆盖两个 scope、三种 graph direction、embedding failure 隔离。
- Migration gate：fresh DB 与 PR #9 DB upgrade 均成功，失败 transaction 回滚。
- Diff gate：`git diff --check`，并审计所有 changed files。
- Version gate：`package.json` 必须为 `0.4.0`；lockfile无独立项目 version 时不制造 churn。

## 13. Mechanical acceptance checklist

- [ ] base/branch/non-stacked 正确。
- [ ] 只有三个 Tool schema。
- [ ] 所有 Tool 直接返回完整 turn。
- [ ] 两档 scope 与 trusted identity 不可被模型覆盖。
- [ ] graph 每个 start/edge/target 授权。
- [ ] FTS 与 vector 都是一 node 一索引记录语义。
- [ ] 无 hybrid、score exposure、query persistence。
- [ ] 正负测试、source gate、behavior gate、build、CI 全部通过。
- [ ] PR 合并后才创建 PR #11 branch。

## 14. Explicit failure conditions

以下任一发生即失败，不得合并：

- Tool 需要第二次模型调用才能取得原文；
- 任何结果泄漏其他 Harness、未授权 conversation 或无权 graph node；
- 模型可提交正式身份或内部检索参数；
- BM25/cosine/path weight 被当成 evidence 返回；
- vector 失败破坏 keyword、graph、写入或正常对话；
- 旧 Tool/owner/compatibility alias 重新进入正常源码；
- relevant tests、build 或 GitHub CI 失败。
