# PR #8 Construction Sheet：V1 Foundation

## 基本信息

- 模式：`Clean Foundation Strict`（干净底座严格模式）。
- 新 PR：是，PR #8。
- base：`main`，起点 `7df6bb5c60b74e5283ec3908fddd65acaf799b80`。
- branch：`agent/v1-foundation`。
- stacked policy：禁止；PR #8 合并后 PR #9 才能创建。
- dirty-worktree policy：只纳入最新 `docs/PRD.md`、两份 research 和本施工表明确文件；`.DS_Store`、数据库、构建产物禁止提交。
- commit/push/PR/merge：用户已授权；必须先审计 diff、通过门禁、创建 PR，再合并。

## 目标与唯一 owner

用户效果：旧路线完全不能运行；仓库只剩最新 PRD 的正式身份、轮次节点和显式回复关系底座。

canonical owner：`PartnerMemStore`（中文翻译：唯一可以把 V1 产品事实写进 SQLite 的存储类）。

## Scope

允许：

- `docs/PRD.md`
- `docs/research/**`
- `docs/engineering/V1_ARCHITECTURE.md`
- `docs/engineering/PR08_*.md` 至 `PR11_*.md`
- `src/core/**`
- `src/storage/**`
- `test/core/**`
- `test/storage/**`
- root package/build/test/CI/README 文件

禁止：

- 新 Harness runtime 或插件；
- keyword/vector/graph Tool 实现；
- embedding 网络调用；
- 兼容旧数据库、旧 API 或旧 Tool。

## 新契约、字段和数据流

`harness_id`（Harness 实例正式 ID）：允许非空全局 UUID；producer 是 `registerHarness`；storage 是 `harness_instances`；consumer 是所有映射、节点和边；UI projection 为无；用户动作是“安装并注册一个 Harness 实例”；禁止模型提交或从 `harness_type` 推断。

`harness_type`（Harness 产品类型）：允许非空字符串，例如 `Hermes`、`OpenClaw`；producer 是适配器注册；storage 是 harness 与 node；consumer 是查询返回与诊断；不得用它区分租户。

`object_kind`（来源对象种类）：只允许 `conversation | thread | message | author | agent`；producer 是内核调用点；storage 是 `source_object_mappings`；consumer 是 ID resolver；不得从正文推断。

`turn_nodes`：字段完全按架构文档第 5 节；至少一侧文字；原文不 trim、不 normalize、不覆盖。

`explicit_reply_edges`：只保存宿主显式消息回复端点；本 PR 只建 schema 与低层约束。

`agent_conversation_access`：只保存正式权限关系；本 PR 只建 schema 与低层写入。

## 旧路径 disposition

- 旧 owner：delete。
- 旧 public surfaces：delete。
- 旧 fields/types/tests：delete。
- 旧文档：delete。
- 旧 GitHub history：retain as historical fact only；不参与构建或运行。
- 后续仍未实现的新路径：写入 service、retrieval、adapters；不得为此保留旧实现。

## API

新增内部 API：

- `openPartnerMemDatabase(path)`
- `PartnerMemStore.registerHarness(harness_type)`
- `PartnerMemStore.resolveSourceObject(...)`
- `PartnerMemStore.insertTurnNode(...)`
- `PartnerMemStore.insertExplicitReplyEdge(...)`
- `PartnerMemStore.grantAgentConversationAccess(...)`

删除全部旧 runtime、Tool、adapter API。本 PR 不暴露模型 Tool。

## 实施顺序

1. 删除旧源码、测试、工程文档和 adapters。
2. 纳入最新 PRD/research。
3. 建立 package/CI。
4. 建立 contracts。
5. 建立 STRICT schema 与非规范数据库拒绝门禁。
6. 建立 store 与 identity mapping。
7. 建立正向、负向和重启测试。
8. 审计、提交、推送、PR、合并。

## Positive tests

- 新数据库只有规范表。
- 相同 source object 在同一 harness 重复解析得到相同正式 ID。
- 相同 raw ID 在不同 harness 得到不同正式 ID。
- 重启数据库后 mapping 不变。
- 原文按字节语义保留，包括前后空格。

## Negative tests

- 非规范旧数据库拒绝打开。
- raw Harness ID 不能作为正式 conversation ID。
- 两侧都没有文字不能建节点。
- 非允许 `object_kind` 被拒绝。
- 旧模块、旧 Tool 和旧表不能运行。

## Source gates

- `rg -n "partner_mem_search|partner_mem_recall|partner_mem_timeline|partner_mem_status|RawIngestService|RevisionTracker|TypedGraph|summary_payloads|memory_nodes|memory_edges" src test`
- `git diff --check`
- `corepack pnpm typecheck`

预期：第一条无命中；其他命令通过。

## Behavior gates

- `corepack pnpm test:foundation`
- `corepack pnpm test`
- `corepack pnpm build`

## Mechanical acceptance

- [ ] 旧 tracked source/test/adapters 全部删除。
- [ ] 最新 PRD/research 已 tracked。
- [ ] package version 为 `0.2.0`。
- [ ] CI 只运行当前存在的阶段门禁。
- [ ] 不提交 `.DS_Store`、数据库、dist、node_modules。
- [ ] PR diff 与本表一致。

## Failure conditions

任何相关测试失败、发现正常源码保留旧 owner、发现自动旧数据库迁移、或 diff 超出允许范围，立即停止，不创建或合并 PR。
