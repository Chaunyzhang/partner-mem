import { mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "@photostructure/sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  createPartnerMemRuntime,
  type PartnerMemRuntime
} from "../../src/runtime/partner-mem-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("PartnerMemRuntime", () => {
  it("commits a Hermes turn and returns the original receipt when the same operation is retried", async () => {
    const stateDir = createTemporaryStateDirectory();
    const runtime = await startRuntime(stateDir);

    try {
      const command = {
        kind: "capture_turn" as const,
        operation_id: "operation-1",
        identity: primaryIdentity("session-1"),
        user_content: "Hermes runtime writes this turn exactly once.",
        assistant_content: "The durable receipt protects a lost acknowledgement.",
        observed_at: "2026-07-10T00:00:00.000Z"
      };

      const first = await runtime.execute(command);
      const retry = await runtime.execute(command);
      const timeline = await runtime.execute({
        kind: "invoke_tool",
        identity: primaryIdentity("session-1"),
        tool_name: "partner_mem_timeline",
        arguments: { limit: 10 }
      });

      expect(retry).toEqual(first);
      expect(first).toMatchObject({ turn_index: 0, raw_node_ids: [expect.any(String), expect.any(String)] });
      expect(timeline).toMatchObject({
        result: {
          evidence_items: [
            { text: "Hermes runtime writes this turn exactly once." },
            { text: "The durable receipt protects a lost acknowledgement." }
          ]
        }
      });
    } finally {
      await runtime.close();
    }
  });

  it("rejects reuse of an operation id for different content", async () => {
    const runtime = await startRuntime(createTemporaryStateDirectory());

    try {
      await runtime.execute({
        kind: "capture_turn",
        operation_id: "operation-conflict",
        identity: primaryIdentity("session-1"),
        user_content: "Original content.",
        assistant_content: "Original response.",
        observed_at: "2026-07-10T00:00:00.000Z"
      });

      await expect(
        runtime.execute({
          kind: "capture_turn",
          operation_id: "operation-conflict",
          identity: primaryIdentity("session-1"),
          user_content: "Different content.",
          assistant_content: "Original response.",
          observed_at: "2026-07-10T00:00:00.000Z"
        })
      ).rejects.toMatchObject({ code: "idempotency_conflict", retryable: false });
    } finally {
      await runtime.close();
    }
  });

  it("allocates the next turn index after the runtime restarts", async () => {
    const stateDir = createTemporaryStateDirectory();
    const firstRuntime = await startRuntime(stateDir);

    await firstRuntime.execute({
      kind: "capture_turn",
      operation_id: "operation-before-restart",
      identity: primaryIdentity("session-1"),
      user_content: "First turn.",
      assistant_content: "First response.",
      observed_at: "2026-07-10T00:00:00.000Z"
    });
    await firstRuntime.close();

    const restartedRuntime = await startRuntime(stateDir);
    try {
      await expect(
        restartedRuntime.execute({
          kind: "capture_turn",
          operation_id: "operation-after-restart",
          identity: primaryIdentity("session-1"),
          user_content: "Second turn.",
          assistant_content: "Second response.",
          observed_at: "2026-07-10T00:01:00.000Z"
        })
      ).resolves.toMatchObject({ turn_index: 1 });
    } finally {
      await restartedRuntime.close();
    }
  });

  it("waits for a short cross-process SQLite write lock instead of dropping the turn", async () => {
    const stateDir = createTemporaryStateDirectory();
    const runtime = await startRuntime(stateDir);
    const databasePath = join(stateDir, "partner-mem.db");
    const locker = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'import { DatabaseSync } from "@photostructure/sqlite";',
          "const db = new DatabaseSync(process.argv[1]);",
          'db.exec("BEGIN IMMEDIATE");',
          'process.stdout.write("locked\\n");',
          'setTimeout(() => { db.exec("COMMIT"); db.close(); }, 250);'
        ].join(""),
        databasePath
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );

    try {
      const [locked] = (await once(locker.stdout, "data")) as [Buffer];
      expect(locked.toString("utf8")).toContain("locked");
      await expect(
        runtime.execute({
          kind: "capture_turn",
          operation_id: "operation-after-short-lock",
          identity: primaryIdentity("session-1"),
          user_content: "Wait for the other Hermes runtime.",
          assistant_content: "Do not drop this completed turn.",
          observed_at: "2026-07-10T00:00:00.000Z"
        })
      ).resolves.toMatchObject({ turn_index: 0 });
      if (locker.exitCode === null) await once(locker, "exit");
    } finally {
      if (locker.exitCode === null) locker.kill();
      await runtime.close();
    }
  });

  it("fails a contended prefetch read inside its protocol budget without poisoning later writes", async () => {
    const stateDir = createTemporaryStateDirectory();
    const runtime = await startRuntime(stateDir);
    const databasePath = join(stateDir, "partner-mem.db");
    const locker = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        [
          'import { DatabaseSync } from "@photostructure/sqlite";',
          "const db = new DatabaseSync(process.argv[1]);",
          'db.exec("BEGIN IMMEDIATE");',
          'process.stdout.write("locked\\n");',
          'setTimeout(() => { db.exec("COMMIT"); db.close(); }, 500);'
        ].join(""),
        databasePath
      ],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );

    try {
      const [locked] = (await once(locker.stdout, "data")) as [Buffer];
      expect(locked.toString("utf8")).toContain("locked");
      const startedAt = Date.now();
      await expect(
        runtime.execute({
          kind: "assemble_context",
          identity: primaryIdentity("session-1"),
          query: "return quickly while another runtime is writing",
          limit: 4
        })
      ).rejects.toThrow(/locked|busy/iu);
      expect(Date.now() - startedAt).toBeLessThan(200);

      if (locker.exitCode === null) await once(locker, "exit");
      await expect(
        runtime.execute({
          kind: "capture_turn",
          operation_id: "operation-after-contended-prefetch",
          identity: primaryIdentity("session-1"),
          user_content: "The prefetch lock has cleared.",
          assistant_content: "The runtime connection remains usable.",
          observed_at: "2026-07-10T00:01:00.000Z"
        })
      ).resolves.toMatchObject({ turn_index: 0 });
    } finally {
      if (locker.exitCode === null) locker.kill();
      await runtime.close();
    }
  });

  it("refuses automatic writes from a non-primary Hermes context", async () => {
    const runtime = await startRuntime(createTemporaryStateDirectory());

    try {
      await expect(
        runtime.execute({
          kind: "capture_turn",
          operation_id: "operation-subagent",
          identity: {
            host: "hermes",
            agent_id: "coder",
            session_id: "session-1",
            agent_context: "subagent"
          },
          user_content: "Do not persist this subagent turn.",
          assistant_content: "It is outside the primary context.",
          observed_at: "2026-07-10T00:00:00.000Z"
        })
      ).rejects.toMatchObject({ code: "untrusted_identity", retryable: false });
    } finally {
      await runtime.close();
    }
  });

  it("scopes operation receipts by agent within the started host", async () => {
    const runtime = await startRuntime(createTemporaryStateDirectory());

    try {
      const first = await runtime.execute({
        kind: "capture_turn",
        operation_id: "shared-operation-id",
        identity: primaryIdentity("session-1", "coder"),
        user_content: "Coder memory.",
        assistant_content: "Coder response.",
        observed_at: "2026-07-10T00:00:00.000Z"
      });
      const second = await runtime.execute({
        kind: "capture_turn",
        operation_id: "shared-operation-id",
        identity: primaryIdentity("session-1", "reviewer"),
        user_content: "Reviewer memory.",
        assistant_content: "Reviewer response.",
        observed_at: "2026-07-10T00:00:00.000Z"
      });
      expect(first).toMatchObject({ turn_index: 0 });
      expect(second).toMatchObject({ turn_index: 0 });
      expect(second).not.toEqual(first);
    } finally {
      await runtime.close();
    }
  });

  it("rejects an identity host that differs from the runtime client host", async () => {
    const runtime = await startRuntime(createTemporaryStateDirectory());

    try {
      await expect(
        runtime.execute({
          kind: "capture_turn",
          operation_id: "forged-host-operation",
          identity: primaryIdentity("session-1", "coder", "openclaw"),
          user_content: "This host must not be accepted.",
          assistant_content: "The runtime was started for Hermes.",
          observed_at: "2026-07-10T00:01:00.000Z"
        })
      ).rejects.toMatchObject({ code: "untrusted_identity", retryable: false });
    } finally {
      await runtime.close();
    }
  });

  it("rejects tool arguments that try to provide identity fields", async () => {
    const runtime = await startRuntime(createTemporaryStateDirectory());

    try {
      await expect(
        runtime.execute({
          kind: "invoke_tool",
          identity: primaryIdentity("session-1"),
          tool_name: "partner_mem_recall",
          arguments: {
            query: "anything",
            limit: 4,
            agent_id: "forged-agent",
            session_id: "forged-session"
          }
        })
      ).rejects.toMatchObject({ code: "untrusted_identity", retryable: false });
    } finally {
      await runtime.close();
    }
  });

  it("rejects malformed or unsupported tool arguments instead of repairing them", async () => {
    const runtime = await startRuntime(createTemporaryStateDirectory());

    try {
      await expect(
        runtime.execute({
          kind: "invoke_tool",
          identity: primaryIdentity("session-1"),
          tool_name: "partner_mem_recall",
          arguments: { query: "anything", limit: 4, ignored: true }
        })
      ).rejects.toMatchObject({ code: "invalid_request", retryable: false });

      await expect(
        runtime.execute({
          kind: "invoke_tool",
          identity: primaryIdentity("session-1"),
          tool_name: "partner_mem_timeline",
          arguments: "not-an-object"
        })
      ).rejects.toMatchObject({ code: "invalid_request", retryable: false });

      await expect(
        runtime.execute({
          kind: "invoke_tool",
          identity: primaryIdentity("session-1"),
          tool_name: "partner_mem_recall",
          arguments: { query: "anything", limit: 4, scope: "all_agents" }
        })
      ).rejects.toMatchObject({ code: "invalid_request", retryable: false });

      await expect(
        runtime.execute({
          kind: "invoke_tool",
          identity: primaryIdentity("session-1"),
          tool_name: "partner_mem_timeline",
          arguments: { limit: 51 }
        })
      ).rejects.toMatchObject({ code: "invalid_request", retryable: false });
    } finally {
      await runtime.close();
    }
  });

  it("rolls back the turn counter and receipt when raw ingest fails", async () => {
    const stateDir = createTemporaryStateDirectory();
    const runtime = await startRuntime(stateDir);
    const inspectionDb = new DatabaseSync(join(stateDir, "partner-mem.db"));

    try {
      inspectionDb.exec(`
        CREATE TRIGGER force_runtime_ingest_failure
        BEFORE INSERT ON raw_payloads
        WHEN NEW.text = 'force runtime rollback'
        BEGIN
          SELECT RAISE(ABORT, 'forced runtime ingest failure');
        END;
      `);

      await expect(
        runtime.execute({
          kind: "capture_turn",
          operation_id: "operation-rollback",
          identity: primaryIdentity("session-1"),
          user_content: "force runtime rollback",
          assistant_content: "This write must roll back.",
          observed_at: "2026-07-10T00:00:00.000Z"
        })
      ).rejects.toThrow("forced runtime ingest failure");

      expect(
        inspectionDb.prepare("SELECT COUNT(*) AS count FROM runtime_operation_receipts").get()
      ).toEqual({ count: 0 });
      expect(inspectionDb.prepare("SELECT COUNT(*) AS count FROM runtime_turn_counters").get()).toEqual({ count: 0 });

      inspectionDb.exec("DROP TRIGGER force_runtime_ingest_failure");
      await expect(
        runtime.execute({
          kind: "capture_turn",
          operation_id: "operation-after-rollback",
          identity: primaryIdentity("session-1"),
          user_content: "Successful turn after rollback.",
          assistant_content: "It must still receive index zero.",
          observed_at: "2026-07-10T00:01:00.000Z"
        })
      ).resolves.toMatchObject({ turn_index: 0 });
    } finally {
      inspectionDb.close();
      await runtime.close();
    }
  });

  it("canonicalizes schema JSON with sorted object keys and preserved array order", () => {
    expect(canonicalJson([{ z: "中文", a: { y: 2, x: 1 } }, "tail"])).toBe(
      '[{"a":{"x":1,"y":2},"z":"中文"},"tail"]'
    );
  });
});

function createTemporaryStateDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "partner-mem-runtime-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function startRuntime(stateDir: string): Promise<PartnerMemRuntime> {
  const runtime = createPartnerMemRuntime();
  await expect(
    runtime.start({
      protocol_version: 1,
      state_dir: stateDir,
      client: {
        name: "partner-mem-hermes",
        version: "0.1.0",
        host: "hermes",
        host_version: "0.18.2"
      }
    })
  ).resolves.toMatchObject({
    protocol_version: 1,
    runtime_version: "0.1.0",
    capabilities: ["context.assemble.v1", "turn.capture.v1", "tools.invoke.v1"],
    tool_schema_digest: expect.stringMatching(/^[a-f0-9]{64}$/u)
  });
  return runtime;
}

function primaryIdentity(sessionId: string, agentId = "coder", host = "hermes") {
  return {
    host,
    agent_id: agentId,
    session_id: sessionId,
    agent_context: "primary" as const
  };
}
