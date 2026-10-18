import { describe, expect, it } from "vitest";
import { DIGEST, SHA, baseline, setSync } from "../test-support/fixtures.js";
import { deploymentStale } from "./deployment-stale.js";

/** Baseline modified so production runs run 101's image while run 102 is the latest success. */
function staleInput(modify?: Parameters<typeof baseline>[0]) {
  return baseline((input) => {
    input.deployment = {
      ...input.deployment!,
      id: "deploy-r101",
      revisionName: "storefront-api--r101",
      imageReference: `demoacr.azurecr.io/storefront-api@${DIGEST.A}`,
      imageDigest: DIGEST.A,
    };
    modify?.(input);
  });
}

describe("deployment.stale", () => {
  it("fires when the verified deployed commit is older than the latest successful build", () => {
    const [finding, ...rest] = deploymentStale.evaluate(staleInput());
    expect(rest).toHaveLength(0);
    expect(finding).toMatchObject({
      ruleId: "deployment.stale",
      severity: "warning",
      confidence: "high",
      id: "deployment.stale/demo-shop/storefront-api/production",
    });
    expect(finding?.facts[1]?.text).toContain(
      "verified by its image digest matching the image built by run 101",
    );
  });

  it("raises severity to high once the lag exceeds the policy threshold", () => {
    const snapshot = staleInput((input) => {
      input.policy = { staleDeploymentHighAfterSeconds: 3600 };
    });
    expect(deploymentStale.evaluate(snapshot)[0]?.severity).toBe("high");
  });

  it("does not fire when the latest successful build is deployed", () => {
    expect(deploymentStale.evaluate(baseline())).toEqual([]);
  });

  it("does not fire within the deployment grace period", () => {
    const snapshot = staleInput((input) => {
      input.evaluatedAt = "2026-10-18T08:20:00Z"; // 11 minutes after run 102 completed
      input.syncStatus = input.syncStatus?.map((s) => ({
        ...s,
        lastSuccessfulSyncAt: "2026-10-18T08:19:00Z",
      }));
      input.healthChecks = [];
    });
    expect(deploymentStale.evaluate(snapshot)).toEqual([]);
  });

  it("does not fire when the deployed identity is only a tag (missing data)", () => {
    const snapshot = staleInput((input) => {
      input.deployment = {
        ...input.deployment!,
        imageReference: "demoacr.azurecr.io/storefront-api:latest",
      };
      delete input.deployment.imageDigest;
    });
    expect(deploymentStale.evaluate(snapshot)).toEqual([]);
  });

  it("does not fire when there is no deployment or no successful run", () => {
    expect(deploymentStale.evaluate(staleInput((i) => delete i.deployment))).toEqual([]);
    expect(
      deploymentStale.evaluate(
        staleInput((i) => {
          i.workflowRuns = i.workflowRuns?.map((r) => ({ ...r, conclusion: "failure" as const }));
        }),
      ),
    ).toEqual([]);
  });

  it("does not fire when Azure data is stale", () => {
    const snapshot = staleInput((i) =>
      setSync(i, "azure-container-apps", "2026-10-18T08:00:00Z", "timeout"),
    );
    expect(deploymentStale.evaluate(snapshot)).toEqual([]);
  });

  it("does not fire when GitHub has never synced (provider error)", () => {
    const snapshot = staleInput((i) => setSync(i, "github", undefined, "unauthorized"));
    expect(deploymentStale.evaluate(snapshot)).toEqual([]);
  });

  it("does not fire when the deployed build is newer than the expected one", () => {
    const snapshot = baseline((input) => {
      // Run 103 on another branch built what is deployed; it finished after run 102.
      input.workflowRuns?.push({
        id: "run-103",
        observedAt: "2026-10-18T11:55:00Z",
        provider: "github",
        runId: "103",
        workflowName: "build-and-deploy",
        branch: "hotfix",
        commitSha: SHA.C,
        status: "completed",
        conclusion: "success",
        startedAt: "2026-10-18T10:00:00Z",
        completedAt: "2026-10-18T10:10:00Z",
        producedImageDigest: DIGEST.C,
      });
      input.deployment = { ...input.deployment!, imageDigest: DIGEST.C };
    });
    expect(deploymentStale.evaluate(snapshot)).toEqual([]);
  });

  it("accepts commit metadata from an OCI label when no run matches the digest", () => {
    const snapshot = staleInput((input) => {
      input.deployment = {
        ...input.deployment!,
        imageDigest: `sha256:${"d".repeat(64)}`,
        commitSha: SHA.A,
        commitShaSource: "oci-label",
      };
    });
    const [finding] = deploymentStale.evaluate(snapshot);
    expect(finding?.facts[1]?.text).toContain("OCI revision label");
  });
});
