# Partner-Mem V1 原文检索证据调研

> 本文汇总 Partner-Mem V1 关于完整原文、宿主结构字段和多证据检索的产品证据。正式产品规则以 [`../PRD.md`](../PRD.md) 为准。

## 1. 结论

V1 的内容层只保存和检索完整轮次原文，不从正文提取持久字段、事实、摘要、实体、主题、偏好、意图、任务、事件时间或因果关系。

内容检索使用：

- 全文/BM25 索引；
- 每个轮次一个语义向量；
- Harness 明确提供的宿主结构字段；
- 已持久保存的显式回复关系。

全文和向量索引是可重建查询索引，不是节点字段、图边、事实或回答证据。检索最终必须返回完整轮次原文。

## 2. 长对话评测证据

### 2.1 LongMemEval

LongMemEval 将长期对话记忆能力划分为信息提取、多 session 推理、知识更新、时间推理和拒答。官方数据提供 turn 级 `has_answer` 与 `answer_session_ids`，评测重点是找回实际证据轮次，而不是命中摘要或画像。

对官方 `longmemeval-cleaned/longmemeval_oracle.json` 的 500 条样本统计：

| 官方问题类型 | 样本数 | 平均证据 session 数 | 多证据 session 占比 |
|---|---:|---:|---:|
| knowledge-update | 78 | 2.00 | 100% |
| multi-session | 133 | 2.59 | 100% |
| temporal-reasoning | 133 | 2.20 | 85.0% |
| single-session-user | 70 | 1.00 | 0% |
| single-session-assistant | 56 | 1.00 | 0% |
| single-session-preference | 30 | 1.00 | 0% |

直接启示：

1. 更新、多 session 和时间问题通常需要多条原文证据；
2. `knowledge-update`、`multi-session` 等是查询能力或评测类别，不是单个节点字段；
3. 保留前后原文比写回一个“当前值”更适合证据回溯；
4. 找不到证据时必须返回空，而不是生成猜测性答案。

### 2.2 LoCoMo

LoCoMo 包含单跳、多跳、时间推理、开放域知识和对抗问题。论文指出：

- 时间问题依赖对话中的时间线索；
- 多跳问题需要组合多个 session；
- 对抗问题要求证据不足时拒答；
- session summary 可能在转换中丢失回答所需细节；
- 时间推理仍是困难场景。

这支持 V1 的两个边界：返回完整原文；查询期允许 Agent 调用多个独立检索 Tool，但不把组合结果持久化成事实。

## 3. Agent 框架的稳定宿主结构

| 系统 | 可验证的稳定结构 | 对 V1 的意义 |
|---|---|---|
| OpenAI Agents SDK Sessions | session history、turn input、role/content、session ID、message collection | session/message/role 是宿主结构，不是正文分类 |
| LangGraph | `thread_id`、messages、checkpoint、parent checkpoint、`created_at` | thread、消息、时间和显式父级由宿主提供，不能从正文猜测 |
| Anthropic Messages | messages、role/content、tool result、图片和文档内容块 | V1 只接收最终可见文字是产品边界，不自动保存工具上下文或附件 |

共同点是稳定结构集中在 conversation/session/thread/message/role/time/order/branch/run 等宿主生命周期信息。没有跨产品通用、可直接作为持久消息字段的 topic、intent、preference 或 task taxonomy。

## 4. 图检索系统提供的边界证据

| 系统 | 机制 | V1 采用的理论 | V1 不采用的产品机制 |
|---|---|---|---|
| Microsoft GraphRAG | 实体、关系、TextUnit、community report | 检索结果应能回到原始 TextUnit | 实体图和社区摘要 |
| Graphiti / Zep | episode、实体、事实边、时间有效窗口 | 原始 episode 是来源根 | 当前真值、事实失效和演进摘要 |
| Neo4j GraphRAG | vector、full-text、Cypher 与 hybrid retriever | 按索引形态划分检索能力 | 自动知识图构建和任意 Cypher |
| LlamaIndex PropertyGraph | 三元组抽取和 source ID | 派生对象应可回溯来源 | 自动实体身份和持久三元组 |
| LightRAG | 实体与关系聚合、source ID | 来源映射是必要条件 | 将内容实体化为持久图 |

这些系统证明“图与多路检索可以帮助候选发现”，但不能证明简单的 entity/topic 字符串字段在没有实体身份和消歧机制时具有可靠图价值。

## 5. 为什么 V1 不保存正文派生字段

| 候选字段 | V1 结论 | 原因 |
|---|---|---|
| `topic` | 不保存 | 边界不稳定，通常等同语义标签 |
| `entity` | 不保存 | 字符串等同关键词；规范化需要别名解析和身份消歧 |
| `preference` | 不保存 | 容易把一句原文升级为用户画像或当前事实 |
| `intent` | 不保存 | taxonomy 跨 Harness 不稳定 |
| `task` / `activity` | 不保存 | 状态维护会形成可演化对象 |
| `is_update` | 不保存 | 不能独立说明更新了什么，需要事实身份 |
| 事件时间 | 不保存 | 需要解析相对时间、时区、粒度和歧义，增加状态与失败面 |
| 摘要 / observation | 不保存 | 转换可能丢失回答所需细节 |
| 因果关系 | 不保存 | 需要正文推断边和事实判断 |

这不是否认上述信息的查询价值，而是把它们留在查询理解与 Agent 推理阶段，不写入持久节点字段或图边。

## 6. V1 保存与索引

### 6.1 持久保存

```text
轮次节点
完整问题原文
完整回答原文
Partner-Mem 正式对象 ID
Harness 提供的 conversation/thread/message/role/author/agent/time/order
Harness 明确提供、两端均有文字原文的回复关系
```

### 6.2 可重建索引

```text
完整轮次原文的全文/BM25 索引
每个轮次一个语义向量
宿主结构字段的过滤/排序索引
显式回复关系的邻接索引
```

### 6.3 不持久保存

```text
查询候选集合
语义相似关系
关键词命中关系
本次遍历路径选择
跨 Tool 合并结果
排序与相似度分数
摘要、事实、画像和当前状态
正文推断的实体、任务、事件和因果边
```

## 7. 原文证据验收标准

任何检索结果必须：

1. 返回正式 `node_id`；
2. 返回命中轮次的完整问题和回答原文；
3. 返回可用的宿主结构字段；
4. 图结果返回实际持久关系路径；
5. 不用摘要或抽取字段代替原文；
6. 空结果与错误不生成猜测性证据；
7. 查询期的组合、排序和推理不写回长期存储。

## 8. 一手来源

- LongMemEval 官方项目：<https://github.com/xiaowu0162/LongMemEval>
- LongMemEval cleaned 官方数据：<https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned>
- LongMemEval 论文：<https://arxiv.org/abs/2410.10813>
- LoCoMo 论文：<https://arxiv.org/abs/2402.17753>
- OpenAI Agents SDK Sessions：<https://openai.github.io/openai-agents-python/sessions/>
- LangGraph Memory：<https://docs.langchain.com/oss/python/langgraph/add-memory>
- Microsoft GraphRAG Local Search：<https://microsoft.github.io/graphrag/query/local_search/>
- Graphiti：<https://github.com/getzep/graphiti>
- Neo4j GraphRAG：<https://neo4j.com/docs/neo4j-graphrag-python/current/user_guide_rag.html>
- LlamaIndex PropertyGraph：<https://developers.llamaindex.ai/python/framework/module_guides/indexing/lpg_index_guide/>
- LightRAG 论文：<https://arxiv.org/abs/2410.05779v3>
