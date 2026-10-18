import type { GithubSetupResponse } from "@releaselens/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { ConnectRepository } from "@/components/connect-repository";
import { Badge, Card, EmptyState } from "@/components/ui";
import { apiGet } from "@/lib/api";

export const metadata: Metadata = { title: "Connect a repository" };

export default async function ConnectPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const setup = await apiGet<GithubSetupResponse>(`/orgs/${encodeURIComponent(org)}/github`);

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <Link href="/projects" className="hover:underline">
          Projects
        </Link>{" "}
        / Connect a repository
      </nav>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Connect a GitHub repository</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-400">
        ReleaseLens reads workflow runs through its GitHub App with read-only permissions. It never
        writes to your repositories.
      </p>

      {!setup.appConfigured && (
        <div className="mt-6">
          <EmptyState>
            The GitHub App is not configured on this server. See docs/github-app.md to set it up.
          </EmptyState>
        </div>
      )}

      {setup.appConfigured && setup.installUrl !== null && (
        <p className="mt-4 text-sm">
          Repository missing?{" "}
          <a
            href={setup.installUrl}
            className="font-medium text-sky-700 underline dark:text-sky-400"
          >
            Install the GitHub App or change its repository access
          </a>
          .
        </p>
      )}

      {setup.appConfigured && setup.installations.length === 0 && (
        <div className="mt-6">
          <EmptyState>The GitHub App is not installed on any account yet.</EmptyState>
        </div>
      )}

      <div className="mt-6 space-y-6">
        {setup.installations.map((installation) => (
          <Card key={installation.installationId}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{installation.account}</h2>
              <span className="text-xs text-slate-500">{installation.accountType}</span>
              {installation.suspended && (
                <Badge className="bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800">
                  suspended
                </Badge>
              )}
            </div>
            {installation.error !== null ? (
              <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
                Could not list repositories ({installation.error}).
              </p>
            ) : installation.repositories.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                This installation has no repository access.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {installation.repositories.map((repo) => (
                  <li key={repo.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-sm">
                        {repo.fullName}
                        {repo.private && (
                          <span className="ml-2 text-xs text-slate-500">private</span>
                        )}
                      </span>
                    </div>
                    <div className="mt-2">
                      <ConnectRepository
                        org={org}
                        installationId={installation.installationId}
                        repository={repo}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
