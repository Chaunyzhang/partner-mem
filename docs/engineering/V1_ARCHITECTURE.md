# Partner-Mem V1 工程架构

## 1. 结论与用户效果

确认模式为 `Clean Foundation Strict`（中文翻译：按最新 PRD 从零建立唯一正常路径，旧路线直接删除且不保留兼容入口）。

用户最终得到的是一个跨 Harness 使用的原文存储与检索内核：只记录已经最终显示的用户问题和助手回答；同一宿主轮次落在一个节点；检索直接返回完整原文；没有摘要、画像、事实抽取、主题推断或自动跨会话补充。

`Harness`（中文翻译：承载 Agent 对话的宿主产品，例如 Hermes 或 OpenClaw）只负责报告宿主生命周期事实。Partner-Mem 内核是身份映射、持久节点、显式回复关系、检索权限和 Tool 结果的唯一 owner（中文翻译：唯一有权决定这些事实的代码）。

## 2. Code Evidence

以下证据来自替换前的 `origin/main@7df6bb5c60b74e5283ec3908fddd65acaf799b80`：

- `src/core/contracts.ts` 定义 `summary | entity | task | event | decision` 等旧节点，以及 semantic/revision/temporal 边，证明旧领域模型超出最新 PRD。
- `src/ingest/raw-ingest.ts` 为每条消息创建独立节点并自动创建 `RAW_NEAR_RAW`、`FOLLOWS`，证明旧写入模型不是“每轮一个问答节点”。
- `src/extraction/*` 和 `openclaw-plugin/src/model-client.ts` 拥有正文抽取与派生图写入，证明存在 PRD 明确禁止的第二内容 owner。
- `src/tools/tool-contracts.ts` 暴露 `partner_mem_search`、`partner_mem_recall`、`partner_mem_timeline`、`partner_mem_status`，证明公开 Tool 契约与最新 PRD 的三个 Tool 不同。
- `src/runtime/runtime-contracts.ts` 以原始 `agent_id + session_id` 作为运行身份，证明缺少 Partner-Mem 生成的 `harness_id + conversation_id` 正式边界。
- `integrations/hermes/partner_mem/provider.py` 与 `openclaw-plugin/src/hooks.ts` 证明旧仓库已有可复用的宿主插件与后台执行经验，但其身份、写入和工具语义需要整体替换。
- `test/**`、`integrations/hermes/tests/**`、`openclaw-plugin/test/**` 共 269 条基线测试通过，证明旧路线在自身契约下可运行；这不证明其符合最新 PRD。

最新产品证据：

- [`../PRD.md`](../PRD.md) 是唯一正式产品定义。
- [`../research/content-retrieval-evidence.md`](../research/content-retrieval-evidence.md) 证明最终证据必须回到完整原文。
- [`../research/retrieval-tools.md`](../research/retrieval-tools.md) 证明 keyword、vector、graph 应作为三个独立检索原语。

## 3. 证据、推断、未知与用户要求

### 3.1 已验证证据

- GitHub 仓库保留旧路线完整提交和已合并 PR，因此替换不需要创建额外备份。
- 当前工具链在 Node 22 上通过 TypeScript、Vitest、Hermes Python 和 OpenClaw 测试。
- SQLite FTS5 官方支持 `bm25()`（中文翻译：按词频与文档频率排序的全文相关度函数）和 `trigram` tokenizer（中文翻译：按连续三个字符建立索引，适合中文与片段搜索）。
- Hermes 官方 `sync_turn()`（中文翻译：完整轮次结束后的持久化回调）必须非阻塞。
- OpenClaw 官方 `message_received`（中文翻译：收到最终入站消息后的观察回调）和 `message_sent`（中文翻译：出站消息最终投递成功或失败后的观察回调）比 `agent_end` 更能证明“最终可见”。

### 3.2 工程推断

- 本地优先 V1 不需要独立数据库服务；SQLite 足以同时承载事实表、FTS5 和可重建向量表。
- V1 向量规模未知，因此先采用精确 cosine scan（中文翻译：逐条计算余弦距离，结果准确但规模很大时会变慢），不提前引入 ANN（中文翻译：以近似结果换速度的向量索引）复杂度。
- `agent_conversation_access`（中文翻译：记录某个正式 Agent 可访问哪些正式 conversation）必须由适配器提供的宿主身份事实产生，不能从正文或节点相似度推断。

### 3.3 仍由部署决定的未知

- 生产 embedding endpoint（中文翻译：把查询或轮次原文转换成向量的服务地址）、model（模型名）和 dimensions（向量维度）不是产品事实。内核提供 `EmbeddingProvider` 契约；适配器配置具体服务；缺失或不可用时 vector Tool 返回稳定 `error`，不得伪造结果。
- Hermes 与 OpenClaw 不同渠道能提供哪些 `message_id`、`thread_id`、`visible_at` 和显示顺序取决于宿主。缺失时保存 `null`，不得用后台时间或数组位置替代。

### 3.4 用户要求

- 按最新 PRD 完成全部 V1。
- 每个阶段独立 PR，验证后合并，再从新的 `main` 开始下一阶段。
- 旧代码只要 GitHub 历史可恢复即可直接替换；该条件已经满足。

## 4. 技术选型

- Node.js `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`（中文翻译：内核运行环境）：与 OpenClaw `2026.7.1-2` 的官方 engine contract 完全一致。
- TypeScript `5.9.x`（中文翻译：严格类型语言）：负责共享契约、内核、runtime 和 OpenClaw 插件。
- `@photostructure/sqlite` `2.2.x`（中文翻译：Node 的同步 SQLite 驱动）：唯一持久化进程内 owner。
- SQLite STRICT tables（中文翻译：数据库拒绝错误字段类型的严格表）与 foreign keys（外键：保证正式 ID 关系真实存在）。
- SQLite FTS5 `trigram` + `bm25()`：关键词检索。三个及以上 Unicode 字符通过 `MATCH + bm25()` 排序；一至两个 Unicode 字符因 SQLite trigram 不产生查询 token，改在同一可重建 FTS 内容表上做逐字 substring scan（中文翻译：只处理 tokenizer 无法表达的短查询，按 `node_id` 稳定排序，不产生第二检索 owner）。
- `turn_fts`（中文翻译：每个 turn 一行的可重建全文索引）由 SQLite trigger 在节点插入和回答首次补入时同步更新；migration `003` 回填 PR #9 已存在的节点。
- `turn_fts` 自带的 scope 列不是权限真相；关键词 query 必须 join `turn_nodes`，再按 node 的正式 conversation 或 `agent_conversation_access` 授权，最后才计算去重结果和截断。
- `node_vectors`（中文翻译：每个 turn 最多一条、可全部重建的向量索引表）保存 little-endian Float32 向量、provider/model、维度与原文拼接哈希；JavaScript 做 exact cosine scan。provider 结果与已有 BLOB 都必须通过 Float32 finite/non-zero 校验，Infinity、NaN、损坏长度和非有限距离直接失败。回答首次补入时 trigger 删除旧向量，下一次 vector 查询重新生成。
- `EmbeddingProvider`（中文翻译：内核向量生成接口）使用 OpenAI-compatible `/v1/embeddings` HTTP 契约；`timeout_ms`（中文翻译：单次向量请求的有界等待时间）默认 10 秒，到期 abort 且只让 vector Tool 返回稳定错误；测试注入固定 provider，不访问网络。
- Vitest：TypeScript 单元、合同与端到端测试。
- Python `unittest`：Hermes provider 插件合同测试。
- JSONL runtime（中文翻译：Hermes Python 与唯一 Node 内核之间一行一个 JSON 请求的进程协议）；它只运输命令，不拥有业务判断。

## 5. 唯一事实与 owner

```text
Harness lifecycle facts
└── adapter（只翻译、持久保存 harness_id、后台提交）
    └── PartnerMemRuntime（验证命令和可信调用上下文）
        ├── IdentityService（来源对象 → 正式 ID）
        ├── TurnIngestService（唯一写入与精确配对）
        ├── PartnerMemStore（唯一 SQLite 事实 owner）
        └── RetrievalFacade
            ├── KeywordSearchService
            ├── VectorSearchService
            └── ReplyGraphTraversalService
```

`turn_nodes`（中文翻译：每个宿主轮次的完整原文节点）是永久内容真相。允许 question-only、answer-only 或 question+answer；禁止两侧都空；禁止覆盖已经保存的原文。

`source_object_mappings`（中文翻译：把某 Harness 的原始 conversation/thread/message/author/agent 标识稳定映射为 Partner-Mem 全局 ID）是身份真相。允许的 `object_kind` 只有 `conversation | thread | message | author | agent`；producer 是 `IdentityService`；storage 是 SQLite；consumer 是写入、权限和返回字段；模型与 UI 不得直接写它。

`explicit_reply_edges`（中文翻译：宿主明确报告的一条消息回复另一条消息）是唯一持久关系。两端必须同时保存 `node_id + message_id`，且对应消息原文已存在。禁止正文推断边、相邻边、conversation/thread 归属边。

`agent_conversation_access` 是 `agent_conversations` scope（中文翻译：当前正式 Agent 在同一 Harness 实例可访问的历史会话范围）的唯一权限事实。它只由可信适配器上下文产生。

## 6. 写入状态机与幂等

V1 不保存额外 `status` 字段。状态直接由原文是否存在表达：

```text
不存在
├── 最终用户文字 → question-only node
└── 已确认无问题的最终助手文字 → answer-only node

question-only node
└── node_id 或精确 message mapping → question+answer node

answer-only / question+answer
└── 再次写 answer → reject；不得覆盖
```

重复请求不建立 receipt、retry 或 duplicate 状态。相同来源 message ID 解析回相同正式 message ID；相同已保存正文返回原节点；不同正文冲突时拒绝。适配器进程内可以保留 host turn → `node_id` 临时映射，但不得持久保存为产品图数据。

刷新、重启和重复投递的证明：

- refresh：重新读 SQLite 正式映射；
- adapter restart：插件配置中的 `harness_id` 保持不变；
- worker restart：只有精确 source message mapping 可以恢复配对；
- repeated submission：同 message mapping 不新增节点、不覆盖正文；
- write failure：不重试、不阻塞、不改变 Harness 对话。

## 7. 删除与禁止

删除的旧 owner：`GraphStore` 旧图领域、`RawIngestService`、`RevisionTracker`、整个 extraction/evidence/recall/context 旧链路、旧 runtime 命令、旧 Harness adapters。

删除的旧 public surface：`partner_mem_search`、`partner_mem_recall`、`partner_mem_timeline`、`partner_mem_status`、自动 context 注入、模型可见写入或 status。

删除的旧字段与类型：node type/status、topic、sequence、revision、validity window、summary payload、normalized text、token count、candidate/evidence audit、semantic/temporal/navigation edge、人工 turn index。

禁止保留的形状：alias Tool、兼容 schema、旧数据库自动迁移、正文推断、时间邻近配对、数组位置配对、自动跨 conversation fallback、hybrid/RRF、模型提交正式身份、模型可见 `get_node`。

旧 GitHub 提交是 historical fact only（中文翻译：只用于查看历史，不参与当前运行决策）。

## 8. 实施顺序

1. PR #8：建立正式契约、SQLite schema、身份映射和 construction sheets；删除全部旧 owner。
2. PR #9：实现最终可见写入、精确补充、显式回复边和内部 runtime。
3. PR #10：实现关键词、向量、图检索与仅三个模型 Tool。
4. PR #11：实现 Hermes/OpenClaw 适配、打包与端到端门禁。

每个 PR 必须先合并到 `main`，下一 PR 才从新的 `origin/main` 创建；不做 stacked PR。

### 8.1 PR #11 adapter 边界

`invoke_tool`（中文翻译：adapter 把一个已注册公开 Tool 调用交给内核的内部
JSONL 命令）只接受 adapter 持久化的 `harness_id`、宿主可信
`source_conversation_id`、可选 `source_agent_id`、三个 canonical
`tool_name` 之一和模型业务 `arguments`。正式 conversation/agent ID、权限和
envelope 全部由 runtime/store/facade 决定。

Hermes `PartnerMemMemoryProvider`（中文翻译：Hermes 最终 turn 生命周期到
JSONL 的薄翻译层）使用 daemon single-worker queue；`sync_turn()` 立即返回，
问题写成功后才用精确 `node_id` 写回答。state 与 database 默认同置于当前
Hermes home；重启复用同一 `harness_id`。

OpenClaw plugin（中文翻译：OpenClaw 最终消息生命周期与 Tool 的薄翻译层）
使用当前 typed `api.on(...)` hooks。`message_received` 保存入站最终可见原文；
operator 必须启用
`plugins.entries.partner-mem.hooks.allowConversationAccess`（中文翻译：允许该
非 bundled plugin 注册受保护 conversation hook 的 OpenClaw 部署权限）；
只读 `before_agent_run` 用精确 `sessionKey + runId` 标记 `cron`/`heartbeat`
主动 run，不写数据；其他 trigger 或缺少精确字段都不能证明 answer-only。
`reply_payload_sending` 只证明出站 payload 是否存在可见文字并排除 audio-only
hidden transcript、reasoning/commentary/status，并在存在时携带官方
`usageState.agentId`；成功 `message_sent` 才安排回答写入并把该 Agent 来源同时
作为回答身份和 conversation access。`sessionKey` 或配对证据缺失/歧义时跳过，
不按时间、正文或数组位置猜测。
宿主提供的 inbound `replyToId + messageId` 经唯一 `record_reply` core command
保存为显式关系。

两个 adapter 都只持有稳定 state、临时 turn correlation 和有界单子进程运输；
它们不导入 SQLite driver、store、ingest/retrieval service，不自动 retry、
replay 或 restart。OpenClaw npm tarball 与 Hermes user-plugin artifact 都内含
runtime closure、migrations 和 canonical Tool schema，并经过仓库外安装、官方
host discovery/load 与真实 runtime start smoke。

## 9. 验证与停止条件

每阶段运行 targeted tests、typecheck、build、完整测试和 `git diff --check`。涉及旧逻辑删除的阶段必须同时有：

- Source gate（中文翻译：扫描正常源码中是否还有禁止形状）；
- Behavior gate（中文翻译：真正运行代码证明旧路径不能工作）；
- Negative test（中文翻译：故意提交无效或旧请求，必须被拒绝）。

停止条件：

- PRD 与宿主一手接口无法同时满足；
- 需要模型或 UI 成为身份、生命周期或权限 owner；
- 相关测试失败；
- 工作区出现无法与本阶段隔离的用户改动；
- GitHub 历史不可恢复、分支基线错误或 PR diff 超出 construction sheet。
