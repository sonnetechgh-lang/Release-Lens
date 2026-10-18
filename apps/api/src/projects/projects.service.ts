import { Inject, Injectable } from "@nestjs/common";
import {
  SEVERITIES,
  SEVERITY_RANK,
  type DeploymentItem,
  type FindingItem,
  type ProjectDetail,
  type ProjectSummary,
  type SeverityCounts,
  type Statement,
  type WorkflowRunItem,
} from "@releaselens/contracts";
import {
  CONFIDENCE_FROM_DB,
  FINDING_STATE_FROM_DB,
  PROVIDER_FROM_DB,
  SEVERITY_FROM_DB,
  iso,
  type Db,
} from "@releaselens/db";
import { DB } from "../db/db.module.js";
import type { ProjectAccess } from "./access.service.js";

export type FindingStateFilter = "active" | "open" | "acknowledged" | "resolved" | "all";

const STATE_FILTER = {
  active: { in: ["OPEN", "ACKNOWLEDGED"] },
  open: { in: ["OPEN"] },
  acknowledged: { in: ["ACKNOWLEDGED"] },
  resolved: { in: ["RESOLVED"] },
  all: undefined,
} as const;

function emptyCounts(): SeverityCounts {
  return { info: 0, warning: 0, high: 0, critical: 0 };
}

function worst(counts: SeverityCounts): ProjectSummary["worstSeverity"] {
  return [...SEVERITIES].reverse().find((s) => counts[s] > 0) ?? null;
}

const isoOrNull = (date: Date | null) => (date === null ? null : iso(date));

@Injectable()
export class ProjectsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async openCounts(projectIds: string[]): Promise<Map<string, SeverityCounts>> {
    const rows = await this.db.diagnosticFinding.groupBy({
      by: ["projectId", "severity"],
      where: { projectId: { in: projectIds }, state: { in: ["OPEN", "ACKNOWLEDGED"] } },
      _count: { _all: true },
    });
    const counts = new Map<string, SeverityCounts>();
    for (const row of rows) {
      const c = counts.get(row.projectId) ?? emptyCounts();
      c[SEVERITY_FROM_DB[row.severity]] = row._count._all;
      counts.set(row.projectId, c);
    }
    return counts;
  }

  /** Projects in every organization the user belongs to, most severe first. */
  async list(userId: string): Promise<ProjectSummary[]> {
    const projects = await this.db.project.findMany({
      where: { org: { memberships: { some: { userId } } } },
      include: { org: true, _count: { select: { services: true, environments: true } } },
      orderBy: [{ org: { name: "asc" } }, { name: "asc" }],
    });
    const counts = await this.openCounts(projects.map((p) => p.id));

    const summaries = projects.map((p): ProjectSummary => {
      const openFindings = counts.get(p.id) ?? emptyCounts();
      return {
        org: { slug: p.org.slug, name: p.org.name },
        slug: p.slug,
        name: p.name,
        description: p.description,
        repository: p.repository,
        serviceCount: p._count.services,
        environmentCount: p._count.environments,
        openFindings,
        worstSeverity: worst(openFindings),
        lastEvaluatedAt: isoOrNull(p.lastEvaluatedAt),
      };
    });
    const rank = (s: ProjectSummary) =>
      s.worstSeverity === null ? -1 : SEVERITY_RANK[s.worstSeverity];
    return summaries.sort((a, b) => rank(b) - rank(a));
  }

  async detail(access: ProjectAccess): Promise<ProjectDetail> {
    const p = await this.db.project.findUniqueOrThrow({
      where: { id: access.projectId },
      include: {
        org: true,
        services: { orderBy: { name: "asc" } },
        environments: { orderBy: { name: "asc" } },
        integrations: { orderBy: { provider: "asc" } },
      },
    });
    const openFindings = (await this.openCounts([p.id])).get(p.id) ?? emptyCounts();
    return {
      org: { slug: p.org.slug, name: p.org.name },
      slug: p.slug,
      name: p.name,
      description: p.description,
      repository: p.repository,
      serviceCount: p.services.length,
      environmentCount: p.environments.length,
      openFindings,
      worstSeverity: worst(openFindings),
      lastEvaluatedAt: isoOrNull(p.lastEvaluatedAt),
      role: access.role,
      services: p.services.map((s) => ({ slug: s.slug, name: s.name })),
      environments: p.environments.map((e) => ({
        slug: e.slug,
        name: e.name,
        releaseBranch: e.releaseBranch,
      })),
      integrations: p.integrations.map((i) => ({
        provider: PROVIDER_FROM_DB[i.provider],
        lastAttemptAt: isoOrNull(i.lastAttemptAt),
        lastSuccessfulSyncAt: isoOrNull(i.lastSuccessfulSyncAt),
        lastErrorKind: i.lastErrorKind,
      })),
    };
  }

  /** Deployment history, newest first. Commits are shown only when evidence links them. */
  async deployments(
    access: ProjectAccess,
    options: { environment?: string; limit: number },
  ): Promise<DeploymentItem[]> {
    const deployments = await this.db.deployment.findMany({
      where: {
        service: { projectId: access.projectId },
        ...(options.environment === undefined
          ? {}
          : { environment: { slug: options.environment } }),
      },
      include: { service: true, environment: true },
      orderBy: { activeSince: "desc" },
      take: options.limit,
    });
    const digests = deployments.flatMap((d) => (d.imageDigest === null ? [] : [d.imageDigest]));
    const runs = await this.db.workflowRun.findMany({
      where: { projectId: access.projectId, producedImageDigest: { in: digests } },
    });
    const runByDigest = new Map(runs.map((r) => [r.producedImageDigest, r]));

    return deployments.map((d) => {
      const run = d.imageDigest === null ? undefined : runByDigest.get(d.imageDigest);
      return {
        id: d.id,
        service: { slug: d.service.slug, name: d.service.name },
        environment: { slug: d.environment.slug, name: d.environment.name },
        revisionName: d.revisionName,
        imageReference: d.imageReference,
        imageDigest: d.imageDigest,
        commitSha: run?.commitSha ?? d.commitSha,
        workflowRun: run === undefined ? null : { runId: run.externalId, url: run.url },
        activeSince: iso(d.activeSince),
        providerStatus: d.providerStatus,
        isActive: d.isActive,
        observedAt: iso(d.observedAt),
      };
    });
  }

  async workflowRuns(
    access: ProjectAccess,
    options: { limit: number },
  ): Promise<WorkflowRunItem[]> {
    const runs = await this.db.workflowRun.findMany({
      where: { projectId: access.projectId },
      orderBy: { startedAt: "desc" },
      take: options.limit,
    });
    return runs.map((r) => ({
      id: r.id,
      runId: r.externalId,
      workflowName: r.workflowName,
      branch: r.branch,
      commitSha: r.commitSha,
      status: r.status,
      conclusion: r.conclusion,
      startedAt: iso(r.startedAt),
      completedAt: isoOrNull(r.completedAt),
      url: r.url,
    }));
  }

  async findings(access: ProjectAccess, state: FindingStateFilter): Promise<FindingItem[]> {
    const filter = STATE_FILTER[state];
    const findings = await this.db.diagnosticFinding.findMany({
      where: {
        projectId: access.projectId,
        ...(filter === undefined ? {} : { state: { in: [...filter.in] } }),
      },
      include: { service: true, environment: true },
      orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }],
    });
    return findings
      .map((f): FindingItem => ({
        id: f.id,
        fingerprint: f.fingerprint,
        ruleId: f.ruleId,
        ruleVersion: f.ruleVersion,
        category: f.category as FindingItem["category"],
        severity: SEVERITY_FROM_DB[f.severity],
        confidence: CONFIDENCE_FROM_DB[f.confidence],
        state: FINDING_STATE_FROM_DB[f.state],
        title: f.title,
        service: { slug: f.service.slug, name: f.service.name },
        environment: { slug: f.environment.slug, name: f.environment.name },
        facts: f.facts as unknown as Statement[],
        inferences: f.inferences as unknown as Statement[],
        unknowns: f.unknowns as unknown as string[],
        nextSteps: f.nextSteps as unknown as string[],
        evidenceIds: f.evidenceIds,
        firstDetectedAt: iso(f.firstDetectedAt),
        lastDetectedAt: iso(f.lastDetectedAt),
        resolvedAt: isoOrNull(f.resolvedAt),
      }))
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  }
}
