import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AzureTokenSource } from "./client.js";

/** Fixtures shipped with this package: recorded-style Azure responses for a demo resource group. */
export const DEFAULT_AZURE_FIXTURES_DIR = fileURLToPath(
  new URL("../../fixtures/azure", import.meta.url),
);

/** Subscription used by the shipped fixtures. Any subscription ID works in simulated mode. */
export const SIMULATED_SUBSCRIPTION_ID = "00000000-0000-0000-0000-000000000000";
export const SIMULATED_RESOURCE_GROUP = "releaselens-demo";

/** A credential that always succeeds. Only for simulated mode. */
export const simulatedCredential: AzureTokenSource = {
  getToken: () => Promise.resolve({ token: "simulated", expiresOnTimestamp: Date.now() + 3600e3 }),
};

/**
 * Optional wrapper in a fixture file to simulate failures:
 * `{ "$response": { "status": 429, "headers": { "retry-after": "30" }, "body": {...} } }`
 * or `{ "$response": { "hang": true } }`, which never answers so the request times out.
 */
interface FixtureResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  hang?: boolean;
}

const REVISIONS_PATH =
  /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/([\w.()-]{1,90})\/providers\/Microsoft\.App\/containerApps\/([a-z0-9-]{2,32})\/revisions$/;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const notFound = () =>
  json(404, { error: { code: "ResourceNotFound", message: "The resource was not found." } });

function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal === null || signal === undefined) return; // never settles; callers always pass a signal
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    signal.addEventListener("abort", () => {
      reject(signal.reason as Error);
    });
  });
}

/**
 * A `fetch` that answers Azure Resource Manager revision requests from files:
 * `<dir>/<resource group>/<container app>/revisions.json`, and `revisions.<n>.json`
 * for further pages (`$skiptoken=<n>`). Anything else is "not found". Names are
 * validated before they touch the file system, and resolved paths must stay in `dir`.
 */
export function createFixtureFetch(dir: string = DEFAULT_AZURE_FIXTURES_DIR): typeof fetch {
  const root = path.resolve(dir);
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const match = REVISIONS_PATH.exec(decodeURIComponent(url.pathname));
    if (match === null) return notFound();
    const [, resourceGroup = "", app = ""] = match;
    const skip = url.searchParams.get("$skiptoken");
    if (skip !== null && !/^\d{1,3}$/.test(skip)) return notFound();

    const file = path.resolve(
      root,
      resourceGroup.toLowerCase(),
      app,
      skip === null ? "revisions.json" : `revisions.${skip}.json`,
    );
    if (!file.startsWith(root + path.sep)) return notFound();

    let content: unknown;
    try {
      content = JSON.parse(await readFile(file, "utf8"));
    } catch {
      return notFound();
    }
    const wrapped = (content as { $response?: FixtureResponse }).$response;
    if (wrapped === undefined) return json(200, content);
    if (wrapped.hang === true) return hang(init?.signal);
    return json(wrapped.status ?? 200, wrapped.body ?? {}, wrapped.headers);
  };
}
