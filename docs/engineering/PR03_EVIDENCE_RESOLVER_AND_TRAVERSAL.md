# PR03 Evidence Resolver And Traversal 施工单

read `AGENTS.md`, inspect referenced code, follow the document in order, do not skip sections, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Base And Branch

- Base: merge result of `a1/pr02-graph-store-raw-ingest`.
- Branch: `a1/pr03-evidence-resolver-traversal`.
- Stop if: `GraphStore`, raw ingest, or evidence edge builder is absent.

## Exact Scope

实现 deterministic `EvidenceResolver` 和 bounded `GraphTraversal`。PR03 证明 candidate node 只有通过 allowed evidence path 才能产出原文 evidence packet。PR03 不实现 FTS ranking、public tools、context assembly 或 host adapters。

## Allowed Files/Modules

- Modify: `src/core/contracts.ts`
- Modify: `src/storage/graph-store.ts`
- Create: `src/graph/traversal.ts`
- Create: `src/evidence/evidence-resolver.ts`
- Create: `src/evidence/evidence-packet-builder.ts`
- Create: `test/graph/traversal.test.ts`
- Create: `test/evidence/evidence-resolver.test.ts`
- Create: `test/evidence/evidence-packet-builder.test.ts`

## Forbidden Files/Modules

- Do not create search router.
- Do not create MCP public server.
- Do not create context injection.
- Do not create automatic extraction or summary generation.
- Do not let LLM code participate in resolver.

## New Contracts/Types/Fields

- `EvidenceResolveInput`（证据解析输入：要从哪个 candidate node 尝试找原文） fields:
  - `candidate_node_id`
  - `max_depth` default `3`
  - `max_evidence_items` default `8`
- `EvidencePacket`（证据包：host agent 可以引用的原文证据） fields:
  - `result_class = evidence`
  - `query_id`
  - `evidence_items`
  - `blocked_paths`
  - `created_at`
- `EvidenceItem`（单条证据：一段可返回给 host agent 的原文） fields:
  - `raw_node_id`
  - `role`
  - `text`
  - `observed_at`
  - `session_id`
  - `turn_id`
  - `turn_index`
  - `message_index`
  - `source_hash`
  - `path`
- `BlockedReason`（阻断原因：解释为什么 candidate 不能变成 evidence） allowed values: `missing_node | missing_edge | disallowed_edge_class | disallowed_edge_type | target_hash_mismatch | cycle_detected | missing_raw_payload | max_depth_exceeded | non_raw_terminal`.

## Field Producers

- `EvidenceResolver` produces `EvidencePacket` or blocked result.
- `GraphTraversal` produces bounded paths.
- `EvidencePacketBuilder` formats verified raw payloads.

## Storage

- `evidence_packets` stores audit records for resolve runs.
- No new source-of-truth table.
- No mutation of `raw_payloads` or `memory_nodes` during resolve.

## Consumers

- PR04 `RecallRouter` consumes `EvidenceResolver`.
- PR04 `partner_mem_recall` returns `EvidencePacket`.
- PR05 context assembly may include verified evidence packets only.

## UI Projection

None.

## Forbidden Decisions

- Do not follow semantic edges when resolving final evidence.
- Do not treat candidate routes as evidence paths.
- Do not accept a path with mismatched `target_hash`.
- Do not allow cycle traversal to continue.
- Do not allow summary text as terminal evidence.
- Do not call an LLM or adapter from resolver.

## Old Paths Deleted In This PR

None.

## Old Paths Not Yet Deleted But Forbidden From New Reads/Writes

None.

## Later Deletion PR Numbers

None.

## APIs To Add/Change/Delete

Add internal APIs:

- `resolveEvidence(input: EvidenceResolveInput)`
- `walkEvidencePaths(startNodeId, options)`
- `buildEvidencePacket(verifiedRawItems, blockedPaths)`
- `verifyTargetHash(edge, targetNodeOrPayload)`

No public agent tool API in PR03.

## Persistence/Schema/Migration Requirements

- `evidence_packets` audit write must be append-only.
- Resolving evidence must not mutate source graph.
- `target_hash` verification must compare against target raw payload hash for raw terminal nodes.

## Service/Worker Ownership Requirements

`EvidenceResolver` is the only owner allowed to decide whether evidence is verified.

## Frontend Projection Requirements

None.

## Positive Tests

- Raw candidate resolves directly to its raw payload.
- `decision -> EVIDENCED_BY_RAW -> raw_message` resolves to original raw text.
- `summary -> SUMMARY_COVERS_RAW -> raw_message` resolves to original raw text.
- `raw_message -> RAW_NEAR_RAW -> raw_message` can resolve neighbor raw evidence when requested.
- Evidence packet preserves role, session, turn, message index, observed_at, source_hash, and path.

## Negative Tests

- Semantic `RELATED_TO` path cannot produce evidence.
- Evidence edge with wrong `target_hash` is blocked.
- Missing target node is blocked.
- Missing raw payload is blocked.
- Cycle in evidence edges is blocked.
- Non-raw terminal node is blocked.
- Summary payload text is never returned as final evidence.

## Source Gates

Run:

```bash
rg -n "RELATED_TO|SIMILAR_TO|CAUSED_BY|USED_TOOL|SOLVED_BY" src/evidence src/graph
```

Expected: semantic edge types may appear only in tests proving they are blocked, not in resolver allowlist.

Run:

```bash
rg -n "openai|anthropic|llm|model|prompt" src/evidence src/graph
```

Expected: no matches.

## Behavior Gates

Run:

```bash
pnpm test test/graph/traversal.test.ts test/evidence/evidence-resolver.test.ts test/evidence/evidence-packet-builder.test.ts
```

Expected: pass with real in-memory SQLite.

## Mechanical Acceptance Checklist

- Resolver path validation follows docs/PROJECT_THINKING.md steps.
- Resolver owns evidence truth.
- Blocked paths include precise reason.
- Max depth is enforced.
- Cycle protection is tested.
- `evidence_packets` audit exists.

## Explicit Failure Conditions

- Fails if any semantic edge can produce final evidence.
- Fails if hash mismatch can be ignored.
- Fails if LLM/prompt code appears in resolver.
- Fails if summary text can be returned as proof.

