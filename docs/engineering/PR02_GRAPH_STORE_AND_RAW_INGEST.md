# PR02 Graph Store And Raw Ingest 施工单

read `AGENTS.md`, inspect referenced code, follow the document in order, do not skip sections, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Base And Branch

- Base: merge result of `a1/pr01-graph-contract-schema`.
- Branch: `a1/pr02-graph-store-raw-ingest`.
- Stop if: PR01 contracts or schema are absent or changed without matching tests.

## Exact Scope

实现唯一 SQLite data access layer、raw message episode 写入、evidence edge builder、raw adjacency。PR02 不实现 recall ranking、FTS query router、public tools 或 host adapters。

## Allowed Files/Modules

- Modify: `src/core/contracts.ts`
- Modify: `src/core/hash.ts`
- Modify: `src/storage/schema.ts`
- Create: `src/storage/graph-store.ts`
- Create: `src/ingest/raw-ingest.ts`
- Create: `src/evidence/evidence-edge-builder.ts`
- Create: `test/storage/graph-store.test.ts`
- Create: `test/ingest/raw-ingest.test.ts`
- Create: `test/evidence/evidence-edge-builder.test.ts`

## Forbidden Files/Modules

- Do not modify MCP/server adapter files.
- Do not create recall router.
- Do not implement automatic summary generation.
- Do not create per-host ingestion logic.
- Do not bypass `GraphStore` from tests except schema setup.

## New Contracts/Types/Fields

- `GraphStore`（图存储：唯一读写 SQLite graph 的代码） owns node, edge, payload CRUD.
- `RawTurnInput`（原文轮次输入：adapter 转换后的统一 turn 数据） fields:
  - `agent_id`（agent 标识：回答这段记忆属于哪个 agent）
  - `session_id`（会话标识：回答这段记忆属于哪个 conversation）
  - `turn_id`（轮次标识：回答这是第几次交互的稳定 ID）
  - `turn_index`（轮次序号：回答在 session 中的顺序）
  - `messages`（消息列表：每条可见 user/assistant 原文）
- `RawMessageInput` fields:
  - `role` allowed values: `user | assistant | system_visible | tool_visible`
  - `text` must be non-empty after preserving original text
  - `observed_at` ISO timestamp from host, or adapter-provided fallback
  - `message_index` integer within turn
- `RawIngestResult` returns created `raw_message` node ids and created `RAW_NEAR_RAW` edge ids.

## Field Producers

- `RawIngestService` produces `memory_nodes` rows with `node_type = raw_message`.
- `RawIngestService` produces `raw_payloads` rows preserving exact `text`.
- `RawIngestService` produces `node_fts` seed rows for raw text.
- `EvidenceEdgeBuilder` produces `memory_edges` rows with `edge_class = evidence`.
- `EvidenceEdgeBuilder` sets `target_hash`.

## Storage

- `memory_nodes.content_hash` for raw nodes must equal sha256 of raw payload canonical source text.
- `raw_payloads.source_hash` must equal sha256 of exact original `text`.
- `RAW_NEAR_RAW` edges connect adjacent visible raw messages in the same turn/session order.
- Evidence edges must always include `target_hash`.

## Consumers

- PR03 `EvidenceResolver` consumes all GraphStore reads and evidence edges.
- PR04 `SeedIndex` consumes `node_fts`.
- PR05 adapters call `ingest_turn` only, never `GraphStore` directly.

## UI Projection

None.

## Forbidden Decisions

- Do not let adapter decide node ids by host-specific fields.
- Do not drop or rewrite original text.
- Do not chunk raw message into multiple `raw_message` nodes.
- Do not create semantic extracted nodes in PR02.
- Do not write evidence edges without `target_hash`.
- Do not let tests assert only snippets; tests must verify exact original text preservation.

## Old Paths Deleted In This PR

None. No code exists before PR01/PR02.

## Old Paths Not Yet Deleted But Forbidden From New Reads/Writes

None.

## Later Deletion PR Numbers

None.

## APIs To Add/Change/Delete

Add internal APIs:

- `GraphStore.createNode(input)`
- `GraphStore.createEdge(input)`
- `GraphStore.getNode(nodeId)`
- `GraphStore.getRawPayload(nodeId)`
- `GraphStore.getSummaryPayload(nodeId)`
- `GraphStore.listOutgoingEdges(nodeId, filter)`
- `GraphStore.listIncomingEdges(nodeId, filter)`
- `GraphStore.insertFtsNode(input)`
- `ingestTurn(input: RawTurnInput)`
- `createEvidenceEdge(input)`

No public agent-facing API in PR02.

## Persistence/Schema/Migration Requirements

- Use transactions around each `ingestTurn`.
- If any message fails validation, rollback the whole turn.
- Keep raw payload exact and normalized text separate.
- `node_fts` writes must reference `node_id`.

## Service/Worker Ownership Requirements

`RawIngestService` owns turn ingestion. No host adapter or tool may own raw message persistence.

## Frontend Projection Requirements

None.

## Positive Tests

- Ingest one user message and one assistant message; assert two `memory_nodes`, two `raw_payloads`, and exact text.
- Assert `raw_payloads.source_hash` equals sha256 exact text.
- Assert adjacent messages produce one `RAW_NEAR_RAW` evidence edge.
- Assert `node_fts` contains indexed raw text for each raw node.
- Assert `GraphStore` can load raw payload through node id.

## Negative Tests

- Reject empty message text without partial DB writes.
- Reject evidence edge creation without `target_hash`.
- Reject `RAW_NEAR_RAW` if source or target node does not exist.
- Prove `RawIngestService` does not create `summary`, `entity`, `task`, `event`, `decision`, or `artifact` nodes.
- Prove tests cannot bypass `GraphStore` for business writes.

## Source Gates

Run:

```bash
rg -n "db\\.prepare|db\\.exec|INSERT INTO|UPDATE memory|DELETE FROM memory" src test
```

Expected: business SQLite writes appear only in `src/storage`, except test setup that is explicitly named.

Run:

```bash
rg -n "summary\\.autoBuildEnabled|host_llm|automatic summary|createSummary" src
```

Expected: no auto summary implementation.

## Behavior Gates

Run:

```bash
pnpm test test/storage/graph-store.test.ts test/ingest/raw-ingest.test.ts test/evidence/evidence-edge-builder.test.ts
```

Expected: pass with real in-memory SQLite.

## Mechanical Acceptance Checklist

- All business writes go through `GraphStore`.
- `ingestTurn` is transactional.
- Original text is preserved exactly.
- Hashes are deterministic.
- `RAW_NEAR_RAW` is evidence class and has `target_hash`.
- `node_fts` is written as seed index only.

## Explicit Failure Conditions

- Fails if raw text is rewritten, summarized, chunked, or trimmed as source of truth.
- Fails if an evidence edge can exist without `target_hash`.
- Fails if adapter-specific fields leak into core schema.
- Fails if any public tool appears before core resolver exists.

