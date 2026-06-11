import { describe, expect, it } from "vitest";
import { createPartnerMemMemoryCapability } from "../src/memory-capability.js";

describe("Partner-Mem memory capability", () => {
  it("returns prompt lines when Partner-Mem tools are available", () => {
    const capability = createPartnerMemMemoryCapability();

    expect(capability.promptBuilder?.({ availableTools: new Set(["partner_mem_recall"]) })).toEqual([
      "Use partner_mem_recall when you need verified original raw memory evidence.",
      "Use partner_mem_search only for candidate navigation; candidates are not proof.",
      "Do not treat summaries or candidate routes as proof."
    ]);
    expect(capability.promptBuilder?.({ availableTools: new Set(["other_tool"]) })).toEqual([]);
  });

  it("returns no public artifacts in MVP and exposes no runtime or flush plan resolver", async () => {
    const capability = createPartnerMemMemoryCapability();

    expect(await capability.publicArtifacts?.listArtifacts()).toEqual([]);
    expect(capability).not.toHaveProperty("runtime");
    expect(capability).not.toHaveProperty("flushPlanResolver");
    expect(
      JSON.stringify(capability.promptBuilder?.({ availableTools: new Set(["partner_mem_recall"]) }))
    ).not.toContain("memory_recall");
    expect(
      JSON.stringify(capability.promptBuilder?.({ availableTools: new Set(["partner_mem_search"]) }))
    ).not.toContain("memory_search");
  });
});
