import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../client.js";
import { evaluateService } from "../findings.js";
import { importScenario } from "./import-scenario.js";

export const DEMO_ORG_SLUG = "demo";
export const DEMO_USER_LOGIN = "demo";

export const DEFAULT_SCENARIOS_DIR = fileURLToPath(
  new URL("../../../../tests/fixtures/scenarios/", import.meta.url),
);

/** Each fault scenario becomes one demo project with a fictional service name. */
export const DEMO_PROJECTS = [
  { scenario: "healthy-baseline", slug: "accounts-api", name: "Accounts API" },
  { scenario: "stale-deployment", slug: "storefront-api", name: "Storefront API" },
  { scenario: "failed-workflow", slug: "checkout-api", name: "Checkout API" },
  { scenario: "broken-health-endpoint", slug: "payments-api", name: "Payments API" },
  { scenario: "missing-build-metadata", slug: "catalog-api", name: "Catalog API" },
  { scenario: "azure-api-timeout", slug: "search-api", name: "Search API" },
] as const;

export interface SeedSummary {
  orgId: string;
  demoUserId: string;
  projects: { slug: string; findings: number }[];
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

/**
 * Recreates the demo organization from the synthetic fault scenarios.
 * Safe to run repeatedly: the demo org is deleted and rebuilt each time.
 * Never touches other organizations.
 */
export async function seedDemo(db: Db, scenariosDir = DEFAULT_SCENARIOS_DIR): Promise<SeedSummary> {
  await db.organization.deleteMany({ where: { slug: DEMO_ORG_SLUG } });

  const demoUser =
    (await db.user.findFirst({ where: { isDemo: true, login: DEMO_USER_LOGIN } })) ??
    (await db.user.create({ data: { login: DEMO_USER_LOGIN, name: "Demo viewer", isDemo: true } }));

  const org = await db.organization.create({
    data: {
      slug: DEMO_ORG_SLUG,
      name: "Demo organization",
      memberships: { create: { userId: demoUser.id, role: "VIEWER" } },
    },
  });

  const projects: SeedSummary["projects"] = [];
  for (const demo of DEMO_PROJECTS) {
    const dir = path.join(scenariosDir, demo.scenario);
    const expected = readJson(path.join(dir, "expected.json")) as { description: string };
    const imported = await importScenario(db, {
      orgId: org.id,
      slug: demo.slug,
      name: demo.name,
      description: `Demo scenario "${demo.scenario}": ${expected.description}`,
      snapshot: readJson(path.join(dir, "snapshot.json")),
    });
    const { findings } = await evaluateService(db, imported);
    projects.push({ slug: demo.slug, findings: findings.length });
  }

  await db.auditEvent.create({
    data: { orgId: org.id, action: "demo.seeded", metadata: { projects: projects.length } },
  });

  return { orgId: org.id, demoUserId: demoUser.id, projects };
}
