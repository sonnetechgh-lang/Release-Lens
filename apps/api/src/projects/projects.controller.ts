import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type {
  DeploymentItem,
  FindingItem,
  ProjectDetail,
  ProjectSummary,
  WorkflowRunItem,
} from "@releaselens/contracts";
import { z } from "zod";
import type { AuthUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { AccessService } from "./access.service.js";
import { ProjectsService } from "./projects.service.js";

const Limit = z.coerce.number().int().min(1).max(200).default(50);

const DeploymentsQuery = z.object({
  environment: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
    .optional(),
  limit: Limit,
});
const RunsQuery = z.object({ limit: Limit });
const FindingsQuery = z.object({
  state: z.enum(["active", "open", "acknowledged", "resolved", "all"]).default("active"),
});

function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) throw new BadRequestException(z.prettifyError(result.error));
  return result.data;
}

@ApiTags("projects")
@Controller()
export class ProjectsController {
  constructor(
    private readonly access: AccessService,
    private readonly projects: ProjectsService,
  ) {}

  @Get("projects")
  list(@CurrentUser() user: AuthUser): Promise<ProjectSummary[]> {
    return this.projects.list(user.id);
  }

  @Get("orgs/:org/projects/:project")
  async detail(
    @CurrentUser() user: AuthUser,
    @Param("org") org: string,
    @Param("project") project: string,
  ): Promise<ProjectDetail> {
    return this.projects.detail(await this.access.project(user.id, org, project));
  }

  @Get("orgs/:org/projects/:project/deployments")
  async deployments(
    @CurrentUser() user: AuthUser,
    @Param("org") org: string,
    @Param("project") project: string,
    @Query() query: unknown,
  ): Promise<DeploymentItem[]> {
    const access = await this.access.project(user.id, org, project);
    return this.projects.deployments(access, parseQuery(DeploymentsQuery, query));
  }

  @Get("orgs/:org/projects/:project/workflow-runs")
  async workflowRuns(
    @CurrentUser() user: AuthUser,
    @Param("org") org: string,
    @Param("project") project: string,
    @Query() query: unknown,
  ): Promise<WorkflowRunItem[]> {
    const access = await this.access.project(user.id, org, project);
    return this.projects.workflowRuns(access, parseQuery(RunsQuery, query));
  }

  @Get("orgs/:org/projects/:project/findings")
  async findings(
    @CurrentUser() user: AuthUser,
    @Param("org") org: string,
    @Param("project") project: string,
    @Query() query: unknown,
  ): Promise<FindingItem[]> {
    const access = await this.access.project(user.id, org, project);
    return this.projects.findings(access, parseQuery(FindingsQuery, query).state);
  }
}
