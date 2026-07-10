import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Hermes Python provider", () => {
  it("passes the standalone provider contract suite", () => {
    const result = spawnSync(
      "python3",
      ["-m", "unittest", "discover", "-s", "integrations/hermes/tests", "-p", "test_*.py", "-v"],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8"
      }
    );

    expect(result.status, [result.stdout, result.stderr].filter(Boolean).join("\n")).toBe(0);
  });
});
