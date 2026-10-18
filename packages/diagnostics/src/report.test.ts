import { describe, expect, it } from "vitest";
import { diagnose } from "./engine.js";
import { renderMarkdownReport } from "./report.js";
import { listScenarios, parse } from "./test-support/fixtures.js";

function reportFor(name: string): string {
  const scenario = listScenarios().find((s) => s.name === name);
  if (scenario === undefined) throw new Error(`No scenario ${name}`);
  const snapshot = parse(scenario.input);
  return renderMarkdownReport(snapshot, diagnose(snapshot));
}

describe("renderMarkdownReport", () => {
  it("says clearly when there are no findings", () => {
    const report = reportFor("healthy-baseline");
    expect(report).toContain("**Findings:** 0");
    expect(report).toContain("No findings.");
    expect(report).not.toContain("## Evidence");
  });

  it("separates facts, inferences, unknowns, and next steps", () => {
    const report = reportFor("broken-health-endpoint");
    expect(report).toContain("### 1. [HIGH] Health endpoint /healthz is failing in Production");
    expect(report).toContain("**Facts (observed)**");
    expect(report).toContain("**Inferences (not proven)**");
    expect(report).toContain("**Unknowns**");
    expect(report).toContain("**Next steps**");
  });

  it("lists cited evidence with links and the freshness of every integration", () => {
    const report = reportFor("stale-deployment");
    expect(report).toContain("| `run-102` | Workflow run |");
    expect(report).toContain("](https://github.com/example/demo-shop/actions/runs/102)");
    expect(report).toContain("| Azure Container Apps | 2026-10-18T11:58:00Z | none |");
  });

  it("escapes Markdown in text that comes from evidence", () => {
    const snapshot = parse(listScenarios().find((s) => s.name === "missing-build-metadata")?.input);
    snapshot.deployment = { ...snapshot.deployment!, revisionName: "rev|*evil*" };
    const report = renderMarkdownReport(snapshot, diagnose(snapshot));
    expect(report).toContain("rev\\|\\*evil\\*");
  });
});
