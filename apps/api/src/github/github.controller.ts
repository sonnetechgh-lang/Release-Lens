import { BadRequestException, Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { CreateProjectResponse, GithubSetupResponse } from "@releaselens/contracts";
import { z } from "zod";
import type { AuthUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { AccessService, requireOwner } from "../projects/access.service.js";
import { GithubService } from "./github.service.js";

const GitRef = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[\w./-]+$/, "Use letters, digits, and . _ / -")
  .refine((value) => !value.includes(".."), "Must not contain '..'");

const CreateProjectBody = z
  .object({
    installationId: z.number().int().positive(),
    repositoryId: z.number().int().positive(),
    releaseBranch: GitRef.optional(),
    deployWorkflowName: z.string().trim().min(1).max(200).optional(),
    environmentName: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

@ApiTags("github")
@Controller("orgs/:org")
export class GithubController {
  constructor(
    private readonly access: AccessService,
    private readonly github: GithubService,
  ) {}

  /** Installations and repositories available to connect. Owners only. */
  @Get("github")
  async setup(
    @CurrentUser() user: AuthUser,
    @Param("org") orgSlug: string,
  ): Promise<GithubSetupResponse> {
    const org = await this.access.org(user.id, orgSlug);
    requireOwner(org);
    return this.github.setup(org.orgId);
  }

  /** Connects a GitHub repository as a new project. Owners only. */
  @Post("projects")
  async createProject(
    @CurrentUser() user: AuthUser,
    @Param("org") orgSlug: string,
    @Body() body: unknown,
  ): Promise<CreateProjectResponse> {
    const org = await this.access.org(user.id, orgSlug);
    requireOwner(org);
    const parsed = CreateProjectBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(z.prettifyError(parsed.error));
    return this.github.createProject({ ...org, orgSlug }, user, parsed.data);
  }
}
