import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { DeploymentTargetItem } from "@releaselens/contracts";
import { ContainerAppRefSchema } from "@releaselens/integrations";
import { z } from "zod";
import type { AuthUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { AccessService, requireOwner } from "../projects/access.service.js";
import { DeploymentTargetsService } from "./deployment-targets.service.js";

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const trimmed = z.string().trim().min(1).max(200);

const CreateTargetBody = z
  .object({
    service: Slug,
    environment: Slug,
    subscriptionId: trimmed,
    resourceGroup: trimmed,
    containerApp: trimmed,
    containerName: trimmed.optional(),
  })
  .strict();

const TARGET_ID = /^[a-z0-9]{20,40}$/;

/** Deployment targets are managed by organization owners; any member can see them on the project. */
@ApiTags("deployment-targets")
@Controller("orgs/:org/projects/:project/deployment-targets")
export class DeploymentTargetsController {
  constructor(
    private readonly access: AccessService,
    private readonly targets: DeploymentTargetsService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Param("org") org: string,
    @Param("project") project: string,
    @Body() body: unknown,
  ): Promise<DeploymentTargetItem> {
    const access = await this.access.project(user.id, org, project);
    requireOwner(access);
    const parsed = CreateTargetBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
    const { service, environment, containerApp, ...rest } = parsed.data;
    const ref = ContainerAppRefSchema.safeParse({ ...rest, name: containerApp });
    if (!ref.success) throw new BadRequestException(z.prettifyError(ref.error));
    return this.targets.create(access, user, { service, environment, ref: ref.data });
  }

  /** Queues a read of every target in the project. */
  @Post("sync")
  @HttpCode(202)
  async sync(
    @CurrentUser() user: AuthUser,
    @Param("org") org: string,
    @Param("project") project: string,
  ): Promise<{ queued: true }> {
    const access = await this.access.project(user.id, org, project);
    requireOwner(access);
    await this.targets.syncNow(access);
    return { queued: true };
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param("org") org: string,
    @Param("project") project: string,
    @Param("id") id: string,
  ): Promise<void> {
    const access = await this.access.project(user.id, org, project);
    requireOwner(access);
    if (!TARGET_ID.test(id)) throw new NotFoundException("Deployment target not found");
    await this.targets.remove(access, user, id);
  }
}
