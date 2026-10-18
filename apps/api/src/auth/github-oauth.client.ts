import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { APP_CONFIG, type AppConfig } from "../config/config.js";

export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

/** Abstracted so tests can replace GitHub with a fake. */
export interface GithubOAuthClient {
  /** Exchanges an authorization code for a short-lived user access token. */
  exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<string>;
  fetchProfile(accessToken: string): Promise<GithubProfile>;
}

export const GITHUB_OAUTH_CLIENT = Symbol("GITHUB_OAUTH_CLIENT");

const TokenResponse = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string() }),
]);

const UserResponse = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable().optional(),
  avatar_url: z.url().nullable().optional(),
});

const TIMEOUT_MS = 10_000;

export class GithubOAuthError extends Error {}

@Injectable()
export class HttpGithubOAuthClient implements GithubOAuthClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<string> {
    if (this.config.github === null) throw new GithubOAuthError("GitHub sign-in is not configured");
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.config.github.clientId,
        client_secret: this.config.github.clientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const parsed = TokenResponse.safeParse(await response.json().catch(() => null));
    if (!response.ok || !parsed.success || "error" in parsed.data) {
      // The error code from GitHub is safe to surface; the response body is not logged.
      const reason =
        parsed.success && "error" in parsed.data ? parsed.data.error : String(response.status);
      throw new GithubOAuthError(`GitHub token exchange failed: ${reason}`);
    }
    return parsed.data.access_token;
  }

  async fetchProfile(accessToken: string): Promise<GithubProfile> {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ReleaseLens",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const parsed = UserResponse.safeParse(await response.json().catch(() => null));
    if (!response.ok || !parsed.success) {
      throw new GithubOAuthError(`GitHub profile request failed: ${String(response.status)}`);
    }
    return {
      id: parsed.data.id,
      login: parsed.data.login,
      name: parsed.data.name ?? null,
      avatarUrl: parsed.data.avatar_url ?? null,
    };
  }
}
