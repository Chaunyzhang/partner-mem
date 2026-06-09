# PR10 Capture Flush Default Two Turns 施工单

read `AGENTS.md`, inspect referenced code, follow this document in order, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Base And Branch

- Confirmed execution mode: `Clean Foundation Strict`（干净底座严格模式：默认写入阈值以新产品合同为准，不保留默认 7 轮的普通路径）。
- Base: PR09 merged or branch `codex/partner-mem-context-injection-safety`.
- Branch: `codex/partner-mem-capture-flush-two-turns`.
- New PR required: yes, create a separate PR for PR10 only.
- Stacked policy: stack on PR09. Do not include PR11 user-anchored turn grouping in this PR.
- Dirty-worktree policy: before branch creation run `git status --short`, `git diff --name-status`, and `git diff --stat`; exclude unrelated local docs and user changes unless explicitly requested.
- Commit/push/PR permission: do not stage, commit, push, or open PR unless explicitly requested by the user in the implementation thread.
- Pre-branch stop conditions: stop if PR08 identity isolation or PR09 injection safety is absent; stop if `captureFlushMaxTurns` has already been removed or renamed.

## Exact Scope

Change the default write threshold from 7 complete turns to 2 complete turns. This PR does not change what counts as a turn; PR11 changes turn semantics.

## Code Evidence

- `openclaw-plugin/src/config.ts:28-56` — `DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG.captureFlushMaxTurns` is currently `7`, and `INTEGER_RANGES.captureFlushMaxTurns` allows `1..100`.
- `openclaw-plugin/src/capture-buffer.ts:64-87` — `collectFlushableTurns` uses `captureFlushMaxTurns` to decide when buffered turns are written.
- `openclaw-plugin/test/hooks.test.ts:154-196` — tests already prove `captureFlushMaxTurns: 2` causes two complete turns to flush when explicitly configured.
- `openclaw-plugin/test/runtime.test.ts:12-39` — runtime config tests assert defaults and explicit overrides, so this is where the default 2 contract must be proven.

## Evidence, Inference, Unknowns

- Evidence: default flush threshold is 7.
- Evidence: explicit threshold 2 behavior already works in tests.
- Inference: changing the default to 2 should reduce delayed writes without requiring capture algorithm changes.
- Unknown: whether OpenClaw plugin manifest contains a separate user-visible default in some installed package artifact outside this repo; implementation must inspect manifest before claiming UI/config defaults are aligned.

## Allowed Files/Modules

- Modify: `openclaw-plugin/src/config.ts`
- Modify: `openclaw-plugin/test/runtime.test.ts`
- Modify: `openclaw-plugin/test/hooks.test.ts` only for default-threshold assertions.
- Modify: `openclaw-plugin/openclaw.plugin.json` if the manifest contains a default for `captureFlushMaxTurns`.
- Modify: docs only if a test or manifest points to default 7.

## Forbidden Files/Modules

- Do not modify `openclaw-plugin/src/capture-buffer.ts` in PR10 unless a default-value test requires a type-only adjustment.
- Do not change user-only message capture behavior.
- Do not change identity isolation or tool schemas.
- Do not change injection stripping.

## Canonical Owner

- `DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG`（Partner-Mem OpenClaw 默认配置：插件没有用户配置时使用的默认值） owns default `captureFlushMaxTurns`.
- User config remains the producer of explicit overrides.

## Old Owners To Delete

- Delete default `captureFlushMaxTurns = 7` as the normal default.

## Old Public Surfaces To Delete

- Delete documentation/test assumptions that default turn threshold is 7.

## New Contracts/Types/Fields

- `captureFlushMaxTurns`（写入轮次阈值：攒多少可写入轮次后落库）
  - Allowed values: integer `1..100`.
  - New default: `2`.
  - Producer: plugin config parser `readPartnerMemOpenClawConfig`.
  - Storage: config only.
  - Consumer: `collectFlushableTurns`.
  - UI projection: OpenClaw plugin config if manifest exposes it.
  - Represented user action: “默认两轮左右就把记忆写进去，减少漏记和延迟”.
  - Allowed actions: explicit user override to another valid integer.
  - Forbidden actions: silently retaining default 7, using threshold to split a turn.

## Field Producers

- Default producer: `DEFAULT_PARTNER_MEM_OPENCLAW_CONFIG`.
- Override producer: user plugin config read by `readPartnerMemOpenClawConfig`.

## Storage

- No new tables.
- No migration.
- Existing DB rows do not need rewrite.

## Consumers

- `collectFlushableTurns` consumes the value.
- Runtime tests consume defaults.
- OpenClaw users consume behavior through faster memory availability.

## UI Projection

- If `openclaw-plugin/openclaw.plugin.json` contains config defaults, update its visible default to 2.

## Forbidden Decisions

- Do not treat token threshold as a replacement for turn threshold.
- Do not change `recallLimit`.
- Do not make threshold dynamic from model output.

## Old Paths Deleted In This PR

- Delete default value `7`.

## Old Paths Not Yet Deleted But Forbidden From New Reads/Writes

- Historical docs may mention old PR07 default 7 as `保留为历史事实，不参与决策`.

## Later Deletion PR Numbers

- None.

## APIs To Add/Change/Delete

- Change default only; no API additions.

## Persistence/Schema/Migration Requirements

- No schema change.
- No migration.

## Service/Worker Ownership Requirements

- Runtime continues passing config into capture buffer.
- Capture buffer continues interpreting threshold; it does not own default values.

## Frontend Projection Requirements

None unless manifest config is user-visible.

## Positive Tests

- `readPartnerMemOpenClawConfig({})` returns `captureFlushMaxTurns: 2`.
- Explicit override `captureFlushMaxTurns: 12` still returns 12.
- With default config in hook tests, two complete turns flush.
- With default config, one complete turn remains buffered unless token threshold is reached.

## Negative Tests

- Source scan proves default `captureFlushMaxTurns: 7` is absent from runtime config.
- Invalid numeric values still throw.
- Default 2 does not cause assistant-only messages to write.

## Source Gates

Run:

```bash
rg -n "captureFlushMaxTurns: 7|default.*7|7 complete turns|7 轮" openclaw-plugin/src openclaw-plugin/test openclaw-plugin/openclaw.plugin.json docs/engineering
```

Expected: no active runtime/test default. Historical docs may state `保留为历史事实，不参与决策`.

## Behavior Gates

Run:

```bash
./node_modules/.bin/vitest run openclaw-plugin/test/runtime.test.ts openclaw-plugin/test/hooks.test.ts
```

Expected: pass.

## Mechanical Acceptance Checklist

- Default is 2.
- Override still works.
- Numeric range still enforced.
- No turn semantics changed in PR10.

## Explicit Failure Conditions

- Fails if default remains 7.
- Fails if changing default also changes user-only capture behavior.
- Fails if tests rely on user configuration to claim default 2.
