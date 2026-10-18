import type { DiagnosticSnapshot, Finding, Statement } from "@releaselens/contracts";
import { PROVIDER_LABELS } from "./rules/evidence-stale.js";

interface EvidenceRow {
  id: string;
  kind: string;
  observedAt: string;
  summary: string;
  url?: string | undefined;
}

/** Escapes characters that would break Markdown table cells or inline formatting. */
function md(text: string): string {
  return text.replace(/[\\|*_`[\]<>]/g, (c) => `\\${c}`).replace(/\r?\n/g, " ");
}

function evidenceRows(snapshot: DiagnosticSnapshot): Map<string, EvidenceRow> {
  const rows = new Map<string, EvidenceRow>();
  for (const run of snapshot.workflowRuns) {
    rows.set(run.id, {
      id: run.id,
      kind: "Workflow run",
      observedAt: run.observedAt,
      summary: `${run.workflowName} #${run.runId} on ${run.branch} @ ${run.commitSha.slice(0, 7)}: ${run.conclusion ?? run.status}`,
      url: run.url,
    });
  }
  const d = snapshot.deployment;
  if (d !== undefined) {
    rows.set(d.id, {
      id: d.id,
      kind: "Deployment",
      observedAt: d.observedAt,
      summary: `${d.revisionName}: ${d.imageReference} (${d.providerStatus})`,
      url: d.url,
    });
  }
  for (const c of snapshot.healthChecks) {
    rows.set(c.id, {
      id: c.id,
      kind: "Health check",
      observedAt: c.observedAt,
      summary: `${c.endpoint}: ${c.outcome}${c.httpStatus === undefined ? "" : ` (HTTP ${String(c.httpStatus)})`}${c.failureKind === undefined ? "" : `, ${c.failureKind}`}, ${String(c.durationMs)} ms`,
    });
  }
  for (const s of snapshot.syncStatus) {
    rows.set(s.id, {
      id: s.id,
      kind: "Sync status",
      observedAt: s.lastAttemptAt ?? s.lastSuccessfulSyncAt ?? "never",
      summary: `${PROVIDER_LABELS[s.provider]}: last success ${s.lastSuccessfulSyncAt ?? "never"}${s.lastErrorKind === undefined ? "" : `, last error ${s.lastErrorKind}`}`,
    });
  }
  return rows;
}

function statementLine(s: Statement): string {
  const refs =
    s.evidenceIds.length === 0
      ? ""
      : ` _(evidence: ${s.evidenceIds.map((id) => `\`${id}\``).join(", ")})_`;
  return `- ${md(s.text)}${refs}`;
}

function section(title: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : [`**${title}**`, "", ...lines, ""];
}

function renderFinding(f: Finding, index: number): string[] {
  return [
    `### ${String(index + 1)}. [${f.severity.toUpperCase()}] ${md(f.title)}`,
    "",
    `Rule \`${f.ruleId}\` v${String(f.ruleVersion)} · Confidence: ${f.confidence} · Finding ID: \`${f.id}\``,
    "",
    ...section("Facts (observed)", f.facts.map(statementLine)),
    ...section("Inferences (not proven)", f.inferences.map(statementLine)),
    ...section(
      "Unknowns",
      f.unknowns.map((u) => `- ${md(u)}`),
    ),
    ...section(
      "Next steps",
      f.nextSteps.map((s, i) => `${String(i + 1)}. ${md(s)}`),
    ),
  ];
}

/**
 * Renders findings as a Markdown incident report. Only evidence that a finding
 * cites is listed, plus the sync status of every integration so readers can see
 * how fresh the data is.
 */
export function renderMarkdownReport(
  snapshot: DiagnosticSnapshot,
  findings: readonly Finding[],
): string {
  const rows = evidenceRows(snapshot);
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  const countText = [...counts].map(([sev, n]) => `${String(n)} ${sev}`).join(", ");

  const lines: string[] = [
    "# ReleaseLens diagnostic report",
    "",
    `- **Project:** ${md(snapshot.project.name)}`,
    `- **Service:** ${md(snapshot.service.name)}`,
    `- **Environment:** ${md(snapshot.environment.name)} (release branch \`${snapshot.environment.releaseBranch}\`)`,
    `- **Evaluated at:** ${snapshot.evaluatedAt} (UTC)`,
    `- **Findings:** ${String(findings.length)}${findings.length > 0 ? ` (${countText})` : ""}`,
    "",
    "## Findings",
    "",
  ];

  if (findings.length === 0) {
    lines.push("No findings. Every rule ran and none of them matched the available evidence.", "");
  } else {
    findings.forEach((f, i) => lines.push(...renderFinding(f, i)));
  }

  lines.push("## Data freshness", "");
  if (snapshot.syncStatus.length === 0) {
    lines.push(
      "No integration sync status was provided, so all integration data is treated as unknown.",
      "",
    );
  } else {
    lines.push("| Integration | Last successful sync | Last error |", "|---|---|---|");
    for (const s of snapshot.syncStatus) {
      lines.push(
        `| ${PROVIDER_LABELS[s.provider]} | ${s.lastSuccessfulSyncAt ?? "never"} | ${s.lastErrorKind ?? "none"} |`,
      );
    }
    lines.push("");
  }

  const cited = [...new Set(findings.flatMap((f) => f.evidenceIds))].sort();
  if (cited.length > 0) {
    lines.push("## Evidence", "", "| ID | Type | Observed at | Summary |", "|---|---|---|---|");
    for (const id of cited) {
      const row = rows.get(id);
      if (row === undefined) {
        lines.push(`| \`${id}\` | unknown | | Not found in snapshot |`);
        continue;
      }
      const summary = row.url === undefined ? md(row.summary) : `[${md(row.summary)}](${row.url})`;
      lines.push(`| \`${row.id}\` | ${row.kind} | ${row.observedAt} | ${summary} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
