import type { DiagnosticSnapshotInput } from "@releaselens/contracts";
import { describe, expect, it } from "vitest";
import { baseline } from "../test-support/fixtures.js";
import { healthEndpointFailing as rule } from "./health-endpoint-failing.js";

type CheckInput = NonNullable<DiagnosticSnapshotInput["healthChecks"]>[number];

function check(n: number, at: string, outcome: "pass" | "fail", endpoint = "/healthz"): CheckInput {
  return outcome === "pass"
    ? {
        id: `hc-${String(n)}`,
        observedAt: at,
        provider: "health-probe",
        endpoint,
        outcome,
        httpStatus: 200,
        durationMs: 40,
      }
    : {
        id: `hc-${String(n)}`,
        observedAt: at,
        provider: "health-probe",
        endpoint,
        outcome,
        httpStatus: 503,
        failureKind: "unexpected-status",
        durationMs: 90,
      };
}

function withChecks(checks: CheckInput[], modify?: (i: DiagnosticSnapshotInput) => void) {
  return baseline((input) => {
    input.healthChecks = checks;
    modify?.(input);
  });
}

const THREE_FAILS = [
  check(1, "2026-10-18T11:40:00Z", "pass"),
  check(2, "2026-10-18T11:45:00Z", "fail"),
  check(3, "2026-10-18T11:50:00Z", "fail"),
  check(4, "2026-10-18T11:55:00Z", "fail"),
];

describe("health.endpoint-failing", () => {
  it("fires after the threshold of consecutive failures", () => {
    const [finding, ...rest] = rule.evaluate(withChecks(THREE_FAILS));
    expect(rest).toHaveLength(0);
    expect(finding).toMatchObject({ severity: "high", confidence: "medium" });
    expect(finding?.facts[0]?.text).toContain("The last 3 checks of /healthz failed");
    expect(finding?.facts[0]?.text).toContain("3× HTTP 503");
    expect(finding?.facts[1]?.evidenceIds).toEqual(["hc-1"]);
  });

  it("does not fire below the threshold", () => {
    expect(rule.evaluate(withChecks(THREE_FAILS.slice(0, 3)))).toEqual([]);
  });

  it("respects a custom threshold", () => {
    const snapshot = withChecks(THREE_FAILS.slice(0, 3), (i) => {
      i.policy = { healthFailureThreshold: 2 };
    });
    expect(rule.evaluate(snapshot)).toHaveLength(1);
  });

  it("does not fire when the latest check passed", () => {
    const checks = [...THREE_FAILS, check(5, "2026-10-18T11:58:00Z", "pass")];
    expect(rule.evaluate(withChecks(checks))).toEqual([]);
  });

  it("does not fire when there are no checks (missing data)", () => {
    expect(rule.evaluate(withChecks([]))).toEqual([]);
  });

  it("does not fire on stale results, even if they failed", () => {
    const snapshot = withChecks(THREE_FAILS, (i) => {
      i.evaluatedAt = "2026-10-18T13:00:00Z"; // latest check is 65 minutes old
    });
    expect(rule.evaluate(snapshot)).toEqual([]);
  });

  it("ignores results recorded after the evaluation time", () => {
    const checks = [
      check(1, "2026-10-18T11:55:00Z", "pass"),
      ...THREE_FAILS.slice(1).map((c) => ({
        ...c,
        observedAt: c.observedAt.replace("T11", "T12"),
      })),
    ];
    expect(rule.evaluate(withChecks(checks))).toEqual([]);
  });

  it("evaluates each endpoint separately", () => {
    const checks = [...THREE_FAILS, check(10, "2026-10-18T11:55:00Z", "pass", "/ready")];
    const findings = rule.evaluate(withChecks(checks));
    expect(findings.map((f) => f.id)).toEqual([
      "health.endpoint-failing/demo-shop/storefront-api/production/%2Fhealthz",
    ]);
  });

  it("mentions a recent deployment only as a correlation", () => {
    const snapshot = withChecks(THREE_FAILS, (i) => {
      i.deployment = { ...i.deployment!, activeSince: "2026-10-18T11:42:00Z" };
    });
    const [finding] = rule.evaluate(snapshot);
    const correlation = finding?.inferences.find((s) => s.text.includes("became active"));
    expect(correlation?.text).toContain("Failures began 3m after revision");
    expect(correlation?.text).toContain("not proof");
    expect(finding?.facts.some((s) => s.text.includes("became active"))).toBe(false);
  });

  it("does not mention a deployment that went live long before the failures", () => {
    const [finding] = rule.evaluate(withChecks(THREE_FAILS));
    expect(finding?.inferences.some((s) => s.text.includes("became active"))).toBe(false);
  });

  it("notes that the start is unknown when no passing check exists", () => {
    const [finding] = rule.evaluate(withChecks(THREE_FAILS.slice(1)));
    expect(finding?.unknowns.join(" ")).toContain("no passing check");
  });
});
