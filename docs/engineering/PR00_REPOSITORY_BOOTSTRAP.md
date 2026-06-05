# PR00 Repository Bootstrap 施工单

read `AGENTS.md`, inspect referenced code, follow the document in order, do not skip sections, keep scope tight, avoid guessing, verify every claim, and report deviations.

## Base And Branch

- Base: filesystem snapshot in `/Users/zhangye/Documents/partner-mem`.
- Branch: local `main` baseline.
- Purpose: turn the current document-only folder into a safe Git worktree before PR01.

## Exact Scope

只准备施工场地：确认是否已有 Git 元数据、初始化本地 Git 仓库、建立 `main`、提交当前文档基线。PR00 不写产品代码、不改 A1 架构、不安装依赖。

## Allowed Files/Modules

- Read: `AGENTS.md`
- Read: `docs/PROJECT_THINKING.md`
- Read: `docs/FOUNDATION_FROM_MATURE_PROJECTS.md`
- Read: `docs/engineering/*.md`
- Create: `.git/` only if `git rev-parse --show-toplevel` fails and the user has not indicated an existing remote/upstream must be used.
- Optional create: `.gitignore` only for generic generated/runtime exclusions listed in `AGENTS.md`.

## Forbidden Files/Modules

- Do not modify product docs during PR00 except to add a minimal `.gitignore` if absent.
- Do not create `src/`, `test/`, `package.json`, or implementation files.
- Do not add remote origin unless the user explicitly provides one.
- Do not push anywhere.
- Do not delete or rewrite existing documents.

## New Contracts/Types/Fields

None. PR00 creates repository state only.

## Field Producers

None.

## Storage

Git repository metadata only.

## Consumers

PR01 consumes the `main` baseline and starts branch `a1/pr01-graph-contract-schema`.

## UI Projection

None.

## Forbidden Decisions

- Do not treat “not a Git repository” as an unrecoverable architecture blocker for a brand-new local project.
- Do not guess a remote.
- Do not push local-only `AGENTS.md` or planning docs to a remote.
- Do not begin PR01 code work before the baseline commit exists.

## Old Paths Deleted In This PR

None.

## Old Paths Not Yet Deleted But Forbidden From New Reads/Writes

None.

## Later Deletion PR Numbers

None.

## APIs To Add/Change/Delete

None.

## Persistence/Schema/Migration Requirements

None.

## Service/Worker Ownership Requirements

None.

## Frontend Projection Requirements

None.

## Positive Tests

- `git rev-parse --show-toplevel` returns `/Users/zhangye/Documents/partner-mem` after bootstrap.
- `git branch --show-current` returns `main`.
- `git log --oneline -1` shows the baseline commit.
- `git status --short` is empty after the baseline commit, unless `.gitignore` was intentionally left unstaged with a stated reason.

## Negative Tests

- If an existing `.git` is discovered, PR00 must not run `git init`.
- If user provides or requires a remote/upstream, PR00 must not invent one.
- If generated/runtime files are present, PR00 must not stage them.
- If `AGENTS.md` is not the user-requested project override, PR00 must stop before committing it.

## Source Gates

Run:

```bash
find . -maxdepth 3 -type f | sort
```

Expected: only intentional project docs and optional `.gitignore` before bootstrap commit.

Run:

```bash
git status --short
```

Expected before commit: only intentional docs and optional `.gitignore`; expected after commit: empty.

## Behavior Gates

If no Git repository exists and no existing upstream is required, run:

```bash
git init -b main
git add AGENTS.md docs/PROJECT_THINKING.md docs/FOUNDATION_FROM_MATURE_PROJECTS.md docs/engineering
git diff --cached --name-status
git commit -m "Establish the Partner-Mem A1 engineering baseline

Constraint: User requested project-local AGENTS.md and A1 engineering handoff before implementation
Rejected: Starting PR01 without Git metadata | construction sheets require an exact base/head
Confidence: high
Scope-risk: narrow
Directive: Keep Graph Kernel as the single memory owner; do not bypass evidence resolution
Tested: git diff --cached --name-status
Not-tested: implementation tests not applicable to document-only bootstrap"
```

After commit, run:

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

Expected: repo root is `/Users/zhangye/Documents/partner-mem`, branch is `main`, status is empty.

## Mechanical Acceptance Checklist

- Repository exists.
- Branch is `main`.
- Baseline commit contains only intended project docs and optional `.gitignore`.
- No remote is invented.
- No product code is created.
- PR01 has a real base/head to branch from.

## Explicit Failure Conditions

- Fails if bootstrap would overwrite an existing Git repository.
- Fails if remote/upstream is required but unknown.
- Fails if generated/runtime files would be staged.
- Fails if any implementation file is created in PR00.

