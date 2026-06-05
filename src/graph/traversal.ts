import { isEvidenceEdgeType } from "../core/contracts.js";
import type { MemoryEdge } from "../storage/graph-store.js";
import { GraphStore } from "../storage/graph-store.js";
import type { BlockedPath } from "../evidence/evidence-packet-builder.js";
import { toPathStep } from "../evidence/evidence-packet-builder.js";

export interface WalkEvidencePathOptions {
  max_depth: number;
}

export interface EvidenceTraversalResult {
  paths: MemoryEdge[][];
  blocked_paths: BlockedPath[];
}

interface QueueItem {
  node_id: string;
  path: MemoryEdge[];
  visited: Set<string>;
}

export class GraphTraversal {
  constructor(private readonly store: GraphStore) {}

  walkEvidencePaths(startNodeId: string, options: WalkEvidencePathOptions): EvidenceTraversalResult {
    const queue: QueueItem[] = [{ node_id: startNodeId, path: [], visited: new Set([startNodeId]) }];
    const paths: MemoryEdge[][] = [];
    const blocked_paths: BlockedPath[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;

      if (current.path.length >= options.max_depth) {
        if (this.store.getNode(current.node_id)?.node_type !== "raw_message") {
          blocked_paths.push({
            candidate_node_id: startNodeId,
            terminal_node_id: current.node_id,
            reason: "max_depth_exceeded",
            path: current.path.map(toPathStep)
          });
        }
        continue;
      }

      const edges = this.store.listOutgoingEdges(current.node_id);
      if (edges.length === 0 && current.path.length > 0) {
        paths.push(current.path);
        continue;
      }

      for (const edge of edges) {
        const path = [...current.path, edge];

        if (edge.edge_class !== "evidence") {
          blocked_paths.push({
            candidate_node_id: startNodeId,
            terminal_node_id: edge.to_node_id,
            reason: "disallowed_edge_class",
            path: path.map(toPathStep)
          });
          continue;
        }

        if (!isEvidenceEdgeType(edge.edge_type)) {
          blocked_paths.push({
            candidate_node_id: startNodeId,
            terminal_node_id: edge.to_node_id,
            reason: "disallowed_edge_type",
            path: path.map(toPathStep)
          });
          continue;
        }

        if (current.visited.has(edge.to_node_id)) {
          blocked_paths.push({
            candidate_node_id: startNodeId,
            terminal_node_id: edge.to_node_id,
            reason: "cycle_detected",
            path: path.map(toPathStep)
          });
          continue;
        }

        const target = this.store.getNode(edge.to_node_id);
        if (!target) {
          blocked_paths.push({
            candidate_node_id: startNodeId,
            terminal_node_id: edge.to_node_id,
            reason: "missing_node",
            path: path.map(toPathStep)
          });
          continue;
        }

        if (target.node_type === "raw_message") {
          paths.push(path);
          continue;
        }

        queue.push({
          node_id: edge.to_node_id,
          path,
          visited: new Set([...current.visited, edge.to_node_id])
        });
      }
    }

    return { paths, blocked_paths };
  }
}
