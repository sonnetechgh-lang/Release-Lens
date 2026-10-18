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

export const PUBLIC_ORIGIN = "http://localhost:3000";

export function testConfig(databaseUrl: string, env: Record<string, string> = {}): AppConfig {
  return loadConfig({
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

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export interface TestApp {
  app: NestExpressApplication;
  github: FakeGithub;
  /** Creates a session directly and returns a Cookie header value for it. */
  sessionCookie(userId: string): Promise<string>;
  close(): Promise<void>;
}

export async function createTestApp(config: AppConfig): Promise<TestApp> {
  const github = new FakeGithub();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(GITHUB_OAUTH_CLIENT)
    .useValue(github)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();

  return {
    app,
    github,
    async sessionCookie(userId) {
      const { token } = await app.get(SessionService).create(userId);
      return `rl_session=${token}`;
    },
    close: () => app.close(),
  };
}
