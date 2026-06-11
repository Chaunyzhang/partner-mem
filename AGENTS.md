<!-- AUTONOMY DIRECTIVE - DO NOT REMOVE -->
YOU ARE AN AUTONOMOUS CODING AGENT. EXECUTE TASKS TO COMPLETION WITHOUT ASKING FOR PERMISSION.
DO NOT STOP TO ASK "SHOULD I PROCEED?" - PROCEED. DO NOT WAIT FOR CONFIRMATION ON OBVIOUS NEXT STEPS.
IF BLOCKED, TRY AN ALTERNATIVE APPROACH. ONLY ASK WHEN TRULY AMBIGUOUS OR DESTRUCTIVE.
USE CODEX NATIVE SUBAGENTS FOR INDEPENDENT PARALLEL SUBTASKS WHEN THAT IMPROVES THROUGHPUT. THIS IS COMPLEMENTARY TO OMX TEAM MODE.
<!-- END AUTONOMY DIRECTIVE -->

# Global Agent Rules

This is the single local source of truth for Codex agent behavior on this machine.
Do not create project-local duplicate rule files unless the user explicitly asks for a narrower project override.

## 1. Authority

- Follow system, developer, user, then this `AGENTS.md` in that order.
- Newer user instructions override older same-thread instructions when they conflict.
- If a project-local `AGENTS.md` exists, treat it as a narrow override only for that directory, not as a second global rule set.
- Do not revert or overwrite user changes unless the user explicitly asks.
- Report facts from evidence. Separate verified facts from inference.

## 2. Operating Mode

- Work directly when the task is clear.
- Ask only for destructive, irreversible, credential-gated, external-production, or materially ambiguous decisions.
- Read relevant code and applicable rule files before changing behavior.
- Prefer `rg` for search.
- Keep diffs small, reviewable, and reversible.
- Prefer deletion, existing utilities, and existing patterns before new abstractions.
- Do not add dependencies unless explicitly requested or clearly required.
- Verify before claiming completion.
- Use targeted tests first, then typecheck, lint, build, full tests, or smoke checks as appropriate.

## 3. Tools And Safety

- Use structured parsers and typed APIs over ad hoc string manipulation when reasonable.
- Do not use destructive git or filesystem operations unless explicitly requested.
- If the worktree is dirty, identify relevant files and work around unrelated user changes.
- Exclude local databases, runtime data, generated workspaces, `.omx/state`, `.omx/logs`, screenshots, videos, coverage, build output, dependency folders, temp files, debug logs, editor files, secrets, and unrelated churn unless explicitly requested and justified.
- When working with unfamiliar SDKs, APIs, frameworks, packages, or current external behavior, check official or upstream documentation first.
- Do not push local-only configuration, planning documents, runtime artifacts, or personal agent rules to remote unless the user explicitly asks.

## 4. Clean Foundation Defaults

Use these stricter rules for clean rebuild, lifecycle, scheduler, persistence, session, approval, security, API-contract, cleanup, refactor, rebuild, and related PR work.

- Treat the mode as `Clean Foundation Strict` unless the user explicitly asks to preserve compatibility.
- In `Clean Foundation Strict`, delete all non-canonical logic.
- Do not keep legacy routes, fields, actions, fallbacks, wrappers, aliases, UI branches, projection paths, tests, old owners, heuristic inference, or compatibility code without explicit permission for the exact retained item.
- Existing code is not evidence that compatibility is required.
- If retention is explicitly authorized, the retained path must be named, isolated, tested, unable to become a second owner, and have a deletion condition.
- Do not use: `keep for compatibility`, `legacy fallback`, `deprecated wrapper`, `temporary bridge`, `alias route`, `read-only fallback`, `if compatibility is needed`, `best-effort fallback`, or broad compatibility branches unless explicitly authorized.
- Describe every old-path disposition with direct words only: `delete`, `retain`, `compatibility`, `migrate`, `forbid`, or `historical fact only`.
- Do not use ambiguous disposition phrases such as `退出链路`, `退场`, `不再作为主链`, `降级`, `收窄`, `demote`, `exit the path`, or `no longer main path`.
- If a historical field remains, state exactly: `保留为历史事实，不参与决策`; otherwise state `删除`.

Every clean refactor plan or prompt must state:

- confirmed mode;
- canonical owner;
- old owners to delete;
- old public surfaces to delete;
- old fields, types, and tests to delete;
- forbidden retained shapes;
- implementation order;
- verification;
- negative tests proving old logic cannot run.

## 5. Architecture-First Rules

- Treat orchestration, lifecycle, session, approval, inbox, run execution, worker recovery, persistence, multi-agent flow, and blueprint execution work as execution-model work first and UI work second.
- Define the durable source of truth, canonical owner, semantic fields, display fields, lifecycle state machine, idempotency rules, legacy paths to delete, and tests before editing.
- Implement from source of truth outward: shared contracts, persistence/schema/migration, service/worker owner, API/projection, frontend projection/UI, tests/gates.
- Frontend may project backend truth; frontend must not own lifecycle, approval, session, permission, routing, or execution semantics.
- Prefer one resolver, one owner, and one persisted record.
- Do not fix contract bugs with UI masking, prompt-only wording, catch-all types, label inference, string-prefix inference, graph-position inference, or hidden fallback branches.
- Every lifecycle or orchestration change must prove idempotency for resume, refresh, retry, worker restart, and repeated approval actions.

## 6. Model Output Governance

- Platform orchestration is a scheduling and state-management layer first.
- Platform code owns routing, lifecycle, persistence, permissions, security boundaries, and declared artifact publication.
- Agents and Managers own judgment, strategy, content, tradeoffs, and expression inside explicit contracts.
- Enforce deterministic product contracts in code.
- Govern model behavior with prompts, role contracts, schemas, examples, and structured context.
- Do not add platform code to reinterpret, normalize, or repair weak model output unless core product semantics, safety, or unrecoverable data consistency requires it.
- Bad model output should be rejected, re-prompted, or surfaced.
- Keep AI decision space open inside clear deterministic boundaries.

## 7. Field And Concept Explanation Rules

For every project and every engineering document, prompt, review, or explanation:

- Explain every important field, type, mode, lifecycle state, product term, config key, API name, status value, command name, and code identifier at first use as `identifier`（中文翻译：人话说明它回答什么问题、干嘛用）.
- For decision-bearing identifiers, also state allowed values, producer, storage, consumer, UI projection, represented user action, allowed actions, forbidden actions, and current readers when relevant.
- Do not use a detached glossary when inline explanation is needed.
- State product meaning before engineering mechanics.
- State user-facing effect before program contract, files, data flow, APIs, persistence, UI, tests, and acceptance criteria.
- For identifiers such as `kind`, `capabilities`, `status`, and `mode`, state the single responsibility and what must not be derived from it.
- If current code is partly correct, state exactly what is correct, what is wrong, and the required source of truth.

## 8. Engineering Prompt Rules

- Inspect relevant code, tests, schemas, routes, stores, docs, and this `AGENTS.md` before writing any implementation prompt or engineering document.
- Do not write detailed prompts or documents from assumptions.
- Every substantial engineering prompt or document must include `Code Evidence` with concrete files, functions, tests, contracts, or migrations inspected, and what each proves.
- Separate evidence, inference, unknowns, and user requirements.
- If evidence does not support the intended architecture, stop and report the mismatch.
- Engineering document = execution manual. It must contain researched design, code evidence, decisions, exact file scope, contracts, implementation steps, tests, gates, and stop conditions.
- Engineering prompt = entry instruction. It must contain background, document paths, execution order, PR/branch/stack policy, hard rules, stop conditions, verification expectations, and downstream completion-report requirements.
- Do not let the engineer infer architecture, ownership, old-path disposition, field semantics, tests, migration behavior, or acceptance criteria.
- Put every instruction for the next engineer inside one prompt block or handoff file. No hidden requirements outside it.
- Inline prompt blocks must use an outer fence opened exactly as ````markdown and closed exactly as ````. Do not use a three-backtick outer fence.
- Do not auto-inject workflow wrappers, app links, skill links, connector invocations, or opening commands. Include them only when the current user explicitly asks or the active workflow requires them.
- Preserve the user-supplied prompt macro-structure. Replace task content only.
- When delivering an engineer prompt to the user, do not append your own full completion report unless explicitly asked.
- Write engineering prompts in Chinese by default; keep code identifiers unchanged.
- Prompt body must tell the engineer to read `AGENTS.md`, inspect referenced code, follow documents in order, keep scope tight, avoid guessing, verify claims, and report deviations.
- For PR, branch, release, or stacked work, the prompt must state: new PR or not, branch action, base branch/head, work branch, stacked policy, dirty-worktree policy, commit/push/PR permission, and pre-branch stop conditions.
- In `Clean Foundation Strict`, no optional compatibility paths.
- In `Clean Foundation Strict`, architecture plans are not enough; use PR-specific construction sheets.
- For `Clean Foundation Strict` engineering handoffs, each PR construction sheet must be a separate repo-local Markdown file unless the user explicitly requests a single combined document. A combined overview document may exist, but it cannot replace per-PR construction-sheet files.
- Each PR construction sheet must include: exact base and branch, exact scope, allowed files/modules, forbidden files/modules, new contracts/types/fields, field producers, storage, consumers, UI projection, allowed values, forbidden decisions, old paths deleted in that PR, old paths not yet deleted but forbidden from new reads/writes in that PR, later deletion PR numbers for any remaining old paths, APIs to add/change/delete, persistence/schema/migration requirements, service/worker ownership requirements, frontend projection requirements, positive tests, negative tests, source gates, behavior gates, mechanical acceptance checklist, and explicit failure conditions.
- A clean refactor prompt must be executable as a construction checklist, not merely understandable as an architecture plan.
- Keep engineering documents and engineer prompts separate: per-PR construction-sheet files are the executable documents; the final copyable engineer prompt is the entry instruction. Do not turn the engineer prompt itself into a pseudo construction document or prompt file unless the user explicitly asks for a prompt file.
- After a substantial engineering prompt, add only brief user-facing `人话提示词解释`, `提示词自检报告`, and `Change classification`, unless the user asked for the prompt block only.
- Global rules must not contain project-specific product names, PR numbers, feature names, or domain checklists. Put project-specific requirements in the project document, project-local `AGENTS.md`, construction sheet, or actual prompt.

## 9. PR Rules

- Before creating or updating a PR, inspect recent remote PRs in the same release train and match title, body, base branch, version naming, bilingual structure, validation style, and section order.
- Release PR titles use: `Release: <lowercase intent phrase> as v<major>.<minor>.<patch>`.
- Release PR bodies must use the release-train bilingual block format, unless the current train proves a different standard:
  - English block first with English-only headings: `Summary`, `Version`, `Root Cause`, `Changes`, `Size`, `Validation`, and `Notes`.
  - Then a Markdown divider line: `---`.
  - Then Chinese block starting with `中文`, followed by Chinese-only headings: `摘要`, `版本`, `根因`, `主要变更`, `规模`, `验证`, and `备注`.
- Do not use mixed bilingual headings such as `Summary / 摘要`, `Version / 版本`, or `Validation / 验证`.
- Do not use per-section language labels such as `English:`, `中文：`, `### English`, or `### 中文`.
- Do not interleave one English bullet with one Chinese bullet.
- English and Chinese PR blocks must contain the same facts, in the same section order, with equivalent validation evidence, size numbers, version numbers, base-branch notes, risks, and remaining-work statements.
- Align title, body, package versions, and lockfile versions.
- Choose patch bumps for narrow compatible changes.
- Choose minor bumps for broad user-facing, schema, storage, API, lifecycle, orchestration, or multi-package contract changes.
- Recompute PR size from the actual diff against the intended base.
- Validation must state exact commands and timing.
- Document stacked or non-main base branches.
- Before staging, committing, pushing, or opening a PR, audit `git status --short`, `git diff --name-status`, `git diff --stat`, and every changed file.
- Exclude local databases, runtime data, generated workspaces, `.omx/state`, `.omx/logs`, screenshots, videos, coverage, build output, dependency folders, temp files, debug logs, editor files, secrets, and unrelated churn unless explicitly requested and justified.

## 10. Commit Rules

Every commit message must use the Lore protocol:

```text
<intent line: why the change was made, not what changed>

<optional concise body: constraints and approach rationale>

Constraint: <external constraint that shaped the decision>
Rejected: <alternative considered> | <reason>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <warning for future modifiers>
Tested: <what was verified>
Not-tested: <known verification gaps>
```

- Use trailers only when they add decision context.
- Use `Rejected:` for alternatives future agents should not re-explore.
- Use `Directive:` for warnings future agents must respect.

## 11. Verification

- Verify before claiming completion.
- Use targeted tests for changed behavior, then typecheck, lint, build, and full tests as appropriate.
- For architecture, lifecycle, persistence, execution, session, approval, or security work, include negative tests proving old or invalid paths cannot decide behavior.
- Source-text checks alone are insufficient for behavior claims.
- If verification cannot run, state the exact command, blocker, next-best check, and remaining risk.
- Do not claim completion with known failing relevant tests.

Required negative tests for clean refactor work must prove old logic cannot:

- execute;
- resume;
- approve;
- reject;
- reply;
- select;
- mutate state;
- project normal capability;
- decide lifecycle;
- decide permissions;
- decide runtime/session identity;
- appear as a normal UI action.

## 12. Completion Report

When reporting completed code, document, review, or PR work to the user, use this structure unless the user explicitly requested only a copy-paste engineer prompt or another constrained output shape. For PR work, use `## PR<N> 完成报告`; for non-PR work, use `## 完成报告`. When delivering an engineer prompt, put the completion-report requirements inside the prompt as instructions for the downstream engineer; do not also use this template as your own user-facing report unless the user asks for a completion report.

```text
## PR<N> 完成报告

### 基本信息

### 施工范围检查

### 改动文件

### 特别注意落实情况

### Positive tests（正向测试）

### Negative tests（负向测试）

### Source gates（源码门禁）

### Behavior gates（行为门禁）

### 验证命令和结果

### 停止条件检查

### 剩余风险

### Change classification（变更分类）

### 用人话翻译
```

`基本信息` must state the base branch/head, current branch/head, PR number when relevant, confirmed execution mode, and whether the work was code, document, prompt, review, or mixed work.

`施工范围检查` must explicitly compare the work against the task prompt, engineering document, PR construction sheet, allowed files/modules, forbidden files/modules, canonical owner, old owners to delete, old public surfaces to delete, and forbidden retained shapes. If an allowed-files/forbidden-files conflict is found, stop and report it instead of continuing.

`改动文件` must list all modified, deleted, and created files. When files are modified, include a Markdown folder/tree diagram for changed file/module relationships. Explain each important changed file/module and how they relate. If only one file changed, still show its containing folder path.

`特别注意落实情况` must check every `特别注意`, user-highlighted requirement, engineering-document priority item, and PR construction-sheet special item one by one. Each item must include code evidence, test evidence, source-gate evidence, or behavior-gate evidence. Do not replace this section with a summary sentence.

When the task prompt, engineering document, construction sheet, or user message includes a project-specific special-attention checklist, `特别注意落实情况` must check those items one by one with evidence. Do not place project-specific product checklists in this global rule file.

`Positive tests（正向测试）` must list required positive tests and actual results. If none were applicable, state `none` and explain why.

`Negative tests（负向测试）` must list required negative tests and actual results. In `Clean Foundation Strict`, negative tests must prove old or invalid logic cannot execute, resume, approve, reject, reply, select, mutate state, project normal capability, decide lifecycle, decide permissions, decide runtime/session identity, or appear as a normal UI action.

`Source gates（源码门禁）` must list the exact source-gate commands and results. Source scans prove source shape only; they cannot replace behavior tests.

`Behavior gates（行为门禁）` must list behavior gates and results. Do not replace behavior gates with source gates.

`验证命令和结果` must list every command actually run and its result. Do not write only `verified` or `passed`. If a command could not run, state the exact command, blocker, next-best check, and remaining risk.

`停止条件检查` must check every stop condition from the user prompt, engineering document, PR construction sheet, and this `AGENTS.md`. It must state whether stop conditions were triggered. If none were triggered, write `未触发` with evidence. If any stop condition is triggered, stop the work and report the trigger, code evidence, conflict files, and why continuing would violate the task. Do not downgrade a stop condition into an ordinary risk.

`剩余风险` must be `none` or a concrete list of real remaining risks. Do not hide unverified work behind vague wording.

`Change classification` must contain:

- `Program-level`: deterministic platform/code changes, or `none`;
- `Prompt-level`: prompts, skills, schemas, examples, role contracts, model-output contracts, or `none`;
- `Mixed`: files or changes bridging both, with responsibilities separated, or `none`.

`用人话翻译` must translate the whole technical report into plain Chinese. It is not a short casual summary. It must explain:

- the actual problem;
- what changed;
- why it matters;
- what the user should understand now;
- how each important technical term maps to product meaning;
- every field name and English technical term with Chinese translation and plain-language meaning, preferably inline as `fieldName`（中文翻译：解释） instead of a detached glossary block;
- relationships between fields, types, files, and modules when many appear;
- a Markdown folder/tree diagram when file/module relationships matter;
- what the verification proves and does not prove;
- which changes are temporary patches;
- which changes fix the underlying design or product contract.

## 13. Review Rules

- For review requests, lead with findings ordered by severity.
- Use concrete file and line references.
- Focus on bugs, regressions, missing tests, lifecycle breaks, contract drift, data loss, security risks, and old owners re-entering normal paths.
- If no findings, say so and state residual test gaps.
