import type { DiagnosticSnapshotInput } from "@releaselens/contracts";
import { describe, expect, it } from "vitest";
import { SHA, baseline, setSync } from "../test-support/fixtures.js";
import { workflowFailed as rule } from "./workflow-failed.js";

type RunInput = NonNullable<DiagnosticSnapshotInput["workflowRuns"]>[number];

function run103(overrides: Partial<RunInput> = {}): RunInput {
  return {
    id: "run-103",
    observedAt: "2026-10-18T11:55:00Z",
    provider: "github",
    runId: "103",
    workflowName: "build-and-deploy",
    branch: "main",
    commitSha: SHA.C,
    status: "completed",
    conclusion: "failure",
    startedAt: "2026-10-18T10:00:00Z",
    completedAt: "2026-10-18T10:06:00Z",
    ...overrides,
  };
}

const withRun = (run: RunInput, modify?: (i: DiagnosticSnapshotInput) => void) =>
  baseline((input) => {
    input.workflowRuns?.push(run);
    modify?.(input);
  });

describe("workflow.failed", () => {
  it("fires when the latest release run failed", () => {
    const [finding] = rule.evaluate(withRun(run103()));
    expect(finding).toMatchObject({
      severity: "warning",
      confidence: "high",
      evidenceIds: ["run-102", "run-103"],
    });
  });

  it("fires when the latest release run timed out", () => {
    expect(rule.evaluate(withRun(run103({ conclusion: "timed_out" })))).toHaveLength(1);
  });

  it("does not fire when the latest run succeeded", () => {
    expect(rule.evaluate(baseline())).toEqual([]);
  });

  it("does not fire for cancelled runs", () => {
    expect(rule.evaluate(withRun(run103({ conclusion: "cancelled" })))).toEqual([]);
  });

  it("does not fire for failures on other branches or workflows", () => {
    expect(rule.evaluate(withRun(run103({ branch: "feature/x" })))).toEqual([]);
    expect(rule.evaluate(withRun(run103({ workflowName: "lint" })))).toEqual([]);
  });

  it("does not fire while the newest run is still in progress after an older failure", () => {
    const snapshot = withRun(
      {
        ...run103({ status: "in_progress" }),
        conclusion: undefined,
        completedAt: undefined,
      },
      (i) => {
        i.workflowRuns = i.workflowRuns?.filter((r) => r.id !== "run-102");
      },
    );
    expect(rule.evaluate(snapshot)).toEqual([]);
  });

  it("does not fire when there are no runs (missing data)", () => {
    expect(rule.evaluate(baseline((i) => (i.workflowRuns = [])))).toEqual([]);
  });

  it("does not fire when GitHub data is stale", () => {
    expect(
      rule.evaluate(
        withRun(run103(), (i) => setSync(i, "github", "2026-10-18T09:00:00Z", "rate-limited")),
      ),
    ).toEqual([]);
  });
});
