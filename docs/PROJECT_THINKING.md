# Partner-Mem Project Thinking

## 1. Name

`partner-mem` means partner memory.

`partner` is spelled correctly. In this project, it means a long-term companion, collaborator, and memory partner for an agent.

The product meaning is:

> Let an agent become the one who understands you best, because it can keep and retrieve your shared history.

This project is not trying to make another chat agent. It provides a memory layer that agents can call through tools.

## 2. Core Goal

The first version should do one thing well:

> Remember everything visible, then reliably find the original text later.

The system should not start with complex user profiles, preference models, project memory, personality modeling, or enterprise workflow concepts.

First make memory trustworthy:

- store visible conversation text;
- index it locally;
- retrieve relevant candidates fast;
- return original text as evidence;
- expose the capability as tools that any host agent can call.

## 3. Product Tone

Partner-Mem should feel like a durable memory companion for agents.

The emotional promise is human:

> The agent remembers the things you have been building, deciding, correcting, and repeating.

The engineering promise is stricter:

> The system must not pretend. If it cannot find original evidence, it should say it cannot find it.

This means summaries, graph nodes, vectors, and inferred relationships can help search, but they are not final evidence. Final evidence is original text.

## 4. First Version Scope

Version 1 should be intentionally simple.

In scope:

- local SQLite storage;
- raw visible message storage;
- time fields for every raw memory;
- graph-native node and edge model;
- schema-level support for summary nodes and summary evidence edges;
- full-text search over raw text;
- graph links from raw messages to memory nodes;
- retrieval tools for agents;
- context assembly for host prompt injection;
- configurable recall, context, chunking, and summary thresholds;
- evidence packets that return original text;
- basic doctor checks.

Out of scope:

- user preference modeling;
- curated project memory categories;
- personality modeling;
- automatic life profile generation;
- enterprise permissions;
- cloud sync;
- multi-user teams.

## 5. Architecture Direction

The project should be graph-native from the beginning.

The graph is the base structure, not an optional feature bolted on later.

Core node types:

- `raw_message`: original visible user or assistant text;
- `summary`: optional navigation summary;
- `entity`: person, tool, product, file, concept, or object;
- `task`: something the user wanted to do;
- `event`: something that happened;
- `decision`: something decided;
- `artifact`: a file, repo, document, branch, PR, or output.

Core edge classes:

- `evidence`: an edge that can support returning original text;
- `semantic`: a relationship used for finding related memories;
- `temporal`: ordering or time-window relationship;
- `navigation`: search or summary route relationship.

The key rule:

> Any path may help retrieval, but final answer evidence must resolve back to `raw_message`.

## 5.0 Graph Mental Model

Partner-Mem should use real graph structure, not fake graph fields.

A node is one memory object.

An edge is one relationship or route between memory objects.

Fields describe a node. Edges connect nodes.

Example nodes:

```text
raw_message("用户说：新项目叫 partner-mem")
entity("partner-mem")
task("设计伙伴记忆系统")
decision("v1 只以原文作为最终证据")
artifact("PROJECT_THINKING.md")
```

Example edges:

```text
entity("partner-mem") --MENTIONED_IN_RAW--> raw_message(...)
task("设计伙伴记忆系统") --EVIDENCED_BY_RAW--> raw_message(...)
decision("v1 只以原文作为最终证据") --EVIDENCED_BY_RAW--> raw_message(...)
artifact("PROJECT_THINKING.md") --EVIDENCED_BY_RAW--> raw_message(...)
task("设计伙伴记忆系统") --RELATED_TO--> entity("partner-mem")
```

Do not hide relationships inside a node field such as:

```text
Node {
  relatedRawIds: [...]
  relatedTasks: [...]
  relatedEntities: [...]
}
```

Those arrays may be useful caches, but they are not the source of truth.

The source of truth is:

```text
nodes + edges + edge types + edge classes
```

This keeps the graph's real strengths:

- multi-hop recall;
- relationship discovery;
- associative jumps;
- path explanation;
- future graph algorithms such as PageRank, community detection, spreading activation, and path scoring.

## 5.1 Graph Associative Power

The graph should keep its associative and creative recall ability.

It should not be reduced to a strict evidence ledger only. The project needs both:

- a free associative layer for finding related memories;
- a strict evidence layer for proving what was actually said.

The associative graph can connect memories by:

- shared people, tools, files, projects, products, or concepts;
- similar tasks;
- repeated problems;
- decisions that affected later work;
- errors and fixes;
- time proximity;
- semantic similarity;
- agent-generated relationship guesses with confidence scores.

This allows questions like:

- "Have we seen something like this before?"
- "What past solution might help here?"
- "What did this decision connect to later?"
- "What are the related threads around this idea?"

These paths can be exploratory. They can be creative. They can jump between related nodes.

But they are candidate routes, not final proof.

## 5.2 Evidence Graph Rule

The evidence graph is stricter than the associative graph.

Only some edge types are allowed to prove original evidence:

- `RAW_NEAR_RAW`
- `SUMMARY_COVERS_RAW`
- `SUMMARY_ROLLS_UP_SUMMARY`
- `MENTIONED_IN_RAW`
- `EVIDENCED_BY_RAW`

Evidence edges must store enough data to verify the route:

- `from_node_id`
- `to_node_id`
- `edge_type`
- `edge_class = evidence`
- `target_hash`
- `created_at`
- `observed_at`
- `ordinal`
- `confidence`
- `metadata_json`

Any normal semantic edge can help search, but it cannot directly produce an evidence packet unless it reaches an evidence edge that resolves to `raw_message`.

## 5.3 Who Walks The Graph

No hidden agent should wander the graph and decide what is true.

Graph walking is owned by Partner-Mem code.

The host agent does this:

```text
ask question -> call Partner-Mem tool -> read returned evidence
```

Partner-Mem code does this:

```text
parse query
find seed nodes
score candidate routes
walk graph edges
separate semantic routes from evidence paths
verify evidence paths
return raw evidence packet
```

The main code components should be:

- `GraphSearch`: finds seed nodes and candidate routes;
- `PathScorer`: ranks paths by relevance, time, confidence, and edge quality;
- `EvidenceResolver`: follows only evidence-capable edges back to `raw_message`;
- `RecallRouter`: decides which retrieval strategy to run;
- `EvidencePacketBuilder`: formats verified raw text for the host agent.

The "thing moving through the channels" is not an LLM. It is a deterministic graph traversal algorithm.

The LLM can help by choosing tools, interpreting results, or generating optional summaries. It does not own graph correctness.

## 5.4 How The Walker Knows A Path Is Valid

Every edge has type and class.

The walker knows which channels are allowed because code keeps an allowlist.

Example:

```text
semantic recall may walk:
RELATED_TO
MENTIONED_IN_RAW
SIMILAR_TO
FOLLOWS
CAUSED_BY
USED_TOOL
SOLVED_BY

evidence recall may walk:
MENTIONED_IN_RAW
EVIDENCED_BY_RAW
SUMMARY_COVERS_RAW
SUMMARY_ROLLS_UP_SUMMARY
RAW_NEAR_RAW
```

The path is valid only if:

1. every node exists;
2. every edge exists;
3. the edge class is allowed for the current resolver;
4. `target_hash` matches the target node or raw payload;
5. the path does not cycle;
6. the final node is `raw_message`;
7. the raw message is evidence-allowed.

If a semantic path finds a good candidate but cannot connect to raw evidence, it can be returned as a candidate route, but not as final evidence.

## 6. Storage Model

The first schema should be small and clean.

Suggested tables:

- `memory_nodes`
- `memory_edges`
- `raw_payloads`
- `summary_payloads`
- `node_fts`
- `retrieval_runs`
- `evidence_packets`

`memory_nodes` should store shared node fields:

- `node_id`
- `agent_id`
- `session_id`
- `node_type`
- `status`
- `created_at`
- `updated_at`
- `observed_at`
- `valid_from`
- `valid_to`
- `invalidated_at`
- `content_hash`
- `metadata_json`

`raw_payloads` should store original text:

- `node_id`
- `role`
- `text`
- `normalized_text`
- `token_count`
- `turn_id`
- `turn_index`
- `message_index`
- `source_hash`

`memory_edges` should store graph connections:

- `edge_id`
- `agent_id`
- `from_node_id`
- `to_node_id`
- `edge_type`
- `edge_class`
- `created_at`
- `observed_at`
- `valid_from`
- `valid_to`
- `invalidated_at`
- `target_hash`
- `weight`
- `confidence`
- `metadata_json`

## 7. Why Time Fields Matter

Time should be first-class.

A lot of human recall is time-shaped:

- "刚才"
- "上次"
- "昨天"
- "最近"
- "我们之前"
- "那个阶段"
- "第一次说这个的时候"

For v1, every raw memory should have:

- `created_at`: when Partner-Mem wrote it;
- `observed_at`: when the original message happened;
- `session_id`: which conversation it belongs to;
- `turn_index`: where it sits inside the session;
- `message_index`: where it sits inside the turn.

This makes simple retrieval much better even before advanced summaries or graph reasoning exist.

## 8. Retrieval Model

Version 1 retrieval should be simple and robust.

Basic flow:

1. Agent asks a question.
2. Agent calls Partner-Mem tool.
3. Partner-Mem searches raw text, time, and graph nodes.
4. Partner-Mem collects candidate nodes and routes.
5. Partner-Mem resolves candidates to raw messages through evidence paths.
6. Partner-Mem returns an evidence packet containing original text.
7. Agent answers using that original text.

The first tool set should be:

- `partner_mem_search`: search candidates;
- `partner_mem_recall`: return original text evidence;
- `partner_mem_timeline`: return recent memory by time;
- `partner_mem_status`: report storage/index health.

Later tool set can add:

- `partner_mem_describe_node`;
- `partner_mem_expand_path`;
- `partner_mem_graph_search`;
- `partner_mem_summarize_route`.

## 8.1 Tool Layer

Partner-Mem should expose memory through host-neutral tools.

The tools are how agents actively ask memory questions.

The core tool groups should be:

### Agent-Facing Tools

- `partner_mem_search`
  - Returns candidate nodes and routes.
  - Good for exploration.
  - Candidate-only results must not be treated as final evidence.

- `partner_mem_recall`
  - Returns verified original text evidence.
  - This is the main "answer from memory" tool.
  - It may search raw text, graph nodes, time, vectors, and optional summaries, but final output must be raw evidence.

- `partner_mem_timeline`
  - Returns recent or time-filtered raw memories.
  - Useful for "刚才", "上次", "最近", and session reconstruction.

- `partner_mem_describe_node`
  - Explains a graph node, its neighbors, and available evidence paths.
  - Useful when the agent wants to inspect why a candidate was found.

- `partner_mem_expand_path`
  - Expands a selected graph path into raw evidence when possible.
  - Useful for multi-step graph recall.

- `partner_mem_status`
  - Reports storage, index, graph, and context health.

### Adapter/Internal APIs

These do not have to be exposed as public agent tools in every host:

- `ingest_turn`
  - Stores visible user/assistant messages after a turn.

- `assemble_context`
  - Builds a bounded memory context block for hosts that support before-prompt injection.

- `update_config`
  - Changes local thresholds and policies when the host allows safe configuration.

### Tool Rule

Tools can return three different result classes:

- `candidate`: useful route, not evidence;
- `evidence`: verified raw text packet;
- `status`: health or configuration result.

The host agent must not answer from `candidate` results as if they were facts.

## 8.2 Context Layer

The context layer is separate from the tool layer.

The tool layer is active:

```text
agent asks memory -> tool returns result
```

The context layer is passive:

```text
host is about to build prompt -> Partner-Mem injects bounded memory context
```

The context layer should only inject:

- recent raw timeline when configured;
- verified evidence packets from automatic recall;
- short path explanations when useful;
- memory safety instructions.

The context layer should not inject:

- unverified graph guesses as facts;
- summary text as final evidence;
- large raw history dumps without budget control;
- hidden tool internals;
- private database paths.

Context assembly should be budgeted by configuration, not hard-coded.

Suggested configurable fields:

- `context.enabled`
- `context.maxTokens`
- `context.recentTurns`
- `context.recentMessages`
- `context.autoRecallEnabled`
- `context.autoRecallMaxQueries`
- `context.evidenceMaxItems`
- `context.evidenceMaxTokens`
- `context.includePathExplanations`
- `context.candidatePreviewEnabled`

The default should be conservative. Hosts with larger context windows can raise the limits.

## 9. Do We Need Summaries?

Summaries are useful, but they should not be required for v1 correctness.

The first version can retrieve original text using:

- raw full-text search;
- time filters;
- graph node matches;
- simple semantic/vector search if available.

Partner-Mem should support summaries in the graph schema from the beginning:

```text
summary --SUMMARY_COVERS_RAW--> raw_message
summary --SUMMARY_ROLLS_UP_SUMMARY--> summary
```

But automatic summary generation should not be required or enabled by default in v1.

This means:

- `summary` is a valid node type;
- summary evidence edges are valid edge types;
- the evidence resolver knows how to follow summary edges back to raw;
- tests can create manual summary nodes and verify the path;
- retrieval does not depend on summary nodes unless configured.

Summary text should remain navigation, not proof.

The project should not block v1 on perfect summary generation.

## 9.1 Summary Configuration

Summary policy should be configurable.

No hard-coded threshold should become part of the product truth.

Suggested fields:

- `summary.schemaEnabled`
- `summary.resolverEnabled`
- `summary.autoBuildEnabled`
- `summary.mode`: `disabled | manual | auto`
- `summary.provider`: `none | extractive | host_llm`
- `summary.triggerRawTokenCount`
- `summary.triggerRawMessageCount`
- `summary.triggerTurnCount`
- `summary.chunkMaxTokens`
- `summary.chunkMaxMessages`
- `summary.chunkMaxTurns`
- `summary.rollupMinChildren`
- `summary.rollupMaxChildren`
- `summary.maxLevels`
- `summary.outputMaxTokens`
- `summary.verifySourceIds`

Recommended v1 default:

```text
summary.schemaEnabled = true
summary.resolverEnabled = true
summary.autoBuildEnabled = false
summary.mode = manual
summary.provider = none
```

In plain language:

> The schema and resolver support summary from day one, but Partner-Mem does not automatically write summaries until the user turns it on.

## 9.2 Raw Chunking Rule

Raw text should never be destroyed by chunking.

The original message is stored as a complete `raw_message` node.

Chunking is only for:

- search index windows;
- vector embedding windows;
- optional summary windows;
- context packing windows.

This allows different hosts or users to tune behavior:

- chunk by token count;
- chunk by message count;
- chunk by turn count;
- chunk by time window;
- chunk by session boundary.

But the evidence packet should always be able to point back to the original raw message and original text.

Suggested configurable fields:

- `chunk.rawWindowTokens`
- `chunk.rawWindowMessages`
- `chunk.rawWindowTurns`
- `chunk.overlapTokens`
- `chunk.overlapMessages`
- `chunk.indexByMessage`
- `chunk.indexByTurn`
- `chunk.indexBySessionWindow`

## 10. Evidence Rule

The evidence rule is the heart of the project.

The system can search with:

- raw text;
- graph nodes;
- graph edges;
- summaries;
- vectors;
- timestamps.

But it can only answer with:

- original raw message text;
- original imported source text;
- evidence packet metadata explaining where it came from.

If the retrieval path cannot resolve to raw text, the tool should return candidate-only results or an empty/blocked evidence packet.

## 10.1 How Original Recall Actually Works

Returning original text should be a deterministic code path, not an LLM promise.

The recall resolver should work like this:

1. Search produces candidate nodes.
2. Candidate nodes may be raw, summary, entity, task, event, decision, or artifact nodes.
3. If the candidate is already `raw_message`, the resolver loads its raw payload directly.
4. If the candidate is not raw, the resolver follows only allowed `evidence` edges.
5. The resolver walks until it reaches one or more `raw_message` nodes.
6. For every hop, the resolver checks that the target node exists.
7. For every evidence edge, the resolver checks `target_hash` against the target node or payload hash.
8. The resolver tracks visited nodes to prevent cycles.
9. If any required node, edge, or hash check fails, the path is blocked.
10. Only verified raw messages enter the final evidence packet.

The LLM or host agent may choose which tool to call and which candidate route to explore. It must not be responsible for proving the route.

Code owns proof.

Agent owns interpretation.

Raw text owns truth.

## 10.2 Candidate Routes vs Evidence Paths

Partner-Mem should distinguish two kinds of path:

- candidate route: useful for discovery, ranking, association, and creative recall;
- evidence path: verified route that can return original text.

Example:

```text
Query: "那个插件改名的事情"

candidate route:
query -> entity("plugin") -> task("rename memory plugin") -> decision("partner-mem")

evidence path:
decision("partner-mem") -> EVIDENCED_BY_RAW -> raw_message(...)
```

The first route helps find the memory.

The second route proves the memory.

This keeps graph recall creative without letting it hallucinate evidence.

## 11. First Version Success Criteria

Partner-Mem v1 is usable when it can pass these checks:

1. Store every visible user/assistant message locally.
2. Preserve original text without rewriting it.
3. Search old messages by exact phrase.
4. Search old messages by fuzzy wording.
5. Filter or boost by time.
6. Return original text evidence, not just snippets.
7. Expose memory through host-neutral tools.
8. Work without a cloud service.
9. Report whether indexes and storage are healthy.
10. Fail honestly when evidence is not found.

## 12. Non-Goals For V1

Do not build these in the first version:

- user personality model;
- preference database;
- automatic project knowledge base;
- complex summary DAG;
- multi-agent organization memory;
- remote sync;
- web UI;
- enterprise access control.

These are later layers. The first layer is durable original-memory retrieval.

## 13. Working Principle

The whole project should follow this principle:

> Graph finds the route. Time narrows the scene. Raw text proves the memory.
