# PR09 Context Injection Capture Safety 施工单

read `AGENTS.md`, inspect referenced code, follow this document in order, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Base And Branch

- Confirmed execution mode: `Clean Foundation Strict`（干净底座严格模式：Partner-Mem 注入块只能是隐藏上下文，不能作为可见用户消息写入，也不能被普通捕获路径重新摄入）。
- Base: PR08 merged or branch `codex/partner-mem-agent-id-isolation`.
- Branch: `codex/partner-mem-context-injection-safety`.
- New PR required: yes, create a separate PR for PR09 only.
- Stacked policy: stack on PR08. Do not include PR10 threshold default or PR11 user-anchored turn grouping in this PR.
- Dirty-worktree policy: before branch creation run `git status --short`, `git diff --name-status`, and `git diff --stat`; exclude unrelated local docs and user changes unless explicitly requested.
- Commit/push/PR permission: do not stage, commit, push, or open PR unless explicitly requested by the user in the implementation thread.
- Pre-branch stop conditions: stop if PR08 identity isolation is absent; stop if `recallBeforePromptBuild` no longer returns `appendContext`; stop if OpenClaw runtime represents injected context as a visible user message and cannot distinguish it.

## Exact Scope

Prevent Partner-Mem injected old memory from becoming newly captured user text. This PR handles Mem-side injection and capture safety only. It does not change Feishu send behavior directly.

## Code Evidence

- `openclaw-plugin/src/hooks.ts:80-105` — `recallBeforePromptBuild` returns `{ appendContext: formatted }`, proving Partner-Mem injects memory into OpenClaw prompt context.
- `openclaw-plugin/src/openclaw-adapter.ts:92-125` — `formatContextBlockForOpenClaw` emits fixed Partner-Mem context headers and raw evidence/timeline text.
- `openclaw-plugin/src/openclaw-adapter.ts:129-143` — `extractMessageText` calls `stripLeadingPartnerMemContextBlocks` for string, array, `text`, and `message` sources.
- `openclaw-plugin/src/openclaw-adapter.ts:179-213` — `stripLeadingPartnerMemContextBlocks` strips only leading context blocks. This proves injected blocks in the middle of visible text are not fully covered.
- `openclaw-plugin/test/openclaw-adapter.test.ts:73-94` — existing test proves leading Partner-Mem blocks are stripped before raw capture, but does not prove non-leading injected blocks are stripped.

## Evidence, Inference, Unknowns

- Evidence: Partner-Mem injects old memory through `appendContext`.
- Evidence: current capture stripping only handles leading injected context blocks.
- Evidence: repository search found no direct Feishu/Lark send path in `openclaw-plugin/src`.
- Inference: Partner-Mem can provide old text that another layer might send or a model might repeat, even if Partner-Mem itself does not send messages.
- Unknown: whether the real OpenClaw/Feishu integration ever serializes `appendContext` into visible user messages. This PR fixes Mem-side capture safety but does not claim to fix non-Mem send behavior.

## Allowed Files/Modules

- Modify: `openclaw-plugin/src/openclaw-adapter.ts`
- Modify: `openclaw-plugin/src/hooks.ts`
- Modify: `openclaw-plugin/test/openclaw-adapter.test.ts`
- Modify: `openclaw-plugin/test/hooks.test.ts`
- Modify: `test/context/context-assembler.test.ts` only if context block semantics need core-level tests.

## Forbidden Files/Modules

- Do not modify Feishu/Lark send/reply code.
- Do not modify `src/ingest/raw-ingest.ts` unless a failing capture test proves raw ingest needs a deterministic rejection contract.
- Do not change `captureFlushMaxTurns`.
- Do not change user-anchored turn grouping.
- Do not add model-output text heuristics that reinterpret arbitrary assistant replies as safe or unsafe.

## Canonical Owner

- `recallBeforePromptBuild`（prompt 构建前召回 hook：把隐藏记忆上下文交给 OpenClaw） owns injection.
- `extractOpenClawVisibleMessages`（可见消息提取器：从 OpenClaw event 中选出真实屏幕可见 user/assistant 文本） owns capture eligibility.
- `stripLeadingPartnerMemContextBlocks` currently strips a leading block; PR09 must replace or extend it with a deterministic `removePartnerMemInjectedContext` contract.

## Old Owners To Delete

- Delete “leading header only” as the only injected-context capture defense.
- Delete any assumption that `appendContext` text can be captured if it appears inside a user message body.

## Old Public Surfaces To Delete

- None.

## New Contracts/Types/Fields

- `PartnerMemInjectedContextBlock`（Partner-Mem 注入上下文块：只给模型看的记忆背景）
  - Allowed headers: `Partner-Mem verified raw evidence:`, `Partner-Mem recent raw timeline:`, `Partner-Mem safety instructions:`.
  - Producer: `formatContextBlockForOpenClaw`.
  - Storage: none.
  - Consumer: OpenClaw prompt builder and `extractOpenClawVisibleMessages` capture filter.
  - UI projection: none; it must not be a user-visible message.
  - Represented user action: none; it is system-supplied memory context.
  - Allowed actions: inject as hidden/append context, strip before capture.
  - Forbidden actions: persist as raw user text, become a user message, become a new memory fact.
- `injection_stripped_count`（注入剥离计数：本次捕获时剥掉多少 Partner-Mem 注入块）
  - Allowed values: integer `>= 0`.
  - Producer: `extractOpenClawVisibleMessages` or hook-local capture wrapper.
  - Storage: log metadata only.
  - Consumer: diagnostics.
  - UI projection: none.
  - Forbidden action: logging raw message content.

## Field Producers

- Injected context text producer: `formatContextBlockForOpenClaw`.
- Visible message text producer: OpenClaw event message after `extractOpenClawVisibleMessages` filters and strips injection.
- Diagnostic metadata producer: `captureAgentEnd` and `recallBeforePromptBuild`.

## Storage

- No new tables.
- No migration.
- Injected context must not be stored in `memory_nodes`, `raw_payloads`, `node_fts`, or retrieval evidence as a new raw message.

## Consumers

- `captureAgentEnd` consumes visible messages after injected-context removal.
- Tests consume timeline output to prove injected blocks are absent.
- Logs consume metadata-only counts.

## UI Projection

None.

## Forbidden Decisions

- Do not decide safety by checking whether old evidence text “looks like” a user fact.
- Do not parse arbitrary model replies to infer whether they came from memory.
- Do not persist Partner-Mem headers as user text.
- Do not use prompt wording as the only safety mechanism; enforce capture filtering in code.

## Old Paths Deleted In This PR

- Delete capture eligibility for any message content segment that contains a Partner-Mem injected context block.
- Delete source reliance on “only leading injected context needs stripping”.

## Old Paths Not Yet Deleted But Forbidden From New Reads/Writes

- None.

## Later Deletion PR Numbers

- None.

## APIs To Add/Change/Delete

- Add or change a pure helper in `openclaw-plugin/src/openclaw-adapter.ts`, for example:
  - `removePartnerMemInjectedContext(text: string): { text: string; stripped_count: number }`
  - It must remove Partner-Mem injected sections wherever they appear as standalone header blocks, not only at the beginning.
- Change `extractMessageText` to use the helper for string content, array text content, `text`, and `message` fields.
- Change `captureAgentEnd` logging to include metadata-only `injection_stripped_count` if available.
- Keep `recallBeforePromptBuild` returning only `{ appendContext: formatted }`.

## Persistence/Schema/Migration Requirements

- No schema change.
- No migration.

## Service/Worker Ownership Requirements

- OpenClaw adapter owns injected-context filtering before raw capture.
- Raw ingest stays a storage service and should not know OpenClaw prompt block syntax unless a failing test proves adapter-only filtering cannot protect it.

## Frontend Projection Requirements

None.

## Positive Tests

- `formatContextBlockForOpenClaw` still emits verified evidence, timeline, and safety sections when evidence or timeline exists.
- `recallBeforePromptBuild` still returns `appendContext` and not `prependContext` or `systemPrompt`.
- A visible user message containing actual user text before and after an injected block preserves only the actual user text.

## Negative Tests

- A user message that starts with Partner-Mem injected context does not store the injected lines.
- A user message that contains Partner-Mem injected context in the middle does not store the injected lines.
- A user message that contains only Partner-Mem injected context stores nothing.
- An assistant message that contains only Partner-Mem injected context stores nothing.
- Captured timeline and FTS do not include `Partner-Mem verified raw evidence`, `Partner-Mem recent raw timeline`, or `Partner-Mem safety instructions`.
- Logs do not include raw evidence text while reporting stripped counts.

## Source Gates

Run:

```bash
rg -n "Partner-Mem verified raw evidence|Partner-Mem recent raw timeline|Partner-Mem safety instructions" openclaw-plugin/src src
```

Expected: matches only in formatter/filter constants and tests; no storage or ingest code persists these as ordinary content.

Run:

```bash
rg -n "prependContext|systemPrompt" openclaw-plugin/src openclaw-plugin/test
```

Expected: no source usage; tests may assert absence.

## Behavior Gates

Run:

```bash
./node_modules/.bin/vitest run openclaw-plugin/test/openclaw-adapter.test.ts openclaw-plugin/test/hooks.test.ts test/context/context-assembler.test.ts
```

Expected: pass.

## Mechanical Acceptance Checklist

- Injected context is stripped before raw capture even when not at the beginning.
- Empty-after-strip messages are dropped.
- Real visible user text around an injected block is preserved.
- No raw memory row contains Partner-Mem context headers.
- No prompt-only wording is used as the safety boundary.

## Explicit Failure Conditions

- Fails if injected context can be written to `raw_payloads`.
- Fails if `appendContext` is changed to a visible user message path.
- Fails if raw evidence text is logged for diagnostics.
- Fails if implementation claims to fix Feishu sending behavior directly.
