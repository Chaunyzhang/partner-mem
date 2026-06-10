import { getDefaultConfig, type PartnerMemConfig } from "../config/default-config.js";
import type { EvidenceItem } from "../evidence/evidence-packet-builder.js";
import { ToolFacade } from "../tools/tool-facade.js";

export interface ContextAssemblyRequest {
  agent_id: string;
  session_id?: string;
  current_prompt?: string;
  budget_tokens: number;
  include_recent: boolean;
  auto_recall: boolean;
}

export interface ContextBlock {
  recent_raw_timeline: EvidenceItem[];
  verified_evidence: EvidenceItem[];
  path_explanations: string[];
  safety_instructions: string[];
  omitted: string[];
}

export class ContextAssembler {
  constructor(
    private readonly facade: ToolFacade,
    private readonly config: PartnerMemConfig = getDefaultConfig()
  ) {}

  assembleContext(request: ContextAssemblyRequest): ContextBlock {
    const omitted: string[] = [];
    const recent_raw_timeline: EvidenceItem[] = [];

    const verified_evidence =
      request.auto_recall && this.config.context.autoRecallEnabled && request.current_prompt
        ? this.facade.partner_mem_recall({
            query: request.current_prompt,
            agent_id: request.agent_id,
            ...(request.session_id ? { session_id: request.session_id } : {}),
            limit: this.config.context.evidenceMaxItems
          }).evidence_items
        : [];

    if (!this.config.context.candidatePreviewEnabled) {
      omitted.push("candidate routes");
    }

    return {
      recent_raw_timeline,
      verified_evidence,
      path_explanations: this.config.context.includePathExplanations
        ? verified_evidence.flatMap((item) => item.path.map((step) => `${step.edge_type}:${step.to_node_id}`))
        : [],
      safety_instructions: [
        "Use only verified raw evidence as memory proof.",
        "Treat candidate routes and summaries as navigation, not facts."
      ],
      omitted
    };
  }
}
