import type { WorkerDeps } from "../deps.js";

/** Deliveries still unprocessed after this long are queued again (e.g. Redis lost the job). */
const STUCK_AFTER_MS = 2 * 60 * 1000;
/** Delivery records are kept this long for auditing, then deleted. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Housekeeping, run every minute:
 * - re-enqueues deliveries stored in PostgreSQL but never processed
 *   (the database, not Redis, is the source of truth);
 * - deletes old delivery records.
 */
export async function sweep(deps: WorkerDeps): Promise<{ requeued: number; deleted: number }> {
  const now = deps.now().getTime();
  const stuck = await deps.db.webhookDelivery.findMany({
    where: { status: "received", receivedAt: { lt: new Date(now - STUCK_AFTER_MS) } },
    select: { deliveryId: true },
    take: 500,
  });
  for (const { deliveryId } of stuck) await deps.enqueueDelivery(deliveryId);

  const { count } = await deps.db.webhookDelivery.deleteMany({
    where: { receivedAt: { lt: new Date(now - RETENTION_MS) } },
  });
  if (stuck.length > 0 || count > 0) {
    deps.log.info({ requeued: stuck.length, deleted: count }, "Delivery sweep");
  }
  return { requeued: stuck.length, deleted: count };
}
