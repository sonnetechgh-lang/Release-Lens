import { isProviderFresh, resolveDeployedIdentity } from "../evidence.js";
import { buildFinding } from "../finding-builder.js";
import type { DiagnosticRule } from "../rule.js";

export const deploymentIdentityUnverified: DiagnosticRule = {
  id: "deployment.identity-unverified",
  version: 1,
  category: "deployment",
  description:
    "The running revision cannot be tied to a commit using immutable evidence (digest or embedded metadata).",

  evaluate(snapshot) {
    if (!isProviderFresh(snapshot, "azure-container-apps")) return [];
    const deployment = snapshot.deployment;
    if (deployment === undefined) return [];

    const identity = resolveDeployedIdentity(snapshot);
    if (identity.verified || identity.reason === "no-deployment") return [];

    const envName = snapshot.environment.name;
    const ev = [deployment.id];
    const tagOnly = identity.reason === "tag-only";

    return [
      buildFinding(this, snapshot, {
        severity: "warning",
        confidence: "high",
        title: `The code running in ${envName} cannot be identified`,
        facts: [
          tagOnly
            ? {
                text: `Revision ${deployment.revisionName} references image "${deployment.imageReference}" by tag, with no image digest.`,
                evidenceIds: ev,
              }
            : {
                text: `Revision ${deployment.revisionName} runs image digest ${deployment.imageDigest ?? ""}, but no workflow run in the available evidence produced that digest.`,
                evidenceIds: ev,
              },
          {
            text: "No commit metadata (OCI revision label or build metadata) was reported for this revision.",
            evidenceIds: ev,
          },
        ],
        inferences: [
          tagOnly
            ? {
                text: "Tags can be moved to a different image at any time, so the running source code cannot be identified from this evidence.",
                evidenceIds: ev,
              }
            : {
                text: "The image is fixed, but it cannot be linked to a commit. It may have been built outside the release workflow.",
                evidenceIds: ev,
              },
        ],
        unknowns: [
          `Which commit is running in ${envName}.`,
          "Whether the running image matches the latest successful build.",
        ],
        nextSteps: [
          "Deploy by digest (image@sha256:...) instead of by tag.",
          "Add the commit SHA to the image as the org.opencontainers.image.revision label during the build.",
          "Record the pushed image digest as a workflow output so ReleaseLens can match it to the run.",
        ],
      }),
    ];
  },
};
