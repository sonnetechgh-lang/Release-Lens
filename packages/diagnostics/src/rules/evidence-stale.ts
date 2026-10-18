import type { Finding, Provider, Statement, SyncStatusEvidence } from "@releaselens/contracts";
import { formatDuration, secondsBetween } from "../evidence.js";
import { buildFinding } from "../finding-builder.js";
import type { DiagnosticRule } from "../rule.js";

export const PROVIDER_LABELS: Readonly<Record<Provider, string>> = {
  github: "GitHub",
  "azure-container-apps": "Azure Container Apps",
  "health-probe": "Health probe",
  prisma: "Prisma migration check",
};

function nextStepFor(kind: SyncStatusEvidence["lastErrorKind"]): string {
  switch (kind) {
    case "unauthorized":
    case "forbidden":
      return "Check that the integration's credentials are valid and still have the required read permissions.";
    case "rate-limited":
      return "Wait for the rate limit to reset, and reduce the sync frequency if it keeps happening.";
    case "not-found":
      return "Check that the configured resource still exists and its name is correct.";
    case "timeout":
    case "network":
    case "server-error":
      return "Check the provider's status page and network connectivity from the ReleaseLens worker.";
    case undefined:
      return "Trigger a manual sync and check the worker logs.";
  }
}

export const evidenceStale: DiagnosticRule = {
  id: "evidence.stale",
  version: 1,
  category: "evidence",
  description: "An integration has not synced successfully within the freshness limit.",

  evaluate(snapshot) {
    const limit = snapshot.policy.evidenceFreshnessSeconds;
    const findings: Finding[] = [];
    const statuses = [...snapshot.syncStatus].sort((a, b) => a.provider.localeCompare(b.provider));

    for (const status of statuses) {
      const age =
        status.lastSuccessfulSyncAt === undefined
          ? undefined
          : secondsBetween(status.lastSuccessfulSyncAt, snapshot.evaluatedAt);
      if (age !== undefined && age <= limit) continue;

      const label = PROVIDER_LABELS[status.provider];
      const ev = [status.id];
      const facts: Statement[] = [
        age === undefined
          ? { text: `${label} has never synced successfully.`, evidenceIds: ev }
          : {
              text: `${label} last synced successfully at ${status.lastSuccessfulSyncAt ?? ""}, ${formatDuration(age)} ago, beyond the ${formatDuration(limit)} freshness limit.`,
              evidenceIds: ev,
            },
      ];
      if (status.lastErrorKind !== undefined) {
        const when = status.lastAttemptAt === undefined ? "" : ` at ${status.lastAttemptAt}`;
        facts.push({
          text: `The most recent sync attempt${when} failed with: ${status.lastErrorKind}.`,
          evidenceIds: ev,
        });
      }

      findings.push(
        buildFinding(this, snapshot, {
          subjectKey: status.provider,
          severity: "warning",
          confidence: "high",
          title: `${label} data is out of date`,
          facts,
          inferences: [
            {
              text: `Data from ${label} may no longer reflect reality. Checks that depend on it are skipped and should be shown as unknown, not healthy.`,
              evidenceIds: ev,
            },
          ],
          unknowns: [`The current state reported by ${label}.`],
          nextSteps: [nextStepFor(status.lastErrorKind)],
        }),
      );
    }

    return findings;
  },
};
