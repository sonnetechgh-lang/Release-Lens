import { createDb, type Db } from "@releaselens/db";
import {
  AzureContainerAppsProvider,
  FakeDeploymentTarget,
  ProviderError,
  createFixtureFetch,
  simulatedCredential,
  type ContainerAppRef,
  type RevisionObservation,
} from "@releaselens/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { syncAllDeploymentTargets, syncDeploymentTargets } from "./processors/deployments.js";
import {
  NOW,
  createConnectedProject,
  testDeps,
  type TestProjectRefs,
} from "./test-support/fixtures.js";

const SUB = "00000000-0000-0000-0000-000000000000";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

let db: Db;
let refs: TestProjectRefs;

beforeAll(() => {
  db = createDb(inject("databaseUrl"));
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.project.deleteMany();
  refs = await createConnectedProject(db);
});

const ref = (name: string): ContainerAppRef => ({
  subscriptionId: SUB,
  resourceGroup: "releaselens-demo",
  name,
});

async function addTarget(name: string, projectId = refs.projectId) {
  const [service, environment] = await Promise.all([
    db.service.findFirstOrThrow({ where: { projectId } }),
    db.environment.findFirstOrThrow({ where: { projectId } }),
  ]);
  await db.deploymentTarget.create({
    data: {
      projectId,
      serviceId: service.id,
      environmentId: environment.id,
      subscriptionId: SUB,
      resourceGroup: "releaselens-demo",
      resourceName: name,
    },
  });
}

const revision = (overrides: Partial<RevisionObservation> = {}): RevisionObservation => ({
  revisionName: "shop--r2",
  imageReference: `acr.io/shop@${DIGEST_B}`,
  imageDigest: DIGEST_B,
  activeSince: new Date("2026-10-18T10:00:00Z"),
  providerStatus: "running",
  trafficWeight: 100,
  isServing: true,
  url: "https://portal.azure.com/#resource/x",
  ...overrides,
});

const deployments = () =>
  db.deployment.findMany({
    where: { service: { projectId: refs.projectId } },
    orderBy: { activeSince: "desc" },
  });
const azure = () =>
  db.integration.findUnique({
    where: { projectId_provider: { projectId: refs.projectId, provider: "AZURE_CONTAINER_APPS" } },
  });

describe("syncDeploymentTargets", () => {
  it("skips projects without targets, and does nothing when Azure is off", async () => {
    const fake = new FakeDeploymentTarget();
    expect(
      await syncDeploymentTargets(testDeps(db, { deploymentTarget: fake }), refs.projectId),
    ).toEqual({ status: "skipped", reason: "no deployment targets" });
    await addTarget("shop");
    expect(await syncDeploymentTargets(testDeps(db), refs.projectId)).toEqual({
      status: "skipped",
      reason: "Azure provider is off",
    });
    expect(await azure()).toBeNull();
  });

  it("stores revisions, marks the serving one active, and records a successful sync", async () => {
    await addTarget("shop");
    const fake = new FakeDeploymentTarget().set(ref("shop"), [
      revision(),
      revision({
        revisionName: "shop--r1",
        imageDigest: DIGEST_A,
        imageReference: `acr.io/shop@${DIGEST_A}`,
        activeSince: new Date("2026-10-17T10:00:00Z"),
        providerStatus: "stopped",
        trafficWeight: 0,
        isServing: false,
      }),
    ]);
    const result = await syncDeploymentTargets(
      testDeps(db, { deploymentTarget: fake }),
      refs.projectId,
    );

    expect(result).toEqual({ status: "synced", targets: 1, revisions: 2 });
    expect(await deployments()).toMatchObject([
      { revisionName: "shop--r2", isActive: true, trafficWeight: 100, observedAt: NOW },
      { revisionName: "shop--r1", isActive: false, providerStatus: "stopped" },
    ]);
    expect(await azure()).toMatchObject({
      status: "connected",
      lastSuccessfulSyncAt: NOW,
      lastErrorKind: null,
    });
  });

  it("moves the active flag when a new revision takes over, keeping history", async () => {
    await addTarget("shop");
    const fake = new FakeDeploymentTarget().set(ref("shop"), [
      revision({ revisionName: "shop--r1" }),
    ]);
    const deps = testDeps(db, { deploymentTarget: fake });
    await syncDeploymentTargets(deps, refs.projectId);

    // r1 has since been deleted in Azure; r2 now serves.
    fake.set(ref("shop"), [revision({ revisionName: "shop--r2" })]);
    await syncDeploymentTargets(deps, refs.projectId);

    const rows = (await deployments()).map((d) => [d.revisionName, d.isActive]);
    expect(rows.sort()).toEqual([
      ["shop--r1", false],
      ["shop--r2", true],
    ]);
  });

  it("feeds the diagnostics engine: a tag-only image raises an identity finding", async () => {
    await addTarget("shop");
    const fake = new FakeDeploymentTarget().set(ref("shop"), [
      revision({ imageReference: "acr.io/shop:latest", imageDigest: null }),
    ]);
    await syncDeploymentTargets(testDeps(db, { deploymentTarget: fake }), refs.projectId);
    const findings = await db.diagnosticFinding.findMany({ where: { projectId: refs.projectId } });
    expect(findings.map((f) => f.ruleId)).toContain("deployment.identity-unverified");
  });

  it("records a timeout, keeps the last success, and rethrows so the job is retried (scenario 6)", async () => {
    await addTarget("shop");
    const fake = new FakeDeploymentTarget().set(ref("shop"), [revision()]);
    const deps = testDeps(db, { deploymentTarget: fake });
    await syncDeploymentTargets(deps, refs.projectId);

    fake.set(ref("shop"), new ProviderError("timeout", "timed out"));
    const later = new Date(NOW.getTime() + 4 * 60 * 60 * 1000);
    await expect(
      syncDeploymentTargets({ ...deps, now: () => later }, refs.projectId),
    ).rejects.toMatchObject({ kind: "timeout" });

    expect(await azure()).toMatchObject({
      lastAttemptAt: later,
      lastSuccessfulSyncAt: NOW,
      lastErrorKind: "timeout",
    });
    // Four hours without fresh Azure data is reported, not hidden.
    const findings = await db.diagnosticFinding.findMany({ where: { projectId: refs.projectId } });
    expect(findings.map((f) => f.ruleId)).toContain("evidence.stale");
  });

  it("does not retry permanent failures such as a missing Reader role", async () => {
    await addTarget("shop");
    const fake = new FakeDeploymentTarget().set(
      ref("shop"),
      new ProviderError("forbidden", "missing Reader role", 403),
    );
    expect(
      await syncDeploymentTargets(testDeps(db, { deploymentTarget: fake }), refs.projectId),
    ).toEqual({ status: "failed", errorKind: "forbidden", failedTargets: 1 });
    expect(await azure()).toMatchObject({ lastErrorKind: "forbidden", lastSuccessfulSyncAt: null });
  });

  it("keeps reading other targets when one fails", async () => {
    await addTarget("shop");
    const environment = await db.environment.create({
      data: { projectId: refs.projectId, slug: "staging", name: "Staging", releaseBranch: "main" },
    });
    const service = await db.service.findFirstOrThrow({ where: { projectId: refs.projectId } });
    await db.deploymentTarget.create({
      data: {
        projectId: refs.projectId,
        serviceId: service.id,
        environmentId: environment.id,
        subscriptionId: SUB,
        resourceGroup: "releaselens-demo",
        resourceName: "shop-staging",
      },
    });
    const fake = new FakeDeploymentTarget()
      .set(ref("shop"), new ProviderError("rate-limited", "throttled", 429, 30_000))
      .set(ref("shop-staging"), [revision({ revisionName: "shop-staging--r1" })]);

    await expect(
      syncDeploymentTargets(testDeps(db, { deploymentTarget: fake }), refs.projectId),
    ).rejects.toMatchObject({ kind: "rate-limited", retryAfterMs: 30_000 });
    expect((await deployments()).map((d) => d.revisionName)).toEqual(["shop-staging--r1"]);
    expect(await azure()).toMatchObject({ lastErrorKind: "rate-limited" });
  });

  it("works end to end with the real adapter in simulated mode", async () => {
    await addTarget("failed-rollout-api");
    const provider = new AzureContainerAppsProvider({
      credential: simulatedCredential,
      fetch: createFixtureFetch(),
    });
    await syncDeploymentTargets(testDeps(db, { deploymentTarget: provider }), refs.projectId);
    expect(
      (await deployments()).map((d) => [d.revisionName, d.providerStatus, d.isActive]),
    ).toEqual([
      ["failed-rollout-api--r13", "failed", false],
      ["failed-rollout-api--r12", "running", true],
    ]);
  });
});

describe("syncAllDeploymentTargets", () => {
  it("queues only projects that have targets", async () => {
    const other = await db.project.create({
      data: { orgId: refs.orgId, slug: "blog", name: "Blog" },
    });
    await addTarget("shop");
    const deps = testDeps(db);
    expect(await syncAllDeploymentTargets(deps)).toBe(1);
    expect(deps.enqueueDeploymentSync).toHaveBeenCalledExactlyOnceWith(refs.projectId);
    expect(deps.enqueueDeploymentSync).not.toHaveBeenCalledWith(other.id);
  });
});
