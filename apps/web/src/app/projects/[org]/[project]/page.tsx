import type {
  DeploymentItem,
  FindingItem,
  ProjectDetail,
  WorkflowRunItem,
} from "@releaselens/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { FindingCard } from "@/components/finding-card";
import { Badge, Card, EmptyState, Mono, SectionTitle, SeverityBadge } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { PROVIDER_LABELS, formatUtc, shortDigest, shortSha } from "@/lib/format";

type Params = { params: Promise<{ org: string; project: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { project } = await params;
  return { title: project };
}

const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
const td = "px-3 py-2 align-top";

export default async function ProjectPage({ params }: Params) {
  const { org, project } = await params;
  const base = `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(project)}`;
  const [detail, findings, deployments, runs] = await Promise.all([
    apiGet<ProjectDetail>(base),
    apiGet<FindingItem[]>(`${base}/findings`),
    apiGet<DeploymentItem[]>(`${base}/deployments?limit=20`),
    apiGet<WorkflowRunItem[]>(`${base}/workflow-runs?limit=20`),
  ]);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <Link href="/projects" className="hover:underline">
          Projects
        </Link>{" "}
        / {detail.org.name}
      </nav>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{detail.name}</h1>
        <SeverityBadge severity={detail.worstSeverity} />
      </div>
      {detail.description !== null && (
        <p className="mt-2 max-w-3xl text-slate-600 dark:text-slate-300">{detail.description}</p>
      )}
      <p className="mt-2 text-sm text-slate-500">
        {detail.repository !== null && (
          <>
            Repository <Mono>{detail.repository}</Mono> ·{" "}
          </>
        )}
        Last evaluated {formatUtc(detail.lastEvaluatedAt)}
      </p>

      <SectionTitle id="freshness">Data freshness</SectionTitle>
      {detail.integrations.length === 0 ? (
        <EmptyState>No integrations connected. All data is unknown.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3">
          {detail.integrations.map((i) => (
            <li key={i.provider}>
              <Card className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{PROVIDER_LABELS[i.provider] ?? i.provider}</p>
                  {i.status !== "connected" && (
                    <Badge className="bg-red-100 text-red-900 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800">
                      {i.status}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Last successful sync: {formatUtc(i.lastSuccessfulSyncAt)}
                </p>
                {i.lastErrorKind !== null && (
                  <p className="mt-1 text-sm font-medium text-red-700 dark:text-red-400">
                    Last error: {i.lastErrorKind}
                  </p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle id="findings">Findings ({findings.length})</SectionTitle>
      {findings.length === 0 ? (
        <EmptyState>No open findings. Every rule ran and none matched the evidence.</EmptyState>
      ) : (
        <div className="space-y-4">
          {findings.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      )}

      <SectionTitle id="deployments">Deployment history</SectionTitle>
      {deployments.length === 0 ? (
        <EmptyState>No deployments recorded.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <caption className="sr-only">Deployment history, newest first</caption>
            <thead className="border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th scope="col" className={th}>
                  Revision
                </th>
                <th scope="col" className={th}>
                  Environment
                </th>
                <th scope="col" className={th}>
                  Image
                </th>
                <th scope="col" className={th}>
                  Commit
                </th>
                <th scope="col" className={th}>
                  Active since
                </th>
                <th scope="col" className={th}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {deployments.map((d) => (
                <tr key={d.id}>
                  <td className={td}>
                    <span className="font-medium">{d.revisionName}</span>
                    {d.isActive && (
                      <Badge className="ml-2 bg-emerald-100 text-emerald-900 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800">
                        active
                      </Badge>
                    )}
                  </td>
                  <td className={td}>{d.environment.name}</td>
                  <td className={td}>
                    {d.imageDigest === null ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        tag only, no digest
                      </span>
                    ) : (
                      <Mono>{shortDigest(d.imageDigest)}</Mono>
                    )}
                  </td>
                  <td className={td}>
                    {d.commitSha === null ? (
                      <span className="text-slate-500">unverified</span>
                    ) : (
                      <Mono>{shortSha(d.commitSha)}</Mono>
                    )}
                    {d.workflowRun !== null && (
                      <span className="ml-1 text-xs text-slate-500">
                        (run{" "}
                        {d.workflowRun.url === null ? (
                          d.workflowRun.runId
                        ) : (
                          <a
                            href={d.workflowRun.url}
                            className="underline"
                            rel="noreferrer"
                            target="_blank"
                          >
                            {d.workflowRun.runId}
                          </a>
                        )}
                        )
                      </span>
                    )}
                  </td>
                  <td className={td}>{formatUtc(d.activeSince)}</td>
                  <td className={td}>{d.providerStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionTitle id="runs">Workflow runs</SectionTitle>
      {runs.length === 0 ? (
        <EmptyState>No workflow runs recorded.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <caption className="sr-only">Workflow runs, newest first</caption>
            <thead className="border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th scope="col" className={th}>
                  Run
                </th>
                <th scope="col" className={th}>
                  Workflow
                </th>
                <th scope="col" className={th}>
                  Branch
                </th>
                <th scope="col" className={th}>
                  Commit
                </th>
                <th scope="col" className={th}>
                  Result
                </th>
                <th scope="col" className={th}>
                  Completed
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className={td}>
                    {r.url === null ? (
                      r.runId
                    ) : (
                      <a
                        href={r.url}
                        className="font-medium underline"
                        rel="noreferrer"
                        target="_blank"
                      >
                        {r.runId}
                      </a>
                    )}
                  </td>
                  <td className={td}>{r.workflowName}</td>
                  <td className={td}>
                    <Mono>{r.branch}</Mono>
                  </td>
                  <td className={td}>
                    <Mono>{shortSha(r.commitSha)}</Mono>
                  </td>
                  <td className={td}>
                    <span
                      className={
                        r.conclusion === "success"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : r.conclusion === "failure" || r.conclusion === "timed_out"
                            ? "font-medium text-red-700 dark:text-red-400"
                            : ""
                      }
                    >
                      {r.conclusion ?? r.status}
                    </span>
                  </td>
                  <td className={td}>{formatUtc(r.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
