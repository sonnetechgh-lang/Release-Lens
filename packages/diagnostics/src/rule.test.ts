import { describe, expect, it } from "vitest";
import { RuleRegistry, type Rule } from "./rule.js";

type Snapshot = { deployedSha?: string; expectedSha: string };

const staleRule: Rule<Snapshot, string> = {
  id: "deployment.stale",
  version: 1,
  description: "test rule",
  evaluate: (s) =>
    s.deployedSha !== undefined && s.deployedSha !== s.expectedSha ? ["stale"] : [],
};

const unknownRule: Rule<Snapshot, string> = {
  id: "deployment.identity-unknown",
  version: 1,
  description: "test rule",
  evaluate: (s) => (s.deployedSha === undefined ? ["unverified"] : []),
};

describe("RuleRegistry", () => {
  it("runs all rules in registration order", () => {
    const registry = new RuleRegistry<Snapshot, string>().register(staleRule).register(unknownRule);
    expect(registry.evaluate({ deployedSha: "a", expectedSha: "b" })).toEqual(["stale"]);
    expect(registry.evaluate({ expectedSha: "b" })).toEqual(["unverified"]);
    expect(registry.evaluate({ deployedSha: "b", expectedSha: "b" })).toEqual([]);
  });

  it("rejects duplicate rule ids", () => {
    const registry = new RuleRegistry<Snapshot, string>().register(staleRule);
    expect(() => registry.register(staleRule)).toThrow(/already registered/);
  });

  it("rejects malformed ids and versions", () => {
    const registry = new RuleRegistry<Snapshot, string>();
    expect(() => registry.register({ ...staleRule, id: "Stale" })).toThrow(/Invalid rule id/);
    expect(() => registry.register({ ...staleRule, version: 0 })).toThrow(/positive integer/);
  });
});
