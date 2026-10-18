import type { Statement } from "@releaselens/contracts";
import { completedReleaseRuns, expectedRelease, isProviderFresh, shortSha } from "../evidence.js";
import { buildFinding } from "../finding-builder.js";
import type { DiagnosticRule } from "../rule.js";

const FAILED_CONCLUSIONS = new Set(["failure", "timed_out"]);

export const workflowFailed: DiagnosticRule = {
  id: "workflow.failed",
  version: 1,
  category: "workflow",
  description: "The most recent completed release run for this environment failed or timed out.",

  evaluate(snapshot) {
    if (!isProviderFresh(snapshot, "github")) return [];

    const latest = completedReleaseRuns(snapshot)[0];
    if (latest?.conclusion === undefined || !FAILED_CONCLUSIONS.has(latest.conclusion)) return [];

    const env = snapshot.environment.name;
    const facts: Statement[] = [
      {
        text: `Run ${latest.runId} of "${latest.workflowName}" on ${latest.branch} for commit ${shortSha(latest.commitSha)} finished with "${latest.conclusion}" at ${latest.completedAt}.`,
        evidenceIds: [latest.id],
      },
    ];
    const lastSuccess = expectedRelease(snapshot);
    if (lastSuccess !== undefined) {
      facts.push({
        text: `The most recent successful release run is ${lastSuccess.runId}, for commit ${shortSha(lastSuccess.commitSha)}.`,
        evidenceIds: [lastSuccess.id],
      });
    }

    return [
      buildFinding(this, snapshot, {
        severity: "warning",
        confidence: "high",
        title: `The latest release run for ${env} failed`,
        facts,
        inferences: [
          {
            text: `Commit ${shortSha(latest.commitSha)} has not been released to ${env} through this workflow.`,
            evidenceIds: [latest.id],
          },
        ],
        unknowns: ["Why the run failed: job logs are not part of the available evidence."],
        nextSteps: [
          `Open the run logs${latest.url ? ` (${latest.url})` : ""} to find the failing job.`,
          "Fix the failure and re-run the workflow, or confirm the failure is expected.",
        ],
      }),
    ];
  },
};
