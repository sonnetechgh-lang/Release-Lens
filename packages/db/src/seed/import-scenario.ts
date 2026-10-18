import { parseSnapshot } from "@releaselens/contracts";
import type { Db } from "../client.js";
import { Prisma } from "../generated/prisma/client.js";
import { PROVIDER_TO_DB } from "../mapping.js";

export interface ScenarioProject {
  orgId: string;
  slug: string;
  name: string;
  description: string;
  /** Raw snapshot JSON from tests/fixtures/scenarios/<name>/snapshot.json. */
  snapshot: unknown;
}

export interface ImportedScenario {
  projectId: string;
  serviceId: string;
  environmentId: string;
  evaluatedAt: Date;
}

const date = (value: string) => new Date(value);

/**
 * Writes a fixture snapshot into the database as a project with one service and
 * one environment. Older successful builds become inactive revisions, so the
 * dashboard has a short, deterministic deployment history.
 */
export async function importScenario(db: Db, scenario: ScenarioProject): Promise<ImportedScenario> {
  const parsed = parseSnapshot(scenario.snapshot);
  if (!parsed.success) throw new Error(`Invalid scenario ${scenario.slug}:\n${parsed.error}`);
  const s = parsed.snapshot;
  const rawPolicy = (scenario.snapshot as { policy?: Prisma.InputJsonValue }).policy;

  return db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        orgId: scenario.orgId,
        slug: scenario.slug,
        name: scenario.name,
        description: scenario.description,
        repository: `example/${scenario.slug}`,
      },
    });
    const service = await tx.service.create({
      data: { projectId: project.id, slug: scenario.slug, name: scenario.name },
    });
    const environment = await tx.environment.create({
      data: {
        projectId: project.id,
        slug: s.environment.id,
        name: s.environment.name,
        releaseBranch: s.environment.releaseBranch,
        deployWorkflowName: s.environment.deployWorkflowName ?? null,
        policy: rawPolicy ?? Prisma.DbNull,
      },
    });

    await tx.integration.createMany({
      data: s.syncStatus.map((sync) => ({
        projectId: project.id,
        provider: PROVIDER_TO_DB[sync.provider],
        lastAttemptAt: sync.lastAttemptAt ? date(sync.lastAttemptAt) : null,
        lastSuccessfulSyncAt: sync.lastSuccessfulSyncAt ? date(sync.lastSuccessfulSyncAt) : null,
        lastErrorKind: sync.lastErrorKind ?? null,
      })),
    });

    await tx.workflowRun.createMany({
      data: s.workflowRuns.map((run) => ({
        projectId: project.id,
        externalId: run.runId,
        workflowName: run.workflowName,
        branch: run.branch,
        commitSha: run.commitSha,
        status: run.status,
        conclusion: run.conclusion ?? null,
        startedAt: date(run.startedAt),
        completedAt: run.completedAt ? date(run.completedAt) : null,
        producedImageDigest: run.producedImageDigest ?? null,
        url: run.url ?? null,
        observedAt: date(run.observedAt),
      })),
    });

    const active = s.deployment;
    if (active !== undefined) {
      // Earlier successful builds that finished before the active revision went live.
      const history = s.workflowRuns
        .filter(
          (run) =>
            run.conclusion === "success" &&
            run.producedImageDigest !== undefined &&
            run.producedImageDigest !== active.imageDigest &&
            run.completedAt !== undefined &&
            date(run.completedAt) < date(active.activeSince),
        )
        .map((run) => ({
          revisionName: `${scenario.slug}--r${run.runId}`,
          imageReference: `demoacr.azurecr.io/${scenario.slug}@${run.producedImageDigest ?? ""}`,
          imageDigest: run.producedImageDigest ?? null,
          activeSince: new Date(date(run.completedAt ?? run.startedAt).getTime() + 6 * 60_000),
        }));

      const activeName = active.revisionName.replace(/^.*--/, `${scenario.slug}--`);
      await tx.deployment.createMany({
        data: [
          ...history
            .filter((h) => h.revisionName !== activeName)
            .map((h) => ({
              ...h,
              serviceId: service.id,
              environmentId: environment.id,
              providerStatus: "stopped",
              isActive: false,
              observedAt: date(active.observedAt),
            })),
          {
            serviceId: service.id,
            environmentId: environment.id,
            revisionName: activeName,
            imageReference: active.imageReference.replace("storefront-api", scenario.slug),
            imageDigest: active.imageDigest ?? null,
            commitSha: active.commitSha ?? null,
            commitShaSource: active.commitShaSource ?? null,
            activeSince: date(active.activeSince),
            providerStatus: active.providerStatus,
            isActive: true,
            url: active.url ?? null,
            observedAt: date(active.observedAt),
          },
        ],
      });
    }

    await tx.healthCheckResult.createMany({
      data: s.healthChecks.map((check) => ({
        serviceId: service.id,
        environmentId: environment.id,
        endpoint: check.endpoint,
        outcome: check.outcome,
        httpStatus: check.httpStatus ?? null,
        durationMs: check.durationMs,
        failureKind: check.failureKind ?? null,
        observedAt: date(check.observedAt),
      })),
    });

    return {
      projectId: project.id,
      serviceId: service.id,
      environmentId: environment.id,
      evaluatedAt: date(s.evaluatedAt),
    };
  });
}
