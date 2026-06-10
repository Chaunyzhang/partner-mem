import { describe, expect, it } from "vitest";
import {
  EDGE_CLASSES,
  EVIDENCE_EDGE_TYPES,
  NODE_STATUSES,
  NODE_TYPES,
  PATH_STATUSES,
  REVISION_EDGE_TYPES,
  RESULT_CLASSES,
  assertEdgeClass,
  assertEvidenceEdgeType,
  assertNodeStatus,
  assertNodeType,
  assertPathStatus,
  assertResultClass,
  assertRevisionEdgeType,
  isEvidenceEdgeType
} from "../../src/core/contracts.js";
import { hashText } from "../../src/core/hash.js";

describe("graph contracts", () => {
  it("accepts every allowed value", () => {
    for (const value of NODE_TYPES) expect(assertNodeType(value)).toBe(value);
    for (const value of EDGE_CLASSES) expect(assertEdgeClass(value)).toBe(value);
    for (const value of EVIDENCE_EDGE_TYPES) {
      expect(assertEvidenceEdgeType(value)).toBe(value);
      expect(isEvidenceEdgeType(value)).toBe(true);
    }
    for (const value of REVISION_EDGE_TYPES) {
      expect(assertRevisionEdgeType(value)).toBe(value);
      expect(isEvidenceEdgeType(value)).toBe(false);
    }
    for (const value of NODE_STATUSES) expect(assertNodeStatus(value)).toBe(value);
    for (const value of PATH_STATUSES) expect(assertPathStatus(value)).toBe(value);
    for (const value of RESULT_CLASSES) expect(assertResultClass(value)).toBe(value);
  });

  it("rejects unknown contract values", () => {
    expect(() => assertNodeType("message")).toThrow(/Unknown NodeType/);
    expect(() => assertEdgeClass("proof")).toThrow(/Unknown EdgeClass/);
    expect(() => assertEvidenceEdgeType("RELATED_TO")).toThrow(/Unknown EvidenceEdgeType/);
    expect(() => assertRevisionEdgeType("RAW_NEAR_RAW")).toThrow(/Unknown RevisionEdgeType/);
    expect(isEvidenceEdgeType("RELATED_TO")).toBe(false);
  });

  it("hashes text deterministically", () => {
    expect(hashText("raw truth")).toBe(hashText("raw truth"));
    expect(hashText("raw truth")).not.toBe(hashText("raw truth "));
  });
});
