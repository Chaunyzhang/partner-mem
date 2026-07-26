import { createRequire } from "node:module";
import { Type } from "typebox";
import {
  buildJsonPluginConfigSchema,
  definePluginEntry
} from "openclaw/plugin-sdk/plugin-entry";

import { resolveOpenClawPartnerMemConfig } from "./config.js";
import { PartnerMemOpenClawAdapter } from "./plugin-core.js";
import { RuntimeClient } from "./runtime-client.js";
import { HarnessStateStore } from "./state.js";
import { PARTNER_MEM_TOOL_SCHEMAS, type PartnerMemToolName } from "./tool-schemas.js";

type PluginManifest = {
  id: string;
  name: string;
  description: string;
  configSchema: Parameters<typeof buildJsonPluginConfigSchema>[0];
};

const require = createRequire(import.meta.url);
const pluginManifest = require("../openclaw.plugin.json") as PluginManifest;

export default definePluginEntry({
  id: pluginManifest.id,
  name: pluginManifest.name,
  description: pluginManifest.description,
  configSchema: buildJsonPluginConfigSchema(pluginManifest.configSchema),
  register(api) {
    const config = resolveOpenClawPartnerMemConfig(api.pluginConfig, import.meta.url);
    const client = new RuntimeClient({
      runtimePath: config.runtimePath,
      databasePath: config.databasePath,
      ...(config.nodePath === undefined ? {} : { nodePath: config.nodePath })
    });
    const stateStore = new HarnessStateStore(
      config.statePath,
      config.databasePath,
      client
    );
    const adapter = new PartnerMemOpenClawAdapter({
      client,
      stateStore,
      logger: api.logger
    });

    api.on("gateway_start", () => {
      adapter.start();
    });
    api.on("before_agent_run", (_event, ctx) => {
      adapter.onBeforeAgentRun({
        ...optionalString("sessionKey", ctx.sessionKey),
        ...optionalString("runId", ctx.runId),
        ...optionalString("agentId", ctx.agentId),
        ...optionalString("trigger", ctx.trigger)
      });
    });
    api.on("message_received", (event, ctx) => {
      adapter.onMessageReceived(
        {
          content: event.content,
          ...optionalNumber("timestamp", event.timestamp),
          ...optionalString("messageId", event.messageId ?? ctx.messageId),
          ...optionalString("senderId", event.senderId ?? ctx.senderId ?? event.from),
          ...optionalString("replyToId", event.replyToId ?? ctx.replyToId),
          ...optionalString("sessionKey", ctx.sessionKey ?? event.sessionKey),
          ...optionalString("threadId", readStringOrNumber(event.threadId))
        },
        {
          ...optionalString("sessionKey", ctx.sessionKey ?? event.sessionKey),
          ...optionalString("messageId", event.messageId ?? ctx.messageId),
          ...optionalString("senderId", event.senderId ?? ctx.senderId ?? event.from),
          ...optionalString("replyToId", event.replyToId ?? ctx.replyToId),
          ...optionalString("threadId", readStringOrNumber(event.threadId))
        }
      );
    });
    api.on("reply_payload_sending", (event, ctx) => {
      adapter.onReplyPayloadSending(
        {
          ...optionalString("text", event.payload.text),
          ...optionalString("spokenText", event.payload.spokenText),
          hasMedia:
            typeof event.payload.mediaUrl === "string" ||
            (Array.isArray(event.payload.mediaUrls) &&
              event.payload.mediaUrls.length > 0),
          isReasoning: event.payload.isReasoning === true,
          isCommentary: event.payload.isCommentary === true,
          isStatusNotice: event.payload.isStatusNotice === true,
          isCompactionNotice: event.payload.isCompactionNotice === true,
          isFallbackNotice: event.payload.isFallbackNotice === true,
          ...optionalString("agentId", event.usageState?.agentId),
          ...optionalString("sessionKey", ctx.sessionKey ?? event.sessionKey),
          ...optionalString("runId", ctx.runId ?? event.runId)
        },
        {
          ...optionalString("sessionKey", ctx.sessionKey ?? event.sessionKey),
          ...optionalString("runId", ctx.runId ?? event.runId)
        }
      );
    });
    api.on("message_sent", (event, ctx) => {
      adapter.onMessageSent(
        {
          content: event.content,
          success: event.success,
          ...optionalString("messageId", event.messageId ?? ctx.messageId),
          ...optionalString("sessionKey", ctx.sessionKey ?? event.sessionKey),
          ...optionalString("runId", ctx.runId ?? event.runId)
        },
        {
          ...optionalString("sessionKey", ctx.sessionKey ?? event.sessionKey),
          ...optionalString("messageId", event.messageId ?? ctx.messageId),
          ...optionalString("replyToId", ctx.replyToId),
          ...optionalString("runId", ctx.runId ?? event.runId)
        }
      );
    });
    api.lifecycle.registerRuntimeLifecycle({
      id: "partner-mem-runtime",
      description: "Close the Partner-Mem child runtime.",
      cleanup: () => {
        adapter.close();
      }
    });

    for (const schema of PARTNER_MEM_TOOL_SCHEMAS) {
      api.registerTool((toolCtx) => ({
        name: schema.name,
        label: labelForTool(schema.name),
        description: schema.description,
        parameters: Type.Unsafe(schema.inputSchema),
        executionMode: "parallel",
        async execute(_toolCallId, params) {
          const result = await adapter.invokeTool(schema.name, params as Record<string, unknown>, {
            ...optionalString("sessionKey", toolCtx.sessionKey),
            ...optionalString("agentId", toolCtx.agentId)
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            details: result
          };
        }
      }));
    }
  }
});

function labelForTool(toolName: PartnerMemToolName): string {
  switch (toolName) {
    case "partner_mem_keyword_search":
      return "Partner-Mem Keyword Search";
    case "partner_mem_vector_search":
      return "Partner-Mem Vector Search";
    case "partner_mem_graph_traverse":
      return "Partner-Mem Graph Traverse";
  }
}

function readStringOrNumber(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function optionalString<K extends string>(
  key: K,
  value: string | undefined
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, string>>);
}

function optionalNumber<K extends string>(
  key: K,
  value: number | undefined
): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, number>>);
}
