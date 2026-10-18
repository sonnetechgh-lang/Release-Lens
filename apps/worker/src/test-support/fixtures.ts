import type { Db } from "@releaselens/db";
import type { GithubWorkflowRun } from "@releaselens/integrations";
import pino from "pino";
import { vi } from "vitest";
import type { WorkerDeps } from "../deps.js";

export const NOW = new Date("2026-10-18T12:00:00Z");
export const INSTALLATION_ID = 4242;
export const REPO_ID = 555;
export const SHA_A = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
export const SHA_B = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";

export interface TestProjectRefs {
  orgId: string;
  projectId: string;
  installationRowId: string;
}

/** An organization with one project connected to a GitHub repository through an installation. */
export async function createConnectedProject(db: Db, slug = "shop"): Promise<TestProjectRefs> {
  const org = await db.organization.upsert({
    where: { slug: "acme" },
    create: { slug: "acme", name: "Acme" },
    update: {},
  });
  const installation = await db.githubInstallation.upsert({
    where: { installationId: BigInt(INSTALLATION_ID) },
    create: {
      installationId: BigInt(INSTALLATION_ID),
      accountLogin: "acme",
      accountType: "Organization",
      orgId: org.id,
    },
    update: { deletedAt: null, suspendedAt: null },
  });
  const project = await db.project.create({
    data: {
      orgId: org.id,
      slug,
      name: "Shop",
      repository: "acme/shop",
      githubRepositoryId: BigInt(REPO_ID),
      githubInstallationId: installation.id,
      services: { create: { slug, name: "Shop" } },
      environments: {
        create: {
          slug: "production",
          name: "Production",
          releaseBranch: "main",
          deployWorkflowName: "deploy",
        },
      },
      integrations: { create: { provider: "GITHUB" } },
    },
  });
  return { orgId: org.id, projectId: project.id, installationRowId: installation.id };
}

export function githubRun(overrides: Partial<GithubWorkflowRun> = {}): GithubWorkflowRun {
  return {
    id: 7001,
    name: "deploy",
    head_branch: "main",
    head_sha: SHA_A,
    status: "completed",
    conclusion: "success",
    event: "push",
    run_started_at: "2026-10-18T11:00:00Z",
    created_at: "2026-10-18T11:00:00Z",
    updated_at: "2026-10-18T11:10:00Z",
    html_url: "https://github.com/acme/shop/actions/runs/7001",
    ...overrides,
  };
}

export function workflowRunPayload(
  run: GithubWorkflowRun,
  { repoId = REPO_ID, installationId = INSTALLATION_ID } = {},
) {
  return {
    action: run.status === "completed" ? "completed" : "in_progress",
    workflow_run: run,
    repository: { id: repoId, full_name: "acme/shop" },
    installation: { id: installationId },
  };
}

export function installationPayload(action: string) {
  return {
    action,
    installation: {
      id: INSTALLATION_ID,
      account: { login: "acme", type: "Organization" },
      repository_selection: "selected",
      suspended_at: action === "suspend" ? "2026-10-18T11:59:00Z" : null,
      permissions: { actions: "read", metadata: "read" },
    },
  };
}

let deliveryCounter = 0;

export async function storeDelivery(
  db: Db,
  event: string,
  payload: unknown,
  deliveryId?: string,
): Promise<string> {
  const id = deliveryId ?? `delivery-${String(++deliveryCounter)}-${String(Date.now())}`;
  await db.webhookDelivery.create({
    data: { deliveryId: id, event, payload: payload as object, receivedAt: NOW },
  });
  return id;
}

export function testDeps(
  db: Db,
  overrides: Partial<WorkerDeps> = {},
): WorkerDeps & {
  enqueueDelivery: ReturnType<typeof vi.fn>;
  enqueueReconcile: ReturnType<typeof vi.fn>;
} {
  return {
    db,
    github: { listWorkflowRuns: vi.fn().mockResolvedValue([]) },
    log: pino({ level: "silent" }),
    now: () => NOW,
    enqueueDelivery: vi.fn().mockResolvedValue(undefined),
    enqueueReconcile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as never;
}
