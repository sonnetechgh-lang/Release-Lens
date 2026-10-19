import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { DeploymentTargetItem } from "@releaselens/contracts";
import { Prisma, deactivateDeployments, evaluateProject, iso, type Db } from "@releaselens/db";
import { portalUrl, type ContainerAppRef } from "@releaselens/integrations";
import { AuditService } from "../audit/audit.service.js";
import type { AuthUser } from "../auth/auth.types.js";
import { DB } from "../db/db.module.js";
import { JOBS, type Jobs } from "../jobs/jobs.module.js";
import type { ProjectAccess } from "../projects/access.service.js";

export interface CreateTarget {
  service: string;
  environment: string;
  ref: ContainerAppRef;
}

@Injectable()
export class DeploymentTargetsService {
  private readonly logger = new Logger(DeploymentTargetsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(JOBS) private readonly jobs: Jobs,
    private readonly audit: AuditService,
  ) {}

  async list(projectId: string): Promise<DeploymentTargetItem[]> {
    const targets = await this.db.deploymentTarget.findMany({
      where: { projectId },
      include: { service: true, environment: true },
      orderBy: { createdAt: "asc" },
    });
    if (targets.length === 0) return [];
    const observed = await this.db.deployment.groupBy({
      by: ["serviceId", "environmentId"],
      where: { serviceId: { in: targets.map((t) => t.serviceId) } },
      _max: { observedAt: true },
    });
    const lastObserved = new Map(
      observed.map((o) => [`${o.serviceId}/${o.environmentId}`, o._max.observedAt]),
    );

    return targets.map((t) => {
      const last = lastObserved.get(`${t.serviceId}/${t.environmentId}`) ?? null;
      return {
        id: t.id,
        provider: "azure-container-apps",
        service: { slug: t.service.slug, name: t.service.name },
        environment: { slug: t.environment.slug, name: t.environment.name },
        subscriptionId: t.subscriptionId,
        resourceGroup: t.resourceGroup,
        containerApp: t.resourceName,
        containerName: t.containerName,
        portalUrl: portalUrl({
          subscriptionId: t.subscriptionId,
          resourceGroup: t.resourceGroup,
          name: t.resourceName,
        }),
        lastObservedAt: last === null ? null : iso(last),
      };
    });
  }

  /**
   * Connects a container app to one service in one environment. Nothing is read
   * from Azure here; the worker reads it right after, and failures show up as sync status.
   */
  async create(
    access: ProjectAccess,
    user: AuthUser,
    request: CreateTarget,
  ): Promise<DeploymentTargetItem> {
    const { projectId } = access;
    const [service, environment] = await Promise.all([
      this.db.service.findFirst({ where: { projectId, slug: request.service } }),
      this.db.environment.findFirst({ where: { projectId, slug: request.environment } }),
    ]);
    if (service === null) throw new NotFoundException("Service not found in this project");
    if (environment === null) throw new NotFoundException("Environment not found in this project");

    let id: string;
    try {
      id = await this.db.$transaction(async (tx) => {
        const target = await tx.deploymentTarget.create({
          data: {
            projectId,
            serviceId: service.id,
            environmentId: environment.id,
            provider: "AZURE_CONTAINER_APPS",
            subscriptionId: request.ref.subscriptionId,
            resourceGroup: request.ref.resourceGroup,
            resourceName: request.ref.name,
            containerName: request.ref.containerName ?? null,
          },
        });
        await tx.integration.upsert({
          where: { projectId_provider: { projectId, provider: "AZURE_CONTAINER_APPS" } },
          create: { projectId, provider: "AZURE_CONTAINER_APPS", status: "connected" },
          update: { status: "connected" },
        });
        return target.id;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(
          `${service.name} already has a deployment target in ${environment.name}`,
        );
      }
      throw error;
    }

    await this.audit.record({
      action: "deployment-target.created",
      actorUserId: user.id,
      orgId: access.orgId,
      targetType: "deployment-target",
      targetId: id,
      metadata: {
        service: service.slug,
        environment: environment.slug,
        resourceGroup: request.ref.resourceGroup,
        containerApp: request.ref.name,
      },
    });
    await this.queueSync(projectId);
    const created = (await this.list(projectId)).find((t) => t.id === id);
    if (created === undefined) throw new NotFoundException("Deployment target not found");
    return created;
  }

  /**
   * Disconnects a target. Its revisions stay as history but none is treated as
   * serving any more, and diagnostics run again so findings reflect that.
   */
  async remove(access: ProjectAccess, user: AuthUser, id: string): Promise<void> {
    const { projectId } = access;
    const target = await this.db.deploymentTarget.findFirst({ where: { id, projectId } });
    if (target === null) throw new NotFoundException("Deployment target not found");

    await this.db.$transaction(async (tx) => {
      await tx.deploymentTarget.delete({ where: { id: target.id } });
      await deactivateDeployments(tx as unknown as Db, {
        serviceId: target.serviceId,
        environmentId: target.environmentId,
      });
      const remaining = await tx.deploymentTarget.count({ where: { projectId } });
      if (remaining === 0) {
        await tx.integration.deleteMany({
          where: { projectId, provider: "AZURE_CONTAINER_APPS" },
        });
      }
    });
    await this.audit.record({
      action: "deployment-target.removed",
      actorUserId: user.id,
      orgId: access.orgId,
      targetType: "deployment-target",
      targetId: target.id,
      metadata: { resourceGroup: target.resourceGroup, containerApp: target.resourceName },
    });
    await evaluateProject(this.db, projectId, new Date());
  }

  /** Asks the worker to read the project's targets now. */
  async syncNow(access: ProjectAccess): Promise<void> {
    const count = await this.db.deploymentTarget.count({ where: { projectId: access.projectId } });
    if (count === 0) throw new NotFoundException("This project has no deployment targets");
    await this.jobs.enqueueDeploymentSync(access.projectId);
  }

  private async queueSync(projectId: string): Promise<void> {
    try {
      await this.jobs.enqueueDeploymentSync(projectId);
    } catch (error) {
      // The scheduled sync will pick the project up.
      this.logger.warn({ err: error, projectId }, "Could not queue deployment sync");
    }
  }
}
