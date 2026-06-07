import type { MemoryPluginCapability } from "openclaw/plugin-sdk/plugin-entry";

const PARTNER_MEM_TOOL_NAMES = ["partner_mem_recall", "partner_mem_search"] as const;

export function createPartnerMemMemoryCapability(): MemoryPluginCapability {
  return {
    promptBuilder({ availableTools }: { availableTools: Set<string> }) {
      if (!PARTNER_MEM_TOOL_NAMES.some((toolName) => availableTools.has(toolName))) {
        return [];
      }

      return [
        "Use partner_mem_recall when you need verified original raw memory evidence.",
        "Use partner_mem_search only for candidate navigation; candidates are not proof.",
        "Do not treat summaries or candidate routes as proof."
      ];
    },
    publicArtifacts: {
      listArtifacts() {
        return [];
      }
    }
  };
}
