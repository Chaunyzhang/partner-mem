import type { ExplicitReplyEdge, TurnNode } from "../core/contracts.js";
import type { PartnerMemStore } from "../storage/partner-mem-store.js";
import type {
  GraphTraversalResultItem,
  GraphTraverseInput,
  RetrievalResult,
  TrustedRetrievalIdentity
} from "./retrieval-contracts.js";
import type { RetrievalAuthorization } from "./retrieval-authorization.js";

interface FrontierItem {
  node: TurnNode;
  path: ExplicitReplyEdge[];
}

export class ReplyGraphTraversalService {
  constructor(
    private readonly store: PartnerMemStore,
    private readonly authorization: RetrievalAuthorization
  ) {}

  traverse(
    identity: TrustedRetrievalIdentity,
    input: GraphTraverseInput
  ): RetrievalResult<GraphTraversalResultItem> {
    const start = this.store.getTurnNode(input.start_node_id);
    if (!start || !this.authorization.canReadGraphNode(identity, start)) {
      return { items: [], truncated: false };
    }

    const visited = new Set([start.node_id]);
    let frontier: FrontierItem[] = [{ node: start, path: [] }];
    const results: GraphTraversalResultItem[] = [];
    for (let depth = 1; depth <= input.max_depth; depth += 1) {
      const nextByNode = new Map<string, FrontierItem>();
      for (const current of frontier) {
        const edges = this.store.listExplicitReplyEdges({
          harness_id: identity.harness_id,
          node_id: current.node.node_id,
          direction: input.direction
        });
        for (const edge of edges) {
          const targetId = nextNodeId(current.node.node_id, edge, input.direction);
          if (targetId === null || visited.has(targetId) || nextByNode.has(targetId)) {
            continue;
          }
          const target = this.store.getTurnNode(targetId);
          if (
            !target ||
            !this.authorization.canReadGraphNode(identity, target) ||
            !isValidReplyEdge(current.node, target, edge)
          ) {
            continue;
          }
          nextByNode.set(target.node_id, {
            node: target,
            path: [...current.path, edge]
          });
        }
      }
      const next = [...nextByNode.values()].sort(compareHostOrder);
      next.forEach((entry) => visited.add(entry.node.node_id));
      results.push(...next);
      frontier = next;
      if (frontier.length === 0) break;
    }

    return {
      items: results.slice(0, input.limit),
      truncated: results.length > input.limit
    };
  }
}

function nextNodeId(
  currentNodeId: string,
  edge: ExplicitReplyEdge,
  direction: GraphTraverseInput["direction"]
): string | null {
  if (
    (direction === "parent" || direction === "both") &&
    edge.from_node_id === currentNodeId
  ) {
    return edge.to_node_id;
  }
  if (
    (direction === "replies" || direction === "both") &&
    edge.to_node_id === currentNodeId
  ) {
    return edge.from_node_id;
  }
  return null;
}

function isValidReplyEdge(
  current: TurnNode,
  target: TurnNode,
  edge: ExplicitReplyEdge
): boolean {
  const from =
    current.node_id === edge.from_node_id
      ? current
      : target.node_id === edge.from_node_id
        ? target
        : undefined;
  const to =
    current.node_id === edge.to_node_id
      ? current
      : target.node_id === edge.to_node_id
        ? target
        : undefined;
  return (
    from !== undefined &&
    to !== undefined &&
    from.harness_id === edge.harness_id &&
    to.harness_id === edge.harness_id &&
    hasStoredMessageText(from, edge.from_message_id) &&
    hasStoredMessageText(to, edge.to_message_id)
  );
}

function hasStoredMessageText(node: TurnNode, messageId: string): boolean {
  return (
    (node.question_message_id === messageId && node.question_text !== null) ||
    (node.answer_message_id === messageId && node.answer_text !== null)
  );
}

function compareHostOrder(left: FrontierItem, right: FrontierItem): number {
  const leftOrder =
    left.node.question_display_order ?? left.node.answer_display_order;
  const rightOrder =
    right.node.question_display_order ?? right.node.answer_display_order;
  if (leftOrder !== null || rightOrder !== null) {
    if (leftOrder === null) return 1;
    if (rightOrder === null) return -1;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  }
  const leftVisible =
    left.node.question_visible_at ?? left.node.answer_visible_at;
  const rightVisible =
    right.node.question_visible_at ?? right.node.answer_visible_at;
  if (leftVisible !== rightVisible) {
    if (leftVisible === null) return 1;
    if (rightVisible === null) return -1;
    const leftEpoch = Date.parse(leftVisible);
    const rightEpoch = Date.parse(rightVisible);
    const leftIsTime = Number.isFinite(leftEpoch);
    const rightIsTime = Number.isFinite(rightEpoch);
    if (leftIsTime !== rightIsTime) return leftIsTime ? -1 : 1;
    if (leftIsTime && rightIsTime && leftEpoch !== rightEpoch) {
      return leftEpoch - rightEpoch;
    }
    if (!leftIsTime && !rightIsTime) {
      const compared = leftVisible.localeCompare(rightVisible);
      if (compared !== 0) return compared;
    }
  }
  return left.node.node_id.localeCompare(right.node.node_id);
}
