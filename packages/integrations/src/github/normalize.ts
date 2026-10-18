import type { GithubWorkflowRun } from "./schemas.js";

/** Workflow run conclusions understood by the diagnostics contracts. */
const KNOWN_CONCLUSIONS = new Set([
  "success",
  "failure",
  "cancelled",
  "timed_out",
  "skipped",
  "neutral",
  "action_required",
  "stale",
]);

export interface WorkflowRunRecord {
  externalId: string;
  workflowName: string;
  branch: string;
  commitSha: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  startedAt: Date;
  completedAt: Date | null;
  url: string | null;
  /** GitHub's `updated_at`; used to ignore events that arrive out of order. */
  providerUpdatedAt: Date;
}

function mapStatus(status: string | null | undefined): WorkflowRunRecord["status"] {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in_progress";
  // queued, requested, waiting, pending (and anything new) are all "not started yet".
  return "queued";
}

function mapConclusion(conclusion: string | null | undefined): string {
  if (conclusion === "startup_failure") return "failure";
  if (conclusion !== null && conclusion !== undefined && KNOWN_CONCLUSIONS.has(conclusion)) {
    return conclusion;
  }
  return "neutral";
}

/** Converts a GitHub workflow run (from a webhook or the REST API) into a stored record. */
export function toWorkflowRunRecord(run: GithubWorkflowRun): WorkflowRunRecord {
  const status = mapStatus(run.status);
  return {
    externalId: String(run.id),
    workflowName: run.name ?? run.path ?? "unnamed workflow",
    branch: run.head_branch ?? "(detached)",
    commitSha: run.head_sha,
    status,
    conclusion: status === "completed" ? mapConclusion(run.conclusion) : null,
    startedAt: new Date(run.run_started_at ?? run.created_at),
    completedAt: status === "completed" ? new Date(run.updated_at) : null,
    url: run.html_url ?? null,
    providerUpdatedAt: new Date(run.updated_at),
  };
}
