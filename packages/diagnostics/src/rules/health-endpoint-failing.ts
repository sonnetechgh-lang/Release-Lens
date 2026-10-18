import type { Finding, HealthCheckEvidence, Statement } from "@releaselens/contracts";
import { formatDuration, secondsBetween } from "../evidence.js";
import { buildFinding } from "../finding-builder.js";
import type { DiagnosticRule } from "../rule.js";

/** Deployments that became active this long before the first failure are mentioned as a correlation. */
const CORRELATION_WINDOW_SECONDS = 3600;

function describeFailure(check: HealthCheckEvidence): string {
  if (check.failureKind === "unexpected-status" && check.httpStatus !== undefined) {
    return `HTTP ${String(check.httpStatus)}`;
  }
  return check.failureKind ?? "failure";
}

function summarize(checks: readonly HealthCheckEvidence[]): string {
  const counts = new Map<string, number>();
  for (const check of checks) {
    const key = describeFailure(check);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([kind, n]) => `${String(n)}× ${kind}`).join(", ");
}

export const healthEndpointFailing: DiagnosticRule = {
  id: "health.endpoint-failing",
  version: 1,
  category: "health",
  description:
    "A configured health endpoint failed at least the threshold number of consecutive, recent checks.",

  evaluate(snapshot) {
    const { policy, deployment, environment, service } = snapshot;
    const endpoints = [...new Set(snapshot.healthChecks.map((c) => c.endpoint))].sort();
    const findings: Finding[] = [];

    for (const endpoint of endpoints) {
      const checks = snapshot.healthChecks
        .filter((c) => c.endpoint === endpoint)
        .filter((c) => secondsBetween(c.observedAt, snapshot.evaluatedAt) >= 0)
        .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));

      const latest = checks[0];
      if (latest === undefined) continue;
      // Old results say nothing about now: health is unknown, not failing.
      if (secondsBetween(latest.observedAt, snapshot.evaluatedAt) > policy.healthFreshnessSeconds) {
        continue;
      }

      const firstPassIndex = checks.findIndex((c) => c.outcome === "pass");
      const failing = firstPassIndex === -1 ? checks : checks.slice(0, firstPassIndex);
      if (failing.length < policy.healthFailureThreshold) continue;

      const firstFailure = failing[failing.length - 1] ?? latest;
      const failingIds = failing.map((c) => c.id).reverse(); // oldest first
      const lastPass = firstPassIndex === -1 ? undefined : checks[firstPassIndex];

      const facts: Statement[] = [
        {
          text: `The last ${String(failing.length)} checks of ${endpoint} failed, from ${firstFailure.observedAt} to ${latest.observedAt} (${summarize(failing)}).`,
          evidenceIds: failingIds,
        },
      ];
      if (lastPass !== undefined) {
        facts.push({
          text: `The check before that, at ${lastPass.observedAt}, passed.`,
          evidenceIds: [lastPass.id],
        });
      }

      const inferences: Statement[] = [
        {
          text: `${service.name} may be degraded in ${environment.name}. A failing health endpoint alone does not prove the whole service is down.`,
          evidenceIds: failingIds,
        },
      ];

      const nextSteps = [
        `Request ${endpoint} manually to confirm the failure.`,
        deployment === undefined
          ? "Check the service's logs and replica status."
          : `Check the logs and replica status of revision ${deployment.revisionName}.`,
      ];

      if (deployment !== undefined) {
        const gap = secondsBetween(deployment.activeSince, firstFailure.observedAt);
        if (gap >= 0 && gap <= CORRELATION_WINDOW_SECONDS) {
          inferences.push({
            text: `Failures began ${formatDuration(gap)} after revision ${deployment.revisionName} became active. This is a timing correlation, not proof that the revision caused them.`,
            evidenceIds: [deployment.id, firstFailure.id],
          });
          nextSteps.push(
            `Review what changed in revision ${deployment.revisionName}. If it is the cause, follow your rollback procedure (ReleaseLens never rolls back automatically).`,
          );
        }
      }

      const unknowns = ["Whether other endpoints or user traffic are affected."];
      if (lastPass === undefined) {
        unknowns.push("When the failures started: no passing check is in the available history.");
      }

      findings.push(
        buildFinding(this, snapshot, {
          subjectKey: encodeURIComponent(endpoint),
          severity: "high",
          confidence: "medium",
          title: `Health endpoint ${endpoint} is failing in ${environment.name}`,
          facts,
          inferences,
          unknowns,
          nextSteps,
        }),
      );
    }

    return findings;
  },
};
