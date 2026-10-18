import type { z } from "zod";
import { ProviderError, fromFetchError } from "../errors.js";
import { createAppJwt } from "./app-auth.js";
import {
  GithubInstallationSchema,
  InstallationRepositoriesPageSchema,
  InstallationTokenSchema,
  WorkflowRunsPageSchema,
  type GithubInstallation,
  type GithubRepository,
  type GithubWorkflowRun,
} from "./schemas.js";

export interface GithubAppClientOptions {
  appId: string;
  privateKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

type Auth = { kind: "app" } | { kind: "installation"; installationId: number };

/** Refresh installation tokens this long before they expire. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_PAGES = 10;

/**
 * Minimal, read-only GitHub App client.
 * - Every request has a timeout.
 * - Failures become ProviderErrors with a category; response bodies are never logged or kept.
 * - Installation tokens are cached in memory and never leave this class.
 */
export class GithubAppClient {
  readonly #opts: Required<GithubAppClientOptions>;
  readonly #tokens = new Map<number, { token: string; expiresAt: number }>();

  constructor(options: GithubAppClientOptions) {
    this.#opts = {
      baseUrl: "https://api.github.com",
      fetch: globalThis.fetch.bind(globalThis),
      timeoutMs: 10_000,
      now: Date.now,
      ...options,
    };
  }

  async listInstallations(): Promise<GithubInstallation[]> {
    const page = await this.#request("/app/installations?per_page=100", { kind: "app" });
    return GithubInstallationSchema.array().parse(page);
  }

  async getInstallation(installationId: number): Promise<GithubInstallation> {
    return this.#get(
      `/app/installations/${String(installationId)}`,
      { kind: "app" },
      GithubInstallationSchema,
    );
  }

  async listInstallationRepositories(installationId: number): Promise<GithubRepository[]> {
    const repos: GithubRepository[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await this.#get(
        `/installation/repositories?per_page=100&page=${String(page)}`,
        { kind: "installation", installationId },
        InstallationRepositoriesPageSchema,
      );
      repos.push(...data.repositories);
      if (repos.length >= data.total_count || data.repositories.length === 0) break;
    }
    return repos;
  }

  /** Most recent workflow runs for a repository, newest first. */
  async listWorkflowRuns(
    installationId: number,
    fullName: string,
    options: { perPage?: number } = {},
  ): Promise<GithubWorkflowRun[]> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) {
      throw new ProviderError("not-found", "Invalid repository name");
    }
    const data = await this.#get(
      `/repos/${fullName}/actions/runs?per_page=${String(options.perPage ?? 50)}`,
      { kind: "installation", installationId },
      WorkflowRunsPageSchema,
    );
    return data.workflow_runs;
  }

  async #installationToken(installationId: number): Promise<string> {
    const cached = this.#tokens.get(installationId);
    if (cached !== undefined && cached.expiresAt - this.#opts.now() > TOKEN_REFRESH_MARGIN_MS) {
      return cached.token;
    }
    const data = await this.#request(
      `/app/installations/${String(installationId)}/access_tokens`,
      { kind: "app" },
      "POST",
    );
    const parsed = InstallationTokenSchema.safeParse(data);
    if (!parsed.success)
      throw new ProviderError("server-error", "Unexpected token response from GitHub");
    this.#tokens.set(installationId, {
      token: parsed.data.token,
      expiresAt: Date.parse(parsed.data.expires_at),
    });
    return parsed.data.token;
  }

  async #get<T extends z.ZodType>(path: string, auth: Auth, schema: T): Promise<z.infer<T>> {
    const data = await this.#request(path, auth);
    const parsed = schema.safeParse(data);
    if (!parsed.success)
      throw new ProviderError(
        "server-error",
        `Unexpected response from GitHub for ${path.split("?")[0] ?? path}`,
      );
    return parsed.data;
  }

  async #request(path: string, auth: Auth, method: "GET" | "POST" = "GET"): Promise<unknown> {
    const token =
      auth.kind === "app"
        ? createAppJwt(this.#opts.appId, this.#opts.privateKey, this.#opts.now())
        : await this.#installationToken(auth.installationId);
    const what = `GitHub ${method} ${path.split("?")[0] ?? path}`;

    let response: Response;
    try {
      response = await this.#opts.fetch(`${this.#opts.baseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "ReleaseLens",
        },
        signal: AbortSignal.timeout(this.#opts.timeoutMs),
      });
    } catch (error) {
      throw fromFetchError(error, what);
    }

    if (!response.ok) {
      if (auth.kind === "installation" && response.status === 401) {
        this.#tokens.delete(auth.installationId);
      }
      throw classifyGithubResponse(response, what, this.#opts.now());
    }
    try {
      return await response.json();
    } catch {
      throw new ProviderError("server-error", `${what} returned invalid JSON`);
    }
  }
}

/** Maps a non-2xx GitHub response to an error category, including both kinds of rate limit. */
export function classifyGithubResponse(
  response: Response,
  what: string,
  nowMs: number,
): ProviderError {
  const { status, headers } = response;
  const retryAfter = Number(headers.get("retry-after"));
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = Number(headers.get("x-ratelimit-reset"));

  if (
    status === 429 ||
    (status === 403 && (remaining === "0" || (Number.isFinite(retryAfter) && retryAfter > 0)))
  ) {
    const retryAfterMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Number.isFinite(reset) && reset > 0
          ? Math.max(0, reset * 1000 - nowMs)
          : 60_000;
    return new ProviderError("rate-limited", `${what}: rate limited`, status, retryAfterMs);
  }
  if (status === 401) return new ProviderError("unauthorized", `${what}: unauthorized`, status);
  if (status === 403) return new ProviderError("forbidden", `${what}: forbidden`, status);
  if (status === 404) return new ProviderError("not-found", `${what}: not found`, status);
  if (status >= 500)
    return new ProviderError("server-error", `${what}: GitHub error ${String(status)}`, status);
  return new ProviderError("server-error", `${what}: unexpected status ${String(status)}`, status);
}
