import { SEVERITIES, type ProjectSummary } from "@releaselens/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, SeverityBadge } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { formatUtc } from "@/lib/format";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const projects = await apiGet<ProjectSummary[]>("/projects");

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Most urgent first. Findings are open problems backed by evidence.
      </p>

      {projects.length === 0 ? (
        <div className="mt-6">
          <EmptyState>No projects yet.</EmptyState>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const counts = [...SEVERITIES]
              .reverse()
              .filter((s) => p.openFindings[s] > 0)
              .map((s) => `${String(p.openFindings[s])} ${s}`);
            return (
              <li key={`${p.org.slug}/${p.slug}`}>
                <Link
                  href={`/projects/${p.org.slug}/${p.slug}`}
                  className="block h-full rounded-xl focus-visible:outline-2"
                >
                  <Card className="h-full transition hover:border-sky-400 dark:hover:border-sky-600">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-semibold">{p.name}</h2>
                      <SeverityBadge severity={p.worstSeverity} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{p.org.name}</p>
                    {p.description !== null && (
                      <p className="mt-3 line-clamp-3 text-sm text-slate-600 dark:text-slate-300">
                        {p.description}
                      </p>
                    )}
                    <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-slate-500">Open findings</dt>
                        <dd className="font-medium">
                          {counts.length === 0 ? "none" : counts.join(", ")}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Last evaluated</dt>
                        <dd className="font-medium">{formatUtc(p.lastEvaluatedAt)}</dd>
                      </div>
                    </dl>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
