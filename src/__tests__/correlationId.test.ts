import { describe, it, expect } from "vitest";
import { generateCorrelationId } from "../utils/correlationId";

describe("generateCorrelationId", () => {
  it("starts with cid_ prefix", () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^cid_/);
  });

  it("is a non-empty string", () => {
    const id = generateCorrelationId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("produces unique IDs across 1000 calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateCorrelationId()));
    expect(ids.size).toBe(1000);
  });
});
