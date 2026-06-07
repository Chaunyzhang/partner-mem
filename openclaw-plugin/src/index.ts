import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { readPartnerMemOpenClawConfig } from "./config.js";
import { registerPartnerMemHooks } from "./hooks.js";
import { createPartnerMemMemoryCapability } from "./memory-capability.js";
import { createPartnerMemOpenClawRuntime } from "./runtime.js";
import { createPartnerMemOpenClawTools } from "./tools.js";

export default definePluginEntry({
  id: "partner-mem",
  name: "Partner-Mem",
  description: "Local graph memory for OpenClaw backed by Partner-Mem raw evidence recall.",
  register(api) {
    const config = readPartnerMemOpenClawConfig(api.pluginConfig ?? {});
    const runtime = createPartnerMemOpenClawRuntime(api, config);

    api.registerService({
      id: "partner-mem",
      start() {
        runtime.logger.info?.("Partner-Mem OpenClaw plugin started");
      },
      stop() {
        runtime.stop();
      }
    });

    for (const tool of createPartnerMemOpenClawTools(runtime)) {
      api.registerTool(tool);
    }

    registerPartnerMemHooks(api, runtime);
    api.registerMemoryCapability(createPartnerMemMemoryCapability());
  }
});
