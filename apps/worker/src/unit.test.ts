import { providerBackoff } from "@releaselens/jobs";
import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "./config.js";
import { createDeploymentTarget } from "./worker.js";

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

  it("leaves Azure off unless asked, and validates the Azure settings", () => {
    expect(loadWorkerConfig(BASE).azure).toEqual({
      mode: "off",
      fixturesDir: undefined,
      syncIntervalMs: 300_000,
      requestTimeoutMs: 10_000,
    });
    expect(
      loadWorkerConfig({
        ...BASE,
        AZURE_PROVIDER_MODE: "simulated",
        AZURE_SYNC_INTERVAL_MINUTES: "1",
        AZURE_REQUEST_TIMEOUT_SECONDS: "3",
      }).azure,
    ).toMatchObject({ mode: "simulated", syncIntervalMs: 60_000, requestTimeoutMs: 3000 });
    expect(() => loadWorkerConfig({ ...BASE, AZURE_PROVIDER_MODE: "on" })).toThrow();
    expect(() => loadWorkerConfig({ ...BASE, AZURE_REQUEST_TIMEOUT_SECONDS: "0" })).toThrow();
  });
});

describe("createDeploymentTarget", () => {
  const azure = loadWorkerConfig({ DATABASE_URL: "x" }).azure;

  it("returns nothing when Azure is off", async () => {
    expect(await createDeploymentTarget(azure)).toBeNull();
  });

  it("reads recorded responses in simulated mode", async () => {
    const target = await createDeploymentTarget({ ...azure, mode: "simulated" });
    const revisions = await target?.listRevisions({
      subscriptionId: "00000000-0000-0000-0000-000000000000",
      resourceGroup: "releaselens-demo",
      name: "storefront-api",
    });
    expect(revisions?.find((r) => r.isServing)?.revisionName).toBe("storefront-api--r102");
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
