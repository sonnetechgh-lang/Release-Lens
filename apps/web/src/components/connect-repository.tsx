"use client";

import type {
  ApiError,
  CreateProjectResponse,
  GithubRepositoryOption,
} from "@releaselens/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

interface Props {
  org: string;
  installationId: number;
  repository: GithubRepositoryOption;
}

const input =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950";

/** One repository row: shows its project if connected, otherwise a small connect form. */
export function ConnectRepository({ org, installationId, repository }: Props) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (repository.connectedProject !== null) {
    return (
      <Link
        href={`/projects/${org}/${repository.connectedProject}`}
        className="text-sm font-medium text-sky-700 underline dark:text-sky-400"
      >
        View project
      </Link>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700"
      >
        Connect
      </button>
    );
  }

  return (
    <form
      className="mt-3 grid gap-3 sm:grid-cols-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const text = (name: string) => {
          const raw = data.get(name);
          const value = typeof raw === "string" ? raw.trim() : "";
          return value === "" ? undefined : value;
        };
        setBusy(true);
        setError(null);
        fetch(`/api/orgs/${encodeURIComponent(org)}/projects`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            installationId,
            repositoryId: repository.id,
            releaseBranch: text("releaseBranch"),
            deployWorkflowName: text("deployWorkflowName"),
          }),
        })
          .then(async (res) => {
            if (!res.ok) throw new Error(((await res.json()) as ApiError).message);
            const created = (await res.json()) as CreateProjectResponse;
            router.push(`/projects/${created.org.slug}/${created.slug}`);
            router.refresh();
          })
          .catch((e: unknown) => {
            setError(e instanceof Error ? e.message : "Could not connect the repository");
            setBusy(false);
          });
      }}
    >
      <label className="text-sm" htmlFor={`${id}-branch`}>
        Release branch
        <input
          id={`${id}-branch`}
          name="releaseBranch"
          placeholder={repository.defaultBranch ?? "main"}
          className={input}
        />
      </label>
      <label className="text-sm" htmlFor={`${id}-workflow`}>
        Deploy workflow name <span className="text-slate-500">(optional)</span>
        <input
          id={`${id}-workflow`}
          name="deployWorkflowName"
          placeholder="All workflows"
          className={input}
        />
      </label>
      <div className="flex items-end gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
        >
          {busy ? "Connecting…" : "Create project"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className="rounded-md px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-3 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
