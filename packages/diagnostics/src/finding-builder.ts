import type { DiagnosticSnapshot, Finding, Statement } from "@releaselens/contracts";
import type { DiagnosticRule } from "./rule.js";

type FindingContent = Pick<
  Finding,
  "severity" | "confidence" | "title" | "facts" | "inferences" | "unknowns" | "nextSteps"
> & {
  /** Extra part of the fingerprint when a rule can fire more than once per snapshot. */
  subjectKey?: string;
};

/** Fills in the fields every finding shares: ID, subject, timestamps, and cited evidence. */
export function buildFinding(
  rule: Pick<DiagnosticRule, "id" | "version" | "category">,
  snapshot: DiagnosticSnapshot,
  content: FindingContent,
): Finding {
  const { subjectKey, ...rest } = content;
  const subject = {
    projectId: snapshot.project.id,
    serviceId: snapshot.service.id,
    environmentId: snapshot.environment.id,
  };
  const idParts = [rule.id, subject.projectId, subject.serviceId, subject.environmentId];
  if (subjectKey !== undefined) idParts.push(subjectKey);

  return {
    id: idParts.join("/"),
    ruleId: rule.id,
    ruleVersion: rule.version,
    category: rule.category,
    subject,
    detectedAt: snapshot.evaluatedAt,
    ...rest,
    evidenceIds: citedEvidence([...rest.facts, ...rest.inferences]),
  };
}

function citedEvidence(statements: readonly Statement[]): string[] {
  return [...new Set(statements.flatMap((s) => s.evidenceIds))].sort();
}
