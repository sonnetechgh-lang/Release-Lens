"use client";

import type {
  ApiError,
  AzureMode,
  DeploymentTargetItem,
  ProjectDetail,
} from "@releaselens/contracts";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { formatUtc } from "@/lib/format";

interface Props {
  org: string;
  project: string;
  canManage: boolean;
  azureMode: AzureMode;
  targets: DeploymentTargetItem[];
  services: ProjectDetail["services"];
  environments: ProjectDetail["environments"];
}

const input =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950";
const primary =
  "rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60";
const secondary =
  "rounded-md px-3 py-1.5 text-sm ring-1 ring-inset ring-slate-300 hover:bg-slate-100 disabled:opacity-60 dark:ring-slate-700 dark:hover:bg-slate-800";

const SIMULATED_SUBSCRIPTION = "00000000-0000-0000-0000-000000000000";
const SIMULATED_APPS = [
  "storefront-api",
  "tag-only-api",
  "failed-rollout-api",
  "canary-api",
  "sidecar-api",
  "slow-api",
  "throttled-api",
  "forbidden-api",
  "expired-token-api",
];

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Request failed (${String(res.status)})`;
    try {
      message = ((await res.json()) as ApiError).message;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
}

function ModeNote({ mode }: { mode: AzureMode }) {
  if (mode === "azure") return null;
  const text =
    mode === "off"
      ? "Azure reading is turned off on this server (AZURE_PROVIDER_MODE=off). Targets are saved but not read, so their data stays unknown."
      : `Simulated mode: responses come from recorded fixtures, not Azure. Use subscription ${SIMULATED_SUBSCRIPTION}, resource group releaselens-demo, and one of: ${SIMULATED_APPS.join(", ")}.`;
  return (
    <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800">
      {text}
    </p>
  );
}

/** Lists the project's deployment targets; owners can connect, remove, and sync them. */
export function DeploymentTargets(props: Props) {
  const { org, project, canManage, azureMode, targets } = props;
  const router = useRouter();
  const base = `/api/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(project)}/deployment-targets`;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = (key: string, action: () => Promise<void>, done?: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    action()
      .then(() => {
        if (done !== undefined) setNotice(done);
        router.refresh();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Something went wrong");
      })
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <div>
      <ModeNote mode={azureMode} />
      {targets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
          No deployment targets. Without one, what is running in each environment is unknown.
        </p>
      ) : (
        <ul className="space-y-3">
          {targets.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {t.service.name} · {t.environment.name}
                </p>
                <p className="mt-1 break-all text-sm text-slate-600 dark:text-slate-300">
                  Azure Container App{" "}
                  <a href={t.portalUrl} className="underline" rel="noreferrer" target="_blank">
                    {t.containerApp}
                  </a>{" "}
                  in resource group {t.resourceGroup}
                  {t.containerName !== null && <> (container {t.containerName})</>}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Last read: {formatUtc(t.lastObservedAt)}
                </p>
              </div>
              {canManage && (
                <button
                  type="button"
                  className={secondary}
                  disabled={busy !== null}
                  onClick={() => {
                    if (!window.confirm(`Disconnect ${t.containerApp}? Its history is kept.`)) {
                      return;
                    }
                    run(`remove-${t.id}`, () =>
                      send(`${base}/${encodeURIComponent(t.id)}`, "DELETE"),
                    );
                  }}
                >
                  {busy === `remove-${t.id}` ? "Removing…" : "Disconnect"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && targets.length > 0 && azureMode !== "off" && (
        <button
          type="button"
          className={`${secondary} mt-3`}
          disabled={busy !== null}
          onClick={() => {
            run(
              "sync",
              () => send(`${base}/sync`, "POST"),
              "Sync queued. Refresh in a few seconds to see the result.",
            );
          }}
        >
          {busy === "sync" ? "Queuing…" : "Sync now"}
        </button>
      )}

      {canManage && (
        <ConnectForm
          {...props}
          busy={busy !== null}
          onSubmit={(body) => {
            run("create", () => send(base, "POST", body), "Connected. The first sync is queued.");
          }}
        />
      )}

      {notice !== null && (
        <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function ConnectForm({
  services,
  environments,
  azureMode,
  busy,
  onSubmit,
}: Props & { busy: boolean; onSubmit: (body: Record<string, string | undefined>) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const simulated = azureMode === "simulated";

  if (!open) {
    return (
      <button
        type="button"
        className={`${primary} mt-3 ml-0 block`}
        onClick={() => {
          setOpen(true);
        }}
      >
        Connect an Azure Container App
      </button>
    );
  }

  return (
    <form
      className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-900"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const text = (name: string) => {
          const raw = data.get(name);
          const value = typeof raw === "string" ? raw.trim() : "";
          return value === "" ? undefined : value;
        };
        onSubmit({
          service: text("service"),
          environment: text("environment"),
          subscriptionId: text("subscriptionId"),
          resourceGroup: text("resourceGroup"),
          containerApp: text("containerApp"),
          containerName: text("containerName"),
        });
      }}
    >
      <label className="text-sm" htmlFor={`${id}-service`}>
        Service
        <select id={`${id}-service`} name="service" className={input} required>
          {services.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm" htmlFor={`${id}-environment`}>
        Environment
        <select id={`${id}-environment`} name="environment" className={input} required>
          {environments.map((e) => (
            <option key={e.slug} value={e.slug}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm" htmlFor={`${id}-sub`}>
        Subscription ID
        <input
          id={`${id}-sub`}
          name="subscriptionId"
          required
          defaultValue={simulated ? SIMULATED_SUBSCRIPTION : undefined}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          className={input}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="text-sm" htmlFor={`${id}-rg`}>
        Resource group
        <input
          id={`${id}-rg`}
          name="resourceGroup"
          required
          defaultValue={simulated ? "releaselens-demo" : undefined}
          className={input}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="text-sm" htmlFor={`${id}-app`}>
        Container app name
        <input
          id={`${id}-app`}
          name="containerApp"
          required
          list={simulated ? `${id}-apps` : undefined}
          placeholder={simulated ? "storefront-api" : "my-app"}
          className={input}
          autoComplete="off"
          spellCheck={false}
        />
        {simulated && (
          <datalist id={`${id}-apps`}>
            {SIMULATED_APPS.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        )}
      </label>
      <label className="text-sm" htmlFor={`${id}-container`}>
        Container name <span className="text-slate-500">(optional)</span>
        <input
          id={`${id}-container`}
          name="containerName"
          placeholder="Same as the app"
          className={input}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <p className="text-xs text-slate-500 sm:col-span-2">
        ReleaseLens only reads revisions. Give its identity the Reader role on the resource group;
        no other access is needed.
      </p>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={busy} className={primary}>
          {busy ? "Connecting…" : "Connect"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
          }}
          className={secondary}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
