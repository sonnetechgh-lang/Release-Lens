import { SEVERITY_RANK, type DiagnosticSnapshot, type Finding } from "@releaselens/contracts";
import { RuleRegistry, type DiagnosticRule } from "./rule.js";
import { deploymentIdentityUnverified } from "./rules/deployment-identity-unverified.js";
import { deploymentStale } from "./rules/deployment-stale.js";
import { evidenceStale } from "./rules/evidence-stale.js";
import { healthEndpointFailing } from "./rules/health-endpoint-failing.js";
import { workflowFailed } from "./rules/workflow-failed.js";

export const DEFAULT_RULES: readonly DiagnosticRule[] = [
  deploymentStale,
  deploymentIdentityUnverified,
  healthEndpointFailing,
  workflowFailed,
  evidenceStale,
];

export function createDefaultRegistry(): RuleRegistry<DiagnosticSnapshot, Finding> {
  const registry = new RuleRegistry<DiagnosticSnapshot, Finding>();
  for (const rule of DEFAULT_RULES) registry.register(rule);
  return registry;
}

/** Most severe first, then by rule and ID so output is stable. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    a.ruleId.localeCompare(b.ruleId) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Runs all rules against a validated snapshot. Deterministic: the same
 * snapshot always produces the same findings in the same order.
 */
export function diagnose(
  snapshot: DiagnosticSnapshot,
  registry: RuleRegistry<DiagnosticSnapshot, Finding> = createDefaultRegistry(),
): Finding[] {
  return registry.evaluate(snapshot).sort(compareFindings);
}
