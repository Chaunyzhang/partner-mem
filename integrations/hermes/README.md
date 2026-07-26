# Partner-Mem Hermes adapter

This directory is a Hermes user-installed memory provider. Install the built
artifact into:

```text
$HERMES_HOME/plugins/partner_mem/
```

Build and install it from the repository root:

```bash
corepack pnpm --filter partner-mem build:hermes
cp -R integrations/hermes/dist/partner_mem "$HERMES_HOME/plugins/partner_mem"
cd "$HERMES_HOME/plugins/partner_mem/runtime"
npm ci --omit=dev
```

Then set Hermes config:

```yaml
memory:
  provider: partner_mem
```

## Runtime and data

- `state.json` stores the Partner-Mem generated `harness_id`. The provider
  writes it with temp-file plus atomic rename and reuses it after restart.
- `partner-mem.sqlite` is the default database in
  `$HERMES_HOME/plugins/partner_mem/data/`.
- `PARTNER_MEM_HERMES_STATE_PATH` can override the state path.
- `PARTNER_MEM_HERMES_DB_PATH` can override the database path.
- `PARTNER_MEM_HERMES_RUNTIME_COMMAND` can override the bundled runtime command.
- Built artifacts include `runtime/package.json`, `runtime/package-lock.json`,
  and `runtime/dist/`. Run `npm ci --omit=dev` inside `runtime/` so the adapter
  can install the runtime dependency outside the repository workspace before
  Hermes starts it.
- `PARTNER_MEM_EMBEDDING_*` configuration is inherited unchanged by the child
  runtime. Missing embedding configuration affects only vector retrieval.

If state exists but the database is missing, initialization fails instead of
registering a second Harness.

## V1 behavior

- `sync_turn()` returns after queueing one daemon single-worker job.
- The worker sends `record_question` once and then `record_answer` once when
  the question write succeeds.
- There is no retry, replay queue, runtime restart, SQL access, auto prefetch,
  context injection, summary memory, profile extraction, or old tool alias.
- `system_prompt_block()`, `prefetch()`, and `queue_prefetch()` are empty/no-op.
- `handle_tool_call()` exposes exactly `partner_mem_keyword_search`,
  `partner_mem_vector_search`, and `partner_mem_graph_traverse` from the
  canonical schema artifact and calls runtime `invoke_tool`.
