import { providerBackoff } from "@releaselens/jobs";
import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "./config.js";

describe("loadWorkerConfig", () => {
  const BASE = { DATABASE_URL: "postgresql://u:p@localhost/db" };

  it("runs without a GitHub App (webhooks only)", () => {
    expect(loadWorkerConfig(BASE)).toMatchObject({
      githubApp: null,
      redisUrl: "redis://127.0.0.1:6379",
      reconcileIntervalMs: 600_000,
    });
  });

  it("accepts a single-line private key with escaped newlines", () => {
    const config = loadWorkerConfig({
      ...BASE,
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    });
    expect(config.githubApp?.privateKey).toBe(
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    );
  });

  it("requires the app ID and key together", () => {
    expect(() => loadWorkerConfig({ ...BASE, GITHUB_APP_ID: "123" })).toThrow(/both/);
  });
});

describe("providerBackoff", () => {
  it("honours the provider's wait time for rate limits", () => {
    expect(providerBackoff(1, { retryAfterMs: 42_000 })).toBe(42_000);
  });

  it("caps very long provider waits at an hour", () => {
    expect(providerBackoff(1, { retryAfterMs: 10 * 60 * 60 * 1000 })).toBe(60 * 60 * 1000);
  });

  it("grows exponentially with jitter and is capped", () => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      const cap = Math.min(2000 * 2 ** (attempt - 1), 600_000);
      const delay = providerBackoff(attempt, new Error("boom"));
      expect(delay).toBeGreaterThanOrEqual(cap / 2);
      expect(delay).toBeLessThanOrEqual(cap);
    }
  });
});
