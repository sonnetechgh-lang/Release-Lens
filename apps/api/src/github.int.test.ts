import { randomUUID } from "node:crypto";
import type { GithubSetupResponse } from "@releaselens/contracts";
import { createDb, type Db } from "@releaselens/db";
import { signWebhookBody } from "@releaselens/integrations";
import { createReconcileQueue, createWebhookQueue } from "@releaselens/jobs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  PUBLIC_ORIGIN,
  WEBHOOK_SECRET,
  createTestApp,
  testConfig,
  type TestApp,
} from "./test-support/app.js";

let t: TestApp;
let db: Db;
let ownerCookie: string;
let viewerCookie: string;
let outsiderCookie: string;

const http = () => request(t.app.getHttpServer());

beforeAll(async () => {
  const databaseUrl = inject("databaseUrl");
  db = createDb(databaseUrl);
  const owner = await db.user.create({ data: { login: "gh-owner", githubId: 71_001n } });
  const viewer = await db.user.create({ data: { login: "gh-viewer", githubId: 71_002n } });
  const outsider = await db.user.create({ data: { login: "gh-outsider", githubId: 71_003n } });
  await db.organization.create({
    data: {
      slug: "acme",
      name: "Acme",
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
      slug: "rival",
      name: "Rival",
      memberships: { create: { userId: outsider.id, role: "OWNER" } },
    },
  });

  t = await createTestApp(testConfig(databaseUrl, {}, inject("redisUrl")));
  t.githubApp.add(4242, "acme", [
    { id: 555, name: "shop" },
    { id: 556, name: "Billing Service" },
  ]);
  t.githubApp.add(5151, "rival", [{ id: 777, name: "secret" }]);
  ownerCookie = await t.sessionCookie(owner.id);
  viewerCookie = await t.sessionCookie(viewer.id);
  outsiderCookie = await t.sessionCookie(outsider.id);
});

afterAll(async () => {
  await t.close();
  await db.$disconnect();
});

function sendWebhook(body: string, headers: Record<string, string | undefined> = {}) {
  let req = http().post("/api/webhooks/github").set("Content-Type", "application/json");
  const all: Record<string, string | undefined> = {
    "X-GitHub-Event": "workflow_run",
    "X-GitHub-Delivery": randomUUID(),
    "X-Hub-Signature-256": signWebhookBody(WEBHOOK_SECRET, body),
    ...headers,
  };
  for (const [key, value] of Object.entries(all)) {
    if (value !== undefined) req = req.set(key, value);
  }
  return req.send(body);
}

const PAYLOAD = JSON.stringify({
  action: "completed",
  installation: { id: 4242 },
  repository: { id: 555, full_name: "acme/shop" },
  workflow_run: { id: 1 },
});

describe("GitHub webhook intake", () => {
  it("rejects missing and wrong signatures without storing anything", async () => {
    const before = await db.webhookDelivery.count();
    await sendWebhook(PAYLOAD, { "X-Hub-Signature-256": undefined }).expect(401);
    await sendWebhook(PAYLOAD, {
      "X-Hub-Signature-256": signWebhookBody("wrong-secret", PAYLOAD),
    }).expect(401);
    // Signed body, then tampered with.
    await sendWebhook(PAYLOAD.replace("completed", "requested"), {
      "X-Hub-Signature-256": signWebhookBody(WEBHOOK_SECRET, PAYLOAD),
    }).expect(401);
    expect(await db.webhookDelivery.count()).toBe(before);
  });

  it("stores a signed delivery and queues it, without needing a session or origin", async () => {
    const deliveryId = randomUUID();
    const res = await sendWebhook(PAYLOAD, { "X-GitHub-Delivery": deliveryId }).expect(202);
    expect(res.body).toEqual({ status: "accepted" });

    const stored = await db.webhookDelivery.findUniqueOrThrow({ where: { deliveryId } });
    expect(stored).toMatchObject({
      event: "workflow_run",
      action: "completed",
      installationId: 4242n,
      repositoryId: 555n,
      status: "received",
    });

    const queue = createWebhookQueue(inject("redisUrl"));
    try {
      expect(await queue.getJob(`delivery-${deliveryId}`)).toBeDefined();
    } finally {
      await queue.close();
    }
  });

  it("acknowledges a redelivery without storing it twice (fault scenario 7)", async () => {
    const deliveryId = randomUUID();
    await sendWebhook(PAYLOAD, { "X-GitHub-Delivery": deliveryId }).expect(202);
    const again = await sendWebhook(PAYLOAD, { "X-GitHub-Delivery": deliveryId }).expect(200);
    expect(again.body).toEqual({ status: "duplicate" });
    expect(await db.webhookDelivery.count({ where: { deliveryId } })).toBe(1);
  });

  it("rejects bad headers and bodies after the signature check", async () => {
    await sendWebhook(PAYLOAD, { "X-GitHub-Delivery": "not a uuid!" }).expect(400);
    await sendWebhook(PAYLOAD, { "X-GitHub-Event": "Bad-Event" }).expect(400);
    await sendWebhook("{not json").expect(400);
  });

  it("refuses oversized payloads", async () => {
    const huge = JSON.stringify({ action: "x", blob: "a".repeat(6 * 1024 * 1024) });
    await sendWebhook(huge).expect(413);
  });
});

describe("GitHub setup (owners only)", () => {
  it("is limited to owners of the organization", async () => {
    await http().get("/api/orgs/acme/github").expect(401);
    await http().get("/api/orgs/acme/github").set("Cookie", viewerCookie).expect(403);
    await http().get("/api/orgs/acme/github").set("Cookie", outsiderCookie).expect(404);
  });

  it("lists installations, repositories, and the install link", async () => {
    const res = await http().get("/api/orgs/acme/github").set("Cookie", ownerCookie).expect(200);
    const body = res.body as GithubSetupResponse;
    expect(body.appConfigured).toBe(true);
    expect(body.installUrl).toBe("https://github.com/apps/releaselens-test/installations/new");
    const acme = body.installations.find((i) => i.installationId === 4242);
    expect(acme?.repositories.map((r) => [r.fullName, r.connectedProject])).toEqual([
      ["acme/Billing Service", null],
      ["acme/shop", null],
    ]);
  });
});

describe("connecting a repository", () => {
  const create = (body: object, cookie = ownerCookie) =>
    http()
      .post("/api/orgs/acme/projects")
      .set("Cookie", cookie)
      .set("Origin", PUBLIC_ORIGIN)
      .send(body);

  it("creates a project, links the installation, and queues the first sync", async () => {
    const res = await create({
      installationId: 4242,
      repositoryId: 555,
      deployWorkflowName: "deploy",
    }).expect(201);
    expect(res.body).toEqual({ org: { slug: "acme", name: "Acme" }, slug: "shop" });

    const project = await db.project.findFirstOrThrow({
      where: { slug: "shop", org: { slug: "acme" } },
      include: { environments: true, integrations: true, githubInstallation: true, services: true },
    });
    expect(project).toMatchObject({ repository: "acme/shop", githubRepositoryId: 555n });
    expect(project.environments).toMatchObject([
      { slug: "production", releaseBranch: "main", deployWorkflowName: "deploy" },
    ]);
    expect(project.integrations).toMatchObject([{ provider: "GITHUB", status: "connected" }]);
    expect(project.githubInstallation?.installationId).toBe(4242n);
    expect(project.services).toHaveLength(1);

    const queue = createReconcileQueue(inject("redisUrl"));
    try {
      const jobs = await queue.getJobs(["waiting", "delayed", "prioritized"]);
      expect(jobs.some((j) => j.data.projectId === project.id)).toBe(true);
    } finally {
      await queue.close();
    }
    expect(
      await db.auditEvent.count({ where: { action: "project.created", targetId: project.id } }),
    ).toBe(1);
  });

  it("makes a unique slug from awkward repository names", async () => {
    const res = await create({ installationId: 4242, repositoryId: 556 }).expect(201);
    expect(res.body.slug).toBe("billing-service");
  });

  it("refuses to connect the same repository twice", async () => {
    await create({ installationId: 4242, repositoryId: 555 }).expect(409);
  });

  it("refuses repositories the installation cannot access", async () => {
    await create({ installationId: 4242, repositoryId: 777 }).expect(404);
    await create({ installationId: 9999, repositoryId: 555 }).expect(404);
  });

  it("does not let another organization take over a linked installation", async () => {
    const res = await http()
      .post("/api/orgs/rival/projects")
      .set("Cookie", outsiderCookie)
      .set("Origin", PUBLIC_ORIGIN)
      .send({ installationId: 4242, repositoryId: 556 })
      .expect(409);
    expect(res.body.message).toMatch(/another organization/);

    const setup = await http()
      .get("/api/orgs/rival/github")
      .set("Cookie", outsiderCookie)
      .expect(200);
    expect((setup.body as GithubSetupResponse).installations.map((i) => i.installationId)).toEqual([
      5151,
    ]);
  });

  it("validates the request body", async () => {
    await create({ installationId: 4242, repositoryId: 556, releaseBranch: "../etc" }).expect(400);
    await create({ installationId: 4242, repositoryId: 556, unexpected: true }).expect(400);
    await create({ installationId: "4242", repositoryId: 556 }).expect(400);
  });

  it("requires the dashboard origin and owner role", async () => {
    await http()
      .post("/api/orgs/acme/projects")
      .set("Cookie", ownerCookie)
      .send({ installationId: 4242, repositoryId: 556 })
      .expect(403);
    await create({ installationId: 4242, repositoryId: 556 }, viewerCookie).expect(403);
  });

  it("shows connected repositories in the setup listing", async () => {
    const res = await http().get("/api/orgs/acme/github").set("Cookie", ownerCookie).expect(200);
    const repos = (res.body as GithubSetupResponse).installations[0]?.repositories ?? [];
    expect(repos.find((r) => r.id === 555)?.connectedProject).toBe("shop");
  });
});

describe("request body errors", () => {
  it("returns 400, not 500, for malformed JSON on regular routes", async () => {
    const res = await http()
      .post("/api/orgs/acme/projects")
      .set("Cookie", ownerCookie)
      .set("Origin", PUBLIC_ORIGIN)
      .set("Content-Type", "application/json")
      .send("{oops")
      .expect(400);
    expect(res.body.statusCode).toBe(400);
  });
});
