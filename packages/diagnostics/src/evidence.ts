import type { DiagnosticSnapshot, Provider, WorkflowRunEvidence } from "@releaselens/contracts";

/** Seconds from `from` to `to` (both ISO timestamps). Negative if `from` is later. */
export function secondsBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 1000;
}

/** Human-friendly duration, e.g. "3h 51m" or "45s". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return hours > 0 ? `${String(days)}d ${String(hours)}h` : `${String(days)}d`;
  if (hours > 0) return minutes > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(hours)}h`;
  if (minutes > 0) return `${String(minutes)}m`;
  return `${String(s)}s`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * True when the provider's last successful sync is recent enough to trust.
 * A provider with no sync record, or one that never synced, is not fresh:
 * unknown data must never be treated as good data.
 */
export function isProviderFresh(snapshot: DiagnosticSnapshot, provider: Provider): boolean {
  const status = snapshot.syncStatus.find((s) => s.provider === provider);
  if (status?.lastSuccessfulSyncAt === undefined) return false;
  const age = secondsBetween(status.lastSuccessfulSyncAt, snapshot.evaluatedAt);
  return age <= snapshot.policy.evidenceFreshnessSeconds;
}

/** Workflow runs that count as releases for this environment. */
export function releaseRuns(snapshot: DiagnosticSnapshot): WorkflowRunEvidence[] {
  const { releaseBranch, deployWorkflowName } = snapshot.environment;
  return snapshot.workflowRuns.filter(
    (run) =>
      run.branch === releaseBranch &&
      (deployWorkflowName === undefined || run.workflowName === deployWorkflowName),
  );
}

type CompletedRun = WorkflowRunEvidence & { completedAt: string };

function isCompleted(run: WorkflowRunEvidence): run is CompletedRun {
  return run.status === "completed" && run.completedAt !== undefined;
}

/** Completed release runs, newest first. Runs that finished after `evaluatedAt` are ignored. */
export function completedReleaseRuns(snapshot: DiagnosticSnapshot): CompletedRun[] {
  return releaseRuns(snapshot)
    .filter(isCompleted)
    .filter((run) => secondsBetween(run.completedAt, snapshot.evaluatedAt) >= 0)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}

/** The most recent successful release run: the build we expect to be deployed. */
export function expectedRelease(snapshot: DiagnosticSnapshot): CompletedRun | undefined {
  return completedReleaseRuns(snapshot).find((run) => run.conclusion === "success");
}

export type DeployedIdentity =
  | {
      verified: true;
      commitSha: string;
      via: "digest-match" | "oci-label" | "build-metadata";
      /** Evidence that proves the identity. */
      evidenceIds: string[];
      /** The workflow run that built the deployed image, when known. */
      buildRun?: WorkflowRunEvidence;
    }
  | {
      verified: false;
      reason: "no-deployment" | "tag-only" | "digest-without-commit";
    };

/**
 * Works out which commit is deployed, using only immutable evidence.
 * A mutable tag (like `:main` or `:latest`) is never enough.
 */
export function resolveDeployedIdentity(snapshot: DiagnosticSnapshot): DeployedIdentity {
  const deployment = snapshot.deployment;
  if (deployment === undefined) return { verified: false, reason: "no-deployment" };

  if (deployment.imageDigest !== undefined) {
    const buildRun = snapshot.workflowRuns.find(
      (run) => run.producedImageDigest === deployment.imageDigest,
    );
    if (buildRun !== undefined) {
      return {
        verified: true,
        commitSha: buildRun.commitSha,
        via: "digest-match",
        evidenceIds: [deployment.id, buildRun.id],
        buildRun,
      };
    }
  }

  if (deployment.commitSha !== undefined && deployment.commitShaSource !== undefined) {
    const commitSha = deployment.commitSha;
    const buildRun = snapshot.workflowRuns.find((run) => run.commitSha === commitSha);
    return {
      verified: true,
      commitSha,
      via: deployment.commitShaSource,
      evidenceIds: [deployment.id],
      ...(buildRun ? { buildRun } : {}),
    };
  }

  return {
    verified: false,
    reason: deployment.imageDigest === undefined ? "tag-only" : "digest-without-commit",
  };
}
