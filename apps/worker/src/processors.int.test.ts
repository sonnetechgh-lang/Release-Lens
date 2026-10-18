import { createDb, type Db } from "@releaselens/db";
import { ProviderError } from "@releaselens/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { reconcileAll, reconcileProject } from "./processors/reconcile.js";
import { sweep } from "./processors/sweep.js";
import { InvalidPayloadError, processDelivery } from "./processors/webhook.js";
import {
  INSTALLATION_ID,
  NOW,
  SHA_B,
  createConnectedProject,
  githubRun,
  installationPayload,
  storeDelivery,
  testDeps,
  workflowRunPayload,
  type TestProjectRefs,
} from "./test-support/fixtures.js";

let db: Db;
let refs: TestProjectRefs;

beforeAll(() => {
  db = createDb(inject("databaseUrl"));
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.webhookDelivery.deleteMany();
  await db.project.deleteMany();
  refs = await createConnectedProject(db);
});

const runs = () => db.workflowRun.findMany({ where: { projectId: refs.projectId } });
const integration = () =>
  db.integration.findFirstOrThrow({ where: { projectId: refs.projectId, provider: "GITHUB" } });

describe("workflow_run deliveries", () => {
  it("stores the run, marks GitHub data fresh, and clears the stored payload", async () => {
    const deps = testDeps(db);
    const id = await storeDelivery(db, "workflow_run", workflowRunPayload(githubRun()));

    expect(await processDelivery(deps, id)).toBe("processed");
    expect(await runs()).toMatchObject([
      { externalId: "7001", status: "completed", conclusion: "success", branch: "main" },
    ]);
    expect((await integration()).lastSuccessfulSyncAt).toEqual(NOW);
    const delivery = await db.webhookDelivery.findUniqueOrThrow({ where: { deliveryId: id } });
    expect(delivery).toMatchObject({ status: "processed", payload: null, attempts: 1 });
  });

  it("is idempotent: processing the same delivery twice changes nothing (fault scenario 7)", async () => {
    const deps = testDeps(db);
    const id = await storeDelivery(db, "workflow_run", workflowRunPayload(githubRun()));
    await processDelivery(deps, id);
    expect(await processDelivery(deps, id)).toBe("skipped");
    expect(await runs()).toHaveLength(1);
  });

  it("keeps one row per run across separate deliveries of the same run", async () => {
    const deps = testDeps(db);
    await processDelivery(
      deps,
      await storeDelivery(db, "workflow_run", workflowRunPayload(githubRun())),
    );
    await processDelivery(
      deps,
      await storeDelivery(db, "workflow_run", workflowRunPayload(githubRun())),
    );
    expect(await runs()).toHaveLength(1);
  });

  it("ignores events that arrive out of order", async () => {
    const deps = testDeps(db);
    const completed = githubRun();
    const olderInProgress = githubRun({
      status: "in_progress",
      conclusion: null,
      updated_at: "2026-10-18T11:05:00Z",
    });
    await processDelivery(
      deps,
      await storeDelivery(db, "workflow_run", workflowRunPayload(completed)),
    );
    await processDelivery(
      deps,
      await storeDelivery(db, "workflow_run", workflowRunPayload(olderInProgress)),
    );
    expect(await runs()).toMatchObject([{ status: "completed", conclusion: "success" }]);
  });

  it("re-runs diagnostics, so a failed release run becomes a finding", async () => {
    const deps = testDeps(db);
    await processDelivery(
      deps,
      await storeDelivery(db, "workflow_run", workflowRunPayload(githubRun())),
    );
    const failed = githubRun({
      id: 7002,
      head_sha: SHA_B,
      conclusion: "failure",
      run_started_at: "2026-10-18T11:30:00Z",
      updated_at: "2026-10-18T11:40:00Z",
    });
    await processDelivery(
      deps,
      await storeDelivery(db, "workflow_run", workflowRunPayload(failed)),
    );

    const findings = await db.diagnosticFinding.findMany({ where: { projectId: refs.projectId } });
    expect(findings).toMatchObject([{ ruleId: "workflow.failed", state: "OPEN" }]);
  });

  it("ignores repositories that are not connected", async () => {
    const id = await storeDelivery(
      db,
      "workflow_run",
      workflowRunPayload(githubRun(), { repoId: 999 }),
    );
    expect(await processDelivery(testDeps(db), id)).toBe("ignored");
    expect(await runs()).toHaveLength(0);
  });

  it("requires the installation to match, not just the repository ID", async () => {
    const id = await storeDelivery(
      db,
      "workflow_run",
      workflowRunPayload(githubRun(), { installationId: 1 }),
    );
    expect(await processDelivery(testDeps(db), id)).toBe("ignored");
    expect(await runs()).toHaveLength(0);
  });

  it("rejects malformed payloads without retrying and keeps them for debugging", async () => {
    const id = await storeDelivery(db, "workflow_run", {
      action: "completed",
      workflow_run: { id: "x" },
    });
    await expect(processDelivery(testDeps(db), id)).rejects.toBeInstanceOf(InvalidPayloadError);
    const delivery = await db.webhookDelivery.findUniqueOrThrow({ where: { deliveryId: id } });
    expect(delivery).toMatchObject({ status: "failed", lastErrorKind: "invalid-payload" });
    expect(delivery.payload).not.toBeNull();
  });

  it("accepts but ignores events it does not use yet", async () => {
    expect(
      await processDelivery(testDeps(db), await storeDelivery(db, "ping", { zen: "hi" })),
    ).toBe("ignored");
    expect(await processDelivery(testDeps(db), await storeDelivery(db, "push", {}))).toBe(
      "ignored",
    );
  });
});

describe("installation deliveries", () => {
  it("marks projects disconnected when the app is uninstalled", async () => {
    await processDelivery(
      testDeps(db),
      await storeDelivery(db, "installation", installationPayload("deleted")),
    );
    expect((await integration()).status).toBe("disconnected");
    const installation = await db.githubInstallation.findUniqueOrThrow({
      where: { installationId: BigInt(INSTALLATION_ID) },
    });
    expect(installation.deletedAt).toEqual(NOW);
  });

  it("tracks suspension and reconciles after it is lifted", async () => {
    const deps = testDeps(db);
    await processDelivery(
      deps,
      await storeDelivery(db, "installation", installationPayload("suspend")),
    );
    expect((await integration()).status).toBe("suspended");
    await processDelivery(
      deps,
      await storeDelivery(db, "installation", installationPayload("unsuspend")),
    );
    expect((await integration()).status).toBe("connected");
    expect(deps.enqueueReconcile).toHaveBeenCalledWith(refs.projectId);
  });

  it("disconnects a project whose repository is removed from the installation", async () => {
    const payload = { ...installationPayload("removed"), repositories_removed: [{ id: 555 }] };
    await processDelivery(
      testDeps(db),
      await storeDelivery(db, "installation_repositories", payload),
    );
    expect((await integration()).status).toBe("disconnected");
  });
});

describe("reconciliation", () => {
  it("fills in runs from the GitHub API and marks the data fresh", async () => {
    const listWorkflowRuns = vi
      .fn()
      .mockResolvedValue([githubRun(), githubRun({ id: 7002, head_sha: SHA_B })]);
    const deps = testDeps(db, { github: { listWorkflowRuns } });

    expect(await reconcileProject(deps, refs.projectId)).toEqual({
      status: "synced",
      runs: 2,
      changed: 2,
    });
    expect(listWorkflowRuns).toHaveBeenCalledWith(INSTALLATION_ID, "acme/shop");
    expect(await runs()).toHaveLength(2);
    expect(await integration()).toMatchObject({ lastSuccessfulSyncAt: NOW, lastErrorKind: null });

    // Same data again: nothing changes.
    expect(await reconcileProject(deps, refs.projectId)).toEqual({
      status: "synced",
      runs: 2,
      changed: 0,
    });
  });

  it("records rate limits, keeps the old sync time, and asks for a retry", async () => {
    const earlier = new Date("2026-10-18T10:00:00Z");
    await db.integration.updateMany({
      where: { projectId: refs.projectId },
      data: { lastSuccessfulSyncAt: earlier },
    });
    const error = new ProviderError("rate-limited", "rate limited", 403, 60_000);
    const deps = testDeps(db, { github: { listWorkflowRuns: vi.fn().mockRejectedValue(error) } });

    await expect(reconcileProject(deps, refs.projectId)).rejects.toBe(error);
    expect(await integration()).toMatchObject({
      lastErrorKind: "rate-limited",
      lastAttemptAt: NOW,
      lastSuccessfulSyncAt: earlier,
    });
  });

  it("does not retry permanent errors such as missing permissions", async () => {
    const deps = testDeps(db, {
      github: {
        listWorkflowRuns: vi.fn().mockRejectedValue(new ProviderError("forbidden", "no", 403)),
      },
    });
    expect(await reconcileProject(deps, refs.projectId)).toEqual({
      status: "failed",
      errorKind: "forbidden",
    });
  });

  it("reports stale GitHub data as a finding when syncing keeps failing", async () => {
    await db.integration.updateMany({
      where: { projectId: refs.projectId },
      data: { lastSuccessfulSyncAt: new Date("2026-10-18T09:00:00Z") },
    });
    const deps = testDeps(db, {
      github: {
        listWorkflowRuns: vi.fn().mockRejectedValue(new ProviderError("unauthorized", "no", 401)),
      },
    });
    await reconcileProject(deps, refs.projectId);
    const findings = await db.diagnosticFinding.findMany({ where: { projectId: refs.projectId } });
    expect(findings.map((f) => f.ruleId)).toContain("evidence.stale");
  });

  it("skips suspended installations and does not call GitHub", async () => {
    await db.githubInstallation.update({
      where: { id: refs.installationRowId },
      data: { suspendedAt: NOW },
    });
    const listWorkflowRuns = vi.fn();
    const outcome = await reconcileProject(
      testDeps(db, { github: { listWorkflowRuns } }),
      refs.projectId,
    );
    expect(outcome).toEqual({ status: "skipped", reason: "installation suspended" });
    expect(listWorkflowRuns).not.toHaveBeenCalled();
    expect((await integration()).status).toBe("suspended");
  });

  it("queues every connected project", async () => {
    const deps = testDeps(db);
    expect(await reconcileAll(deps)).toBe(1);
    expect(deps.enqueueReconcile).toHaveBeenCalledWith(refs.projectId);
  });
});

describe("sweep", () => {
  it("re-queues stuck deliveries and deletes expired ones", async () => {
    const stuck = await storeDelivery(db, "workflow_run", workflowRunPayload(githubRun()));
    await db.webhookDelivery.update({
      where: { deliveryId: stuck },
      data: { receivedAt: new Date(NOW.getTime() - 5 * 60_000) },
    });
    const old = await storeDelivery(db, "ping", {});
    await db.webhookDelivery.update({
      where: { deliveryId: old },
      data: { status: "ignored", receivedAt: new Date(NOW.getTime() - 40 * 24 * 60 * 60_000) },
    });

    const deps = testDeps(db);
    expect(await sweep(deps)).toEqual({ requeued: 1, deleted: 1 });
    expect(deps.enqueueDelivery).toHaveBeenCalledWith(stuck);
  });
});
