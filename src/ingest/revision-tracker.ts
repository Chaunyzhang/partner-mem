import { randomUUID } from "node:crypto";
import type { RevisionEdgeType } from "../core/contracts.js";
import { hashText } from "../core/hash.js";
import { GraphStore, type RawRevisionCandidate } from "../storage/graph-store.js";

export interface RevisionDecision {
  topic_group: string;
  sequence: number;
  edge_type?: RevisionEdgeType;
  supersedes?: string;
  previous_raw_node_id?: string;
  previous_source_hash?: string;
}

export interface RevisionRecordInput {
  agent_id: string;
  node_id: string;
  observed_at: string;
}

export class RevisionTracker {
  constructor(private readonly store: GraphStore) {}

  plan(agentId: string, text: string): RevisionDecision {
    const topicGroup = inferTopicGroup(text);
    const previous = this.store.getLatestRawRevisionCandidate(agentId, topicGroup);
    const sequence = this.store.nextTopicSequence(agentId, topicGroup);
    const edgeType = previous ? classifyRevisionEdge(text, previous) : undefined;

    return {
      topic_group: topicGroup,
      sequence,
      ...(edgeType ? { edge_type: edgeType } : {}),
      ...(previous
        ? {
            previous_raw_node_id: previous.node.node_id,
            previous_source_hash: previous.payload.source_hash
          }
        : {}),
      ...(edgeType === "correction" && previous ? { supersedes: previous.node.node_id } : {})
    };
  }

  record(input: RevisionRecordInput, decision: RevisionDecision): string | undefined {
    if (!decision.edge_type) return undefined;
    if (!decision.previous_raw_node_id || !decision.previous_source_hash) return undefined;

    if (decision.edge_type === "correction") {
      this.store.markNodeSuperseded(decision.previous_raw_node_id, input.node_id, new Date().toISOString());
    }

    const edgeId = randomUUID();
    this.store.createEdge({
      edge_id: edgeId,
      agent_id: input.agent_id,
      from_node_id: input.node_id,
      to_node_id: decision.previous_raw_node_id,
      edge_type: decision.edge_type,
      edge_class: "semantic",
      created_at: new Date().toISOString(),
      observed_at: input.observed_at,
      target_hash: decision.previous_source_hash,
      metadata_json: JSON.stringify({ topic_group: decision.topic_group })
    });

    return edgeId;
  }
}

export function inferTopicGroup(text: string): string {
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens = normalized.match(/[\p{Script=Han}]{2,}|[a-z0-9][a-z0-9_-]*/gu) ?? [];
  const significant = tokens.map(cleanTopicToken).filter((token) => token.length > 1 && !TOPIC_STOPWORDS.has(token));
  const first = significant[0];
  const key =
    first && /\p{Script=Han}/u.test(first)
      ? first
      : significant.slice(0, 2).join("_") || hashText(normalized).slice(0, 12);
  return `topic_${key.slice(0, 80)}`;
}

export function classifyRevisionEdge(text: string, previous: RawRevisionCandidate): RevisionEdgeType | undefined {
  if (previous.node.topic_group === null) return undefined;
  const normalized = text.normalize("NFKC").toLowerCase();
  if (CORRECTION_PATTERNS.some((pattern) => pattern.test(normalized))) return "correction";
  if (EXTENSION_PATTERNS.some((pattern) => pattern.test(normalized))) return "extension";
  if (CONTRADICTION_PATTERNS.some((pattern) => pattern.test(normalized))) return "contradiction";
  return undefined;
}

function cleanTopicToken(token: string): string {
  return token
    .replace(/^(不是|不对|改成|改为|改|换成|换为|换|不要|不做|定|还有|另外|补充|还要)/u, "")
    .replace(/(了|吧)$/u, "");
}

const TOPIC_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "of",
  "and",
  "or",
  "is",
  "are",
  "be",
  "use",
  "using",
  "change",
  "switch",
  "replace",
  "also",
  "plus"
]);

const CORRECTION_PATTERNS = [
  /不是/u,
  /不对/u,
  /改/u,
  /换/u,
  /不要/u,
  /不做.+了/u,
  /\b(no longer|instead|change|switch|replace|not|don't|do not)\b/u
] as const;

const EXTENSION_PATTERNS = [
  /还有/u,
  /另外/u,
  /补充/u,
  /\+1/u,
  /还要/u,
  /\b(also|additionally|plus|add|another)\b/u
] as const;

const CONTRADICTION_PATTERNS = [
  /矛盾/u,
  /冲突/u,
  /相反/u,
  /\b(conflict|contradict|contradiction|opposite)\b/u
] as const;
