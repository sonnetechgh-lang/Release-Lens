import {
  ContainerAppRefSchema,
  type ContainerAppRef,
  type DeploymentTargetProvider,
  type RevisionObservation,
} from "../deployment-target.js";
import { ProviderError, fromFetchError } from "../errors.js";
import { toRevisionObservations } from "./normalize.js";
import { ArmErrorSchema, ArmRevisionPageSchema, type ArmRevision } from "./schemas.js";

export const ARM_BASE_URL = "https://management.azure.com";
export const ARM_SCOPE = "https://management.azure.com/.default";
export const CONTAINER_APPS_API_VERSION = "2024-03-01";

/**
 * Anything that can hand out an Azure access token. `@azure/identity` credentials
 * (DefaultAzureCredential, ManagedIdentityCredential, ...) satisfy this as is.
 */
export interface AzureTokenSource {
  getToken(
    scopes: string | string[],
    options?: { abortSignal?: AbortSignal },
  ): Promise<{ token: string; expiresOnTimestamp: number } | null>;
}

export interface AzureContainerAppsOptions {
  credential: AzureTokenSource;
  baseUrl?: string;
  apiVersion?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

const MAX_PAGES = 10;
const DEFAULT_RETRY_AFTER_MS = 60_000;

/**
 * Read-only Azure Container Apps adapter. It calls the Azure Resource Manager
 * REST API directly and issues only GET requests, so the Reader role is enough.
 * - Every request (including getting a token) has a timeout.
 * - Failures become ProviderErrors with a category; Azure's messages are never kept.
 * - Pagination links are followed only when they point back to Azure Resource Manager.
 */
export class AzureContainerAppsProvider implements DeploymentTargetProvider {
  readonly provider = "azure-container-apps" as const;
  readonly #opts: Required<AzureContainerAppsOptions>;
  readonly #origin: string;

  constructor(options: AzureContainerAppsOptions) {
    this.#opts = {
      baseUrl: ARM_BASE_URL,
      apiVersion: CONTAINER_APPS_API_VERSION,
      fetch: globalThis.fetch.bind(globalThis),
      timeoutMs: 10_000,
      now: Date.now,
      ...options,
    };
    this.#origin = new URL(this.#opts.baseUrl).origin;
  }

  async listRevisions(input: ContainerAppRef): Promise<RevisionObservation[]> {
    const parsed = ContainerAppRefSchema.safeParse(input);
    if (!parsed.success) throw new ProviderError("not-found", "Invalid container app reference");
    const target = parsed.data;

    const path =
      `/subscriptions/${target.subscriptionId}` +
      `/resourceGroups/${encodeURIComponent(target.resourceGroup)}` +
      `/providers/Microsoft.App/containerApps/${target.name}/revisions`;
    let url: string | null =
      `${this.#opts.baseUrl}${path}?api-version=${encodeURIComponent(this.#opts.apiVersion)}`;

    const revisions: ArmRevision[] = [];
    for (let page = 0; url !== null && page < MAX_PAGES; page++) {
      const body = await this.#get(url, "Azure GET containerApps/revisions");
      const parsedPage = ArmRevisionPageSchema.safeParse(body);
      if (!parsedPage.success) {
        throw new ProviderError("server-error", "Unexpected revisions response from Azure");
      }
      revisions.push(...parsedPage.data.value);
      url = this.#nextLink(parsedPage.data.nextLink);
    }
    return toRevisionObservations(revisions, target);
  }

  /** Only follows links back to the same Azure Resource Manager origin over HTTPS (or the test base URL). */
  #nextLink(link: string | null | undefined): string | null {
    if (link === undefined || link === null || link === "") return null;
    let next: URL;
    try {
      next = new URL(link);
    } catch {
      throw new ProviderError("server-error", "Azure returned an invalid pagination link");
    }
    if (next.origin !== this.#origin || next.username !== "" || next.password !== "") {
      throw new ProviderError("server-error", "Azure returned a pagination link to another host");
    }
    return next.href;
  }

  async #token(): Promise<string> {
    let token: { token: string } | null;
    try {
      token = await this.#opts.credential.getToken(ARM_SCOPE, {
        abortSignal: AbortSignal.timeout(this.#opts.timeoutMs),
      });
    } catch (error) {
      throw fromCredentialError(error);
    }
    if (token === null || token.token === "") {
      throw new ProviderError("unauthorized", "Azure credential returned no token");
    }
    return token.token;
  }

  async #get(url: string, what: string): Promise<unknown> {
    const token = await this.#token();
    let response: Response;
    try {
      response = await this.#opts.fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.#opts.timeoutMs),
        redirect: "error",
      });
    } catch (error) {
      throw fromFetchError(error, what);
    }
    if (!response.ok) throw await classifyArmResponse(response, what, this.#opts.now());
    try {
      return await response.json();
    } catch (error) {
      // A body that stops arriving still hits the timeout.
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw fromFetchError(error, what);
      }
      throw new ProviderError("server-error", `${what} returned invalid JSON`);
    }
  }
}

/**
 * Maps a failure to get a token. Expired or revoked secrets, a missing managed
 * identity, or no configured credential all mean ReleaseLens is not authorized.
 */
export function fromCredentialError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new ProviderError("timeout", "Getting an Azure token timed out");
  }
  if (/Authentication|Credential/i.test(name)) {
    return new ProviderError("unauthorized", "Azure credential was rejected or is not available");
  }
  return new ProviderError("network", "Getting an Azure token failed");
}

/** Maps a non-2xx Azure Resource Manager response to an error category. */
export async function classifyArmResponse(
  response: Response,
  what: string,
  nowMs: number,
): Promise<ProviderError> {
  const { status } = response;
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), nowMs);
  let code: string | undefined;
  try {
    const parsed = ArmErrorSchema.safeParse(await response.json());
    if (parsed.success) code = parsed.data.error.code;
  } catch {
    // No JSON body; the status code is enough.
  }

  if (status === 429) {
    return new ProviderError(
      "rate-limited",
      `${what}: throttled`,
      status,
      retryAfterMs ?? DEFAULT_RETRY_AFTER_MS,
    );
  }
  if (status === 401) return new ProviderError("unauthorized", `${what}: unauthorized`, status);
  if (status === 403) {
    return new ProviderError(
      "forbidden",
      code === "AuthorizationFailed" ? `${what}: missing Reader role` : `${what}: forbidden`,
      status,
    );
  }
  if (status === 404) return new ProviderError("not-found", `${what}: not found`, status);
  if (status === 408 || status === 504) {
    return new ProviderError("timeout", `${what}: Azure timed out`, status, retryAfterMs);
  }
  if (status >= 500) {
    return new ProviderError(
      "server-error",
      `${what}: Azure error ${String(status)}`,
      status,
      retryAfterMs,
    );
  }
  return new ProviderError("server-error", `${what}: unexpected status ${String(status)}`, status);
}

/** Retry-After as seconds or an HTTP date. */
function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}
