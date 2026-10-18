import { FindingSchema } from "@releaselens/contracts";
import { describe, expect, it } from "vitest";
import { diagnose } from "./engine.js";
import { listScenarios, parse } from "./test-support/fixtures.js";

const scenarios = listScenarios();

describe("fault scenarios", () => {
  it("has the documented scenarios", () => {
    expect(scenarios.map((s) => s.name).sort()).toEqual([
      "azure-api-timeout",
      "broken-health-endpoint",
      "failed-workflow",
      "healthy-baseline",
      "missing-build-metadata",
      "stale-deployment",
    ]);
  });

  describe.each(scenarios)("$name", (scenario) => {
    const snapshot = parse(scenario.input);
    const findings = diagnose(snapshot);

    it("produces exactly the expected findings", () => {
      expect(
        findings.map((f) => ({
          ruleId: f.ruleId,
          severity: f.severity,
          confidence: f.confidence,
          evidenceIds: f.evidenceIds,
        })),
      ).toEqual(scenario.expected);
    });

    it("produces findings that match the published finding schema", () => {
      for (const finding of findings) {
        expect(FindingSchema.safeParse(finding).success).toBe(true);
      }
    });

    it("only cites evidence that exists in the snapshot", () => {
      const known = new Set([
        ...snapshot.workflowRuns.map((e) => e.id),
        ...(snapshot.deployment ? [snapshot.deployment.id] : []),
        ...snapshot.healthChecks.map((e) => e.id),
        ...snapshot.syncStatus.map((e) => e.id),
      ]);
      for (const id of findings.flatMap((f) => f.evidenceIds)) {
        expect(known).toContain(id);
      }
    });

    it("is deterministic", () => {
      expect(diagnose(parse(scenario.input))).toEqual(findings);
    });
  });
});
