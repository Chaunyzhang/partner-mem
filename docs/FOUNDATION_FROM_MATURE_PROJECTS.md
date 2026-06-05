# Partner-Mem Foundation From Mature Projects

This document records what Partner-Mem should learn from existing memory systems.

The goal is not to clone any one project. The goal is to take the proven pieces and build a clean local graph-native memory foundation.

## 1. Foundation Conclusion

Partner-Mem should use this foundation:

```text
Zep / Graphiti temporal graph thinking
+ Mem0 multi-signal retrieval thinking
+ graph-memory graph recall mechanics
+ Cognee memory control-plane direction
+ LangGraph / Letta tool and memory-layer separation
+ Partner-Mem hard raw evidence resolver
```

In plain language:

> Raw text is truth. Temporal graph is structure. Multi-signal retrieval finds routes. Evidence resolver proves routes. Tools expose memory to agents.

## 2. Zep / Graphiti

### What To Learn

Zep and Graphiti are the strongest reference for the core data model.

Important ideas:

- temporal context graph;
- entities and relationships as graph data;
- facts have time validity;
- raw episodes are provenance;
- derived facts trace back to original episodes;
- retrieval combines vector, full-text, and graph traversal.

Partner-Mem should adopt the same direction:

```text
raw_message = episode / original source
entity/task/decision/event = derived graph nodes
semantic/evidence/temporal edges = graph structure
time fields = first-class
```

### What Not To Copy Directly

Do not copy the full Zep managed-platform shape.

Partner-Mem is local-first and personal-production oriented:

- local SQLite first;
- no cloud dependency;
- no enterprise governance in v1;
- no required external graph service.

### Partner-Mem Takeaway

The strongest foundation is:

```text
Temporal graph + raw episode provenance
```

But Partner-Mem should make raw evidence retrieval stricter and simpler for a local plugin.

## 3. Mem0

### What To Learn

Mem0 is useful as a reference for productized agent memory.

Important ideas:

- simple memory API;
- memories accumulate instead of constantly rewriting history;
- entity linking improves retrieval;
- semantic search, BM25 keyword search, and entity matching can run in parallel;
- temporal reasoning improves dated recall.

Partner-Mem should learn the retrieval shape:

```text
raw text search
+ entity match
+ graph walk
+ time boost
+ optional vector search
=> fused candidate ranking
```

### What Not To Copy Directly

Do not make Partner-Mem primarily a preference/fact memory system in v1.

The first version should not focus on:

- user preference modeling;
- memory decay;
- automatic profile maintenance;
- cloud API shape.

### Partner-Mem Takeaway

Use multi-signal retrieval, but keep the first version centered on original text recall.

## 4. graph-memory

### What To Learn

graph-memory is a strong reference for practical graph recall in an OpenClaw-like environment.

Important ideas:

- conversations are stored locally;
- LLM extracts structured graph nodes and edges;
- FTS/vector search finds seed nodes;
- graph walk expands related memories;
- Personalized PageRank ranks nodes by current query;
- community detection groups related knowledge;
- community summaries help generalized recall;
- episodic traces show original user/assistant snippets;
- context engine integration matters.

Partner-Mem should learn:

```text
seed search -> graph walk -> PPR ranking -> context assembly
```

This is valuable for associative and creative recall.

### What Not To Copy Directly

Do not copy graph-memory's original text recall as the final evidence model.

Its trace model is useful for context, but Partner-Mem needs a stricter evidence path:

```text
candidate node -> evidence edge -> raw_message -> hash verification -> evidence packet
```

Partner-Mem should not rely only on:

- source session lists;
- nearest messages around a timestamp;
- top-N snippet injection;
- OpenClaw-only context engine assumptions.

### Partner-Mem Takeaway

Use graph-memory's graph recall mechanics, but replace loose episodic snippets with hard raw evidence paths.

## 5. Cognee

### What To Learn

Cognee is useful as a reference for a memory control plane.

Important ideas:

- capture context from many sources;
- model raw data into graph memory;
- recall memory across agent runtimes;
- provide one memory layer to different hosts;
- support MCP and agent integrations.

Partner-Mem should learn the product shape:

```text
remember / recall / forget / improve
```

And the adapter direction:

```text
Codex
Claude Code
OpenClaw
Hermes
Pi
MCP clients
```

### What Not To Copy Directly

Do not start with Cognee's full platform scope.

Partner-Mem v1 should avoid:

- many data sources;
- cloud control plane;
- team permissions;
- ontology-heavy enterprise setup;
- large UI.

### Partner-Mem Takeaway

Use the memory-control-plane idea, but keep v1 local, simple, and raw-evidence-first.

## 6. LangGraph / Letta

### What To Learn

LangGraph and Letta are useful for memory-layer separation.

Important ideas:

- long-term memory should be separate from short-term thread state;
- agents should access memory through tools or store APIs;
- semantic, episodic, and procedural memory should be distinguished;
- memory hierarchy helps avoid putting everything into prompt context;
- stateful agents need clear memory boundaries.

Partner-Mem should learn:

```text
tool layer != context layer
long-term memory != current conversation state
memory store != agent runtime
```

### What Not To Copy Directly

Partner-Mem should not become a full agent runtime or agent OS.

It should not own:

- planning loop;
- autonomous agent identity;
- task execution;
- full agent state machine.

### Partner-Mem Takeaway

Partner-Mem is the memory layer. Hosts and agents call it.

## 7. Partner-Mem Foundation

The stable foundation should have seven layers.

### Layer 1: Raw Log

Every visible user/assistant message is stored as a complete `raw_message` node.

Required fields:

- original text;
- normalized text;
- role;
- agent id;
- session id;
- turn id;
- turn index;
- message index;
- created time;
- observed time;
- content hash;
- metadata.

Rule:

> Chunking, summaries, embeddings, and graph extraction must never replace the original raw text.

### Layer 2: Temporal Graph

Graph is the base structure.

Core nodes:

- `raw_message`
- `entity`
- `task`
- `event`
- `decision`
- `artifact`
- `summary`

Core edge classes:

- `semantic`
- `temporal`
- `evidence`
- `navigation`

Time fields should be first-class:

- `created_at`
- `observed_at`
- `valid_from`
- `valid_to`
- `invalidated_at`

### Layer 3: Multi-Signal Retrieval

Retrieval should combine:

- raw FTS/BM25;
- entity matching;
- graph walk;
- temporal boost;
- optional vector search;
- optional summary navigation.

No single signal should own recall quality.

### Layer 4: Associative Graph Recall

The graph should keep its creative recall ability:

- multi-hop traversal;
- related tasks;
- similar events;
- decision chains;
- artifact links;
- Personalized PageRank;
- community detection;
- spreading activation later.

This layer finds good candidates. It does not prove final evidence.

### Layer 5: Hard Evidence Resolver

The resolver is Partner-Mem's key differentiator.

It turns candidate nodes into verified raw evidence:

```text
candidate node
-> allowed evidence edge
-> target node exists
-> target hash matches
-> no cycle
-> raw_message
-> evidence packet
```

If verification fails, the path is blocked.

### Layer 6: Tool Layer

Agents call memory through host-neutral tools:

- `partner_mem_search`
- `partner_mem_recall`
- `partner_mem_timeline`
- `partner_mem_describe_node`
- `partner_mem_expand_path`
- `partner_mem_status`

Tool outputs should distinguish:

- candidate;
- evidence;
- status.

### Layer 7: Context Layer

Hosts may ask Partner-Mem to assemble bounded context.

The context layer can inject:

- recent raw timeline;
- verified evidence packets;
- short path explanations;
- memory safety instructions.

It must not inject unverified graph guesses as facts.

## 8. Summary Policy

Summary should be supported by the foundation but not required for v1.

Partner-Mem should support:

```text
summary --SUMMARY_COVERS_RAW--> raw_message
summary --SUMMARY_ROLLS_UP_SUMMARY--> summary
```

Recommended v1 behavior:

```text
summary.schemaEnabled = true
summary.resolverEnabled = true
summary.autoBuildEnabled = false
summary.mode = manual
summary.provider = none
```

This means:

- schema supports summary nodes;
- resolver supports summary evidence paths;
- tests can verify summary-to-raw expansion;
- automatic summary generation is off by default.

## 9. What Makes Partner-Mem Different

Most existing memory systems are strong in one or two areas:

- Zep / Graphiti: temporal graph and provenance;
- Mem0: productized memory API and multi-signal retrieval;
- graph-memory: practical PPR/community graph recall;
- Cognee: memory control plane;
- LangGraph / Letta: memory/tool/runtime separation.

Partner-Mem should combine those lessons around one stricter rule:

> Every useful route is welcome, but final memory evidence must resolve to original text.

This is the foundation.

## 10. Foundation Consistency Locks

These rules must stay consistent across implementation documents and code.

1. Graph is the base.
   - Memory relationships must be represented as nodes and edges.
   - Relationship arrays inside node metadata can be caches, not source of truth.

2. Raw text is truth.
   - Every visible message is stored as a complete `raw_message` node.
   - Chunking, embedding, extraction, and summary must not replace original text.

3. Candidate routes are not evidence.
   - Semantic graph paths can discover candidates.
   - Only verified evidence paths can produce evidence packets.

4. Evidence edges are a small allowlist.
   - V1 evidence edge types are `MENTIONED_IN_RAW`, `EVIDENCED_BY_RAW`, `RAW_NEAR_RAW`, `SUMMARY_COVERS_RAW`, and `SUMMARY_ROLLS_UP_SUMMARY`.
   - Evidence edges must store `target_hash`.

5. Summary is supported but not auto-built by default.
   - `summary.schemaEnabled = true`
   - `summary.resolverEnabled = true`
   - `summary.autoBuildEnabled = false`
   - `summary.provider = none`

6. Time is first-class.
   - Nodes and edges should carry `created_at`, `observed_at`, `valid_from`, `valid_to`, and `invalidated_at` where applicable.

7. Tools and context are separate.
   - Tools are active memory calls.
   - Context assembly is bounded prompt injection.
   - Neither may present unverified graph guesses as facts.

8. Agent does not prove memory.
   - The host agent may choose tools and interpret evidence.
   - Partner-Mem code verifies paths, hashes, cycles, and raw evidence eligibility.
