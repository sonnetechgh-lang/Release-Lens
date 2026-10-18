import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  GithubInstallationOption,
  GithubSetupResponse,
} from "@releaselens/contracts";
import type { Db } from "@releaselens/db";
import {
  ProviderError,
  type GithubInstallation,
  type GithubRepository,
} from "@releaselens/integrations";
import { AuditService } from "../audit/audit.service.js";
import type { AuthUser } from "../auth/auth.types.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { DB } from "../db/db.module.js";
import { JOBS, type Jobs } from "../jobs/jobs.module.js";
import { GITHUB_APP, type GithubAppApi } from "./github-app.provider.js";

/** Turns a provider failure into a 502 that names only the error category. */
function upstream(error: unknown): never {
  if (error instanceof ProviderError) {
    if (error.kind === "not-found") throw new NotFoundException("Not found on GitHub");
    throw new BadGatewayException(`GitHub request failed: ${error.kind}`);
  }
  throw error;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return slug === "" ? "project" : slug;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Db,
    @Inject(GITHUB_APP) private readonly github: GithubAppApi | null,
    @Inject(JOBS) private readonly jobs: Jobs,
    private readonly audit: AuditService,
  ) {}

  private get installUrl(): string | null {
    const slug = this.config.githubApp?.slug;
    return slug === undefined || slug === null
      ? null
      : `https://github.com/apps/${slug}/installations/new`;
  }

  /**
   * Installations of the ReleaseLens GitHub App and their repositories.
   * Installations already linked to a different organization are not shown.
   */
  async setup(orgId: string): Promise<GithubSetupResponse> {
    if (this.github === null) {
      return { appConfigured: false, installUrl: null, installations: [] };
    }
    const github = this.github;
    let installations: GithubInstallation[];
    try {
      installations = await github.listInstallations();
    } catch (error) {
      upstream(error);
    }

    const linked = await this.db.githubInstallation.findMany({
      where: { installationId: { in: installations.map((i) => BigInt(i.id)) } },
    });
    const linkedOrg = new Map(linked.map((l) => [Number(l.installationId), l.orgId]));
    const connected = await this.db.project.findMany({
      where: { orgId, githubRepositoryId: { not: null } },
      select: { slug: true, githubRepositoryId: true },
    });
    const projectByRepo = new Map(connected.map((p) => [Number(p.githubRepositoryId), p.slug]));

    const visible = installations.filter((i) => {
      const owner = linkedOrg.get(i.id);
      return owner === undefined || owner === null || owner === orgId;
    });

    const options = await Promise.all(
      visible.map(async (i): Promise<GithubInstallationOption> => {
        let repositories: GithubRepository[] = [];
        let error: string | null = null;
        try {
          repositories = await github.listInstallationRepositories(i.id);
        } catch (e) {
          if (!(e instanceof ProviderError)) throw e;
          error = e.kind;
        }
        return {
          installationId: i.id,
          account: i.account?.login ?? "unknown",
          accountType: i.account?.type ?? "unknown",
          suspended: i.suspended_at !== null && i.suspended_at !== undefined,
          error,
          repositories: repositories
            .map((r) => ({
              id: r.id,
              fullName: r.full_name,
              defaultBranch: r.default_branch ?? null,
              private: r.private,
              connectedProject: projectByRepo.get(r.id) ?? null,
            }))
            .sort((a, b) => a.fullName.localeCompare(b.fullName)),
        };
      }),
    );
    return { appConfigured: true, installUrl: this.installUrl, installations: options };
  }

  /**
   * Creates a project from a repository the GitHub App can access. GitHub is asked
   * directly whether the installation exists and includes the repository, so a
   * client cannot connect a repository by guessing IDs.
   */
  async createProject(
    org: { orgId: string; orgName: string; orgSlug: string },
    user: AuthUser,
    request: CreateProjectRequest,
  ): Promise<CreateProjectResponse> {
    if (this.github === null) throw new NotFoundException("The GitHub App is not configured");

    let installation: GithubInstallation;
    let repositories: GithubRepository[];
    try {
      installation = await this.github.getInstallation(request.installationId);
      repositories = await this.github.listInstallationRepositories(request.installationId);
    } catch (error) {
      upstream(error);
    }
    const repo = repositories.find((r) => r.id === request.repositoryId);
    if (repo === undefined) {
      throw new NotFoundException("This installation does not have access to that repository");
    }

    const created = await this.db.$transaction(async (tx) => {
      const existing = await tx.githubInstallation.findUnique({
        where: { installationId: BigInt(installation.id) },
      });
      if (
        existing?.orgId !== undefined &&
        existing.orgId !== null &&
        existing.orgId !== org.orgId
      ) {
        throw new ConflictException("This GitHub installation is linked to another organization");
      }
      const installationRow = await tx.githubInstallation.upsert({
        where: { installationId: BigInt(installation.id) },
        create: {
          installationId: BigInt(installation.id),
          orgId: org.orgId,
          accountLogin: installation.account?.login ?? "unknown",
          accountType: installation.account?.type ?? "unknown",
          repositorySelection: installation.repository_selection ?? null,
        },
        update: { orgId: org.orgId, deletedAt: null },
      });

      const duplicate = await tx.project.findFirst({
        where: { orgId: org.orgId, githubRepositoryId: BigInt(repo.id) },
      });
      if (duplicate !== null)
        throw new ConflictException(`Repository is already connected as "${duplicate.slug}"`);

      const base = slugify(repo.name);
      const taken = new Set(
        (
          await tx.project.findMany({
            where: { orgId: org.orgId, slug: { startsWith: base } },
            select: { slug: true },
          })
        ).map((p) => p.slug),
      );
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${String(n)}`;

      const environmentName = request.environmentName ?? "Production";
      return tx.project.create({
        data: {
          orgId: org.orgId,
          slug,
          name: repo.name,
          repository: repo.full_name,
          githubRepositoryId: BigInt(repo.id),
          githubInstallationId: installationRow.id,
          services: { create: { slug, name: repo.name } },
          environments: {
            create: {
              slug: slugify(environmentName),
              name: environmentName,
              releaseBranch: request.releaseBranch ?? repo.default_branch ?? "main",
              deployWorkflowName: request.deployWorkflowName ?? null,
            },
          },
          integrations: { create: { provider: "GITHUB", status: "connected" } },
        },
      });
    });

    await this.audit.record({
      action: "project.created",
      actorUserId: user.id,
      orgId: org.orgId,
      targetType: "project",
      targetId: created.id,
      metadata: { repository: repo.full_name, installationId: installation.id },
    });
    try {
      await this.jobs.enqueueReconcile(created.id);
    } catch (error) {
      // The scheduled reconcile will pick the project up.
      this.logger.warn(
        { err: error, projectId: created.id },
        "Could not queue initial GitHub sync",
      );
    }
    return { org: { slug: org.orgSlug, name: org.orgName }, slug: created.slug };
  }
}
