# Partner-Mem OpenClaw plugin

This OpenClaw `2026.7.1-2` plugin stores only host-proven, finally visible text
and registers exactly:

- `partner_mem_keyword_search`
- `partner_mem_vector_search`
- `partner_mem_graph_traverse`

## Build and install

From the repository root:

```bash
corepack pnpm --filter partner-mem build
corepack pnpm --filter @partner-mem/openclaw-plugin build
cd openclaw-plugin
npm pack --pack-destination ../build
openclaw plugins install npm-pack:../build/partner-mem-openclaw-plugin-1.0.0.tgz --force
openclaw config set plugins.entries.partner-mem.hooks.allowConversationAccess true
openclaw plugins inspect partner-mem --runtime --json
```

`plugins.entries.partner-mem.hooks.allowConversationAccess`（conversation
hook permission：允许这个已安装的非 bundled plugin 注册 OpenClaw 受保护的
conversation hooks）必须为 `true`，否则 OpenClaw 会阻止
`before_agent_run`。Partner-Mem 只读取该 hook 的 `trigger`、`sessionKey`、
`runId` 和 `agentId`，不保存 hook 提供的 prompt 或 history。

The npm package contains the compiled plugin, manifest, canonical Tool schema,
Partner-Mem runtime closure, and all SQLite migrations. OpenClaw installs the
declared runtime dependencies in its managed plugin project.

## Configuration

- `statePath`: stable `harness_id` state file.
- `databasePath`: Partner-Mem SQLite file.
- `runtimePath`: bundled JSONL runtime entry.
- `nodePath`: Node executable.

Defaults are under `~/.openclaw/partner-mem/`. If state exists but its database
is missing, activation fails without registering another Harness. Embedding
configuration is inherited by the child runtime through
`PARTNER_MEM_EMBEDDING_*`.

## Lifecycle

The plugin uses current typed `api.on(...)` hooks:

- `message_received` queues visible inbound original text.
- `before_agent_run` records no memory; an exact `cron` or `heartbeat`
  `sessionKey + runId` is the only proactive/no-question proof.
- `reply_payload_sending` records no memory; it only proves that an outbound
  payload contains visible text rather than hidden audio, reasoning,
  commentary, or status content, and carries the host's
  `usageState.agentId` when available.
- successful `message_sent` queues the matching visible answer, with
  `source_agent_id` and `source_access_agent_id` bound from that host fact.
- `gateway_start` initializes the one stable Harness state.

Missing sessions, ambiguous concurrent pending turns, failed delivery, hidden
speech, blank content, and payload/message mismatches are skipped. Host
`messageId + replyToId` facts are sent to the core `record_reply` command after
the reply source text is stored. A host-proven proactive run creates an
answer-only node with `question_was_absent: true`; absence of a pending question
alone is never treated as proof. The adapter does not use `agent_end`, write
SQL, generate formal IDs, retry/replay failed writes, restart a failed child,
or inject Partner-Mem automatically into model context.
