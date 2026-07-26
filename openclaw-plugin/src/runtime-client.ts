import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import { isPartnerMemToolName, type PartnerMemToolName } from "./tool-schemas.js";

export type RuntimeCommand =
  | "register_harness"
  | "record_question"
  | "record_answer"
  | "record_reply"
  | "invoke_tool";

export interface RuntimeRequest {
  id: string;
  command: RuntimeCommand;
  params: Record<string, unknown>;
}

export type RuntimeResponse =
  | { id: string; ok: true; result: unknown }
  | {
      id: string;
      ok: false;
      error: { code: string; message: string };
    };

export interface RuntimeClientOptions {
  nodePath?: string;
  runtimePath: string;
  databasePath: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
}

export class RuntimeTransportError extends Error {}

export class RuntimeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: Interface | null = null;
  private nextId = 1;
  private closed = false;
  private startAttempted = false;
  private readonly pending = new Map<
    string,
    {
      resolve: (response: RuntimeResponse) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  constructor(private readonly options: RuntimeClientOptions) {}

  async registerHarness(harnessType: string): Promise<string> {
    const response = await this.send({
      command: "register_harness",
      params: { harness_type: harnessType }
    });
    const result = requireObjectResult(response);
    const harnessId = readString(result.harness_id);
    if (!harnessId) {
      throw new RuntimeTransportError("register_harness did not return harness_id");
    }
    return harnessId;
  }

  async recordQuestion(params: Record<string, unknown>): Promise<string> {
    const response = await this.send({ command: "record_question", params });
    const result = requireObjectResult(response);
    const nodeId = readString(result.node_id);
    if (!nodeId) {
      throw new RuntimeTransportError("record_question did not return node_id");
    }
    return nodeId;
  }

  async recordAnswer(params: Record<string, unknown>): Promise<string> {
    const response = await this.send({ command: "record_answer", params });
    const result = requireObjectResult(response);
    const nodeId = readString(result.node_id);
    if (!nodeId) {
      throw new RuntimeTransportError("record_answer did not return node_id");
    }
    return nodeId;
  }

  async recordReply(params: {
    harness_id: string;
    from_source_message_id: string;
    to_source_message_id: string;
  }): Promise<string> {
    const response = await this.send({ command: "record_reply", params });
    const result = requireObjectResult(response);
    const edgeId = readString(result.edge_id);
    if (!edgeId) {
      throw new RuntimeTransportError("record_reply did not return edge_id");
    }
    return edgeId;
  }

  async invokeTool(params: {
    harness_id: string;
    source_conversation_id: string;
    source_agent_id?: string;
    tool_name: PartnerMemToolName;
    arguments: Record<string, unknown>;
  }): Promise<unknown> {
    if (!isPartnerMemToolName(params.tool_name)) {
      throw new RuntimeTransportError(`Unknown Partner-Mem tool: ${params.tool_name}`);
    }
    const response = await this.send({ command: "invoke_tool", params });
    if (!response.ok) {
      throw new RuntimeTransportError(response.error.message);
    }
    return response.result;
  }

  async send(request: Omit<RuntimeRequest, "id">): Promise<RuntimeResponse> {
    if (this.closed) {
      throw new RuntimeTransportError("Partner-Mem runtime is closed");
    }
    this.start();
    const id = String(this.nextId++);
    const payload: RuntimeRequest = { id, ...request };
    return await new Promise<RuntimeResponse>((resolve, reject) => {
      const child = this.child;
      if (!child || child.killed || !child.stdin.writable) {
        reject(new RuntimeTransportError("Partner-Mem runtime is unavailable"));
        return;
      }
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new RuntimeTransportError("Partner-Mem runtime request timed out"));
        this.close();
      }, this.options.requestTimeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(error instanceof Error ? error : new RuntimeTransportError(String(error)));
        }
      });
    });
  }

  close(): void {
    this.closed = true;
    for (const { reject, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      reject(new RuntimeTransportError("Partner-Mem runtime is closed"));
    }
    this.pending.clear();
    this.reader?.close();
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
    this.reader = null;
  }

  private start(): void {
    if (this.startAttempted) {
      if (!this.child || this.child.killed) {
        throw new RuntimeTransportError("Partner-Mem runtime exited");
      }
      return;
    }
    this.startAttempted = true;
    const child = spawn(this.options.nodePath ?? process.execPath, [
      this.options.runtimePath,
      this.options.databasePath
    ], {
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    this.reader = createInterface({ input: child.stdout });
    this.reader.on("line", (line) => {
      this.handleLine(line);
    });
    child.once("exit", () => {
      this.rejectPending(new RuntimeTransportError("Partner-Mem runtime exited"));
    });
    child.once("error", (error) => {
      this.rejectPending(error);
    });
    child.stderr.on("data", () => {
      // Runtime stderr is diagnostic-only and must not alter host chat flow.
    });
  }

  private handleLine(line: string): void {
    let response: RuntimeResponse;
    try {
      response = JSON.parse(line) as RuntimeResponse;
    } catch {
      this.rejectPending(new RuntimeTransportError("Partner-Mem runtime returned invalid JSON"));
      this.close();
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    clearTimeout(pending.timeout);
    pending.resolve(response);
  }

  private rejectPending(error: Error): void {
    for (const { reject, timeout } of this.pending.values()) {
      clearTimeout(timeout);
      reject(error);
    }
    this.pending.clear();
  }
}

function requireObjectResult(response: RuntimeResponse): Record<string, unknown> {
  if (!response.ok) {
    throw new RuntimeTransportError(response.error.message);
  }
  if (typeof response.result !== "object" || response.result === null || Array.isArray(response.result)) {
    throw new RuntimeTransportError("Runtime result must be an object");
  }
  return response.result as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
