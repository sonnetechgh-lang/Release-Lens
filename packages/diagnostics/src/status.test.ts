import { describe, expect, it } from "vitest";
import { isStatus } from "./status.js";

describe("isStatus", () => {
  it("accepts every defined status", () => {
    for (const status of ["healthy", "degraded", "failed", "unknown", "unverified"]) {
      expect(isStatus(status)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isStatus("ok")).toBe(false);
    expect(isStatus("")).toBe(false);
    expect(isStatus(undefined)).toBe(false);
    expect(isStatus(1)).toBe(false);
  });
});
