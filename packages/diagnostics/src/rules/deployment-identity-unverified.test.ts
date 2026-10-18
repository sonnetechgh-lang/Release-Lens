import { describe, expect, it } from "vitest";
import { SHA, baseline, setSync } from "../test-support/fixtures.js";
import { deploymentIdentityUnverified as rule } from "./deployment-identity-unverified.js";

function tagOnly(modify?: Parameters<typeof baseline>[0]) {
  return baseline((input) => {
    input.deployment = {
      ...input.deployment!,
      imageReference: "demoacr.azurecr.io/storefront-api:latest",
    };
    delete input.deployment.imageDigest;
    modify?.(input);
  });
}

describe("deployment.identity-unverified", () => {
  it("fires when the revision uses only a mutable tag", () => {
    const [finding] = rule.evaluate(tagOnly());
    expect(finding).toMatchObject({ severity: "warning", confidence: "high" });
    expect(finding?.facts[0]?.text).toContain("by tag, with no image digest");
  });

  it("fires when a digest exists but cannot be linked to any commit", () => {
    const snapshot = baseline((input) => {
      input.deployment = { ...input.deployment!, imageDigest: `sha256:${"e".repeat(64)}` };
    });
    const [finding] = rule.evaluate(snapshot);
    expect(finding?.facts[0]?.text).toContain(
      "no workflow run in the available evidence produced that digest",
    );
  });

  it("does not fire when the digest matches a build", () => {
    expect(rule.evaluate(baseline())).toEqual([]);
  });

  it("does not fire when the tag-only revision carries commit metadata", () => {
    const snapshot = tagOnly((input) => {
      input.deployment = {
        ...input.deployment!,
        commitSha: SHA.B,
        commitShaSource: "build-metadata",
      };
    });
    expect(rule.evaluate(snapshot)).toEqual([]);
  });

  it("does not fire when there is no deployment (missing data)", () => {
    expect(rule.evaluate(baseline((i) => delete i.deployment))).toEqual([]);
  });

  it("does not fire when Azure data is stale or unavailable", () => {
    expect(
      rule.evaluate(tagOnly((i) => setSync(i, "azure-container-apps", "2026-10-18T06:00:00Z"))),
    ).toEqual([]);
    expect(
      rule.evaluate(tagOnly((i) => setSync(i, "azure-container-apps", undefined, "unauthorized"))),
    ).toEqual([]);
  });
});
