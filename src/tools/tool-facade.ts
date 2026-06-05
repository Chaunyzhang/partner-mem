import { randomUUID } from "node:crypto";
import { RecallRouter, type RecallQuery, type TimelineQuery } from "../recall/recall-router.js";
import type { SearchQuery } from "../search/seed-index.js";
import { runSchemaDoctor } from "../storage/doctor.js";
import { GraphStore } from "../storage/graph-store.js";

export interface StatusResult {
  result_class: "status";
  schema: ReturnType<typeof runSchemaDoctor>["status"];
  fts: ReturnType<typeof runSchemaDoctor>["fts"];
  graph: ReturnType<typeof runSchemaDoctor>["graph"];
  evidence: ReturnType<typeof runSchemaDoctor>["evidence"];
  config: ReturnType<typeof runSchemaDoctor>["config"];
}

export class ToolFacade {
  private readonly recallRouter: RecallRouter;

  constructor(private readonly store: GraphStore) {
    this.recallRouter = new RecallRouter(store);
  }

  partner_mem_search(input: SearchQuery) {
    return this.recallRouter.search(input);
  }

  partner_mem_recall(input: RecallQuery) {
    return this.recallRouter.recall(input);
  }

  partner_mem_timeline(input: TimelineQuery) {
    return this.recallRouter.timeline(input);
  }

  partner_mem_status(): StatusResult {
    const status = runSchemaDoctor(this.store.rawDb());
    this.store.insertRetrievalRun({
      run_id: randomUUID(),
      agent_id: "system",
      result_class: "status",
      created_at: new Date().toISOString()
    });
    return {
      result_class: "status",
      schema: status.status,
      fts: status.fts,
      graph: status.graph,
      evidence: status.evidence,
      config: status.config
    };
  }
}
