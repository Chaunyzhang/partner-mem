# A1 Graph Kernel 工程交接总览

read `AGENTS.md`, inspect referenced code, follow the document in order, do not skip sections, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Confirmed Mode

`Clean Foundation Strict`（干净底座严格模式：先建立唯一底座，禁止为了兼容或省事留下第二套记忆逻辑）。

当前目录在交接时不是 Git 仓库。代码施工前必须先执行 [PR00 Repository Bootstrap](./PR00_REPOSITORY_BOOTSTRAP.md)：如果确认这是一个全新的本地项目，就初始化 Git、建立 `main`、提交当前文档基线；如果用户期望接入已有 remote/upstream，但本地没有 `.git`，则停止并要求用户提供 remote/base。不要让 PR01 直接卡在 `not a git repository`。

当前文件系统基线：

- `AGENTS.md`: `a1e40b85f0eff1a1252231573c3357ffdb81b14e8b38d0001363b23a7873cbd4`
- `docs/PROJECT_THINKING.md`: `87b111fe1512dc792ac8a8f5fd1c57316f860edd48322613bb4ee7591848a585`
- `docs/FOUNDATION_FROM_MATURE_PROJECTS.md`: `385fc1099793c6bba7af4373349af04f6a97e15dd36f17f5a893bd231180b984`

## Goal

A1 要把 Partner-Mem 做成一个从 `Graph Kernel`（图内核：拥有节点、边、路径和证据校验的核心代码）往外生长的本地记忆插件。搜索、工具、上下文注入、适配层都必须调用同一个核心协议，不能各自拼一套记忆逻辑。

## Code Evidence

当前仓库没有实现代码、schema、route、store、test 或 migration。已检查到的 repo 文件只有 `AGENTS.md`、`docs/PROJECT_THINKING.md`、`docs/FOUNDATION_FROM_MATURE_PROJECTS.md`。

- `AGENTS.md:115-144`: 工程文档必须先取证，必须区分 code evidence、inference、unknowns、user requirements，必须写 `Forbidden Shapes`，必须拆成 PR-specific construction sheets。
- `AGENTS.md:46-66`: 默认 `Clean Foundation Strict`，不能留下未授权兼容路径、别名、fallback 或第二 owner。
- `AGENTS.md:68-76`: 要从 source of truth 往外实现，偏好一个 resolver、一个 owner、一个 persisted record。
- `docs/PROJECT_THINKING.md:17-29`: v1 的核心目标是保存所有可见文本、局部索引、快速找候选、返回原文证据、给 host agent 暴露工具。
- `docs/PROJECT_THINKING.md:39-43`: 工程承诺是不假装；summary、graph、vector、推断关系都不是最终证据，最终证据是原文。
- `docs/PROJECT_THINKING.md:51-62`: v1 scope 包含 SQLite、raw message、time fields、graph-native model、FTS、retrieval tools、context assembly、config、evidence packets、doctor checks。
- `docs/PROJECT_THINKING.md:190-213`: evidence edge allowlist 和 `target_hash` 是证据路径的基础，semantic edge 不能直接产出 evidence。
- `docs/PROJECT_THINKING.md:217-249`: graph walking 必须由 Partner-Mem 代码负责，LLM 不能拥有 graph correctness。
- `docs/PROJECT_THINKING.md:289-347`: 建议 schema 是 `memory_nodes`、`memory_edges`、`raw_payloads`、`summary_payloads`、`node_fts`、`retrieval_runs`、`evidence_packets`。
- `docs/PROJECT_THINKING.md:373-455`: tool result class 必须区分 `candidate`、`evidence`、`status`。
- `docs/PROJECT_THINKING.md:459-503`: context layer 和 tool layer 分离，context 不得注入未验证 graph guess、summary 事实、大段 history dump、私有 DB path。
- `docs/PROJECT_THINKING.md:507-576`: summary schema 和 resolver 支持从 day one 存在，但 auto build 默认关闭。
- `docs/PROJECT_THINKING.md:612-681`: `EvidenceResolver`（证据解析器：把候选节点确定性解析成原文证据）必须检查 node、edge、edge_class、edge_type、target_hash、cycle、raw payload。
- `docs/PROJECT_THINKING.md:683-696`: v1 验收包括原文保存、exact phrase search、fuzzy search、time boost、原文 evidence、host-neutral tools、doctor 和诚实失败。
- `docs/FOUNDATION_FROM_MATURE_PROJECTS.md:9-22`: 项目基础是 temporal graph、multi-signal retrieval、graph recall、memory control plane、tool/memory separation、hard raw evidence resolver。
- `docs/FOUNDATION_FROM_MATURE_PROJECTS.md:244-370`: 七层结构是 raw log、temporal graph、multi-signal retrieval、associative graph recall、hard evidence resolver、tool layer、context layer。
- `docs/FOUNDATION_FROM_MATURE_PROJECTS.md:416-452`: consistency locks 明确 graph 是 base、raw text 是 truth、candidate 不是 evidence、evidence edge allowlist 小而严格、agent 不证明 memory。

## External Evidence

- Graphiti/Zep docs: episode 是 ingestion event，也是 node；ingestion 产生的节点通过 `MENTIONS` edge 关联 episode，episode 用于 provenance 和 point-in-time 查询。参考：<https://help.getzep.com/graphiti/core-concepts/adding-episodes>
- Graphiti docs: search 能结合 semantic、keyword、graph-based retrieval。参考：<https://help.getzep.com/graphiti/getting-started/welcome>
- Mem0 docs: 当前 OSS v3 已移除 graph store，改为 entity linking，并在 search 时用 entity match 提升结果。这说明 Partner-Mem 不能盲目复制 Mem0 graph code，应吸收 multi-signal 和 entity seed 思路。参考：<https://docs.mem0.ai/migration/oss-v2-to-v3>
- graph-memory README: 实际 OpenClaw 方向采用 vector/FTS5 seed、community expansion、graph walk、PPR ranking，并区分 store、recaller、format、graph 等模块。参考：<https://github.com/adoresever/graph-memory>
- Cognee MCP docs: MCP 作为统一工具连接层，可以避免每个 AI assistant 为外部系统做重复集成，并提供跨会话持久记忆。参考：<https://docs.cognee.ai/cognee-mcp/mcp-overview>
- SQLite FTS5 docs: FTS5 是 SQLite full-text search virtual table，可用 `MATCH`、`=` 或 table-valued syntax 查询，并可用 `ORDER BY rank` 排序。参考：<https://www.sqlite.org/fts5.html>
- SQLite recursive CTE docs: recursive CTE 可做 graph query，文档示例用 `UNION` 防止 graph cycle 导致无限递归。参考：<https://www.sqlite.org/lang_with.html>
- MCP tools spec: server 暴露 tools，每个 tool 有 `name`、`description`、`inputSchema`，调用用 `tools/call`，tool result 可带 `isError`。参考：<https://modelcontextprotocol.io/specification/2024-11-05/server/tools>

## User Requirements

- A1/v1 不另起一个缩水 MVP。工程拆解要按已有 v1 目标往下落。
- 不能闭门造车。写工程实现前必须看成熟项目和底层逻辑。
- 底座必须是 `Graph Kernel`，搜索只是 graph 的入口索引。
- 适配层是 harness 转接头，类似插座转换器；它不拥有记忆语义。
- Partner-Mem 本体负责两件事：记忆存储和工具能力。
- 所有功能必须从同一个底座长出来，不能功能越来越多但互相拼接。
- 工程文档必须按项目 `AGENTS.md` 要求写，有证据、unknowns、forbidden shapes、coverage inventory、PR construction sheets、可复制工程师提示词、人话解释、自检报告。

## Inference

- 推荐 A1 使用 TypeScript/Node 作为插件和 MCP-first 运行时，因为目标 host 包括 Codex、Claude Code、OpenClaw、MCP clients，且 graph-memory 的可参考实现也是 TypeScript/OpenClaw 插件。
- 推荐 SQLite 作为唯一 durable store，因为项目文档明确 local SQLite first，外部参考也证明 SQLite + FTS5 + edge table 可以支撑本地 agent memory。
- 推荐先实现 schema、contracts、GraphStore、EvidenceResolver，再实现 FTS、tools、adapter。这样能满足“从底座长出来”的用户要求。
- 推荐 summary 只做 schema/resolver 支持，不做自动生成，因为项目文档明确 `summary.autoBuildEnabled = false`。

## Unknowns

- 真实 Git base/head 在交接时不存在。PR00 必须把它变成明确的本地 `main` 基线，或停止并要求用户提供 upstream/base。
- 真实 package manager 未指定。施工单默认 `pnpm`，如果用户项目后续出现其他 package manager，必须先报告偏差。
- SQLite driver 未在 repo 中存在。施工单默认选择 `@photostructure/sqlite`，理由是 graph-memory 用它避免 `node-gyp` 手动编译；如果安装失败，先报告，不得换成第二套 storage abstraction。
- Codex、Claude Code、OpenClaw、MCP 的真实 hook 细节未在本 repo 中存在。A1 只定义 adapter contract 和 MCP-first adapter skeleton，不实现每个 host 的私有深集成。
- 没有现有测试框架。施工单默认创建 Vitest。

## Canonical Owner

`Graph Kernel` 是唯一记忆事实 owner。

`Graph Kernel` 包含：

- `GraphContract`（图契约：NodeType、EdgeType、EdgeClass、status、allowed values）
- `SQLiteGraphSchema`（SQLite 图 schema：持久化节点、边、payload、FTS 和 retrieval/evidence audit）
- `GraphStore`（图存储访问层：唯一可读写 SQLite graph 的代码）
- `RawIngestService`（原文摄入服务：把可见消息写成 `raw_message` node 和 payload）
- `EvidenceEdgeBuilder`（证据边创建器：统一写入 evidence edge 和 `target_hash`）
- `EvidenceResolver`（证据解析器：只沿 allowlist evidence edge 返回 raw evidence）
- `GraphTraversal`（图遍历器：有限深度 BFS 或 recursive CTE，防 cycle）
- `SeedIndex`（入口索引：FTS/entity/time seed，只返回 candidate node id）
- `RecallRouter`（召回路由：组织 seed、graph walk、resolver、packet builder）
- `ToolFacade`（工具外壳：把 core result 变成 host-neutral result）
- `HostAdapter`（宿主适配器：把 Codex/OpenClaw/MCP 等格式翻译成 core request）

## Construction Order

0. [PR00 Repository Bootstrap](./PR00_REPOSITORY_BOOTSTRAP.md)
1. [PR01 Graph Contract And Schema](./PR01_GRAPH_CONTRACT_AND_SCHEMA.md)
2. [PR02 Graph Store And Raw Ingest](./PR02_GRAPH_STORE_AND_RAW_INGEST.md)
3. [PR03 Evidence Resolver And Traversal](./PR03_EVIDENCE_RESOLVER_AND_TRAVERSAL.md)
4. [PR04 Seed Index Recall Router And Tools](./PR04_SEED_INDEX_RECALL_ROUTER_AND_TOOLS.md)
5. [PR05 Adapter Context Doctor](./PR05_ADAPTER_CONTEXT_DOCTOR.md)

## Coverage Inventory

- Concepts: `raw_message`、`summary`、`entity`、`task`、`event`、`decision`、`artifact`、`candidate route`、`evidence path`、`evidence packet`、`host adapter`。
- Fields: `node_id`、`edge_id`、`agent_id`、`session_id`、`turn_id`、`turn_index`、`message_index`、`role`、`text`、`normalized_text`、`content_hash`、`source_hash`、`target_hash`、`created_at`、`observed_at`、`valid_from`、`valid_to`、`invalidated_at`、`metadata_json`。
- Allowed values: `node_type` must be `raw_message | summary | entity | task | event | decision | artifact`; `edge_class` must be `evidence | semantic | temporal | navigation`; evidence `edge_type` allowlist is `RAW_NEAR_RAW | SUMMARY_COVERS_RAW | SUMMARY_ROLLS_UP_SUMMARY | MENTIONED_IN_RAW | EVIDENCED_BY_RAW`; result class is `candidate | evidence | status`.
- Producers: adapters produce normalized host input; `RawIngestService` produces raw nodes/payloads; `EvidenceEdgeBuilder` produces evidence edges; `SeedIndex` produces seed ids; `RecallRouter` produces evidence/candidate/status results.
- Consumers: `GraphStore` consumes contracts; `EvidenceResolver` consumes nodes/edges/payloads; `ToolFacade` consumes core results; `HostAdapter` consumes tool facade outputs.
- APIs: `ingest_turn`、`assemble_context`、`update_config`、`partner_mem_search`、`partner_mem_recall`、`partner_mem_timeline`、`partner_mem_status`。
- Persistence: SQLite tables from project docs, plus migration metadata if implementation chooses migrations.
- Frontend/UI controls: none in A1.
- Lifecycle transitions: raw message ingested -> indexed -> candidate seed -> evidence resolved -> packet returned; blocked path -> candidate-only or empty/blocked evidence.
- Tests: positive tests for ingest/search/resolve/tools/status; negative tests for semantic-edge proof, hash mismatch, missing payload, cycles, unverified context injection.
- Legacy paths to delete: none, because no implementation exists. Forbidden old paths must still be tested by absence/source gates once code exists.

## Forbidden Shapes

- Do not create a separate message log outside `memory_nodes` + `raw_payloads` as the source of truth.
- Do not let FTS, vector search, summary, entity linking, PPR, or adapter return facts as final evidence.
- Do not let a host adapter write SQLite directly.
- Do not duplicate memory logic per harness.
- Do not put relationship arrays such as `relatedRawIds` or `relatedTasks` into node metadata as source of truth.
- Do not let an LLM decide whether a path is valid evidence.
- Do not treat `summary` text as proof.
- Do not expose private DB paths in context injection.
- Do not add compatibility aliases, fallback routes, broad wrappers, or parallel owners without explicit user approval for the exact retained item.
- Do not hard-code summary/chunk/context thresholds as product truth.

## Stop Conditions

- Stop if PR00 cannot safely establish a local `main` baseline and the user has not provided an existing upstream/base.
- Stop if Git base/head is still unavailable after PR00 and before PR01 code implementation begins.
- Stop if package manager or runtime appears and conflicts with the TypeScript/Node inference.
- Stop if SQLite FTS5 is unavailable in the selected runtime and no equivalent local SQLite FTS path is verified.
- Stop if any implementation path requires cloud service for v1 correctness.
- Stop if a tool or adapter would need to answer from candidate-only results.
- Stop if code evidence contradicts this architecture after implementation files appear.

## Verification Expectations

每个 PR 必须至少有：

- Positive tests: 证明新功能能从 `Graph Kernel` 正常工作。
- Negative tests: 证明旧形状、无证据路径、hash mismatch、cycle、candidate-only answer 不能越权。
- Source gates: `rg` 检查 forbidden strings、直接 DB bypass、adapter 直接查表、summary-as-proof 等。
- Behavior gates: 用真实 SQLite 临时库跑 ingest、recall、timeline、status、context assembly。
