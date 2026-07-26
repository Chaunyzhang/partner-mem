import { describe, expect, it } from "vitest";
import {
  SOURCE_OBJECT_KINDS,
  assertSourceObjectKind,
  optionalNonEmptyString,
  requireNonEmptyString,
  requireNonNegativeInteger
} from "../../src/core/contracts.js";

describe("V1 contracts", () => {
  it("allows only host structural object kinds", () => {
    expect(SOURCE_OBJECT_KINDS).toEqual([
      "conversation",
      "thread",
      "message",
      "author",
      "agent"
    ]);
    expect(assertSourceObjectKind("conversation")).toBe("conversation");
    expect(() => assertSourceObjectKind("topic")).toThrow("Unknown source object kind");
  });

  it("keeps stored host text exact while rejecting empty required values", () => {
    expect(requireNonEmptyString("  original text  ", "text")).toBe("  original text  ");
    expect(optionalNonEmptyString(undefined, "optional")).toBeNull();
    expect(() => requireNonEmptyString("  ", "text")).toThrow("non-empty string");
  });

  it("accepts only non-negative host display order", () => {
    expect(requireNonNegativeInteger(0, "display_order")).toBe(0);
    expect(requireNonNegativeInteger(null, "display_order")).toBeNull();
    expect(() => requireNonNegativeInteger(-1, "display_order")).toThrow(
      "non-negative integer"
    );
  });
});
