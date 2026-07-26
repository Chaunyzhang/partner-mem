# Partner-Mem V1 检索 Tools 调研与确认契约

> 本文汇总 Partner-Mem V1 专用检索 Tool 的产品证据和已确认契约。正式产品规则以 [`../PRD.md`](../PRD.md) 为准。

## 1. 结论

V1 的模型可见检索 Tool 按检索对象与索引形态划分：

```text
完整轮次原文
├── 全文/BM25 索引 ── partner_mem_keyword_search
├── 语义向量索引 ─── partner_mem_vector_search
└── 持久关系图 ────── partner_mem_graph_traverse
```

共同边界：

1. 每个 Tool 只查询一种明确的数据形态；
2. Tool 内部可以产生候选，但模型可见输出必须返回完整轮次原文；
3. Harness 中的 Agent 决定调用哪个 Tool，可以顺序调用多个 Tool；
4. 不提供隐藏多种检索方式的黑盒 recall Tool；
5. 不提供 keyword 与 vector 融合的 hybrid Tool；
6. `get_node` 仅是适配插件与内核之间的内部精确读取接口；
7. Tool 不生成最终回答、摘要、事实或画像；Agent 根据返回原文回答用户；
8. 写入由适配插件监听 Harness 生命周期异步完成，不提供模型可见写入 Tool。

## 2. 为什么按索引形态划分

### 2.1 Elasticsearch Retriever Tree

Elasticsearch 官方将检索器分为：

- `standard retriever`：传统全文查询；
- `knn retriever`：向量近邻查询；
- `rrf`、`linear` 等 compound retriever：组合多个子检索器。

这说明全文、向量是基础检索原语，融合是上层组合，不应以“先找候选、再取得证据”的业务阶段拆分基础能力。

### 2.2 Neo4j GraphRAG

Neo4j GraphRAG 官方分别提供 `VectorRetriever`、`VectorCypherRetriever`、`HybridRetriever`、`Text2CypherRetriever` 等检索器，区分向量索引、图查询和组合检索。这项资料支持分别评估全文、向量和图查询的输入、排序和结果契约。

### 2.3 RRF 的位置

RRF 原论文将其定义为合并多个检索结果排名的方法。Elastic 官方说明 RRF 不要求 BM25 与向量分数处于同一尺度。

V1 已确认不提供 hybrid Tool，也不在 Partner-Mem 内核执行跨 Tool RRF。Harness 需要两种召回时分别调用 keyword 与 vector Tool，并用正式 `node_id` 识别重复轮次。RRF 只保留为未来可能评估的外部理论，不属于 V1 契约。

## 3. 身份与查询范围

关键词与向量 Tool 共用两档 scope：

| scope | 查询边界 |
|---|---|
| `current_conversation` | 默认值；适配插件注入的当前 `harness_id + conversation_id` |
| `agent_conversations` | 当前 Harness 实例中，适配插件注入的当前 `agent_id` 可访问的历史 conversations |

规则：

1. 模型只选择 scope 名称；
2. `harness_id`、`conversation_id`、`agent_id` 由适配插件内部注入；
3. 模型不得提交或覆盖正式身份 ID；
4. V1 不自动跨 Harness 查询；
5. 图 Tool 从已知正式 `node_id` 出发，但起点、边和目标节点都必须执行同样的访问边界校验。

## 4. `partner_mem_keyword_search`

### 4.1 检索对象

完整轮次节点问题与回答原文建立的全文/BM25 索引。

### 4.2 输入

```json
{
  "query": "event_time_anchors",
  "scope": "agent_conversations",
  "limit": 10
}
```

| 字段 | 规则 |
|---|---|
| `query` | 必填、非空字符串 |
| `scope` | 可选；默认 `current_conversation` |
| `limit` | 可选；默认 10，最大 20 |

### 4.3 功能

- 检索精确词、专有名词、短语和文字片段；
- 在 scope 过滤后执行全文/BM25 排序；
- 按正式 `node_id` 去重；
- 返回完整轮次原文；
- 只返回从 1 开始的 `rank`，不把 BM25 原始分数作为证据。

### 4.4 不负责

- 语义近似；
- 向量生成；
- 图关系扩展；
- 自动调用其他 Tool；
- 生成答案或摘要。

## 5. `partner_mem_vector_search`

### 5.1 检索对象

每个轮次节点对应的一个可重建语义向量。

### 5.2 向量生成规则

- 问题和回答同时存在时，按固定的“问题原文在前、回答原文在后”顺序拼接；
- 只有一侧文字时，只使用存在的一侧；
- 每个轮次最多一个向量；
- 向量直接回指正式 `node_id`；
- 向量不是图节点、事实或回答证据。

Elasticsearch nested kNN 和 Qdrant multivector 证明一个对象可以有多种向量表示，但 V1 选择单向量以减少索引、去重和重建复杂度。

### 5.3 输入

```json
{
  "query": "我们之前对 V1 的取舍原则是什么？",
  "scope": "agent_conversations",
  "limit": 10
}
```

输入契约与关键词 Tool 相同。查询向量由 Partner-Mem 内部从 `query` 生成；模型不得提交向量、embedding model 或相似度阈值。

### 5.4 功能

- 检索措辞不同但语义接近的轮次；
- 在 scope 过滤后按向量近邻排序；
- 按正式 `node_id` 去重；
- 返回完整轮次原文；
- 只返回 `rank`，不把原始相似度作为证据。

### 5.5 不负责

- 全文/BM25 精确匹配；
- 图关系扩展；
- 自动融合关键词结果；
- 把语义近似持久化为关系；
- 生成答案或摘要。

## 6. `partner_mem_graph_traverse`

### 6.1 检索对象

Partner-Mem 已持久保存的正式轮次节点和显式回复关系边。V1 不存在正文推断的实体、任务、事件或事实边。

### 6.2 输入

```json
{
  "start_node_id": "pm-node-id",
  "direction": "both",
  "max_depth": 3,
  "limit": 10
}
```

| 字段 | 规则 |
|---|---|
| `start_node_id` | 必填；每次调用只接受一个正式起点 |
| `direction` | 必填；`parent`、`replies` 或 `both` |
| `max_depth` | 可选；默认 1，最大 3 |
| `limit` | 可选；默认 10，最大 20 |

V1 只有显式回复关系，模型不提交 `edge_type`。图 Tool 不接受自然语言 `query` 或 `scope`。

### 6.3 遍历规则

1. 广度优先，先返回较近跳数；
2. 同一跳数内优先按宿主显示顺序；
3. 没有宿主顺序时按消息显示时间；
4. 仍相同时按 `node_id` 稳定排序；
5. 循环检测与节点去重由 Tool 内部完成；
6. 每个结果保留从起点到目标的实际持久关系路径；
7. 无权节点、无效关系或循环停止对应分支；
8. 达到总数上限时返回 `truncated: true`；
9. 每个目标节点直接携带完整轮次原文。

## 7. 共同输出契约

```json
{
  "status": "ok",
  "retrieval_type": "keyword",
  "truncated": false,
  "evidence_items": [
    {
      "rank": 1,
      "node_id": "pm-node-id",
      "harness_id": "pm-harness-id",
      "conversation_id": "pm-conversation-id",
      "thread_id": null,
      "question": {
        "text": "完整问题原文",
        "message_id": "pm-message-id",
        "role": "user",
        "author_id": "pm-author-id",
        "visible_at": "2026-07-11T10:00:00Z"
      },
      "answer": {
        "text": "完整回答原文",
        "message_id": "pm-message-id",
        "role": "assistant",
        "author_id": "pm-author-id",
        "agent_id": "pm-agent-id",
        "visible_at": "2026-07-11T10:00:05Z"
      }
    }
  ]
}
```

节点只有一侧文字时，另一侧为 `null`。图 Tool 的 evidence item 另带实际关系路径。

空结果：

```json
{
  "status": "empty",
  "retrieval_type": "keyword",
  "truncated": false,
  "evidence_items": []
}
```

不可用：

```json
{
  "status": "error",
  "retrieval_type": "keyword",
  "truncated": false,
  "error": "partner_mem_unavailable",
  "evidence_items": []
}
```

失败不得阻塞 Harness 正常对话；Agent 不得把空结果或错误编造成历史证据。

## 8. Harness 接入研究

- Hermes General Plugin 支持插件声明并注册 Tool；
- Hermes Memory Provider 接口支持提供 Tool schemas 和处理 Tool 调用；
- OpenClaw Tool Plugin 支持注册 Agent-callable typed tools；
- MCP 定义 `tools/list`、`tools/call`、`inputSchema`、`outputSchema` 和结构化结果；
- Claude Code 与 Codex 支持 MCP Tool。

产品结论是统一 Tool 名称、输入语义和输出契约；每个 Harness 的适配插件负责宿主原生注册、内部身份注入和结果转换。V1 不要求所有 Harness 使用同一种进程通信协议。

## 9. 实现验收边界

实现必须满足：

- 只注册三个模型可见检索 Tool；
- Tool schema 不暴露正式身份 ID、向量、模型名称、阈值或边类型；
- 所有命中返回完整轮次原文；
- `get_node`、状态检查和索引管理不进入模型 Tool 列表；
- keyword 与 vector 不在内核自动融合；
- graph 只沿已持久保存的显式回复关系；
- 空结果与错误具有不同状态；
- Tool 失败不影响正常对话。

具体数据库、tokenizer、embedding model、向量库和进程通信方式属于工程选型，不得改变上述产品契约。

## 10. 一手来源

- Hermes General Plugin：<https://hermes-agent.nousresearch.com/docs/developer-guide/plugins>
- Hermes Memory Provider Plugin：<https://hermes-agent.nousresearch.com/docs/developer-guide/memory-provider-plugin>
- OpenClaw Tool Plugins：<https://docs.openclaw.ai/plugins/tool-plugins>
- Elasticsearch Retrievers：<https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers>
- Elasticsearch Standard Retriever：<https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/standard-retriever>
- Elasticsearch kNN Retriever：<https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/knn-retriever>
- Elasticsearch RRF Retriever：<https://www.elastic.co/docs/reference/elasticsearch/rest-apis/retrievers/rrf-retriever>
- Elasticsearch nested kNN：<https://www.elastic.co/docs/solutions/search/vector/knn>
- Neo4j GraphRAG Retrievers：<https://neo4j.com/docs/neo4j-graphrag-python/current/user_guide_rag.html>
- Qdrant Vectors：<https://qdrant.tech/documentation/manage-data/vectors/>
- MCP Tools Specification：<https://modelcontextprotocol.io/specification/2025-06-18/server/tools>
- Claude Code MCP：<https://docs.anthropic.com/en/docs/claude-code/mcp>
- Codex MCP：<https://developers.openai.com/codex/mcp/>
- RRF 原论文 DOI：<https://doi.org/10.1145/1571941.1572114>
