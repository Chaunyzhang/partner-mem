import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { runPartnerMemJsonlServer } from "../../src/runtime/jsonl-server.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Partner-Mem runtime JSONL server", () => {
  it("processes start, capture, context, tool, and close requests in FIFO order", async () => {
    const stateDir = createTemporaryStateDirectory();
    const requests = [
      request("start", "runtime.start", {
        state_dir: stateDir,
        client: { name: "partner-mem-hermes", version: "0.1.0", host: "hermes", host_version: "0.18.2" }
      }),
      request("capture", "memory.capture_turn", {
        operation_id: "jsonl-operation-1",
        identity: primaryIdentity(),
        user_content: "JSONL runtime remembers this evidence.",
        assistant_content: "JSONL runtime acknowledges it.",
        observed_at: "2026-07-10T00:00:00.000Z"
      }),
      request("context", "memory.assemble_context", {
        identity: primaryIdentity(),
        query: "JSONL evidence",
        limit: 4
      }),
      request("tool", "tools.invoke", {
        identity: primaryIdentity(),
        tool_name: "partner_mem_timeline",
        arguments: { limit: 10 }
      }),
      request("close", "runtime.close", {})
    ];
    const output = captureWritable();
    const errorOutput = captureWritable();

    await runPartnerMemJsonlServer({
      input: Readable.from(requests.map((item) => `${JSON.stringify(item)}\n`)),
      output,
      error: errorOutput
    });

    const responses = parseLines(output.text());
    expect(responses.map((response) => response.request_id)).toEqual(["start", "capture", "context", "tool", "close"]);
    expect(responses.every((response) => response.protocol_version === 1)).toBe(true);
    expect(responses.every((response) => response.ok === true)).toBe(true);
    expect(responses[0]?.result).toMatchObject({
      capabilities: ["context.assemble.v1", "turn.capture.v1", "tools.invoke.v1"]
    });
    expect(responses[1]?.result).toMatchObject({ turn_index: 0 });
    expect(JSON.stringify(responses[2]?.result)).toContain("JSONL runtime remembers this evidence.");
    expect(JSON.stringify(responses[3]?.result)).toContain("JSONL runtime acknowledges it.");
    expect(responses[4]?.result).toEqual({ closed: true });
    expect(errorOutput.text()).toBe("");
  });

  it("returns strict errors for invalid JSON, protocol versions, and methods", async () => {
    const output = captureWritable();
    const errorOutput = captureWritable();
    const invalidRequests = [
      "not-json\n",
      `${JSON.stringify({ protocol_version: 2, request_id: "version", method: "runtime.close", params: {} })}\n`,
      `${JSON.stringify(request("method", "unknown.method", {}))}\n`
    ];

    await runPartnerMemJsonlServer({
      input: Readable.from(invalidRequests),
      output,
      error: errorOutput
    });

    expect(parseLines(output.text())).toEqual([
      {
        protocol_version: 1,
        request_id: null,
        ok: false,
        error: { code: "invalid_request", message: expect.any(String), retryable: false }
      },
      {
        protocol_version: 1,
        request_id: "version",
        ok: false,
        error: { code: "protocol_mismatch", message: expect.any(String), retryable: false }
      },
      {
        protocol_version: 1,
        request_id: "method",
        ok: false,
        error: { code: "unknown_method", message: expect.any(String), retryable: false }
      }
    ]);
    expect(errorOutput.text()).toBe("");
  });

  it("exits after acknowledging runtime.close even when stdin remains open", async () => {
    const input = new PassThrough();
    const output = captureWritable();
    const errorOutput = captureWritable();
    const server = runPartnerMemJsonlServer({ input, output, error: errorOutput });

    input.write(`${JSON.stringify(request("close", "runtime.close", {}))}\n`);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      server.then(() => "closed" as const),
      new Promise<"waiting">((resolve) => {
        timeout = setTimeout(() => resolve("waiting"), 1_000);
      })
    ]);
    if (timeout) clearTimeout(timeout);
    input.end();
    await server;

    expect(outcome).toBe("closed");
    expect(parseLines(output.text())).toEqual([
      { protocol_version: 1, request_id: "close", ok: true, result: { closed: true } }
    ]);
    expect(errorOutput.text()).toBe("");
  });
});

function request(requestId: string, method: string, params: unknown) {
  return { protocol_version: 1, request_id: requestId, method, params };
}

function primaryIdentity() {
  return {
    host: "hermes",
    agent_id: "coder",
    session_id: "session-1",
    agent_context: "primary"
  };
}

function createTemporaryStateDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "partner-mem-jsonl-"));
  temporaryDirectories.push(directory);
  return directory;
}

function captureWritable(): Writable & { text(): string } {
  const chunks: string[] = [];
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    }
  }) as Writable & { text(): string };
  writable.text = () => chunks.join("");
  return writable;
}

function parseLines(text: string): Array<Record<string, any>> {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}
