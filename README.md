# Partner-Mem

Partner-Mem V1 is a Harness-neutral store and retrieval kernel for complete,
finally visible user and assistant text. The canonical product contract is
[`docs/PRD.md`](docs/PRD.md).

V1 keeps one durable turn node per exact host turn, maps host object identifiers
to globally unique Partner-Mem identifiers, and preserves only host-provided
structure plus original text. It does not create summaries, profiles, facts,
topics, entities, tasks, inferred relations, or current-truth objects.

The implementation is being delivered through four sequential PR stages:

1. canonical contracts, identity mapping, and SQLite durable truth;
2. final-visible write lifecycle and exact reply relations;
3. keyword, vector, graph retrieval, and the three model-visible tools;
4. Hermes and OpenClaw adapters plus end-to-end packaging.

Every merged stage remains recoverable through GitHub history. The previous
product route was deleted from normal source paths in the first stage and is not
retained as a runtime branch.
