import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { serveJsonLines } from "../../src/runtime/jsonl-server.js";
import { PartnerMemRuntime } from "../../src/runtime/partner-mem-runtime.js";
import { createTestDatabase } from "../helpers/database.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe("JSONL runtime transport", () => {
  it("returns one response per non-empty line and continues after malformed JSON", async () => {
    const fixture = createTestDatabase();
    const runtime = new PartnerMemRuntime(fixture.db);
    cleanups.push(fixture.close);
    const output = new PassThrough();
    let text = "";
    output.setEncoding("utf8");
    output.on("data", (chunk: string) => {
      text += chunk;
    });

    await serveJsonLines(
      Readable.from([
        "{not-json}\n",
        "\n",
        `${JSON.stringify({
          id: "next",
          command: "register_harness",
          params: { harness_type: "jsonl-test" }
        })}\n`
      ]),
      output,
      runtime
    );

    const responses = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" }
    });
    expect(responses[1]).toMatchObject({ id: "next", ok: true });
  });
});
