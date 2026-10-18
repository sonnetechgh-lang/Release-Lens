import type { Finding } from "@releaselens/contracts";
import { diagnose } from "@releaselens/diagnostics";
import type { Db } from "./client.js";
import { CONFIDENCE_TO_DB, SEVERITY_TO_DB } from "./mapping.js";
import { loadSnapshot, type SnapshotScope } from "./snapshot.js";

export interface SaveResult {
  opened: number;
  updated: number;
  resolved: number;
}

/**
 * Stores the current findings for one service/environment.
 * - New fingerprints are created as open.
 * - Existing ones are refreshed; resolved ones reopen; acknowledged ones stay acknowledged.
 * - Open findings that no longer fire are marked resolved.
 */
export async function saveFindings(
  db: Db,
  scope: { projectId: string; serviceId: string; environmentId: string; detectedAt: Date },
  findings: readonly Finding[],
): Promise<SaveResult> {
  const { projectId, serviceId, environmentId, detectedAt } = scope;
  const result: SaveResult = { opened: 0, updated: 0, resolved: 0 };

  await db.$transaction(async (tx) => {
    for (const finding of findings) {
      const content = {
        ruleId: finding.ruleId,
        ruleVersion: finding.ruleVersion,
        category: finding.category,
        severity: SEVERITY_TO_DB[finding.severity],
        confidence: CONFIDENCE_TO_DB[finding.confidence],
        title: finding.title,
        facts: finding.facts,
        inferences: finding.inferences,
        unknowns: finding.unknowns,
        nextSteps: finding.nextSteps,
        evidenceIds: finding.evidenceIds,
        lastDetectedAt: detectedAt,
      };
      const existing = await tx.diagnosticFinding.findUnique({
        where: { projectId_fingerprint: { projectId, fingerprint: finding.id } },
        select: { id: true, state: true },
      });
      if (existing === null) {
        await tx.diagnosticFinding.create({
          data: {
            ...content,
            fingerprint: finding.id,
            projectId,
            serviceId,
            environmentId,
            firstDetectedAt: detectedAt,
          },
        });
        result.opened++;
      } else {
        await tx.diagnosticFinding.update({
          where: { id: existing.id },
          data: {
            ...content,
            ...(existing.state === "RESOLVED" ? { state: "OPEN" as const, resolvedAt: null } : {}),
          },
        });
        result.updated++;
      }
    }

    const { count } = await tx.diagnosticFinding.updateMany({
      where: {
        projectId,
        serviceId,
        environmentId,
        state: { not: "RESOLVED" },
        fingerprint: { notIn: findings.map((f) => f.id) },
      },
      data: { state: "RESOLVED", resolvedAt: detectedAt },
    });
    result.resolved = count;
  });

  return result;
}

/** Loads evidence, runs every rule, and stores the findings. */
export async function evaluateService(
  db: Db,
  scope: SnapshotScope,
): Promise<{ findings: Finding[]; saved: SaveResult }> {
  const snapshot = await loadSnapshot(db, scope);
  const findings = diagnose(snapshot);
  const service = await db.service.findUniqueOrThrow({
    where: { id: scope.serviceId },
    select: { projectId: true },
  });
  const saved = await saveFindings(
    db,
    {
      projectId: service.projectId,
      serviceId: scope.serviceId,
      environmentId: scope.environmentId,
      detectedAt: scope.evaluatedAt,
    },
    findings,
  );
  await db.project.updateMany({
    where: {
      id: service.projectId,
      OR: [{ lastEvaluatedAt: null }, { lastEvaluatedAt: { lt: scope.evaluatedAt } }],
    },
    data: { lastEvaluatedAt: scope.evaluatedAt },
  });
  return { findings, saved };
}
