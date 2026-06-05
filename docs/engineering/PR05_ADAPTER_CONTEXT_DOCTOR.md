# PR05 Adapter Context Doctor 施工单

read `AGENTS.md`, inspect referenced code, follow the document in order, do not skip sections, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Base And Branch

- Base: merge result of `a1/pr04-seed-index-recall-router-tools`.
- Branch: `a1/pr05-adapter-context-doctor`.
- Stop if: public tool facade is absent or `partner_mem_recall` can bypass resolver.

## Exact Scope

实现 host adapter contract、MCP adapter skeleton、context assembly、status/doctor strengthening。PR05 的重点是把“适配层是转接头”落到代码边界：adapter 只转换 harness 格式，不拥有 memory semantics。

## Allowed Files/Modules

- Modify: `src/storage/doctor.ts`
- Modify: `src/tools/tool-contracts.ts`
- Create: `src/adapters/adapter-contracts.ts`
- Create: `src/adapters/mcp-adapter.ts`
- Create: `src/context/context-assembler.ts`
- Create: `src/config/default-config.ts`
- Create: `test/adapters/adapter-contracts.test.ts`
- Create: `test/adapters/mcp-adapter.test.ts`
- Create: `test/context/context-assembler.test.ts`
- Create: `test/storage/doctor-deep.test.ts`

## Forbidden Files/Modules

- Do not create Codex-specific, Claude-specific, OpenClaw-specific deep adapters in A1 unless user explicitly asks.
- Do not let adapter import `src/storage/graph-store.ts`.
- Do not let adapter import SQLite driver.
- Do not create UI.
- Do not create cloud sync, team permissions, or enterprise auth.

## New Contracts/Types/Fields

- `HostAdapter`（宿主适配器：把 harness 输入输出转成 Partner-Mem 内部协议） owns translation only.
- `HostTurnEnvelope`（宿主轮次信封：adapter 接收到的原始 host turn 包装） fields:
  - `host` allowed values: `mcp | codex | claude_code | openclaw | generic`
  - `agent_id`
  - `session_id`
  - `turn_id`
  - `turn_index`
  - `messages`
- `CoreTurn`（核心轮次：Partner-Mem 内部统一输入） equals PR02 `RawTurnInput`.
- `ContextAssemblyRequest`（上下文组装请求：host 准备 prompt 前请求 bounded memory context） fields:
  - `agent_id`
  - `session_id?`
  - `current_prompt?`
  - `budget_tokens`
  - `include_recent`
  - `auto_recall`
- `ContextBlock`（上下文块：允许注入 prompt 的记忆内容） fields:
  - `recent_raw_timeline`
  - `verified_evidence`
  - `path_explanations`
  - `safety_instructions`
  - `omitted`

## Field Producers

- `mcp-adapter.ts` produces tool schemas and routes MCP `tools/call` arguments to `ToolFacade`.
- `adapter-contracts.ts` maps host turn envelope to core turn.
- `context-assembler.ts` calls timeline/recall and only includes verified evidence or recent raw timeline.
- `default-config.ts` produces conservative default thresholds.
- `doctor.ts` reports schema, index, graph edge hash, and context configuration health.

## Storage

- Adapter does not write storage directly.
- Context assembly does not persist new memory.
- Doctor reads storage and reports status; it does not repair silently in A1.

## Consumers

- MCP-compatible clients consume `mcp-adapter.ts`.
- Future Codex/Claude/OpenClaw adapters consume `adapter-contracts.ts`.
- Host prompt injection consumes `ContextBlock`.

## UI Projection

None.

## Forbidden Decisions

- Adapter must not decide evidence validity.
- Adapter must not build SQL.
- Adapter must not know private DB schema beyond public tool/core contracts.
- Context assembly must not include candidate-only graph guesses as facts.
- Context assembly must not include summary text as final evidence.
- Doctor must not silently mutate data to hide corruption.

## Old Paths Deleted In This PR

None.

## Old Paths Not Yet Deleted But Forbidden From New Reads/Writes

None.

## Later Deletion PR Numbers

None.

## APIs To Add/Change/Delete

Add adapter APIs:

- `normalizeHostTurn(envelope: HostTurnEnvelope) -> RawTurnInput`
- `createMcpToolList()`
- `callMcpTool(name, arguments)`
- `assembleContext(request: ContextAssemblyRequest) -> ContextBlock`
- `getDefaultConfig()`

No host-specific private APIs beyond MCP skeleton in A1.

## Persistence/Schema/Migration Requirements

- No new persistence tables.
- Config defaults live in code for A1; if persisted config is later added, it must be a new PR.

## Service/Worker Ownership Requirements

- `HostAdapter` owns protocol translation.
- `ToolFacade` owns host-neutral tool execution.
- `Graph Kernel` owns memory semantics and proof.
- `ContextAssembler` owns bounded prompt context and must consume verified tool/core outputs.

## Frontend Projection Requirements

None.

## Positive Tests

- MCP `tools/list` exposes `partner_mem_search`, `partner_mem_recall`, `partner_mem_timeline`, `partner_mem_status` with JSON schemas.
- MCP `tools/call` routes to `ToolFacade`.
- `normalizeHostTurn` preserves original message text and maps host fields into `RawTurnInput`.
- `assembleContext` includes recent raw timeline when enabled.
- `assembleContext` includes verified evidence packet when auto recall succeeds.
- Doctor reports unhealthy when evidence edge hash mismatch is present.

## Negative Tests

- Adapter cannot import `GraphStore` or SQLite driver.
- Adapter cannot return evidence without `ToolFacade`/`EvidenceResolver`.
- Context assembly rejects candidate-only routes as facts.
- Context assembly does not include private DB path.
- Context assembly does not include summary text as proof.
- Doctor does not repair hash mismatch silently.

## Source Gates

Run:

```bash
rg -n "GraphStore|sqlite|db\\.prepare|db\\.exec" src/adapters src/context
```

Expected: no matches in `src/adapters`; `src/context` may call tool/core facade but not SQLite.

Run:

```bash
rg -n "candidate.*context|summary.*proof|private database|dbPath|databasePath" src/context src/adapters
```

Expected: matches only in negative tests or explicit forbidding comments.

## Behavior Gates

Run:

```bash
pnpm test test/adapters/adapter-contracts.test.ts test/adapters/mcp-adapter.test.ts test/context/context-assembler.test.ts test/storage/doctor-deep.test.ts
```

Expected: pass.

## Mechanical Acceptance Checklist

- Adapter layer is a pure translation layer.
- MCP tool schemas match PR04 tool contracts.
- Context assembly is budgeted and conservative.
- Candidate-only results are never injected as facts.
- Doctor detects schema, FTS, missing raw payload, bad evidence hash, and config health.
- No host-specific deep adapter is created.

## Explicit Failure Conditions

- Fails if adapter imports storage directly.
- Fails if context includes unverified graph guesses as facts.
- Fails if doctor hides corruption by auto-repairing.
- Fails if A1 grows cloud sync, enterprise permissions, or UI.

