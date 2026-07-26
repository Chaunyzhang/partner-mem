# Partner-Mem

Partner-Mem V1 is the complete implementation of the latest
[`docs/PRD.md`](docs/PRD.md): Hermes and OpenClaw can save finally visible
user/assistant text in the background and expose three explicit retrieval
tools. Partner-Mem failures never change the host conversation result.

V1 preserves complete original text. It does not create summaries, profiles,
facts, topics, entities, tasks, inferred relations, automatic recall, or
context injection.

## V1 route

The GitHub history contains four sequential, non-stacked stages:

1. PR #8 — canonical contracts, Harness identity mapping, and SQLite durable
   truth;
2. PR #9 — final-visible write lifecycle, exact turn pairing, explicit reply
   relations, and the internal JSONL runtime;
3. PR #10 — keyword, vector, and graph retrieval plus exactly three
   model-visible tools;
4. PR #11 — Hermes/OpenClaw adapters, deployable artifacts, install smoke
   tests, and the `1.0.0` release surface.

The deleted product route remains recoverable from GitHub commits and PRs. It
is not retained as a compatibility branch, alias, fallback, or second runtime
owner.

## Runtime requirements

- Node
  `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`（运行版本：与 OpenClaw
  `2026.7.1-2` 的官方要求一致）
- pnpm `11.5.2`（工作区依赖与 TypeScript 构建）
- Python 3.12+（仅用于 Hermes provider、测试和 artifact 构建）

Install, test, and build the core:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter partner-mem typecheck
corepack pnpm --filter partner-mem test
corepack pnpm --filter partner-mem build
```

The internal runtime entry is `dist/runtime/cli.js`. It accepts the database
path as its first argument or through `PARTNER_MEM_DB_PATH`（数据库路径：唯一
SQLite durable truth 文件）and speaks one JSON request/response per line.

## Model-visible tools

Only these tools are public:

- `partner_mem_keyword_search`（关键词检索：从完整原文 FTS/BM25 索引返回完整
  turn）
- `partner_mem_vector_search`（向量检索：按完整 turn 语义相似度返回完整原文）
- `partner_mem_graph_traverse`（图跳转：只沿宿主明确提供并已持久化的 reply
  关系返回完整原文与实际路径）

`get_node`（按正式节点读取：只供 adapter 与 core 的内部能力）、写入命令、
状态检查和旧四 Tool 都不模型可见。

## OpenClaw

Build and install the exact package shape:

```bash
corepack pnpm --filter partner-mem build
corepack pnpm --filter @partner-mem/openclaw-plugin build
cd openclaw-plugin
npm pack --pack-destination ../build
openclaw plugins install npm-pack:../build/partner-mem-openclaw-plugin-1.0.0.tgz --force
openclaw config set plugins.entries.partner-mem.hooks.allowConversationAccess true
openclaw plugins inspect partner-mem --runtime --json
```

`statePath`（Harness state 路径：只保存格式版本和稳定
`harness_id`）、`databasePath`（SQLite 文件路径）、`runtimePath`（随包运行时
入口）和 `nodePath`（Node executable）是可选 plugin config。默认 state 与
database 位于 `~/.openclaw/partner-mem/`。state 存在而 database 丢失时启动
失败，不注册第二个 Harness。

The plugin uses current typed hooks. `message_received` records final visible
inbound text. Read-only `before_agent_run` facts mark exact cron/heartbeat runs
as proactive. OpenClaw requires
`plugins.entries.partner-mem.hooks.allowConversationAccess=true`（中文翻译：
允许这个已安装插件注册受保护的 conversation hook；这里只读取 run trigger，
不保存 prompt/history）before that hook can register. `reply_payload_sending`
proves visible text, carries the official
`usageState.agentId` when available, and never writes. A successful matching
`message_sent` performs the background answer write. Missing or ambiguous
correlation is skipped instead of guessed.

## Hermes

Build and install the user provider:

```bash
corepack pnpm --filter partner-mem build:hermes
cp -R integrations/hermes/dist/partner_mem "$HERMES_HOME/plugins/partner_mem"
cd "$HERMES_HOME/plugins/partner_mem/runtime"
npm ci --omit=dev
```

Then select it in Hermes:

```yaml
memory:
  provider: partner_mem
```

Hermes keeps `state.json` and `partner-mem.sqlite` under
`$HERMES_HOME/plugins/partner_mem/data/` by default. The provider's
`sync_turn()` queues one non-retrying single-worker job and returns immediately.
`system_prompt_block()` and `prefetch()` remain empty; Partner-Mem does not
enter model context unless the Agent explicitly calls one of the three tools.

## Embeddings

Vector retrieval is deployment-configured through:

- `PARTNER_MEM_EMBEDDING_ENDPOINT`（OpenAI-compatible embeddings endpoint）
- `PARTNER_MEM_EMBEDDING_MODEL`（部署模型名）
- `PARTNER_MEM_EMBEDDING_PROVIDER_ID`（可重建向量索引的 provider 标识；默认
  `openai-compatible`）
- `PARTNER_MEM_EMBEDDING_API_KEY`（只发给 endpoint，不持久化）
- `PARTNER_MEM_EMBEDDING_DIMENSIONS`（可选正整数维度）
- `PARTNER_MEM_EMBEDDING_TIMEOUT_MS`（可选正整数超时毫秒）

Endpoint and model must be configured together. Without them, keyword and
graph retrieval still work; vector retrieval returns the stable
`embedding_unavailable` error envelope when an embedding is required.

## Failure and V1 boundaries

Adapters send each write command at most once. They do not retry, replay,
restart a failed child runtime, inspect SQLite, infer identity, or repair
content. Runtime, database, or embedding failures are logged or returned as a
stable Tool error and do not block host chat.

Only host-provided text and structure are stored. Missing message/thread/time
fields remain absent. OpenClaw media-only hidden speech, reasoning,
commentary, status/fallback notices, failed deliveries, missing sessions, and
ambiguous concurrent replies are not persisted. Attachments and binary media
are outside V1.
