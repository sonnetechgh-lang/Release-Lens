import type { ContainerAppRef, RevisionObservation } from "../deployment-target.js";
import type { ArmRevision } from "./schemas.js";

const DIGEST = /@(sha256:[0-9a-f]{64})$/;

/** The digest an image reference is pinned to, or null for tag references. */
export function digestOf(imageReference: string): string | null {
  return DIGEST.exec(imageReference)?.[1] ?? null;
}

/**
 * Maps Azure's provisioning, running and health states to one status.
 * Anything not recognised becomes `unknown`, never `running`.
 */
export function revisionStatus(
  properties: ArmRevision["properties"],
): RevisionObservation["providerStatus"] {
  const provisioning = properties.provisioningState?.toLowerCase();
  const running = properties.runningState?.toLowerCase();

  if (provisioning === "failed" || running === "failed") return "failed";
  if (provisioning === "provisioning" || provisioning === "deprovisioning") return "provisioning";
  if (provisioning === "deprovisioned" || running === "stopped") return "stopped";
  if (properties.active === false) return "stopped";
  if (running === "processing" || running === "activating") return "provisioning";
  if (running === "degraded" || properties.healthState?.toLowerCase() === "unhealthy") {
    return "degraded";
  }
  if (running === "running" || running === "runningatmaxscale") return "running";
  return "unknown";
}

/** The container whose image identifies the release. */
function primaryImage(revision: ArmRevision, target: ContainerAppRef): string | null {
  const containers = revision.properties.template?.containers ?? [];
  const wanted = target.containerName ?? target.name;
  const container = containers.find((c) => c.name === wanted) ?? containers[0];
  return container?.image ?? null;
}

export function portalUrl(target: ContainerAppRef): string {
  return (
    "https://portal.azure.com/#resource/subscriptions/" +
    `${target.subscriptionId}/resourceGroups/${target.resourceGroup}` +
    `/providers/Microsoft.App/containerApps/${target.name}/revisionManagement`
  );
}

/**
 * Turns Azure revisions into observations and marks the one serving traffic:
 * the active revision with the highest traffic weight, newest first on a tie.
 * Apps without ingress report no weights, so the newest active revision wins.
 * A revision without an image (or a named container that does not exist) is
 * skipped, since nothing about it can be verified.
 */
export function toRevisionObservations(
  revisions: ArmRevision[],
  target: ContainerAppRef,
): RevisionObservation[] {
  const url = portalUrl(target);
  const observations = revisions.flatMap((revision): RevisionObservation[] => {
    const image = primaryImage(revision, target);
    if (image === null) return [];
    const p = revision.properties;
    return [
      {
        revisionName: revision.name,
        imageReference: image,
        imageDigest: digestOf(image),
        activeSince: new Date(p.createdTime),
        providerStatus: revisionStatus(p),
        trafficWeight: p.trafficWeight ?? null,
        isServing: false,
        url,
      },
    ];
  });

  const active = new Set(revisions.filter((r) => r.properties.active === true).map((r) => r.name));
  const serving = observations
    .filter((o) => active.has(o.revisionName) && o.providerStatus !== "failed")
    .sort(
      (a, b) =>
        (b.trafficWeight ?? 0) - (a.trafficWeight ?? 0) ||
        b.activeSince.getTime() - a.activeSince.getTime(),
    )[0];
  if (serving !== undefined) serving.isServing = true;

  return observations.sort((a, b) => b.activeSince.getTime() - a.activeSince.getTime());
}
