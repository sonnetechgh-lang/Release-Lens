import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb, type Db } from "./client.js";
import { evaluateService } from "./findings.js";
import { DEFAULT_SCENARIOS_DIR, DEMO_PROJECTS, seedDemo } from "./seed/demo.js";
import { loadSnapshot } from "./snapshot.js";

let db: Db;

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
  await seedDemo(db);
});

afterAll(async () => {
  await db.$disconnect();
});

async function scope(slug: string) {
  const service = await db.service.findFirstOrThrow({
    where: { slug, project: { org: { slug: "demo" } } },
    include: { project: { include: { environments: true } } },
  });
  const environment = service.project.environments[0];
  if (environment === undefined) throw new Error("no environment");
  return {
    projectId: service.projectId,
    serviceId: service.id,
    environmentId: environment.id,
    evaluatedAt: new Date("2026-10-18T12:00:00Z"),
  };
}

describe("demo seed", () => {
  it.each(DEMO_PROJECTS)(
    "$slug reproduces the $scenario scenario from stored evidence",
    async ({ slug, scenario }) => {
      const expected = JSON.parse(
        readFileSync(path.join(DEFAULT_SCENARIOS_DIR, scenario, "expected.json"), "utf8"),
      ) as { findings: { ruleId: string; severity: string; confidence: string }[] };

      const stored = await db.diagnosticFinding.findMany({
        where: { project: { slug, org: { slug: "demo" } } },
        orderBy: { ruleId: "asc" },
      });
      expect(
        stored.map((f) => ({
          ruleId: f.ruleId,
          severity: f.severity.toLowerCase(),
          confidence: f.confidence.toLowerCase(),
        })),
      ).toEqual(
        expected.findings.map((f) => ({
          ruleId: f.ruleId,
          severity: f.severity,
          confidence: f.confidence,
        })),
      );
    },
  );

  it("cites only evidence that exists in the stored snapshot", async () => {
    for (const { slug } of DEMO_PROJECTS) {
      const s = await scope(slug);
      const snapshot = await loadSnapshot(db, s);
      const ids = new Set([
        ...snapshot.workflowRuns.map((e) => e.id),
        ...(snapshot.deployment ? [snapshot.deployment.id] : []),
        ...snapshot.healthChecks.map((e) => e.id),
        ...snapshot.syncStatus.map((e) => e.id),
      ]);
      const findings = await db.diagnosticFinding.findMany({ where: { serviceId: s.serviceId } });
      for (const id of findings.flatMap((f) => f.evidenceIds)) expect(ids).toContain(id);
    }
  });

  it("gives every project a short deployment history with exactly one active revision", async () => {
    const deployments = await db.deployment.findMany({
      where: { service: { slug: "payments-api" } },
      orderBy: { activeSince: "asc" },
    });
    expect(deployments.map((d) => [d.revisionName, d.isActive])).toEqual([
      ["payments-api--r101", false],
      ["payments-api--r102", false],
      ["payments-api--r103", true],
    ]);
  });

  it("can be run again without duplicating data", async () => {
    await seedDemo(db);
    expect(await db.organization.count({ where: { slug: "demo" } })).toBe(1);
    expect(await db.project.count({ where: { org: { slug: "demo" } } })).toBe(DEMO_PROJECTS.length);
    expect(await db.user.count({ where: { isDemo: true } })).toBe(1);
  });
});

describe("finding lifecycle", () => {
  it("re-evaluating updates the same finding instead of creating another", async () => {
    const s = await scope("storefront-api");
    const before = await db.diagnosticFinding.findMany({ where: { serviceId: s.serviceId } });
    const { saved } = await evaluateService(db, {
      ...s,
      evaluatedAt: new Date("2026-10-18T12:05:00Z"),
    });
    const after = await db.diagnosticFinding.findMany({ where: { serviceId: s.serviceId } });

    expect(saved).toEqual({ opened: 0, updated: 1, resolved: 0 });
    expect(after.map((f) => f.id)).toEqual(before.map((f) => f.id));
    expect(after[0]?.lastDetectedAt.toISOString()).toBe("2026-10-18T12:05:00.000Z");
    expect(after[0]?.firstDetectedAt.toISOString()).toBe("2026-10-18T12:00:00.000Z");
  });

  it("resolves a finding when the evidence no longer supports it, and reopens it if it returns", async () => {
    const s = await scope("payments-api");
    const check = await db.healthCheckResult.create({
      data: {
        serviceId: s.serviceId,
        environmentId: s.environmentId,
        endpoint: "/healthz",
        outcome: "pass",
        httpStatus: 200,
        durationMs: 30,
        observedAt: new Date("2026-10-18T11:58:00Z"),
      },
    });
    const resolved = await evaluateService(db, s);
    expect(resolved.saved.resolved).toBe(1);
    const finding = await db.diagnosticFinding.findFirstOrThrow({
      where: { serviceId: s.serviceId },
    });
    expect(finding.state).toBe("RESOLVED");
    expect(finding.resolvedAt?.toISOString()).toBe("2026-10-18T12:00:00.000Z");

    await db.healthCheckResult.delete({ where: { id: check.id } });
    await evaluateService(db, s);
    const reopened = await db.diagnosticFinding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(reopened.state).toBe("OPEN");
    expect(reopened.resolvedAt).toBeNull();
  });

  it("keeps an acknowledged finding acknowledged while it still fires", async () => {
    const s = await scope("checkout-api");
    const finding = await db.diagnosticFinding.findFirstOrThrow({
      where: { serviceId: s.serviceId },
    });
    await db.diagnosticFinding.update({
      where: { id: finding.id },
      data: { state: "ACKNOWLEDGED" },
    });
    await evaluateService(db, s);
    const after = await db.diagnosticFinding.findUniqueOrThrow({ where: { id: finding.id } });
    expect(after.state).toBe("ACKNOWLEDGED");
  });

  it("rejects stored evidence that does not match the contracts", async () => {
    const s = await scope("accounts-api");
    const run = await db.workflowRun.findFirstOrThrow({ where: { projectId: s.projectId } });
    await db.workflowRun.update({ where: { id: run.id }, data: { status: "exploded" } });
    await expect(loadSnapshot(db, s)).rejects.toThrow(/is invalid/);
    await db.workflowRun.update({ where: { id: run.id }, data: { status: run.status } });
  });
});
