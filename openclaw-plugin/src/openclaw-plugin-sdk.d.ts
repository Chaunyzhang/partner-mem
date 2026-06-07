declare module "openclaw/plugin-sdk/plugin-entry" {
  export interface OpenClawLogger {
    debug?(message: string, meta?: unknown): void;
    info?(message: string, meta?: unknown): void;
    warn?(message: string, meta?: unknown): void;
    error?(message: string, meta?: unknown): void;
  }

  export interface OpenClawPluginToolContext {
    agentId?: string;
    sessionKey?: string;
    sessionId?: string;
    config?: unknown;
    runtimeConfig?: unknown;
    getRuntimeConfig?: () => unknown;
  }

  export interface AgentToolResult {
    content: Array<{ type: "text"; text: string }>;
    details?: unknown;
    isError?: boolean;
  }

  export interface AnyAgentTool {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    execute(
      toolCallId: string,
      params: unknown,
      context?: OpenClawPluginToolContext
    ): AgentToolResult | Promise<AgentToolResult>;
  }

  export interface OpenClawPluginService {
    id: string;
    start?: () => void | Promise<void>;
    stop?: () => void | Promise<void>;
  }

  export interface MemoryPluginCapability {
    promptBuilder?: (input: { availableTools: Set<string>; citationsMode?: unknown }) => string[];
    publicArtifacts?: {
      listArtifacts: (params?: { cfg?: unknown }) => unknown[] | Promise<unknown[]>;
    };
  }

  export interface OpenClawPluginApi {
    pluginConfig?: Record<string, unknown>;
    config?: unknown;
    runtime?: unknown;
    logger?: OpenClawLogger;
    resolvePath(input: string): string;
    registerService(service: OpenClawPluginService): void;
    registerTool(toolOrFactory: AnyAgentTool, opts?: unknown): void;
    registerMemoryCapability(capability: MemoryPluginCapability): void;
    on(hookName: string, handler: (event: unknown, ctx?: unknown) => unknown, opts?: unknown): void;
  }

  export interface OpenClawPluginEntry {
    id: string;
    name: string;
    description: string;
    register(api: OpenClawPluginApi): void | Promise<void>;
  }

  export function definePluginEntry<T extends OpenClawPluginEntry>(entry: T): T;
}
