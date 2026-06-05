# PR01 Graph Contract And Schema 施工单

read `AGENTS.md`, inspect referenced code, follow the document in order, do not skip sections, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Base And Branch

- Base: `main` baseline created by `docs/engineering/PR00_REPOSITORY_BOOTSTRAP.md`。
- Branch: `a1/pr01-graph-contract-schema`。
- Stop if: PR00 has not produced a real `main` baseline and you are about to modify code.

## Exact Scope

建立项目的 TypeScript/Node 工程骨架、图契约、SQLite schema migration、schema doctor 和 contract tests。PR01 不实现 ingest、search、resolver、tools 或 adapters。

## Allowed Files/Modules

- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/core/contracts.ts`
- Create: `src/core/hash.ts`
- Create: `src/storage/migrations/001_init_graph.sql`
- Create: `src/storage/schema.ts`
- Create: `src/storage/doctor.ts`
- Create: `test/core/contracts.test.ts`
- Create: `test/storage/schema.test.ts`

## Forbidden Files/Modules

- Do not create host adapter files.
- Do not create tool server files.
- Do not create recall/search/resolver implementation.
- Do not create UI.
- Do not create a second persistence location outside `src/storage`.

## New Contracts/Types/Fields

- `NodeType`（节点类型：说明一个 memory node 代表什么对象） allowed values: `raw_message | summary | entity | task | event | decision | artifact`.
- `EdgeClass`（边类别：说明边用于证明、语义、时间还是导航） allowed values: `evidence | semantic | temporal | navigation`.
- `EvidenceEdgeType`（证据边类型：能被 EvidenceResolver 用来证明原文的边） allowed values: `RAW_NEAR_RAW | SUMMARY_COVERS_RAW | SUMMARY_ROLLS_UP_SUMMARY | MENTIONED_IN_RAW | EVIDENCED_BY_RAW`.
- `SemanticEdgeType`（语义边类型：用于找候选，不得直接证明事实） allowed values: `RELATED_TO | SIMILAR_TO | CAUSED_BY | USED_TOOL | SOLVED_BY`.
- `TemporalEdgeType`（时间边类型：表示消息或事件顺序） allowed values: `FOLLOWS`.
- `NavigationEdgeType`（导航边类型：表示 summary 或索引路线） allowed values: `INDEXES | ROLLS_UP`.
- `NodeStatus`（节点状态：表示节点是否可用于正常召回） allowed values: `active | invalidated`.
- `PathStatus`（路径状态：表示 resolver 对路径的判定） allowed values: `verified | blocked | candidate_only`.
- `ResultClass`（工具结果类别：告诉 host agent 结果能不能当证据） allowed values: `candidate | evidence | status`.
- `content_hash`（内容哈希：节点当前内容的 sha256） producer: future node writer; storage: `memory_nodes`; consumer: resolver and doctor.
- `source_hash`（原文哈希：raw payload 原文的 sha256） producer: future raw ingest; storage: `raw_payloads`; consumer: resolver and doctor.
- `target_hash`（目标哈希：edge 指向目标节点或 payload 时记录的哈希） producer: future `EvidenceEdgeBuilder`; storage: `memory_edges`; consumer: resolver and doctor.

## Field Producers

PR01 只定义 producers，不生产业务数据。

- `schema.ts` creates empty tables and migration state.
- `doctor.ts` reads schema and reports missing tables/indexes.
- `hash.ts` provides deterministic sha256 helper for later producers.

## Storage

Create these SQLite tables exactly:

- `memory_nodes`
- `memory_edges`
- `raw_payloads`
- `summary_payloads`
- `node_fts`
- `retrieval_runs`
- `evidence_packets`
- `schema_migrations`

`node_fts` must be an FTS5 virtual table. It indexes node text for seed search only; it is not a fact source.

## Consumers

Future PRs consume:

- `src/core/contracts.ts` for all allowed values.
- `src/core/hash.ts` for hash creation and comparison.
- `src/storage/schema.ts` for DB initialization.
- `src/storage/doctor.ts` for status checks.

## UI Projection

None. A1 has no UI.

## Forbidden Decisions

- Do not infer evidence from `node_type` alone.
- Do not use loose strings for node or edge types.
- Do not allow arbitrary evidence edge types.
- Do not store relationship arrays as source of truth.
- Do not create a `messages` table as the primary source of raw text.
- Do not make `summary_payloads` required for v1 correctness.

## Old Paths Deleted In This PR

None. No code exists.

## Old Paths Not Yet Deleted But Forbidden From New Reads/Writes

None. No code exists.

## Later Deletion PR Numbers

None.

## APIs To Add/Change/Delete

Add internal APIs only:

- `assertNodeType(value)`
- `assertEdgeClass(value)`
- `assertEvidenceEdgeType(value)`
- `isEvidenceEdgeType(value)`
- `hashText(text)`
- `initializeSchema(db)`
- `runSchemaDoctor(db)`

No public agent tool APIs in PR01.

## Persistence/Schema/Migration Requirements

- Migration must be idempotent.
- All table names must match `docs/PROJECT_THINKING.md`.
- `memory_edges.edge_class` and `memory_edges.edge_type` must be indexed.
- `raw_payloads.node_id` must be unique and foreign-keyed to `memory_nodes.node_id`.
- `summary_payloads.node_id` must be unique and foreign-keyed to `memory_nodes.node_id`.
- `node_fts` must not be treated as source of truth.

## Service/Worker Ownership Requirements

No service or worker yet. PR01 only creates contracts and schema foundation.

## Frontend Projection Requirements

None.

## Positive Tests

- Contract tests accept every allowed `NodeType`, `EdgeClass`, `EvidenceEdgeType`, `NodeStatus`, `PathStatus`, `ResultClass`.
- Schema test creates an in-memory SQLite DB and verifies all required tables exist.
- FTS test inserts a test row into `node_fts` and verifies `MATCH` returns the row.
- Doctor test returns healthy after schema initialization.

## Negative Tests

- Contract tests reject unknown `NodeType`, unknown `EdgeClass`, and unknown evidence edge type.
- Schema test proves no standalone `messages` table exists.
- Doctor test reports missing `memory_edges` when schema is incomplete.
- Source gate proves no `relatedRawIds` or `relatedTasks` source-of-truth arrays exist.

## Source Gates

Run:

```bash
rg -n "relatedRawIds|relatedTasks|messages table|legacy fallback|deprecated wrapper|best-effort fallback" src test
```

Expected: no matches.

Run:

```bash
rg -n "CREATE TABLE messages|CREATE TABLE raw_messages" src
```

Expected: no matches.

## Behavior Gates

Run:

```bash
pnpm test test/core/contracts.test.ts test/storage/schema.test.ts
```

Expected: pass.

Run a schema doctor smoke command if a CLI exists; otherwise use Vitest only in PR01.

## Mechanical Acceptance Checklist

- All allowed values are centralized in `src/core/contracts.ts`.
- No module hard-codes evidence edge strings outside the contract file.
- SQLite schema contains all required tables.
- FTS5 table is present.
- Doctor distinguishes healthy schema from missing-table schema.
- No public tools or adapters are introduced.

## Explicit Failure Conditions

- Fails if any evidence edge type can be accepted without being in the allowlist.
- Fails if raw text source of truth is a separate `messages` table.
- Fails if FTS is documented or implemented as final evidence.
- Fails if package setup cannot run tests.
