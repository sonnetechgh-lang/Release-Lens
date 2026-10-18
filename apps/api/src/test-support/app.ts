import "reflect-metadata";
import { createHash } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module.js";
import {
  GITHUB_OAUTH_CLIENT,
  GithubOAuthError,
  type GithubOAuthClient,
  type GithubProfile,
} from "../auth/github-oauth.client.js";
import { SessionService } from "../auth/session.service.js";
import { configureApp } from "../bootstrap.js";
import { loadConfig, type AppConfig } from "../config/config.js";
import { GITHUB_APP, type GithubAppApi } from "../github/github-app.provider.js";
import {
  ProviderError,
  type GithubInstallation,
  type GithubRepository,
} from "@releaselens/integrations";

export const PUBLIC_ORIGIN = "http://localhost:3000";

export const WEBHOOK_SECRET = "test-webhook-secret-0123456789";

export function testConfig(
  databaseUrl: string,
  env: Record<string, string> = {},
  redisUrl = "redis://127.0.0.1:6379",
): AppConfig {
  return loadConfig({
    REDIS_URL: redisUrl,
    GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: "not-used-in-tests",
    GITHUB_APP_SLUG: "releaselens-test",
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    PUBLIC_URL: PUBLIC_ORIGIN,
    LOG_LEVEL: "silent",
    RELEASELENS_MODE: "demo",
    GITHUB_OAUTH_CLIENT_ID: "test-client-id",
    GITHUB_OAUTH_CLIENT_SECRET: "test-client-secret",
    RELEASELENS_OWNER_GITHUB_LOGINS: "octo-owner",
    RELEASELENS_ALLOWED_GITHUB_LOGINS: "octo-viewer",
    ...env,
  });
}

/**
 * Stands in for GitHub. Codes map to profiles; the PKCE verifier sent with the
 * token exchange is recorded so tests can check it matches the challenge.
 */
export class FakeGithub implements GithubOAuthClient {
  readonly profiles = new Map<string, GithubProfile>();
  readonly verifiers: string[] = [];

  exchangeCode(code: string, codeVerifier: string): Promise<string> {
    this.verifiers.push(codeVerifier);
    if (!this.profiles.has(code))
      return Promise.reject(new GithubOAuthError("bad_verification_code"));
    return Promise.resolve(`token-for-${code}`);
  }

  fetchProfile(accessToken: string): Promise<GithubProfile> {
    const profile = this.profiles.get(accessToken.replace("token-for-", ""));
    return profile ? Promise.resolve(profile) : Promise.reject(new GithubOAuthError("401"));
  }
}

/** Stands in for the GitHub App API: installations and the repositories each can access. */
export class FakeGithubApp implements GithubAppApi {
  readonly installations = new Map<
    number,
    { installation: GithubInstallation; repos: GithubRepository[] }
  >();

  add(id: number, account: string, repos: { id: number; name: string }[]): void {
    this.installations.set(id, {
      installation: {
        id,
        account: { login: account, type: "Organization" },
        repository_selection: "selected",
      },
      repos: repos.map((r) => ({
        id: r.id,
        name: r.name,
        full_name: `${account}/${r.name}`,
        private: true,
        default_branch: "main",
        owner: { login: account },
      })),
    });
  }

  listInstallations(): Promise<GithubInstallation[]> {
    return Promise.resolve([...this.installations.values()].map((i) => i.installation));
  }

  getInstallation(id: number): Promise<GithubInstallation> {
    const found = this.installations.get(id);
    return found
      ? Promise.resolve(found.installation)
      : Promise.reject(new ProviderError("not-found", "nope", 404));
  }

  listInstallationRepositories(id: number): Promise<GithubRepository[]> {
    const found = this.installations.get(id);
    return found
      ? Promise.resolve(found.repos)
      : Promise.reject(new ProviderError("not-found", "nope", 404));
  }
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export interface TestApp {
  app: NestExpressApplication;
  github: FakeGithub;
  githubApp: FakeGithubApp;
  /** Creates a session directly and returns a Cookie header value for it. */
  sessionCookie(userId: string): Promise<string>;
  close(): Promise<void>;
}

export async function createTestApp(config: AppConfig): Promise<TestApp> {
  const github = new FakeGithub();
  const githubApp = new FakeGithubApp();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(GITHUB_OAUTH_CLIENT)
    .useValue(github)
    .overrideProvider(GITHUB_APP)
    .useValue(githubApp)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();

  return {
    app,
    github,
    githubApp,
    async sessionCookie(userId) {
      const { token } = await app.get(SessionService).create(userId);
      return `rl_session=${token}`;
    },
    close: () => app.close(),
  };
}
