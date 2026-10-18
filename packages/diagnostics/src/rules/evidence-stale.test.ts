import { describe, expect, it } from "vitest";
import { baseline, setSync } from "../test-support/fixtures.js";
import { evidenceStale as rule } from "./evidence-stale.js";

describe("evidence.stale", () => {
  it("fires when a provider's last success is older than the freshness limit", () => {
    const snapshot = baseline((i) =>
      setSync(i, "azure-container-apps", "2026-10-18T08:30:00Z", "timeout"),
    );
    const [finding, ...rest] = rule.evaluate(snapshot);
    expect(rest).toHaveLength(0);
    expect(finding).toMatchObject({
      id: "evidence.stale/demo-shop/storefront-api/production/azure-container-apps",
      severity: "warning",
      evidenceIds: ["sync-azure"],
    });
    expect(finding?.facts[0]?.text).toContain("3h 30m ago");
    expect(finding?.facts[1]?.text).toContain("failed with: timeout");
    expect(finding?.nextSteps[0]).toContain("status page");
  });

  it("fires when a provider has never synced", () => {
    const [finding] = rule.evaluate(
      baseline((i) => setSync(i, "github", undefined, "unauthorized")),
    );
    expect(finding?.facts[0]?.text).toBe("GitHub has never synced successfully.");
    expect(finding?.nextSteps[0]).toContain("credentials");
  });

  it("reports each stale provider separately", () => {
    const snapshot = baseline((i) => {
      setSync(i, "github", "2026-10-18T06:00:00Z");
      setSync(i, "health-probe", "2026-10-18T06:00:00Z");
    });
    expect(rule.evaluate(snapshot).map((f) => f.evidenceIds[0])).toEqual([
      "sync-github",
      "sync-health",
    ]);
  });

  it("does not fire when all providers are fresh", () => {
    expect(rule.evaluate(baseline())).toEqual([]);
  });

  it("does not fire exactly at the limit", () => {
    const snapshot = baseline((i) => setSync(i, "github", "2026-10-18T11:00:00Z"));
    expect(rule.evaluate(snapshot)).toEqual([]);
  });

  it("does not fire when no sync status is supplied (nothing to judge)", () => {
    expect(rule.evaluate(baseline((i) => (i.syncStatus = [])))).toEqual([]);
  });
});
