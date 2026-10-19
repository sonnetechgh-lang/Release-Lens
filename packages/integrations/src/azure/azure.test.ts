import { describe, expect, it, vi } from "vitest";
import {
  ContainerAppRefSchema,
  FakeDeploymentTarget,
  type ContainerAppRef,
  type RevisionObservation,
} from "../deployment-target.js";
import { ProviderError } from "../errors.js";
import {
  AzureContainerAppsProvider,
  fromCredentialError,
  type AzureTokenSource,
} from "./client.js";
import {
  SIMULATED_RESOURCE_GROUP,
  SIMULATED_SUBSCRIPTION_ID,
  createFixtureFetch,
  simulatedCredential,
} from "./fixtures.js";
import { digestOf, revisionStatus, toRevisionObservations } from "./normalize.js";
import type { ArmRevision } from "./schemas.js";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;

const app = (name: string, extra: Partial<ContainerAppRef> = {}): ContainerAppRef => ({
  subscriptionId: SIMULATED_SUBSCRIPTION_ID,
  resourceGroup: SIMULATED_RESOURCE_GROUP,
  name,
  ...extra,
});

function simulated(options: { timeoutMs?: number; fetch?: typeof fetch } = {}) {
  return new AzureContainerAppsProvider({
    credential: simulatedCredential,
    fetch: options.fetch ?? createFixtureFetch(),
    timeoutMs: options.timeoutMs ?? 2000,
    now: () => NOW,
  });
}

const serving = (revisions: RevisionObservation[]) => revisions.filter((r) => r.isServing);

describe("AzureContainerAppsProvider with the shipped fixtures", () => {
  it("reads a healthy app: the digest-pinned revision serves all traffic", async () => {
    const revisions = await simulated().listRevisions(app("storefront-api"));
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({
      revisionName: "storefront-api--r102",
      imageDigest: B,
      providerStatus: "running",
      trafficWeight: 100,
      isServing: true,
      activeSince: new Date("2026-10-18T08:20:00Z"),
    });
    expect(revisions[0]?.url).toContain("/containerApps/storefront-api/revisionManagement");
    expect(revisions[1]).toMatchObject({
      revisionName: "storefront-api--r101",
      providerStatus: "stopped",
      isServing: false,
    });
  });

  it("never invents a digest for a tag reference", async () => {
    const [revision] = await simulated().listRevisions(app("tag-only-api"));
    expect(revision).toMatchObject({
      imageReference: "releaselensdemo.azurecr.io/tag-only-api:latest",
      imageDigest: null,
      isServing: true,
    });
  });

  it("keeps the previous revision serving when the newest one failed", async () => {
    const revisions = await simulated().listRevisions(app("failed-rollout-api"));
    expect(revisions.map((r) => [r.revisionName, r.providerStatus, r.isServing])).toEqual([
      ["failed-rollout-api--r13", "failed", false],
      ["failed-rollout-api--r12", "running", true],
    ]);
  });

  it("picks the revision with most traffic in a split", async () => {
    const revisions = await simulated().listRevisions(app("canary-api"));
    expect(serving(revisions).map((r) => [r.revisionName, r.trafficWeight])).toEqual([
      ["canary-api--blue", 80],
    ]);
  });

  it("uses the app's own container, not a sidecar, and reports degraded replicas", async () => {
    const [revision] = await simulated().listRevisions(app("sidecar-api"));
    expect(revision).toMatchObject({ imageDigest: A, providerStatus: "degraded" });
    const named = await simulated().listRevisions(
      app("sidecar-api", { containerName: "otel-collector" }),
    );
    expect(named[0]?.imageReference).toBe("mcr.microsoft.com/azuremonitor/otel-collector:0.1");
  });

  it("follows pagination", async () => {
    const revisions = await simulated().listRevisions(app("paged-api"));
    expect(revisions.map((r) => r.revisionName)).toEqual(["paged-api--r2", "paged-api--r1"]);
  });

  it("works with any subscription ID and resource group casing", async () => {
    const revisions = await simulated().listRevisions(
      app("storefront-api", {
        subscriptionId: "11111111-2222-3333-4444-555555555555",
        resourceGroup: "ReleaseLens-Demo",
      }),
    );
    expect(revisions).toHaveLength(2);
  });

  it.each([
    ["throttled-api", { kind: "rate-limited", retryAfterMs: 30_000, retryable: true }],
    [
      "forbidden-api",
      {
        kind: "forbidden",
        retryable: false,
        message: expect.stringContaining("Reader") as unknown,
      },
    ],
    ["expired-token-api", { kind: "unauthorized", retryable: false }],
    ["unavailable-api", { kind: "server-error", retryAfterMs: 10_000, retryable: true }],
    ["does-not-exist", { kind: "not-found", retryable: false }],
  ])("turns %s into an error category", async (name, expected) => {
    await expect(simulated().listRevisions(app(name))).rejects.toMatchObject(expected);
  });

  it("times out when Azure does not answer (scenario 6)", async () => {
    const started = Date.now();
    await expect(simulated({ timeoutMs: 50 }).listRevisions(app("slow-api"))).rejects.toMatchObject(
      { kind: "timeout", retryable: true },
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("never keeps Azure's error message", async () => {
    const error = (await simulated()
      .listRevisions(app("forbidden-api"))
      .catch((e: unknown) => e)) as ProviderError;
    expect(error.message).not.toContain("does not have authorization");
  });
});

describe("AzureContainerAppsProvider requests", () => {
  const page = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { status: 200, ...init });

  it("sends a bearer token and only GET requests to the documented path", async () => {
    const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(page({ value: [] })),
    );
    const getToken = vi.fn(() => Promise.resolve({ token: "tok", expiresOnTimestamp: NOW }));
    const provider = new AzureContainerAppsProvider({
      credential: { getToken },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await provider.listRevisions(app("storefront-api"));

    expect(getToken).toHaveBeenCalledWith(
      "https://management.azure.com/.default",
      expect.anything(),
    );
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://management.azure.com/subscriptions/${SIMULATED_SUBSCRIPTION_ID}/resourceGroups/releaselens-demo/providers/Microsoft.App/containerApps/storefront-api/revisions?api-version=2024-03-01`,
    );
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("refuses pagination links that point to another host", async () => {
    const provider = simulated({
      fetch: () =>
        Promise.resolve(
          page({ value: [], nextLink: "https://attacker.example/steal?api-version=1" }),
        ),
    });
    await expect(provider.listRevisions(app("storefront-api"))).rejects.toMatchObject({
      kind: "server-error",
      message: expect.stringContaining("another host") as unknown,
    });
  });

  it("stops after a bounded number of pages", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        page({
          value: [],
          nextLink: "https://management.azure.com/next?api-version=2024-03-01",
        }),
      ),
    );
    await simulated({ fetch: fetchImpl as unknown as typeof fetch }).listRevisions(
      app("storefront-api"),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });

  it("rejects responses that do not match the documented shape", async () => {
    const provider = simulated({
      fetch: () => Promise.resolve(page({ value: [{ name: "x" }] })),
    });
    await expect(provider.listRevisions(app("storefront-api"))).rejects.toMatchObject({
      kind: "server-error",
    });
  });

  it("refuses target names that could change the request path", async () => {
    const fetchImpl = vi.fn();
    const provider = simulated({ fetch: fetchImpl as unknown as typeof fetch });
    for (const bad of [
      app("../../providers"),
      app("ok-name", { resourceGroup: "rg/../../x" }),
      app("ok-name", { subscriptionId: "not-a-guid" }),
    ]) {
      await expect(provider.listRevisions(bad)).rejects.toBeInstanceOf(ProviderError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats network failures as retryable", async () => {
    const provider = simulated({
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    await expect(provider.listRevisions(app("storefront-api"))).rejects.toMatchObject({
      kind: "network",
      retryable: true,
    });
  });

  it("reads Retry-After given as an HTTP date", async () => {
    const provider = simulated({
      fetch: () =>
        Promise.resolve(
          new Response("", {
            status: 429,
            headers: { "retry-after": new Date(NOW + 45_000).toUTCString() },
          }),
        ),
    });
    await expect(provider.listRevisions(app("storefront-api"))).rejects.toMatchObject({
      kind: "rate-limited",
      retryAfterMs: 45_000,
    });
  });
});

describe("Azure credentials", () => {
  const failing = (error: Error): AzureTokenSource => ({ getToken: () => Promise.reject(error) });
  const named = (name: string) => Object.assign(new Error("secret details"), { name });

  it.each([
    ["AuthenticationError", "unauthorized"],
    ["CredentialUnavailableError", "unauthorized"],
    ["AggregateAuthenticationError", "unauthorized"],
    ["TimeoutError", "timeout"],
    ["Error", "network"],
  ])("maps %s to %s without making a request", async (name, kind) => {
    const fetchImpl = vi.fn();
    const provider = new AzureContainerAppsProvider({
      credential: failing(named(name)),
      fetch: fetchImpl,
    });
    const error = (await provider
      .listRevisions(app("storefront-api"))
      .catch((e: unknown) => e)) as ProviderError;
    expect(error).toMatchObject({ kind });
    expect(error.message).not.toContain("secret details");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a missing token as unauthorized", async () => {
    const provider = new AzureContainerAppsProvider({
      credential: { getToken: () => Promise.resolve(null) },
      fetch: vi.fn(),
    });
    await expect(provider.listRevisions(app("storefront-api"))).rejects.toMatchObject({
      kind: "unauthorized",
    });
  });

  it("passes ProviderErrors through", () => {
    const error = new ProviderError("forbidden", "x");
    expect(fromCredentialError(error)).toBe(error);
  });
});

describe("revision normalization", () => {
  const props = (p: Partial<ArmRevision["properties"]>): ArmRevision["properties"] => ({
    createdTime: "2026-10-18T00:00:00Z",
    active: true,
    ...p,
  });

  it.each([
    [{ provisioningState: "Failed", runningState: "Running" }, "failed"],
    [{ provisioningState: "Provisioned", runningState: "Failed" }, "failed"],
    [{ provisioningState: "Provisioning" }, "provisioning"],
    [{ provisioningState: "Provisioned", runningState: "Processing" }, "provisioning"],
    [{ provisioningState: "Deprovisioned" }, "stopped"],
    [{ provisioningState: "Provisioned", runningState: "Running", active: false }, "stopped"],
    [{ provisioningState: "Provisioned", runningState: "Degraded" }, "degraded"],
    [
      { provisioningState: "Provisioned", runningState: "Running", healthState: "Unhealthy" },
      "degraded",
    ],
    [{ provisioningState: "Provisioned", runningState: "Running" }, "running"],
    [{ provisioningState: "Provisioned", runningState: "RunningAtMaxScale" }, "running"],
    [{ provisioningState: "Provisioned", runningState: "SomethingNew" }, "unknown"],
    [{}, "unknown"],
  ] as const)("maps %o to %s", (p, expected) => {
    expect(revisionStatus(props(p))).toBe(expected);
  });

  it("extracts only well-formed sha256 digests", () => {
    expect(digestOf(`r.io/app@${A}`)).toBe(A);
    expect(digestOf("r.io/app:sha256-aaaa")).toBeNull();
    expect(digestOf(`r.io/app@sha256:${"A".repeat(64)}`)).toBeNull();
  });

  it("chooses the newest active revision when no traffic weights are reported", () => {
    const rev = (name: string, created: string): ArmRevision => ({
      name,
      properties: props({
        createdTime: created,
        provisioningState: "Provisioned",
        runningState: "Running",
        template: { containers: [{ name: "worker", image: `r.io/worker@${A}` }] },
      }),
    });
    const result = toRevisionObservations(
      [rev("w--1", "2026-10-01T00:00:00Z"), rev("w--2", "2026-10-02T00:00:00Z")],
      app("worker"),
    );
    expect(serving(result).map((r) => r.revisionName)).toEqual(["w--2"]);
  });

  it("marks nothing as serving when no revision is active", () => {
    const result = toRevisionObservations(
      [
        {
          name: "x--1",
          properties: props({
            active: false,
            template: { containers: [{ name: "x", image: "r.io/x:1" }] },
          }),
        },
      ],
      app("x-app"),
    );
    expect(serving(result)).toEqual([]);
  });

  it("skips revisions without an image", () => {
    expect(toRevisionObservations([{ name: "x--1", properties: props({}) }], app("x-app"))).toEqual(
      [],
    );
  });
});

describe("ContainerAppRefSchema", () => {
  const parse = (v: Partial<ContainerAppRef>) =>
    ContainerAppRefSchema.safeParse({ ...app("my-app"), ...v }).success;

  it("accepts valid references and lowercases the subscription ID", () => {
    expect(
      ContainerAppRefSchema.parse(
        app("my-app", { subscriptionId: "AAAAAAAA-0000-0000-0000-000000000000" }),
      ).subscriptionId,
    ).toBe("aaaaaaaa-0000-0000-0000-000000000000");
    expect(parse({ resourceGroup: "rg_Prod.(eu)-1" })).toBe(true);
  });

  it.each([
    { name: "a" },
    { name: "My-App" },
    { name: "my--app" },
    { name: "-app" },
    { name: "app-" },
    { name: "a".repeat(33) },
    { resourceGroup: "rg." },
    { resourceGroup: "rg/x" },
    { resourceGroup: "" },
    { subscriptionId: "1234" },
    { containerName: "Bad Name" },
  ])("rejects %o", (value) => {
    expect(parse(value)).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(ContainerAppRefSchema.safeParse({ ...app("my-app"), extra: 1 }).success).toBe(false);
  });
});

describe("FakeDeploymentTarget", () => {
  const observation: RevisionObservation = {
    revisionName: "a--1",
    imageReference: `r.io/a@${A}`,
    imageDigest: A,
    activeSince: new Date(NOW),
    providerStatus: "running",
    trafficWeight: 100,
    isServing: true,
    url: null,
  };

  it("returns what it was given, as a copy, and records calls", async () => {
    const fake = new FakeDeploymentTarget().set(app("a-app"), [observation]);
    const first = await fake.listRevisions(app("a-app"));
    expect(first).toEqual([observation]);
    expect(first[0]).not.toBe(observation);
    expect(fake.calls).toHaveLength(1);
  });

  it("fails with the given error, or not-found for unknown apps", async () => {
    const fake = new FakeDeploymentTarget().set(
      app("slow-app"),
      new ProviderError("timeout", "timed out"),
    );
    await expect(fake.listRevisions(app("slow-app"))).rejects.toMatchObject({ kind: "timeout" });
    await expect(fake.listRevisions(app("other-app"))).rejects.toMatchObject({
      kind: "not-found",
    });
  });
});
