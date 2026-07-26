# PR #11 Construction Sheet：V1 Harness Adapters and Release

## 1. 基本信息

- 确认模式：`Clean Foundation Strict`（中文翻译：最新 `docs/PRD.md` 是唯一正常路线；不保留旧 adapter、旧 Tool、旧自动注入、兼容入口或第二业务 owner）。
- 新 PR：是，GitHub PR #11。
- exact base：`main@20ac942cb166e49cda99cfe3af93ce239439abb1`，即已合并 PR #10。
- exact branch：`agent/v1-harness-adapters`。
- head：本施工单不预造；提交后记录实际 commit。
- stacked policy：禁止；PR 直接以 `main` 为 base。
- dirty-worktree policy：创建分支前必须 clean；本 PR 只提交施工单允许的源文件、测试、manifest、lockfile 和文档，不提交数据库、`dist`、构建包、缓存、日志、截图或临时 state。
- commit/push/PR/merge：用户已授权；本地全部门禁和 GitHub CI 通过后提交、推送、创建 PR 并 merge。
- pre-branch stop condition：base 不是上述 merge commit、GitHub 历史不能恢复旧版本、官方 Harness 接口不能证明最终可见时停止。建分支前已确认 base 与远端历史满足要求。
- 版本：root、OpenClaw package 与 Hermes package artifact 都是 `1.0.0`（中文翻译：四阶段闭环完成后的首个 V1 发布版本）。

## 2. 用户效果与 canonical owner

用户在 Hermes 或 OpenClaw 中正常聊天时，只要最终可见的用户文字和成功送达的助手文字被 Harness 生命周期提供，Partner-Mem 就在后台保存完整原文；Partner-Mem 慢、退出或报错都不改变聊天结果。Agent 只看到三个检索 Tool，默认检索当前聊天，且 Tool 失败只得到稳定 `status: error` envelope。

唯一业务 owners：

- `PartnerMemRuntime`（中文翻译：唯一 JSONL 命令分发者；把来源对象解析为正式身份后调用写入或检索 owner）。
- `TurnIngestService`（中文翻译：唯一问题建节点、回答精确补入、显式 reply 落库 owner）。
- `RetrievalFacade`（中文翻译：唯一 Tool 输入、可信身份、三检索服务与统一 envelope owner）。
- `PartnerMemStore`（中文翻译：唯一 SQLite 与来源对象映射 owner）。

Harness domain wrappers：

- Hermes `PartnerMemProvider`（中文翻译：把 `MemoryProvider` 生命周期翻译成 JSONL 命令；不拥有 SQL、配对规则、检索权限或节点状态）。
- OpenClaw plugin（中文翻译：观察最终入站文字与成功送达的出站文字，注册 Tool，并把可信 hook context 翻译成 JSONL 命令；不拥有业务判断）。
- 两端 `RuntimeClient`（中文翻译：一个请求对应一行 JSON、一个响应对应一行 JSON 的进程运输层；不自动 retry，不修复模型输出，不解析数据库）。

适配器可以在当前进程持有“宿主 turn → `node_id`”临时 map；它不是长期图数据，不得落数据库或在重启后用于猜测配对。

## 3. Code Evidence

已检查并作为实现依据：

- `docs/PRD.md` 2.1–2.7：证明 Harness 稳定隔离、最终可见写入、question/answer 精确归组、只保存原文、三个 Tool 和失败不影响聊天。
- `src/runtime/runtime-contracts.ts`：证明 PR #10 合并后的内部命令只有注册、写入与 `get_node`；本 PR 必须新增唯一 `invoke_tool` 运输命令，不能让 adapter 自己构造正式 ID。
- `src/ingest/turn-ingest-service.ts`：证明 `record_question`、`record_answer`、`record_reply` 已拥有幂等来源 message 映射和第二回答禁止规则；adapter 不能复制这些判断。
- `src/tools/tool-contracts.ts` 与 `src/tools/generated/tool-schemas.json`：证明模型可见名称和输入 schema 的唯一 artifact 恰好是 `partner_mem_keyword_search`、`partner_mem_vector_search`、`partner_mem_graph_traverse`。
- `src/tools/retrieval-facade.ts`：证明 Tool 错误已统一为 `invalid_tool_input | trusted_identity_invalid | embedding_unavailable | partner_mem_unavailable`。
- `src/embedding/openai-compatible-provider.ts`：证明 vector provider 已有超时、响应和维度校验；adapter 只提供部署配置，不可另写向量 owner。
- OpenClaw `2026.7.1-2` 官方类型 `PluginHookMessageReceivedEvent`、`PluginHookReplyPayloadSendingEvent`、`PluginHookMessageSentEvent`、`PluginHookMessageContext`：证明 `message_sent.success` 是送达结果，`sessionKey` 是当前可用的出入站 conversation 关联字段；官方说明出站 `runId` 尚未贯通，且 audio-only 的 `message_sent.content` 可能是未显示的 spoken transcript，因此不得依赖 `runId` 猜配对，也不得仅凭非空 `message_sent.content` 判断文字可见。
- OpenClaw 官方 plugin SDK：证明 `definePluginEntry(...)`、`api.registerTool(...)` 和 hook 注册是当前第三方 plugin 入口；manifest `contracts.tools` 必须与实际注册一致。
- Hermes Agent `529ae164ae961588b2318540c3a5d7be88e84cc2` 的 `agent/memory_provider.py`、`agent/memory_manager.py` 和 `plugins/memory/__init__.py`：证明用户 provider 从 `$HERMES_HOME/plugins/<name>/` 发现，`sync_turn(...)` 必须 non-blocking，`get_tool_schemas()` 返回 bare OpenAI function schema，`handle_tool_call()` 返回 JSON string，`initialize()` 提供 `hermes_home` 与可选 `agent_identity`，`on_session_switch()` 是 conversation ID 变更 seam。

当前 `main` 中不存在 Hermes/OpenClaw adapter 源码；旧 adapter 只存在于 Git 历史。证据不支持恢复旧 capture buffer、extractor/model client、四 Tool、自动 recall/prefetch 或重试客户端。

## 4. Exact scope

允许新增/修改：

- `src/runtime/**`
- `src/index.ts`
- `test/runtime/**`
- `integrations/hermes/**`
- `openclaw-plugin/**`
- `test/adapters/**`
- `scripts/**` 中仅 adapter 构建、schema 同步和 package smoke 脚本
- `.github/workflows/ci.yml`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `.gitignore`
- `README.md`
- `docs/engineering/PR11_V1_HARNESS_ADAPTERS.md`
- `docs/engineering/V1_ARCHITECTURE.md`

禁止修改：

- `docs/PRD.md` 的产品语义。
- `src/core/**`、`src/storage/**`、`src/ingest/**`、`src/retrieval/**`、`src/tools/**` 与 migrations 的既有业务规则；只有 adapter 消费，不得复制或绕过。
- 旧路线 Git 历史。
- 自动 context 注入、自动 prefetch、summary、抽取、profile、长期事实、hybrid/RRF 或推断 relation。
- 新增 package dependency，除当前官方 OpenClaw SDK/type contract 或构建发布确实要求的最小依赖。

## 5. Runtime public contract

### 5.1 `invoke_tool`

新增内部 `invoke_tool`（中文翻译：Harness 调一个模型可见 Tool 时使用的 JSONL 运输命令；它本身不模型可见）：

- `harness_id`（中文翻译：当前 adapter 安装实例的 Partner-Mem 正式隔离 ID）必填；producer 是 adapter 持久 state；storage 是 `harness_instances`；consumer 是 runtime/store/retrieval authorization；模型不得提交或覆盖。
- `source_conversation_id`（中文翻译：Harness 官方生命周期提供的原始聊天 ID）必填；producer 是 trusted hook/provider context；不直接写入节点；runtime 通过 `source_object_mappings` 生成/解析正式 `conversation_id`。
- `source_agent_id`（中文翻译：当前 Harness Agent 的原始身份）可选；producer 是 trusted hook/provider context；runtime 解析为正式 `agent_id` 并只用于已确认的 Agent conversation access；不得从正文、Tool 参数或 `answer_agent_id` 猜测。
- `tool_name`（中文翻译：要调用的三个公开 Tool 之一）只允许 PR #10 三个名称；producer 是已注册 Tool wrapper；consumer 是 `RetrievalFacade`。
- `arguments`（中文翻译：模型只可控制的 Tool 业务参数）必须是 object；由 PR #10 schema/facade 严格校验；不得包含任何正式或来源身份字段。

Runtime 在同一 transaction 内验证 Harness、解析 conversation/agent 映射并授予当前可信 Agent 对当前 conversation 的访问，再把正式 `TrustedRetrievalIdentity` 交给 `RetrievalFacade`。adapter 永远看不到或决定正式 `conversation_id`/`agent_id`。

`PartnerMemRuntime.handle(...)`（中文翻译：JSONL request 的唯一执行入口）改为 async，以等待 vector Tool；写入命令仍同步完成内部事务。`serveJsonLines(...)` 必须按输入行顺序 await，保持同一子进程请求的确定顺序。

### 5.2 Embedding deployment fields

CLI 从进程环境读取：

- `PARTNER_MEM_EMBEDDING_ENDPOINT`（中文翻译：OpenAI-compatible embeddings HTTP 地址）与 `PARTNER_MEM_EMBEDDING_MODEL`（中文翻译：部署选择的 embedding model）必须同时出现；都缺失时 vector Tool 在有候选需要 embedding 时返回 `embedding_unavailable`。
- `PARTNER_MEM_EMBEDDING_PROVIDER_ID`（中文翻译：索引失效判断用的部署标识）可选，默认 `openai-compatible`。
- `PARTNER_MEM_EMBEDDING_API_KEY`（中文翻译：只发给 embedding endpoint 的 bearer secret）可选；不持久化、不输出、不进入 Tool schema。
- `PARTNER_MEM_EMBEDDING_DIMENSIONS`（中文翻译：可选的正整数预期维度）与 `PARTNER_MEM_EMBEDDING_TIMEOUT_MS`（中文翻译：单请求正整数毫秒超时）可选；错误配置启动失败，不猜默认修复。

## 6. Harness state、lifecycle 与幂等性

### 6.1 Stable Harness state

每个 adapter 的 `state.json`（中文翻译：该安装实例唯一持久的 Harness 注册结果）只保存 `harness_id` 和必要格式版本：

- 第一次初始化：启动一次 runtime，调用一次 `register_harness`，收到正式 ID 后以 temp file + atomic rename 持久化。
- 普通重启、refresh、session switch、retrying host callback：读取并复用同一个 ID；不得再次注册、随机生成、用 `harness_type` 代替或从路径推导。
- state 与数据库默认位于同一 adapter-owned profile 目录。state 存在但数据库丢失/不匹配时请求失败并记录；禁止无声注册第二 Harness。
- 并发 initialize 通过 adapter 内单一 ready promise/lock 合并；不能创建两个 state。

Hermes state 位于 active `hermes_home` 下的 Partner-Mem provider data 目录；OpenClaw state 位于 plugin-owned state/config 路径。所有路径可以由部署 config 明确覆盖，但 adapter 不修改宿主全局 config。

### 6.2 Hermes

- `initialize(session_id, **kwargs)`：`session_id`（中文翻译：当前 Hermes conversation source ID）保存到进程内；`agent_identity`（中文翻译：当前 Hermes profile/Agent source ID）可选保存；`hermes_home` 决定默认 state/database 路径；非 `primary` agent context 不写入。
- `sync_turn(user_content, assistant_content, session_id="", messages=None)`：返回前只向 daemon single-worker queue 投递一个不可重试 job；worker 先 `record_question`，成功拿到本进程 `node_id` 后再 `record_answer`。每个 JSONL command 最多发送一次。任一失败只 log，后续命令不得补写本次失败。
- `system_prompt_block()`、`prefetch()` 返回空，`queue_prefetch()` no-op；Partner-Mem 不自动进入上下文。
- `on_session_switch(new_session_id, ...)` 原子更新当前 source conversation；不得把新 session 与旧节点 map 合并。
- `get_tool_schemas()` 只把 canonical artifact 的 `inputSchema` 投影为 Hermes `parameters`；名称/描述/字段不得重画。
- `handle_tool_call(tool_name, args, **kwargs)` 调 `invoke_tool`，返回 JSON string；runtime/transport error 转成相应 retrieval type 的 `partner_mem_unavailable` envelope，不抛出终止对话。
- `shutdown()` 停止接受新 job、有限清理进程资源；不得为了未完成写入无限阻塞宿主退出，也不得在 shutdown retry。

### 6.3 OpenClaw

- `gateway_start` 初始化 single ready promise；hook/tool 也可以安全 lazy-await 同一 promise。
- OpenClaw 使用当前 typed `api.on(...)`（中文翻译：由官方 `PluginHookHandlerMap` 校验 event/context 的 hook 注册 API），删除 `registerHook` generic compatibility 入口与旧 payload normalization。
- `plugins.entries.partner-mem.hooks.allowConversationAccess`（中文翻译：OpenClaw 允许非 bundled plugin 注册受保护 conversation hooks 的部署权限）必须为 `true`；producer 是 operator 配置，storage 是 OpenClaw config，consumer 是官方 hook registry，UI/CLI projection 是 plugin runtime inspection。允许行为仅为注册 `before_agent_run`；Partner-Mem 不读取或保存该 event 的 prompt/history。缺失或 `false` 时必须由官方 host 阻止该 hook 并在 inspection 暴露 diagnostic，不得加绕过入口。
- `before_agent_run`（中文翻译：Agent run 开始前只读宿主事实）只在 `ctx.trigger` 精确为 `cron` 或 `heartbeat` 且同时存在 `sessionKey + runId` 时保存一次有界的 proactive proof；不写 Partner-Mem。其他 trigger、字段缺失、仅仅 pending map 为空都不得解释为“没有用户问题”。
- `message_received` 只接受 trim 后非空的 `event.content`；`ctx.sessionKey` 是必需 source conversation；使用 hook 提供的 source message/sender/thread/time/reply 字段，不用本地当前时间伪造宿主显示时间。入站同时提供 `messageId + replyToId` 时，在来源文字成功保存后调用一次 core `record_reply`；任一端尚无已保存原文时由 core 拒绝，adapter 不补写或猜测。
- 入站 hook 立即把一次后台 job 安排进 per-session serial queue 后返回；job 发一次 `record_question`，并把 Promise/`node_id` 只存当前进程的 pending map。
- `reply_payload_sending`（中文翻译：送达前的规范化 payload 观察点）只保存当前进程 visibility proof，不写 Partner-Mem；`payload.text` 非空且不是 reasoning/commentary/status/compaction/fallback 才是可见文字。只有 media + `spokenText` 而没有 `text` 是 hidden transcript，必须标记为不可写。存在 `usageState.agentId` 时保留为官方回答 Agent 来源；回答写入同时提交相同的 `source_agent_id` 与 `source_access_agent_id`，正式 Agent ID 和授权仍只由 core 解析。
- `message_sent` 只在 `event.success === true`、trim 后 `event.content` 非空、存在匹配 visibility proof 且 `ctx.sessionKey` 存在时安排后台 job。当前官方出站 `runId` 不可依赖；只允许精确 run proof，或同一 `sessionKey` 下唯一未消费 visibility/pending question 关联。并发、不唯一、payload/text 不匹配时不得按时间、数组位置或正文猜测。
- 明确由 host context 证明没有用户问题的主动发送才可 `question_was_absent: true` 创建 answer-only；没有该证明且 pending map 丢失时跳过，不猜。
- `agent_end`、`message_sending`、stream chunk、tool event、internal event 不写入；`message_sent.success === false` 不写入；media-only、audio-only/hidden transcript 且无可见 `content` 不写入。
- Tool wrapper await `invoke_tool` 并返回 canonical envelope；失败转稳定 error envelope。Tool 调用不得排队在写入 job 后面而阻塞正常推理。
- runtime child 退出后不自动 restart；后续调用返回 unavailable。plugin lifecycle stop 只关闭资源，不重放写入。

## 7. Tool registration and package contracts

- `src/tools/generated/tool-schemas.json` 是名称、描述和输入 schema 的唯一生成源。
- Hermes generated schema 只能是 `name`、`description`、`parameters` 三字段投影。
- OpenClaw `openclaw.plugin.json.contracts.tools`、`api.registerTool(...)` 与 canonical artifact 名称集合必须 deep-equal。
- `get_node`、status、index/maintenance、write command 和 `node_id` write result 均不得模型可见。
- 两个 adapter package 都必须包含运行所需 Node runtime、migrations 和 canonical Tool schema，或声明并在安装 smoke 中验证唯一明确的 runtime package dependency；不得依赖仓库工作区的未发布相对路径。
- Node engine 与当前 OpenClaw `2026.7.1-2` requirement 对齐：`>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`。
- OpenClaw package 使用官方 current SDK 类型编译并产出 host 可加载 JS、manifest 与 `package.json`；`peerDependencies.openclaw` 固定为已验证的 `2026.7.1-2`，`openclaw.compat.pluginApi`/`minGatewayVersion` 声明相同 current floor，`activation.onStartup: true` 保证消息观察 hook 在 Gateway 启动时加载。
- Hermes artifact 安装到 `$HERMES_HOME/plugins/partner_mem/` 后可被官方 discovery 识别；Python 标准库以外不新增运行依赖。

## 8. Old path disposition

以下旧公开面和 owners：`delete`，只允许出现在本施工单、历史说明或负向 source gate：

- `partner_mem_search`
- `partner_mem_recall`
- `partner_mem_timeline`
- `partner_mem_status`
- `memory.capture_turn`
- `memory.assemble_context`
- 旧 `tools.invoke`
- capture buffer
- extractor/model client
- auto prefetch/recall/context injection
- summary/memory capability prompt
- runtime client retry
- adapter SQL/domain write

当前 `main` 没有这些 adapter 文件；其 disposition 是 Git 历史中的 `historical fact only`。禁止恢复任何旧 owner、alias、fallback 或 deprecated wrapper。

## 9. Implementation order

1. 扩展 runtime async `invoke_tool`，在内核解析 trusted source identity，并从环境配置唯一 embedding provider。
2. 建 Hermes runtime client、stable state、background writer、provider 与 canonical schema 投影。
3. 建 OpenClaw runtime client、stable state、hook correlation、Tool wrappers、manifest。
4. 建 adapter package/runtime closure 与 build/install smoke。
5. 建 root-to-adapter E2E、source gates、schema/manifest deep equality 和 failure tests。
6. 更新 workspace、版本、README、architecture、CI。
7. targeted tests → 三套 full tests → typecheck → build → package smoke → source/behavior/diff gates。
8. 按 Lore commit，push，创建 PR #11；GitHub CI green 后 merge，再审计远端 `main`。

## 10. Positive tests

- Runtime 将 raw conversation/agent ID 映射为正式 ID 后调用三个 Tool；模型参数无法提交 identity。
- 同一个 adapter state 重启后 `harness_id` 不变；两个 state 使用相同 raw conversation/message ID 仍生成隔离节点。
- Hermes `sync_turn` 立即返回；后台问题+答案构成一个节点；session switch 后写入新 conversation。
- OpenClaw final inbound + successful delivered outbound 构成一个节点；重复 host event 通过来源 message 映射保持同节点且不覆盖。
- question-only 永久保留；有 host 明确证据的 proactive answer-only 可写。
- Hermes/OpenClaw schema、manifest 与 runtime registration 恰好三个 Tool。
- 三 Tool 经两种 adapter 均返回 canonical full-turn envelope。
- embedding config 完整时 vector Tool 可调用；未配置时不影响 keyword/graph/chat。
- root、OpenClaw、Hermes build/package/install/discovery smoke。

## 11. Negative tests

- delivery failure、cancel、stream chunk、tool/internal/agent-end、media-only、hidden transcript 不写。
- `sessionKey` 缺失、pending turn 歧义、map 丢失且没有精确来源 anchor 时不猜问题，不创建 answer-only。
- Partner-Mem/runtime/embedding 不可用不抛进宿主聊天流程。
- 写入 command 每个最多发送一次；child exit 不 restart；不存在 retry/backoff/replay queue。
- adapter 不解析或写 SQLite，不生成正式 ID，不拥有第二回答/覆盖/跨 conversation 授权判断。
- adapter 不返回 write success/`node_id` 给宿主；Tool wrapper 之外不暴露 Partner-Mem 状态。
- 模型不可见 `harness_id`、source/formal conversation/agent ID、`get_node`、旧四 Tool 或 write command。
- 不从 message 数组位置、时间邻近、正文相似度、role label、thread name 推断同 turn。
- state 存在而 DB 不匹配时失败，不静默注册第二 Harness。
- 旧 adapter owner、旧 tool names、自动注入、retry source pattern 不能重新进入正常路径。

## 12. Source gates、behavior gates 与机械验收

Source gates：

- adapter 目录不得 import SQLite driver、`PartnerMemStore`、`TurnIngestService` 或 retrieval service。
- `api.registerTool`、Hermes schema、OpenClaw manifest 的名称集合严格等于 canonical artifact。
- 除负向测试/施工单外不存在旧 Tool、auto injection、retry/backoff/replay owner。
- adapter 不包含 SQL statement、正文分类/提取 prompt、summary/profile schema 或自动 host history scan。

Behavior gates：

- 同一真实 adapter consumer 的 restart、refresh、duplicate callback、session switch、child exit、runtime unavailable 行为通过测试。
- core runtime 的 register/write/get-node/invoke-tool 顺序、async JSONL 和 malformed-line recovery 通过测试。
- 三个 Tool 通过 Hermes 与 OpenClaw 两个真实 consumer 的不同 identity/data 调用；两个 consumer 都复用同一 canonical schema。
- 负向测试证明旧命令、旧 Tool 和身份注入不能执行、不能检索、不能投影为正常动作。

机械验收：

- [x] root 与 adapter manifests 均为 `1.0.0`。
- [x] root `typecheck`、full tests、build 通过。
- [x] OpenClaw typecheck、tests、build、pack/install/load smoke 通过。
- [x] Hermes Python tests、artifact build、install/discovery smoke 通过。
- [x] generated schema/manifest deep-equal。
- [x] CI 覆盖 root + OpenClaw + Hermes + package smoke。
- [x] README 包含安装、配置、embedding、数据位置、失败语义、无自动注入与 V1 限制。
- [x] `git diff --check`、name-status/stat、所有 changed files audit 通过。
- [ ] GitHub CI green；PR #11 合并；远端 `main`、`origin/HEAD` 指向同一 V1 merge commit。
- [ ] GitHub PR #8–#11 顺序可见，旧版本可由历史 commit/PR 恢复，repo 正常源路径只含最新 PRD 路线。

## 13. Explicit failure conditions

满足任一条件禁止提交或合并：

- 官方 Harness 接口不能证明最终可见或可靠 conversation identity，却用时间、数组或正文猜测。
- adapter 成为第二持久 owner、直接写 SQL、生成正式 ID 或解释 Tool 权限。
- stable Harness state 无法经过真实 restart/package install smoke。
- package 依赖仓库外未声明文件或安装后不能启动 runtime。
- 任一 write path retry/replay、任一 failure 阻塞正常聊天、任一旧 Tool/owner 可执行。
- 相关 targeted/full/CI 测试失败，或只用 source-text test 声称行为完成。
