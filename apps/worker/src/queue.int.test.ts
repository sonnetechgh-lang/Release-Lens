import { createDb, type Db } from "@releaselens/db";
import { createWebhookQueue, enqueueWebhook } from "@releaselens/jobs";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { loadWorkerConfig } from "./config.js";
import {
  createConnectedProject,
  githubRun,
  storeDelivery,
  workflowRunPayload,
} from "./test-support/fixtures.js";
import { startWorker, type RunningWorker } from "./worker.js";

let db: Db;
let worker: RunningWorker;

beforeAll(async () => {
  const config = loadWorkerConfig({
    NODE_ENV: "test",
    DATABASE_URL: inject("databaseUrl"),
    REDIS_URL: inject("redisUrl"),
  });
  db = createDb(config.databaseUrl);
  await db.project.deleteMany();
  await createConnectedProject(db, "queued-shop");
  worker = await startWorker(config, pino({ level: "silent" }));
});

afterAll(async () => {
  await worker.close();
  await db.$disconnect();
});

async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the worker");
}

describe("worker with real Redis", () => {
  it("processes a queued delivery end to end, once, even if enqueued twice", async () => {
    const queue = createWebhookQueue(inject("redisUrl"));
    try {
      const id = await storeDelivery(
        db,
        "workflow_run",
        workflowRunPayload(githubRun({ id: 8100 })),
      );
      await enqueueWebhook(queue, id);
      await enqueueWebhook(queue, id);

      const delivery = await waitFor(async () => {
        const d = await db.webhookDelivery.findUnique({ where: { deliveryId: id } });
        return d?.status === "processed" ? d : undefined;
      });
      expect(delivery.attempts).toBe(1);
      expect(await db.workflowRun.count({ where: { externalId: "8100" } })).toBe(1);
    } finally {
      await queue.close();
    }
  });
});
