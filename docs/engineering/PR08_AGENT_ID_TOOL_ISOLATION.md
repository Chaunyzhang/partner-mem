# PR08 Agent ID Tool Isolation 施工单

read `AGENTS.md`, inspect referenced code, follow this document in order, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Base And Branch

- Confirmed execution mode: `Clean Foundation Strict`（干净底座严格模式：删除普通工具跨 `agent_id` 形状，禁止默认共享身份，禁止模型决定 agent 身份）。
- Base: clean `codex/openclaw-turn-capture-cursor` at `3f851de Bound audit log growth after capture flushes` or the current reviewed successor containing the same OpenClaw plugin capture runtime.
- Branch: `codex/partner-mem-agent-id-isolation`.
- New PR required: yes, create a separate PR for PR08 only.
- Stacked policy: PR08 is the base of PR09-PR11. Do not include PR09 injection safety, PR10 threshold default, or PR11 user-anchored turn behavior in this PR.
- Dirty-worktree policy: before branch creation run `git status --short`, `git diff --name-status`, and `git diff --stat`; exclude unrelated `AGENTS.md`, local planning docs, runtime data, screenshots, logs, coverage, build output, and generated workspace files unless explicitly requested.
- Commit/push/PR permission: do not stage, commit, push, or open PR unless explicitly requested by the user in the implementation thread.
- Pre-branch stop conditions: stop if `openclaw-plugin/src/tools.ts`, `openclaw-plugin/src/openclaw-adapter.ts`, `src/tools/tool-contracts.ts`, or `src/recall/recall-router.ts` is absent; stop if current OpenClaw SDK does not provide any trusted identity context field.

## Exact Scope

Make `agent_id`（agent 身份证号：回答“这条记忆属于哪个 agent”） a hard runtime-owned boundary for ordinary Partner-Mem OpenClaw tools and hooks.

This PR deletes normal-path model-controlled agent selection and deletes normal-path cross-agent recall. It does not design an admin cross-agent tool. It does not change flush timing or user-anchored turns.

## Code Evidence

- `openclaw-plugin/src/openclaw-adapter.ts:70-90` — `resolveOpenClawSessionIdentity` currently reads `ctx.agentId`, event `agentId`, event `agent_id`, then falls back to `"openclaw-default-agent"`. This proves the current hook path has a shared identity fallback to delete.
- `src/tools/tool-contracts.ts:24-70` — public schemas for `partner_mem_search`, `partner_mem_recall`, and `partner_mem_timeline` require `agent_id`; `partner_mem_recall` exposes `allow_cross_agent`. This proves ordinary tools currently let model/tool params request identity and cross-agent behavior.
- `openclaw-plugin/src/tools.ts:30-52` — tool `execute` passes raw params to `ToolFacade` and ignores trusted OpenClaw tool context. This proves runtime context is not yet the ordinary tool identity owner.
- `src/recall/recall-router.ts:7-18` and `src/recall/recall-router.ts:62-69` — `RecallQuery` contains `allow_cross_agent`, and `RecallRouter.recall` forwards it to `EvidenceResolver`. This proves ordinary recall can carry a cross-agent switch.
- `test/context/context-assembler.test.ts:200-278` — current context tests block cross-agent evidence paths by default. This is correct but incomplete because tool schemas still expose identity and cross-agent fields.

## Evidence, Inference, Unknowns

- Evidence: ordinary OpenClaw-facing schemas expose `agent_id` and `allow_cross_agent`.
- Evidence: hook identity has default shared fallback.
- Evidence: tool execution does not bind identity from OpenClaw context.
- Inference: wrong-agent or shared-agent memory can appear even when SQL filters are present, because the filter key can be wrong or model-controlled.
- Unknown: whether the real OpenClaw runtime always supplies `ctx.agentId`; implementation must verify event/context shape with metadata-only tests or logs.

## Allowed Files/Modules

- Modify: `src/tools/tool-contracts.ts`
- Modify: `src/recall/recall-router.ts`
- Modify: `src/evidence/evidence-resolver.ts` only if required to remove ordinary cross-agent propagation from public recall.
- Modify: `src/graph/traversal.ts` only if required to forbid ordinary cross-agent behavior while preserving isolated core test coverage.
- Modify: `openclaw-plugin/src/openclaw-adapter.ts`
- Modify: `openclaw-plugin/src/hooks.ts`
- Modify: `openclaw-plugin/src/tools.ts`
- Modify: `openclaw-plugin/src/openclaw-plugin-sdk.d.ts`
- Modify: `openclaw-plugin/test/tools.test.ts`
- Modify: `openclaw-plugin/test/hooks.test.ts`
- Modify: `openclaw-plugin/test/openclaw-adapter.test.ts`
- Modify: `test/adapters/mcp-adapter.test.ts`
- Modify: `test/recall/recall-router.test.ts`
- Modify: `test/context/context-assembler.test.ts`
- Modify: `test/graph/traversal.test.ts` only if cross-agent core traversal tests are retained as isolated historical/admin-only core behavior.

## Forbidden Files/Modules

- Do not modify Feishu/Lark/OpenClaw send/reply code.
- Do not add a new admin cross-agent tool in PR08.
- Do not add a default `"openclaw-default-agent"` replacement string.
- Do not add a compatibility branch for model-supplied `agent_id`.
- Do not change capture flush thresholds or user-anchored turn grouping.
- Do not change typed graph extraction behavior except for compile fixes caused by public recall type changes.

## Canonical Owner

- `OpenClawPluginToolContext`（OpenClaw 工具上下文：OpenClaw runtime 给工具调用的可信元信息） owns current `agent_id` for ordinary OpenClaw tools.
- `resolveOpenClawSessionIdentity`（OpenClaw 会话身份解析：从 hook event/context 得到当前 agent/session 身份） owns current hook identity.
- `ToolFacade`（工具外壳：host-neutral 工具执行入口） may consume an already trusted `agent_id` but must not derive it from model text.

## Old Owners To Delete

- Delete model-supplied `agent_id` as an ordinary OpenClaw tool owner.
- Delete `allow_cross_agent` as an ordinary `partner_mem_recall` owner.
- Delete `"openclaw-default-agent"` and `"openclaw-default-session"` as shared identity owners.

## Old Public Surfaces To Delete

- Delete `agent_id` from ordinary OpenClaw-facing `partner_mem_search` schema.
- Delete `agent_id` from ordinary OpenClaw-facing `partner_mem_recall` schema.
- Delete `agent_id` from ordinary OpenClaw-facing `partner_mem_timeline` schema.
- Delete `allow_cross_agent` from ordinary OpenClaw-facing `partner_mem_recall` schema.
- Delete `allow_cross_agent` from ordinary `RecallQuery` if no separate admin/core-only type is introduced.

## New Contracts/Types/Fields

- `TrustedOpenClawIdentity`（可信 OpenClaw 身份：runtime 已认证的当前 agent/session）
  - Fields: `agent_id`, `session_id`.
  - `agent_id` allowed values: non-empty string from trusted OpenClaw context field such as `ctx.agentId`; producer is OpenClaw runtime context; storage is none; consumer is hooks/tools; UI projection is none; represented user action is “当前 agent 正在请求记忆”; forbidden actions are model override, default shared agent, and cross-agent normal read/write.
  - `session_id` allowed values: non-empty string from trusted OpenClaw context or event session field; producer is OpenClaw runtime context/event; storage is none; consumer is capture/recent timeline; UI projection is none; represented user action is “当前 OpenClaw 会话”; forbidden action is replacing missing `agent_id`.
- `UntrustedMemoryToolInput`（不可信记忆工具输入：模型传给工具的参数）
  - Allowed fields for `partner_mem_recall`: `query`, `session_id?`, `time_window?`, `limit?`.
  - Allowed fields for `partner_mem_search`: `query`, `session_id?`, `time_window?`, `limit?`.
  - Allowed fields for `partner_mem_timeline`: `session_id?`, `since?`, `until?`, `limit?`.
  - Producer is model/tool call; consumer is `openclaw-plugin/src/tools.ts`; forbidden decisions are agent identity and cross-agent permission.

## Field Producers

- `agent_id` producer: trusted OpenClaw `ctx.agentId` or explicitly validated equivalent in `OpenClawPluginToolContext`.
- `session_id` producer: trusted OpenClaw `ctx.sessionKey` or `ctx.sessionId`, then event session fields only after code confirms event fields are host metadata and not model text.
- `query` producer: model/tool call or latest visible user prompt.
- `limit` producer: model/tool call bounded by plugin config or tool default; it must not create cross-agent capability.

## Storage

- No new tables.
- No migration.
- Retrieval audit rows continue storing the trusted `agent_id` actually used by the runtime.

## Consumers

- `captureAgentEnd` consumes trusted identity for writes.
- `recallBeforePromptBuild` consumes trusted identity for auto recall.
- OpenClaw tools consume trusted identity and merge it into facade calls.
- Core recall/search/timeline consume `agent_id` only after host/runtime has established it.

## UI Projection

None.

## Forbidden Decisions

- A model tool call must not decide `agent_id`.
- A model tool call must not request `allow_cross_agent`.
- A missing trusted `agent_id` must not become a default shared agent.
- A missing trusted `agent_id` must not write memory, recall memory, timeline memory, or project normal capability.
- Session identity must not be used to infer agent identity.

## Old Paths Deleted In This PR

- Delete default shared agent/session fallback from `resolveOpenClawSessionIdentity`.
- Delete ordinary public tool schema fields that expose `agent_id`.
- Delete ordinary public tool schema field `allow_cross_agent`.
- Delete ordinary recall propagation of `allow_cross_agent` from `RecallRouter.recall`.

## Old Paths Not Yet Deleted But Forbidden From New Reads/Writes

- If core traversal still contains `allow_cross_agent` for an explicitly isolated future admin path, mark it `保留为历史事实，不参与决策` for ordinary OpenClaw tools, and tests must prove ordinary tools cannot read/write it.

## Later Deletion PR Numbers

- None. This PR must delete normal-path cross-agent surfaces now.

## APIs To Add/Change/Delete

- Change `createTool(...).execute(toolCallId, params, context)` in `openclaw-plugin/src/tools.ts` to require trusted context identity for memory tools.
- Add a local helper such as `resolveToolIdentity(context)` that returns `TrustedOpenClawIdentity` or throws/returns tool error without memory access.
- Change ordinary tool schemas to remove `agent_id` and `allow_cross_agent`.
- Change `RecallQuery` and `RecallRouter.recall` to remove `allow_cross_agent` from ordinary recall.
- Change `resolveOpenClawSessionIdentity` to return `undefined` or throw typed identity error when no trusted `agent_id` exists.
- Change `captureAgentEnd` and `recallBeforePromptBuild` to skip safely and log metadata-only warning when identity is missing.

## Persistence/Schema/Migration Requirements

- No migration.
- No data rewrite.
- Audit writes must record the trusted `agent_id`, not a model-supplied one.

## Service/Worker Ownership Requirements

- OpenClaw plugin runtime owns identity binding.
- Core storage owns persisted memory.
- `ToolFacade` owns host-neutral execution but must not invent identity.

## Frontend Projection Requirements

None.

## Positive Tests

- Tool recall with trusted context `agentId: "agent-1"` returns agent-1 evidence when params omit `agent_id`.
- Tool timeline with trusted context `agentId: "agent-1"` returns agent-1 timeline when params omit `agent_id`.
- Hook capture with trusted context writes rows under the trusted `agent_id`.
- Hook auto recall with trusted context injects only trusted-agent memory.

## Negative Tests

- Tool params containing `agent_id: "agent-2"` while trusted context is `agent-1` cannot read agent-2 memory and must use or reject to agent-1.
- Tool params containing `allow_cross_agent: true` cannot cross agent and the field is absent from public schema.
- Missing trusted `agent_id` causes no capture write.
- Missing trusted `agent_id` causes no auto recall injection.
- Missing trusted `agent_id` causes memory tools to return an error without calling `ToolFacade`.
- Source test proves no `"openclaw-default-agent"` or `"openclaw-default-session"` remains in OpenClaw plugin source.

## Source Gates

Run:

```bash
rg -n "openclaw-default-agent|openclaw-default-session" openclaw-plugin/src openclaw-plugin/test
```

Expected: no matches.

Run:

```bash
rg -n "allow_cross_agent" src openclaw-plugin/src openclaw-plugin/test test
```

Expected: no ordinary OpenClaw tool, hook, or public recall matches. Any retained core/admin-only match must be named, isolated, tested, and state `保留为历史事实，不参与决策`.

Run:

```bash
rg -n "agent_id: \\{ type: \"string\" \\}" src/tools openclaw-plugin/src openclaw-plugin/test test/adapters
```

Expected: no ordinary OpenClaw-facing public tool schema requires model-supplied `agent_id`.

## Behavior Gates

Run:

```bash
./node_modules/.bin/vitest run openclaw-plugin/test/tools.test.ts openclaw-plugin/test/hooks.test.ts openclaw-plugin/test/openclaw-adapter.test.ts test/recall/recall-router.test.ts test/context/context-assembler.test.ts
```

Expected: pass.

## Mechanical Acceptance Checklist

- Ordinary OpenClaw tools bind `agent_id` from trusted runtime context.
- Ordinary OpenClaw tools do not expose `agent_id` in model-facing schema.
- Ordinary OpenClaw tools do not expose `allow_cross_agent`.
- Hook capture skips without trusted identity.
- Hook recall skips without trusted identity.
- Tests prove wrong-agent params cannot read, mutate, select, resume, project, or appear as normal capability.

## Explicit Failure Conditions

- Fails if model-supplied `agent_id` can decide ordinary recall/search/timeline.
- Fails if `allow_cross_agent` can run through ordinary `partner_mem_recall`.
- Fails if missing identity falls back to a shared string.
- Fails if any test relies on cross-agent ordinary memory access.
