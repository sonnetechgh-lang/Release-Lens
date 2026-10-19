import type { Db } from "./client.js";

/** A revision in storage form (see `RevisionObservation` in @releaselens/integrations). */
export interface RevisionUpsert {
  revisionName: string;
  imageReference: string;
  imageDigest: string | null;
  activeSince: Date;
  providerStatus: string;
  trafficWeight: number | null;
  /** The revision serving most traffic. At most one per call. */
  isServing: boolean;
  url: string | null;
}

/**
 * Stores what a deployment target reported in one transaction:
 * - each revision is inserted or updated by name;
 * - exactly the serving revision is marked active, every other one inactive,
 *   including revisions Azure no longer lists (they stay as history).
 * Returns the number of revisions written.
 */
export async function applyRevisions(
  db: Db,
  scope: { serviceId: string; environmentId: string },
  revisions: RevisionUpsert[],
  observedAt: Date,
): Promise<number> {
  if (revisions.filter((r) => r.isServing).length > 1) {
    throw new Error("At most one revision can be serving");
  }
  const { serviceId, environmentId } = scope;
  await db.$transaction(async (tx) => {
    await tx.deployment.updateMany({
      where: { serviceId, environmentId, isActive: true },
      data: { isActive: false },
    });
    for (const r of revisions) {
      const data = {
        imageReference: r.imageReference,
        imageDigest: r.imageDigest,
        activeSince: r.activeSince,
        providerStatus: r.providerStatus,
        trafficWeight: r.trafficWeight,
        isActive: r.isServing,
        url: r.url,
        observedAt,
      };
      await tx.deployment.upsert({
        where: {
          serviceId_environmentId_revisionName: {
            serviceId,
            environmentId,
            revisionName: r.revisionName,
          },
        },
        create: { serviceId, environmentId, revisionName: r.revisionName, ...data },
        update: data,
      });
    }
  });
  return revisions.length;
}

/**
 * Stops trusting the active revision of a service in an environment, e.g. when its
 * deployment target is removed. History stays; nothing is marked as serving.
 */
export async function deactivateDeployments(
  db: Db,
  scope: { serviceId: string; environmentId: string },
): Promise<void> {
  await db.deployment.updateMany({
    where: { ...scope, isActive: true },
    data: { isActive: false },
  });
}
