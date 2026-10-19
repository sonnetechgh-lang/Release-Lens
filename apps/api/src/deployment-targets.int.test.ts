import type { DeploymentTargetItem, ProjectDetail } from "@releaselens/contracts";
import { createDb, type Db } from "@releaselens/db";
import { createDeploymentSyncQueue } from "@releaselens/jobs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { PUBLIC_ORIGIN, createTestApp, testConfig, type TestApp } from "./test-support/app.js";

const SUB = "00000000-0000-0000-0000-000000000000";
const BASE = "/api/orgs/zure/projects/shop";
const TARGETS = `${BASE}/deployment-targets`;

let t: TestApp;
let db: Db;
let ownerCookie: string;
let viewerCookie: string;
let outsiderCookie: string;
let projectId: string;

const http = () => request(t.app.getHttpServer());

const body = (overrides: Record<string, unknown> = {}) => ({
  service: "shop",
  environment: "production",
  subscriptionId: SUB,
  resourceGroup: "releaselens-demo",
  containerApp: "storefront-api",
  ...overrides,
});

const post = (path: string, cookie: string, payload?: unknown) => {
  const req = http().post(path).set("Cookie", cookie).set("Origin", PUBLIC_ORIGIN);
  return payload === undefined ? req : req.send(payload as object);
};

beforeAll(async () => {
  const databaseUrl = inject("databaseUrl");
  db = createDb(databaseUrl);
  const owner = await db.user.create({ data: { login: "az-owner", githubId: 81_001n } });
  const viewer = await db.user.create({ data: { login: "az-viewer", githubId: 81_002n } });
  const outsider = await db.user.create({ data: { login: "az-outsider", githubId: 81_003n } });
  const org = await db.organization.create({
    data: {
      slug: "zure",
      name: "Zure",
      memberships: {
        create: [
          { userId: owner.id, role: "OWNER" },
          { userId: viewer.id, role: "VIEWER" },
        ],
      },
    },
  });
  await db.organization.create({
    data: {
      slug: "zure-rival",
      name: "Rival",
      memberships: { create: { userId: outsider.id, role: "OWNER" } },
    },
  });
  const project = await db.project.create({
    data: {
      orgId: org.id,
      slug: "shop",
      name: "Shop",
      services: { create: [{ slug: "shop", name: "Shop" }] },
      environments: {
        create: [
          { slug: "production", name: "Production", releaseBranch: "main" },
          { slug: "staging", name: "Staging", releaseBranch: "main" },
        ],
      },
    },
  });
  projectId = project.id;

  t = await createTestApp(
    testConfig(databaseUrl, { AZURE_PROVIDER_MODE: "simulated" }, inject("redisUrl")),
  );
  ownerCookie = await t.sessionCookie(owner.id);
  viewerCookie = await t.sessionCookie(viewer.id);
  outsiderCookie = await t.sessionCookie(outsider.id);
});

beforeEach(async () => {
  await db.deploymentTarget.deleteMany({ where: { projectId } });
  await db.integration.deleteMany({ where: { projectId } });
  await db.deployment.deleteMany({ where: { service: { projectId } } });
});

afterAll(async () => {
  await t.close();
  await db.$disconnect();
});

describe("connecting a deployment target", () => {
  it("lets an owner connect a container app and queues the first sync", async () => {
    const queue = createDeploymentSyncQueue(inject("redisUrl"));
    try {
      const res = await post(TARGETS, ownerCookie, body()).expect(201);
      const created = res.body as DeploymentTargetItem;
      expect(created).toMatchObject({
        provider: "azure-container-apps",
        service: { slug: "shop" },
        environment: { slug: "production" },
        subscriptionId: SUB,
        resourceGroup: "releaselens-demo",
        containerApp: "storefront-api",
        containerName: null,
        lastObservedAt: null,
      });
      expect(created.portalUrl).toMatch(
        /^https:\/\/portal\.azure\.com\/#resource\/subscriptions\/0{8}-.*\/containerApps\/storefront-api\/revisionManagement$/,
      );

      const jobs = await queue.getJobs(["waiting", "delayed", "prioritized"]);
      expect(jobs.map((j) => j.data)).toContainEqual({ projectId });

      const audit = await db.auditEvent.findFirstOrThrow({
        where: { action: "deployment-target.created", targetId: created.id },
      });
      expect(audit.metadata).toMatchObject({ containerApp: "storefront-api" });
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });

  it("shows targets, sync status and the Azure mode on the project", async () => {
    await post(TARGETS, ownerCookie, body()).expect(201);
    const res = await http().get(BASE).set("Cookie", viewerCookie).expect(200);
    const detail = res.body as ProjectDetail;
    expect(detail.azureMode).toBe("simulated");
    expect(detail.deploymentTargets).toHaveLength(1);
    // Connected but never read: freshness is shown as "never", not as healthy.
    expect(detail.integrations).toContainEqual({
      provider: "azure-container-apps",
      status: "connected",
      lastAttemptAt: null,
      lastSuccessfulSyncAt: null,
      lastErrorKind: null,
    });
  });

  it("normalises the subscription ID and accepts an optional container name", async () => {
    const res = await post(
      TARGETS,
      ownerCookie,
      body({ subscriptionId: SUB.replace(/0/g, "A"), containerName: "api" }),
    ).expect(201);
    expect(res.body).toMatchObject({
      subscriptionId: SUB.replace(/0/g, "a"),
      containerName: "api",
    });
  });

  it("allows one target per service and environment", async () => {
    await post(TARGETS, ownerCookie, body()).expect(201);
    const res = await post(TARGETS, ownerCookie, body({ containerApp: "other-app" })).expect(409);
    expect((res.body as { message: string }).message).toContain("already has a deployment target");
    await post(TARGETS, ownerCookie, body({ environment: "staging" })).expect(201);
  });

  it.each([
    ["an invalid subscription", { subscriptionId: "not-a-guid" }],
    ["a path in the resource group", { resourceGroup: "rg/../../other" }],
    ["an uppercase app name", { containerApp: "Storefront" }],
    ["an app name with a slash", { containerApp: "a/b" }],
    ["unknown fields", { extra: true }],
    ["a missing app name", { containerApp: undefined }],
  ])("rejects %s", async (_label, overrides) => {
    await post(TARGETS, ownerCookie, body(overrides)).expect(400);
    expect(await db.deploymentTarget.count({ where: { projectId } })).toBe(0);
  });

  it("rejects services and environments from outside the project", async () => {
    await post(TARGETS, ownerCookie, body({ service: "nope" })).expect(404);
    await post(TARGETS, ownerCookie, body({ environment: "nope" })).expect(404);
  });

  it("only lets owners manage targets, and hides the project from other organizations", async () => {
    await post(TARGETS, viewerCookie, body()).expect(403);
    await post(TARGETS, outsiderCookie, body()).expect(404);
    await post(TARGETS, ownerCookie, body()).expect(201);
    await post(`${TARGETS}/sync`, viewerCookie).expect(403);
    await post(`${TARGETS}/sync`, outsiderCookie).expect(404);
  });

  it("requires a same-origin request", async () => {
    await http().post(TARGETS).set("Cookie", ownerCookie).send(body()).expect(403);
    await http()
      .post(TARGETS)
      .set("Cookie", ownerCookie)
      .set("Origin", "https://evil.example")
      .send(body())
      .expect(403);
  });
});

describe("syncing and removing", () => {
  it("queues a sync on request, and 404s when there is nothing to sync", async () => {
    await post(`${TARGETS}/sync`, ownerCookie).expect(404);
    await post(TARGETS, ownerCookie, body()).expect(201);
    const res = await post(`${TARGETS}/sync`, ownerCookie).expect(202);
    expect(res.body).toEqual({ queued: true });
  });

  it("removes a target, keeps history, and stops treating any revision as serving", async () => {
    const created = (await post(TARGETS, ownerCookie, body()).expect(201))
      .body as DeploymentTargetItem;
    const service = await db.service.findFirstOrThrow({ where: { projectId } });
    const environment = await db.environment.findFirstOrThrow({
      where: { projectId, slug: "production" },
    });
    await db.deployment.create({
      data: {
        serviceId: service.id,
        environmentId: environment.id,
        revisionName: "storefront-api--r1",
        imageReference: "acr.io/storefront-api:1",
        activeSince: new Date(),
        providerStatus: "running",
        isActive: true,
        observedAt: new Date(),
      },
    });

    await http()
      .delete(`${TARGETS}/${created.id}`)
      .set("Cookie", viewerCookie)
      .set("Origin", PUBLIC_ORIGIN)
      .expect(403);
    await http()
      .delete(`${TARGETS}/${created.id}`)
      .set("Cookie", ownerCookie)
      .set("Origin", PUBLIC_ORIGIN)
      .expect(204);

    expect(await db.deploymentTarget.count({ where: { projectId } })).toBe(0);
    expect(await db.deployment.findMany({ where: { serviceId: service.id } })).toMatchObject([
      { revisionName: "storefront-api--r1", isActive: false },
    ]);
    // The last target is gone, so the Azure freshness card goes too.
    expect(
      await db.integration.count({ where: { projectId, provider: "AZURE_CONTAINER_APPS" } }),
    ).toBe(0);
    await http()
      .delete(`${TARGETS}/${created.id}`)
      .set("Cookie", ownerCookie)
      .set("Origin", PUBLIC_ORIGIN)
      .expect(404);
  });

  it("cannot remove another project's target", async () => {
    const otherOrg = await db.organization.findUniqueOrThrow({ where: { slug: "zure-rival" } });
    const other = await db.project.create({
      data: {
        orgId: otherOrg.id,
        slug: "secret",
        name: "Secret",
        services: { create: { slug: "secret", name: "Secret" } },
        environments: { create: { slug: "production", name: "Production", releaseBranch: "main" } },
      },
      include: { services: true, environments: true },
    });
    const foreign = await db.deploymentTarget.create({
      data: {
        projectId: other.id,
        serviceId: other.services[0]?.id ?? "",
        environmentId: other.environments[0]?.id ?? "",
        subscriptionId: SUB,
        resourceGroup: "rg",
        resourceName: "secret-app",
      },
    });
    await http()
      .delete(`${TARGETS}/${foreign.id}`)
      .set("Cookie", ownerCookie)
      .set("Origin", PUBLIC_ORIGIN)
      .expect(404);
    expect(await db.deploymentTarget.count({ where: { id: foreign.id } })).toBe(1);
  });

  it("reports the deployment traffic weight", async () => {
    const service = await db.service.findFirstOrThrow({ where: { projectId } });
    const environment = await db.environment.findFirstOrThrow({
      where: { projectId, slug: "production" },
    });
    await db.deployment.create({
      data: {
        serviceId: service.id,
        environmentId: environment.id,
        revisionName: "shop--blue",
        imageReference: "acr.io/shop:1",
        activeSince: new Date(),
        providerStatus: "running",
        trafficWeight: 80,
        isActive: true,
        observedAt: new Date(),
      },
    });
    const res = await http().get(`${BASE}/deployments`).set("Cookie", viewerCookie).expect(200);
    expect(res.body).toMatchObject([{ revisionName: "shop--blue", trafficWeight: 80 }]);
  });
});
