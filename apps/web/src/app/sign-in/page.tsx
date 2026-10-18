import type { AuthConfigResponse, MeResponse } from "@releaselens/contracts";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DemoLoginButton } from "@/components/auth-buttons";
import { Card } from "@/components/ui";
import { apiGetOptional } from "@/lib/api";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  "not-allowed": "This GitHub account is not allowed to sign in to this ReleaseLens installation.",
  "invalid-request": "The sign-in request expired or was tampered with. Please try again.",
  github: "GitHub sign-in failed. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if ((await apiGetOptional<MeResponse>("/me")) !== null) redirect("/projects");
  const [{ error }, config] = await Promise.all([
    searchParams,
    apiGetOptional<AuthConfigResponse>("/auth/config"),
  ]);
  const message = error === undefined ? undefined : (ERRORS[error] ?? ERRORS.github);

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-3xl font-bold tracking-tight">Sign in to ReleaseLens</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        Read-only deployment diagnostics. ReleaseLens never changes your infrastructure.
      </p>

      {message !== undefined && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {message}
        </p>
      )}

      <Card className="mt-6 space-y-4">
        {config?.githubEnabled === true && (
          <a
            href="/api/auth/github"
            className="block w-full rounded-lg bg-slate-900 px-4 py-2.5 text-center font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            Sign in with GitHub
          </a>
        )}
        {config?.demoLoginEnabled === true && (
          <>
            <DemoLoginButton />
            <p className="text-xs text-slate-500">
              The demo uses synthetic data only: six services, each showing one kind of deployment
              problem.
            </p>
          </>
        )}
        {config === null && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            The ReleaseLens API is not reachable.
          </p>
        )}
        {config !== null && !config.githubEnabled && !config.demoLoginEnabled && (
          <p className="text-sm text-slate-600">
            No sign-in method is configured. Set up GitHub sign-in in the server configuration.
          </p>
        )}
      </Card>
    </div>
  );
}
