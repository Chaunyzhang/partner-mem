# OpenClaw Memory Safety And User-Anchored Capture 工程总览

read `AGENTS.md`, inspect referenced code, follow the PR construction sheets in order, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Confirmed Mode

- Confirmed execution mode: `Clean Foundation Strict`（干净底座严格模式：把 `agent_id` 身份隔离、上下文注入安全、写入阈值、用户锚点轮次切分作为新 canonical contract，不保留普通工具跨 agent、默认共享身份、把注入块当可见用户消息、必须等 assistant 才写入的旧形状）。
- Work type: engineering document and implementation handoff.
- User-facing problem: Partner-Mem 可能把很久以前的话注入到当前模型上下文；默认 7 轮写入导致新信息迟迟不落库；agent 回话失败时用户消息不写入；普通工具暴露 `agent_id` 和 `allow_cross_agent`，不符合“agent 身份证号绝对不能串”的产品边界。

## Base, Branch, Stack

- Observed current branch/head while writing this document: `codex/openclaw-turn-capture-cursor` / `3f851de Bound audit log growth after capture flushes`.
- Observed dirty worktree while writing this document: modified `AGENTS.md`, `src/recall/recall-router.ts`, `src/search/seed-index.ts`, `test/recall/recall-router.test.ts`, `test/search/seed-index.test.ts`; untracked engineering docs under `docs/engineering/`.
- Required implementation base: a clean branch containing the OpenClaw plugin capture runtime at or after `3f851de`. Before implementation, run `git status --short`, `git diff --name-status`, and `git diff --stat`.
- Branch action: create separate implementation branches per construction sheet. Do not implement all four sheets in one branch unless the user explicitly changes stack policy.
- Stack policy:
  - PR08 branch `codex/partner-mem-agent-id-isolation` based on clean `codex/openclaw-turn-capture-cursor` at `3f851de` or the current reviewed successor.
  - PR09 branch `codex/partner-mem-context-injection-safety` stacked on PR08.
  - PR10 branch `codex/partner-mem-capture-flush-two-turns` stacked on PR09.
  - PR11 branch `codex/partner-mem-user-anchored-turns` stacked on PR10.
- Commit/push/PR permission: do not stage, commit, push, or open PR unless the user explicitly requests it in the implementation thread. If requested, use the Lore commit protocol from `AGENTS.md`.
- Pre-branch stop conditions: stop if current branch is not clean except user-approved planning docs; stop if OpenClaw plugin files are absent; stop if `AGENTS.md` rules conflict with any construction sheet.

## Code Evidence

- `openclaw-plugin/src/openclaw-adapter.ts:70-90` — `resolveOpenClawSessionIdentity`（OpenClaw 身份解析：把 hook event/context 转成 memory 身份） currently returns default `"openclaw-default-agent"` and `"openclaw-default-session"` when trusted identity fields are missing. This directly conflicts with `agent_id`（agent 身份证号：记忆属于哪个 agent） as a hard boundary.
- `src/tools/tool-contracts.ts:24-70` — `partner_mem_search`（候选搜索工具）、`partner_mem_recall`（验证证据召回工具）、`partner_mem_timeline`（原始时间线工具） schemas require model-supplied `agent_id`; `partner_mem_recall` exposes `allow_cross_agent`（是否允许跨 agent 证据路径）。 This is a normal tool surface that can request another agent's bucket.
- `openclaw-plugin/src/tools.ts:30-52` — OpenClaw tool execution passes raw `params` directly to `ToolFacade` without overwriting `agent_id` from trusted tool context.
- `src/recall/recall-router.ts:7-18` and `src/recall/recall-router.ts:62-69` — `RecallQuery` includes `allow_cross_agent`, and `RecallRouter.recall` forwards it to `EvidenceResolver`. This is the current ordinary recall cross-agent switch.
- `openclaw-plugin/src/hooks.ts:80-105` — `recallBeforePromptBuild`（prompt 构建前召回 hook） returns `{ appendContext: formatted }`, so Partner-Mem injects memory as appended prompt context.
- `openclaw-plugin/src/openclaw-adapter.ts:92-125` — `formatContextBlockForOpenClaw`（OpenClaw 上下文格式化器） emits `Partner-Mem verified raw evidence`, `Partner-Mem recent raw timeline`, and `Partner-Mem safety instructions` text sections.
- `openclaw-plugin/src/openclaw-adapter.ts:179-213` — `stripLeadingPartnerMemContextBlocks`（注入块剥离器） strips only leading Partner-Mem blocks. If old evidence is restated without the fixed leading headers, current capture cannot distinguish it from visible text.
- `openclaw-plugin/src/config.ts:28-56` — `captureFlushMaxTurns`（写入轮次阈值：攒多少轮后刷写） defaults to `7`.
- `openclaw-plugin/src/capture-buffer.ts:64-87` — `collectFlushableTurns`（收集可刷写轮次） flushes when complete turns reach threshold or token estimate reaches threshold.
- `openclaw-plugin/src/capture-buffer.ts:101-126` — `collectCompleteTurnMessages`（完整轮次切分器） requires at least one assistant message after user messages; user-only trailing messages are not flushed.
- `openclaw-plugin/test/hooks.test.ts:223-255` — current tests assert user-only messages remain pending until assistant reply appears. This test must change in PR11.
- `openclaw-plugin/test/openclaw-adapter.test.ts:73-94` — current tests assert leading Partner-Mem injection blocks are stripped before raw capture. PR09 must strengthen this boundary.

## Evidence, Inference, Unknowns

- Evidence: Partner-Mem has no code path that directly sends Feishu/Lark messages; repository search found no send/post/reply/webhook/fetch path in `openclaw-plugin/src`.
- Evidence: Partner-Mem injects old memory text into OpenClaw prompt context through `appendContext`.
- Evidence: current default capture flush threshold is 7 turns.
- Evidence: current turn grouping does not persist a user-only message until an assistant message follows.
- Evidence: ordinary public tool schemas expose `agent_id`, and `partner_mem_recall` exposes `allow_cross_agent`.
- Inference: the “system sends old words” symptom can be fueled by Partner-Mem if OpenClaw/Feishu/model layers treat `appendContext` text as visible user text or if the model repeats injected evidence as a reply. This document fixes the Mem-side contributors but does not claim to fix non-Mem send behavior.
- Unknown: the exact OpenClaw runtime event shape in the failing real environment. PR08 must log or test trusted context identity shape without storing message text.

## Product Decisions

- `agent_id`（agent 身份证号：回答“这条记忆属于哪个 agent”） is a hard isolation boundary. Allowed source for ordinary OpenClaw tools and hooks: trusted OpenClaw runtime context only. Forbidden: model-supplied `agent_id`, default shared agent, normal-path cross-agent switches.
- `session_id`（会话身份证号：回答“这条消息属于哪个 OpenClaw 会话”） is a secondary boundary. It may scope recent timeline when the product requires current-session-only behavior; it must not substitute for `agent_id`.
- `appendContext`（追加上下文：给模型看的隐藏记忆背景） must remain hidden model context. It must not become a user-visible message and must not be captured as a new user fact.
- `captureFlushMaxTurns` default must become `2` so normal conversation memory is written promptly.
- `turn`（记忆轮次：一条用户消息和它后续 assistant 消息，直到下一条用户消息前） is anchored by user messages. A user-only message is a valid minimal turn.

## Construction Sheets

Implement in this exact order:

1. `docs/engineering/PR08_AGENT_ID_TOOL_ISOLATION.md`
2. `docs/engineering/PR09_CONTEXT_INJECTION_CAPTURE_SAFETY.md`
3. `docs/engineering/PR10_CAPTURE_FLUSH_DEFAULT_TWO_TURNS.md`
4. `docs/engineering/PR11_USER_ANCHORED_TURN_CAPTURE.md`

Do not skip PR08. PR09-PR11 increase recall/capture frequency and safety; doing them before identity isolation can make wrong-agent memory appear faster or more often.

## Overall Source Gates

Run after each PR:

```bash
rg -n "openclaw-default-agent|openclaw-default-session|allow_cross_agent|agent_id: \\{ type: \"string\" \\}" openclaw-plugin/src src openclaw-plugin/test test
```

Expected:
- After PR08, no normal OpenClaw tool schema exposes `agent_id`; no ordinary recall path exposes `allow_cross_agent`; no OpenClaw hook uses default shared agent/session.
- Any remaining `allow_cross_agent` appears only in explicitly isolated core/admin tests or historical docs with `保留为历史事实，不参与决策`.

Run after each PR:

```bash
./node_modules/.bin/vitest run openclaw-plugin/test/hooks.test.ts openclaw-plugin/test/openclaw-adapter.test.ts openclaw-plugin/test/runtime.test.ts openclaw-plugin/test/tools.test.ts test/context/context-assembler.test.ts test/recall/recall-router.test.ts
```

Expected: pass, with tests updated per each PR sheet.

## Stop Conditions

- Stop if an implementation requires a normal public tool to accept model-supplied `agent_id`.
- Stop if an implementation requires default shared identity fallback.
- Stop if an implementation requires normal `partner_mem_recall` to cross agent.
- Stop if injected Partner-Mem context must be represented as a visible user message.
- Stop if user-only messages cannot be persisted without an assistant reply.
- Stop if the implementation changes Feishu/OpenClaw sending behavior directly; this stack only fixes Mem-side contributors.
