import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import {
  createReconcileQueue,
  createWebhookQueue,
  enqueueReconcile,
  enqueueWebhook,
  type GithubReconcileJob,
  type GithubWebhookJob,
} from "@releaselens/jobs";
import type { Queue } from "bullmq";
import { APP_CONFIG, type AppConfig } from "../config/config.js";

/** What the API needs from the job queues. */
export interface Jobs {
  enqueueDelivery(deliveryId: string): Promise<void>;
  enqueueReconcile(projectId: string): Promise<void>;
}

export const JOBS = Symbol("JOBS");

/** Queues are created on first use, so the API starts even if Redis is briefly unavailable. */
@Injectable()
export class BullJobs implements Jobs, OnApplicationShutdown {
  #webhooks: Queue<GithubWebhookJob> | undefined;
  #reconcile: Queue<GithubReconcileJob> | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async enqueueDelivery(deliveryId: string): Promise<void> {
    this.#webhooks ??= createWebhookQueue(this.config.redisUrl);
    await enqueueWebhook(this.#webhooks, deliveryId);
  }

  async enqueueReconcile(projectId: string): Promise<void> {
    this.#reconcile ??= createReconcileQueue(this.config.redisUrl);
    await enqueueReconcile(this.#reconcile, projectId);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.#webhooks?.close(), this.#reconcile?.close()]);
  }
}

@Global()
@Module({
  providers: [{ provide: JOBS, useClass: BullJobs }],
  exports: [JOBS],
})
export class JobsModule {}
