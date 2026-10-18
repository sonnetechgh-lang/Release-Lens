import type { Statement } from "@releaselens/contracts";
import {
  expectedRelease,
  formatDuration,
  isProviderFresh,
  resolveDeployedIdentity,
  secondsBetween,
  shortSha,
} from "../evidence.js";
import { buildFinding } from "../finding-builder.js";
import type { DiagnosticRule } from "../rule.js";

const VIA_TEXT = {
  "digest-match": "its image digest matching the image built by run",
  "oci-label": "the image's OCI revision label",
  "build-metadata": "build metadata reported by the service",
} as const;

export const deploymentStale: DiagnosticRule = {
  id: "deployment.stale",
  version: 1,
  category: "deployment",
  description:
    "The verified deployed commit differs from the latest successful release build, after the grace period.",

  evaluate(snapshot) {
    // Both sides of the comparison must be trustworthy, or we say nothing.
    if (!isProviderFresh(snapshot, "github")) return [];
    if (!isProviderFresh(snapshot, "azure-container-apps")) return [];

    const deployment = snapshot.deployment;
    const expected = expectedRelease(snapshot);
    if (deployment === undefined || expected === undefined) return [];

    const identity = resolveDeployedIdentity(snapshot);
    if (!identity.verified) return []; // covered by deployment.identity-unverified
    if (identity.commitSha === expected.commitSha) return [];

    const { policy, environment } = snapshot;
    const sinceBuild = secondsBetween(expected.completedAt, snapshot.evaluatedAt);
    if (sinceBuild < policy.deploymentGraceSeconds) return []; // deployment may still be rolling out

    // A deployed build newer than the expected one is a different problem, not staleness.
    const deployedRun = identity.buildRun;
    if (
      deployedRun?.completedAt !== undefined &&
      Date.parse(deployedRun.completedAt) > Date.parse(expected.completedAt)
    ) {
      return [];
    }

    const via =
      identity.via === "digest-match" && deployedRun !== undefined
        ? `${VIA_TEXT[identity.via]} ${deployedRun.runId}`
        : VIA_TEXT[identity.via];

    const facts: Statement[] = [
      {
        text: `The latest successful "${expected.workflowName}" run on ${expected.branch} (run ${expected.runId}) built commit ${shortSha(expected.commitSha)} and completed at ${expected.completedAt}.`,
        evidenceIds: [expected.id],
      },
      {
        text: `Revision ${deployment.revisionName} is running commit ${shortSha(identity.commitSha)}, verified by ${via}.`,
        evidenceIds: identity.evidenceIds,
      },
      {
        text: `The expected build finished ${formatDuration(sinceBuild)} before this check, longer than the ${formatDuration(policy.deploymentGraceSeconds)} deployment grace period.`,
        evidenceIds: [expected.id],
      },
    ];

    const unknowns = [
      `Whether a deployment of commit ${shortSha(expected.commitSha)} to ${environment.name} was attempted.`,
    ];
    if (deployedRun === undefined) {
      unknowns.push(
        "Which workflow run built the deployed commit: none in the available evidence did.",
      );
    }

    return [
      buildFinding(this, snapshot, {
        severity: sinceBuild > policy.staleDeploymentHighAfterSeconds ? "high" : "warning",
        confidence: "high",
        title: `${environment.name} is running an older build than the latest successful release`,
        facts,
        inferences: [
          {
            text: `${environment.name} has not received the latest successful build of ${environment.releaseBranch}. The deploy step may have failed, been skipped, or targeted another environment.`,
            evidenceIds: [expected.id, deployment.id],
          },
        ],
        unknowns,
        nextSteps: [
          `Open run ${expected.runId} and check whether its deploy step ran and succeeded${expected.url ? ` (${expected.url})` : ""}.`,
          "Compare the image digest pushed by that run with the digest configured on the active revision.",
          "Check the Container App's revision history for a failed or inactive revision of the newer image.",
        ],
      }),
    ];
  },
};
