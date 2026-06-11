# PR11 User-Anchored Turn Capture 施工单

read `AGENTS.md`, inspect referenced code, follow this document in order, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Base And Branch

- Confirmed execution mode: `Clean Foundation Strict`（干净底座严格模式：删除“必须等 assistant 回复才算完整轮次”的旧规则，用户消息成为最小可写入轮次）。
- Base: PR10 merged or branch `codex/partner-mem-capture-flush-two-turns`.
- Branch: `codex/partner-mem-user-anchored-turns`.
- New PR required: yes, create a separate PR for PR11 only.
- Stacked policy: stack on PR10. Do not include PR08-PR10 work in this PR.
- Dirty-worktree policy: before branch creation run `git status --short`, `git diff --name-status`, and `git diff --stat`; exclude unrelated local docs and user changes unless explicitly requested.
- Commit/push/PR permission: do not stage, commit, push, or open PR unless explicitly requested by the user in the implementation thread.
- Pre-branch stop conditions: stop if PR08 identity isolation, PR09 injection safety, or PR10 default 2 is absent; stop if capture buffer no longer owns turn grouping.

## Exact Scope

Change turn grouping so each user message starts a writeable memory turn, and all following assistant messages belong to that turn until the next user message. A user-only turn is valid and must be persisted.

## Code Evidence

- `openclaw-plugin/src/capture-buffer.ts:101-126` — `collectCompleteTurnMessages` currently requires at least one assistant message after user messages; `if (assistantStart === index) break` prevents user-only turns from becoming flushable.
- `openclaw-plugin/src/capture-buffer.ts:80-86` — flushable turns are converted to `RawTurnInput` using the first message index as `turn_index`, which is suitable for user-anchored turns when the first message is user.
- `openclaw-plugin/test/hooks.test.ts:223-255` — existing test asserts a trailing user-only message remains pending until an assistant reply appears. This is the old product contract to delete.
- `openclaw-plugin/test/hooks.test.ts:260-295` — existing tests prove neighboring Q/A rounds are persisted as separate `RawTurnInput` calls. PR11 must preserve this separation with user-anchored grouping.
- `src/ingest/raw-ingest.ts:128-138` — raw ingest validates that a turn has at least one visible message and valid roles; it does not require an assistant message.

## Evidence, Inference, Unknowns

- Evidence: current grouping blocks user-only persistence.
- Evidence: raw ingest can accept a turn with at least one valid visible message.
- Evidence: tests currently encode assistant-required behavior.
- Inference: changing grouping in capture buffer should be enough for user-only persistence; raw ingest likely does not need semantic changes.
- Unknown: whether downstream typed extraction prompts need special handling for user-only turns; PR11 must run extraction queue tests if extractor is enabled in existing hooks tests.

## Allowed Files/Modules

- Modify: `openclaw-plugin/src/capture-buffer.ts`
- Modify: `openclaw-plugin/test/hooks.test.ts`
- Modify: `openclaw-plugin/test/openclaw-adapter.test.ts` only if helper export/testing requires it.
- Modify: `src/ingest/raw-ingest.ts` only if existing ingest rejects valid user-only turns; current evidence suggests it accepts at least one visible message.
- Modify: `test/ingest/raw-ingest.test.ts` only if user-only ingestion behavior needs direct core coverage.
- Modify: docs only if active docs assert assistant-required turns.

## Forbidden Files/Modules

- Do not change agent identity isolation.
- Do not change public tool schemas.
- Do not change injected-context stripping.
- Do not change default `captureFlushMaxTurns` from 2.
- Do not add an LLM or summary step to decide turns.

## Canonical Owner

- `collectFlushableTurns`（可刷写轮次收集器：从 pending messages 里选出应该写入的轮次） owns flushable turn grouping.
- A helper such as `collectUserAnchoredTurnMessages` owns pure message grouping.
- `RawIngestService` owns persistence of any valid turn passed to it.

## Old Owners To Delete

- Delete assistant-required turn completeness as the owner of write eligibility.
- Delete the test expectation that user-only trailing messages remain pending until assistant reply appears.

## Old Public Surfaces To Delete

- Delete docs/tests that define `turn` as requiring assistant reply.

## New Contracts/Types/Fields

- `turn`（用户锚点轮次：一条 user 消息和后续 assistant 消息，直到下一条 user 消息前）
  - Allowed shape: `[user]`, `[user, assistant...]`.
  - Producer: `collectFlushableTurns`.
  - Storage: persisted through existing `RawTurnInput`.
  - Consumer: raw ingest, recall timeline, extraction queue.
  - UI projection: none.
  - Represented user action: “用户说了一句话，即使 agent 没回，也是一条应该记住的事实来源”.
  - Allowed actions: persist a user-only turn; attach multiple assistant messages to the preceding user.
  - Forbidden actions: assistant-only turn, merging assistant messages into the next user turn, waiting for assistant before writing user facts.
- `turn_index`（轮次位置：本轮第一条消息的位置）
  - Allowed value: first user message `message_index`.
  - Producer: `collectFlushableTurns`.
  - Storage: `raw_payloads.turn_index`.
  - Consumer: timeline ordering and cursor lookup.
  - Forbidden action: derive from assistant position.

## Field Producers

- User message producer: OpenClaw visible event message with `role = "user"`.
- Assistant message producer: OpenClaw visible event message with `role = "assistant"`.
- `turn_id` producer: `createCapturedTurnId`, deterministic over trusted identity and message hashes.

## Storage

- No new tables.
- No migration.
- Existing user+assistant turns remain valid.
- New user-only turns persist through existing raw node/payload tables.

## Consumers

- `captureAgentEnd` consumes flushable turns and writes each via `RawIngestService.ingestTurn`.
- Extraction queue consumes raw node IDs from user-only turns as normal.
- Recall/timeline consume user-only messages after they are written.

## UI Projection

None.

## Forbidden Decisions

- Do not infer role by message position.
- Do not attach assistant messages to a later user message.
- Do not persist assistant-only messages as a turn.
- Do not wait for assistant before persisting user-only turns.
- Do not split `[user, assistant, assistant, assistant]` into multiple turns.

## Old Paths Deleted In This PR

- Delete `if (assistantStart === index) break` behavior from the turn grouping path.
- Delete tests that require user-only messages to remain pending until assistant reply.

## Old Paths Not Yet Deleted But Forbidden From New Reads/Writes

- None.

## Later Deletion PR Numbers

- None.

## APIs To Add/Change/Delete

- Change `collectCompleteTurnMessages` or replace it with `collectUserAnchoredTurnMessages`.
- Change `collectFlushableTurns` to treat user-only groups as flushable turns subject to thresholds.
- Keep `selectNewCaptureMessages`, `appendCaptureMessages`, `markCaptureTurnsFlushed`, and `createCapturedTurnId` contracts unless tests prove a necessary change.

## Persistence/Schema/Migration Requirements

- No schema change.
- No migration.

## Service/Worker Ownership Requirements

- Capture buffer owns grouping.
- Hook owns orchestration.
- Raw ingest owns persistence.

## Frontend Projection Requirements

None.

## Positive Tests

- User-only message persists as one turn when threshold allows flush.
- With default threshold 2, two user-only messages flush as two turns.
- Sequence `[user "1", assistant "2", assistant "3", assistant "4", user "a"]` groups as `[1,2,3,4]` and `[a]`.
- Sequence `[user "a"]` produces a `RawTurnInput` with one message and `turn_index` equal to that user's `message_index`.
- Extraction queue receives raw node ID for user-only persisted turns when extractor is enabled.

## Negative Tests

- Sequence `[assistant "orphan"]` produces no turn and writes nothing.
- Sequence `[assistant "orphan", user "a"]` writes only `[a]`, not the orphan assistant.
- Assistant messages after user cannot become separate turns without a new user.
- Repeated full-history `agent_end` events do not duplicate user-only turns.
- Old assistant-required test name/expectation is deleted.

## Source Gates

Run:

```bash
rg -n "pending until the assistant|assistant reply appears|assistantStart === index|incomplete turn" openclaw-plugin/src openclaw-plugin/test docs/engineering
```

Expected: no active source/test path requires assistant reply before persisting a user message. Historical docs may state `保留为历史事实，不参与决策`.

Run:

```bash
rg -n "role.*position|guess.*role|assistant-only.*turn" openclaw-plugin/src openclaw-plugin/test
```

Expected: no role-position inference; assistant-only behavior appears only in negative tests.

## Behavior Gates

Run:

```bash
./node_modules/.bin/vitest run openclaw-plugin/test/hooks.test.ts openclaw-plugin/test/runtime.test.ts test/ingest/raw-ingest.test.ts
```

Expected: pass.

## Mechanical Acceptance Checklist

- User-only messages can persist.
- Multiple assistant replies attach to the preceding user.
- Assistant-only messages do not persist.
- Duplicate full-history events do not duplicate persisted messages.
- Existing user+assistant capture still works.

## Explicit Failure Conditions

- Fails if user-only messages still require assistant reply.
- Fails if assistant-only messages become memory turns.
- Fails if turn grouping uses graph position, string prefix, or model output.
- Fails if implementation changes identity or injection safety from earlier PRs.
