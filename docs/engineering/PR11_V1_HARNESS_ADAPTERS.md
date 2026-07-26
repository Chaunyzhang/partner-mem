# PR #11 Construction Sheet：V1 Harness Adapters

## 基本信息

- 模式：`Clean Foundation Strict`。
- 新 PR：是，预计 PR #11。
- base：PR #10 合并后的 `main`；创建前记录实际 hash。
- branch：`agent/v1-harness-adapters`。
- stacked：禁止；工作区必须 clean。
- commit/push/PR/merge：用户已授权；本 PR 完成 V1 并将版本设为 `1.0.0`。

## 目标与 owners

用户效果：Hermes 与 OpenClaw 都能持久复用自己的 `harness_id`，后台写入最终可见文字，并只给模型注册三个 V1 Tool；任一 Partner-Mem 故障不阻塞正常聊天。

domain wrappers：

- Hermes `MemoryProvider`：只翻译 `sync_turn` 与工具调用；
- OpenClaw plugin：只观察 `message_received`、成功的 `message_sent`、注册工具；
- Node runtime：仍是唯一业务 owner。

适配器不得拥有 SQL、配对判断、检索权限或 lifecycle 状态。

## Scope

允许：`integrations/hermes/**`、`openclaw-plugin/**`、runtime packaging、schema generation、CI、README、E2E tests、必要 root workspace files。

禁止：修改 PRD 产品语义、引入抽取模型、自动 summary、旧 Tool、旧自动 context 注入、写入 retry。

## Harness identity

Hermes：`harness_id` 保存到 active `hermes_home`（中文翻译：当前 Hermes profile 的专属数据目录）下 plugin config；首次启动调用 register，重启复用。

OpenClaw：`harness_id` 保存到 plugin-owned state/config；首次 gateway start 注册，重启复用。

原始 conversation/thread/message/author/agent ID 只作为 source ID 发送给内核；不得直接写入 node 正式字段。

## Lifecycle

Hermes `sync_turn` 是 completed turn 回调；daemon worker 后台发送，异常只记录，禁止 join 当前写入、自动 retry 或把 node result 返回宿主。

OpenClaw：

- `message_received` 只记录最终入站文字；
- `message_sent` 仅在 delivery success 时记录最终出站文字；
- `agent_end` 不写入，因为模型结束不等于用户成功看到；
- media-only、hidden TTS transcript、失败/cancelled/streaming/tool/internal 内容不写；
- question/answer correlation 只使用 trusted run/session/message/reply fields 和进程内 map；不得扫描完整历史。

## Tools

Hermes generated schema、OpenClaw manifest/runtime registrations 必须严格等于 PRD 三 Tool。Tool context 注入 trusted harness/conversation/agent；模型 params 不含这些 ID。

Tool failure 返回 `status: error` envelope；auto prefetch 删除；adapter 不编造空结果为历史证据。

## Old path disposition

旧 Hermes/OpenClaw adapter、capture buffer、extractor/model client、旧 memory capability 提示、旧 manifest/tool schemas：delete 后重新创建。无 compatibility。

## Tests

Positive：

- 两种 adapter 重启后 harness ID 不变；
- 相同 raw ID 跨 harness 隔离；
- final user + delivered assistant 构成一节点；
- question-only/answer-only；
- 三 Tool schema 与调用；
- package build/install smoke；
- root-to-adapter E2E。

Negative：

- delivery failure、cancel、streaming、tool result、internal run、media-only 不写；
- Partner-Mem unavailable 不阻塞；
- 不 retry；
- 不暴露 node_id/write result/status/get_node/旧 Tool；
- adapter source scan 无 SQL/domain write；
- duplicate host event 不新增或覆盖。

## Gates

- root typecheck/test/build；
- OpenClaw typecheck/test/package smoke；
- Hermes Python unittest/build/package smoke；
- generated schema comparison；
- full source/behavior gates；
- GitHub CI green。

## Mechanical acceptance

- [ ] root 与所有 package version 为 `1.0.0`。
- [ ] Node engine 与 OpenClaw current requirement 一致。
- [ ] CI 覆盖三套测试。
- [ ] README 提供安装、配置、故障语义和限制。
- [ ] GitHub `main` 只含最新路线。

## Failure conditions

真实宿主接口不能证明最终可见、adapter 需要成为第二持久 owner、相关 E2E 失败、或 package 无法按发布形态安装时，停止合并并报告。
