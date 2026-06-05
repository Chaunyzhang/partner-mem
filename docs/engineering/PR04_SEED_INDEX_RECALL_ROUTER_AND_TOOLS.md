# PR04 Seed Index Recall Router And Tools 施工单

read `AGENTS.md`, inspect referenced code, follow the document in order, do not skip sections, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Base And Branch

- Base: merge result of `a1/pr03-evidence-resolver-traversal`.
- Branch: `a1/pr04-seed-index-recall-router-tools`.
- Stop if: `EvidenceResolver` is absent or does not have negative tests for semantic edge blocking and hash mismatch.

## Exact Scope

实现 seed index 查询、recall router、host-neutral tool facade、MCP-compatible tool schemas。PR04 让 agent 能调用 search/recall/timeline/status，但所有 final evidence 仍必须经过 `EvidenceResolver`。

## Allowed Files/Modules

- Modify: `src/storage/graph-store.ts`
- Modify: `src/storage/doctor.ts`
- Create: `src/search/seed-index.ts`
- Create: `src/recall/recall-router.ts`
- Create: `src/tools/tool-contracts.ts`
- Create: `src/tools/tool-facade.ts`
- Create: `test/search/seed-index.test.ts`
- Create: `test/recall/recall-router.test.ts`
- Create: `test/tools/tool-facade.test.ts`

## Forbidden Files/Modules

- Do not create host-specific adapters.
- Do not expose private SQLite paths in tool results.
- Do not implement vector search in A1 unless the user explicitly expands scope.
- Do not auto-build summaries.
- Do not let `partner_mem_search` return `result_class = evidence`.

## New Contracts/Types/Fields

- `SearchQuery`（搜索请求：agent 想找什么候选） fields:
  - `query`
  - `agent_id`
  - `session_id?`
  - `time_window?`
  - `limit`
- `CandidateRoute`（候选路线：能帮助发现，但不能证明） fields:
  - `result_class = candidate`
  - `seed_node_id`
  - `score`
  - `route`
  - `why`
- `RecallQuery`（召回请求：agent 要原文证据） fields:
  - `query`
  - `agent_id`
  - `session_id?`
  - `time_window?`
  - `limit`
- `TimelineQuery`（时间线请求：agent 要最近或指定时间段原文） fields:
  - `agent_id`
  - `session_id?`
  - `since?`
  - `until?`
  - `limit`
- `StatusResult`（状态结果：说明 storage/index/graph/context 健康状态） fields:
  - `result_class = status`
  - `schema`
  - `fts`
  - `graph`
  - `evidence`
  - `config`

## Field Producers

- `SeedIndex` produces candidate seed ids from FTS and time filters.
- `RecallRouter` produces candidate routes and evidence packets by calling resolver.
- `ToolFacade` produces host-neutral tool results.

## Storage

- `retrieval_runs` stores search/recall audit metadata.
- Tool calls must not write raw memory except future ingest API, which is not public in PR04.
- FTS is read-only from tool path.

## Consumers

- PR05 MCP adapter consumes tool contracts.
- Host agents consume `partner_mem_search`, `partner_mem_recall`, `partner_mem_timeline`, `partner_mem_status`.

## UI Projection

None.

## Forbidden Decisions

- `partner_mem_search` must never imply facts are verified.
- `partner_mem_recall` must never bypass `EvidenceResolver`.
- FTS/BM25 score must not be treated as proof.
- Timeline result must return raw messages, not summary.
- Status must not expose private DB path.

## Old Paths Deleted In This PR

None.

## Old Paths Not Yet Deleted But Forbidden From New Reads/Writes

None.

## Later Deletion PR Numbers

None.

## APIs To Add/Change/Delete

Add host-neutral tool APIs:

- `partner_mem_search(input: SearchQuery) -> CandidateRoute[]`
- `partner_mem_recall(input: RecallQuery) -> EvidencePacket | blocked evidence result`
- `partner_mem_timeline(input: TimelineQuery) -> raw timeline evidence-like raw items`
- `partner_mem_status() -> StatusResult`

Add MCP-compatible JSON schemas in `tool-contracts.ts`, but do not start a server in PR04.

## Persistence/Schema/Migration Requirements

- `retrieval_runs` records query, result class, seed count, evidence count, blocked count, created_at.
- Do not persist full private DB path.
- Do not store LLM-generated answer text in retrieval audit.

## Service/Worker Ownership Requirements

`RecallRouter` owns retrieval orchestration. It does not own proof; proof remains in `EvidenceResolver`.

## Frontend Projection Requirements

None.

## Positive Tests

- `partner_mem_search` returns `candidate` routes from FTS seed.
- `partner_mem_recall` returns original raw text after FTS seed plus resolver.
- `partner_mem_timeline` returns ordered raw messages by observed time and turn/message index.
- `partner_mem_status` reports healthy schema and FTS after setup.
- `retrieval_runs` audit row is written for recall.

## Negative Tests

- FTS hit on an entity without evidence path returns candidate-only or blocked, not evidence.
- `partner_mem_search` result cannot have `result_class = evidence`.
- `partner_mem_recall` cannot return summary text.
- Status result cannot include private DB path.
- Recall with hash mismatch returns blocked evidence, not a best-effort answer.

## Source Gates

Run:

```bash
rg -n "result_class.*evidence|isEvidence" src/search src/tools
```

Expected: `src/search` never produces evidence; only recall path can.

Run:

```bash
rg -n "dbPath|databasePath|\\.sqlite|graph-memory\\.db" src/tools src/recall
```

Expected: no private DB path in tool output code.

## Behavior Gates

Run:

```bash
pnpm test test/search/seed-index.test.ts test/recall/recall-router.test.ts test/tools/tool-facade.test.ts
```

Expected: pass with real in-memory SQLite.

## Mechanical Acceptance Checklist

- Search returns candidate only.
- Recall always calls resolver.
- Timeline preserves order.
- Status covers schema, FTS, graph, evidence, config.
- MCP schemas exist but server adapter is not started.
- No vector or auto summary work appears.

## Explicit Failure Conditions

- Fails if `partner_mem_search` can return final evidence.
- Fails if recall can answer from FTS snippet without resolver.
- Fails if status leaks DB path.
- Fails if vector or automatic summary becomes required for v1 correctness.

