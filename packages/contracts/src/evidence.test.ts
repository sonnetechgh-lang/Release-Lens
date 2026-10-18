import { describe, expect, it } from "vitest";
import { parseSnapshot, type DiagnosticSnapshotInput } from "./evidence.js";

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

function minimal(overrides: Partial<DiagnosticSnapshotInput> = {}): DiagnosticSnapshotInput {
  return {
    schemaVersion: 1,
    evaluatedAt: "2026-10-18T12:00:00Z",
    project: { id: "demo", name: "Demo" },
    service: { id: "api", name: "API" },
    environment: { id: "production", name: "Production", releaseBranch: "main" },
    ...overrides,
  };
}

describe("parseSnapshot", () => {
  it("applies policy and list defaults", () => {
    const result = parseSnapshot(minimal());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.snapshot.policy.healthFailureThreshold).toBe(3);
    expect(result.snapshot.policy.evidenceFreshnessSeconds).toBe(3600);
    expect(result.snapshot.workflowRuns).toEqual([]);
  });

  it("keeps explicit policy values and fills in the rest", () => {
    const result = parseSnapshot(minimal({ policy: { healthFailureThreshold: 5 } }));
    expect(result.success && result.snapshot.policy).toMatchObject({
      healthFailureThreshold: 5,
      healthFreshnessSeconds: 900,
    });
  });

  it("rejects timestamps that are not UTC", () => {
    const result = parseSnapshot(minimal({ evaluatedAt: "2026-10-18T12:00:00+02:00" }));
    expect(result.success).toBe(false);
  });

  it("rejects short commit SHAs", () => {
    const result = parseSnapshot(
      minimal({
        workflowRuns: [
          {
            id: "run-1",
            observedAt: "2026-10-18T11:00:00Z",
            provider: "github",
            runId: "1",
            workflowName: "deploy",
            branch: "main",
            commitSha: "a1b2c3d",
            status: "queued",
            startedAt: "2026-10-18T11:00:00Z",
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/40-character/);
  });

  it("rejects a completed run without a conclusion", () => {
    const result = parseSnapshot(
      minimal({
        workflowRuns: [
          {
            id: "run-1",
            observedAt: "2026-10-18T11:00:00Z",
            provider: "github",
            runId: "1",
            workflowName: "deploy",
            branch: "main",
            commitSha: SHA,
            status: "completed",
            startedAt: "2026-10-18T11:00:00Z",
            completedAt: "2026-10-18T11:05:00Z",
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a failed health check without a failure kind", () => {
    const result = parseSnapshot(
      minimal({
        healthChecks: [
          {
            id: "hc-1",
            observedAt: "2026-10-18T11:00:00Z",
            provider: "health-probe",
            endpoint: "/healthz",
            outcome: "fail",
            durationMs: 10,
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects duplicate evidence IDs across evidence types", () => {
    const result = parseSnapshot(
      minimal({
        healthChecks: [
          {
            id: "dup",
            observedAt: "2026-10-18T11:00:00Z",
            provider: "health-probe",
            endpoint: "/healthz",
            outcome: "pass",
            durationMs: 10,
          },
        ],
        syncStatus: [{ id: "dup", provider: "github" }],
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/Duplicate evidence id "dup"/);
  });

  it("rejects input that is not an object", () => {
    expect(parseSnapshot("nope").success).toBe(false);
    expect(parseSnapshot(null).success).toBe(false);
  });
});
