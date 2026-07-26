import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { PartnerMemRuntime } from "./partner-mem-runtime.js";

export async function serveJsonLines(
  input: Readable,
  output: Writable,
  runtime: Pick<PartnerMemRuntime, "handle">
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      output.write(
        `${JSON.stringify({
          id: "unknown",
          ok: false,
          error: { code: "INVALID_REQUEST", message: "Request line is not valid JSON" }
        })}\n`
      );
      continue;
    }
    output.write(`${JSON.stringify(await runtime.handle(request))}\n`);
  }
}
