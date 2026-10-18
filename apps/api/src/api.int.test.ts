import type { FindingItem, MeResponse, ProjectSummary } from "@releaselens/contracts";
import { createDb, seedDemo, type Db } from "@releaselens/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  PUBLIC_ORIGIN,
  createTestApp,
  pkceChallenge,
  testConfig,
  type TestApp,
} from "./test-support/app.js";

let t: TestApp;
let db: Db;
let demoCookie: string;
let outsiderCookie: string;

const http = () => request(t.app.getHttpServer());

beforeAll(async () => {
  const databaseUrl = inject("databaseUrl");
  db = createDb(databaseUrl);
  const { demoUserId } = await seedDemo(db);

  // A second organization the demo user must never see.
  const outsider = await db.user.create({ data: { login: "outsider", githubId: 999_001n } });
  await db.organization.create({
    data: {
      slug: "other",
      name: "Other org",
      memberships: { create: { userId: outsider.id, role: "OWNER" } },
      projects: { create: { slug: "secret", name: "Secret project" } },
    },
  });

  t = await createTestApp(testConfig(databaseUrl, {}, inject("redisUrl")));
  demoCookie = await t.sessionCookie(demoUserId);
  outsiderCookie = await t.sessionCookie(outsider.id);
});

afterAll(async () => {
  await t.close();
  await db.$disconnect();
});

describe("health", () => {
  it("reports liveness and readiness without a session", async () => {
    await http().get("/healthz").expect(200, { status: "ok" });
    await http().get("/readyz").expect(200, { status: "ok" });
  });
});

describe("authentication", () => {
  it("rejects API requests without a session, with a request ID and no internals", async () => {
    const res = await http().get("/api/projects").expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, message: "Sign in required" });
    expect(res.body.requestId).toBe(res.headers["x-request-id"]);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.ts/);
  });

  it("rejects a forged session token", async () => {
    await http()
      .get("/api/me")
      .set("Cookie", "rl_session=not-a-real-token-but-long-enough")
      .expect(401);
  });

  it("rejects an expired session", async () => {
    const user = await db.user.findFirstOrThrow({ where: { isDemo: true } });
    const cookie = await t.sessionCookie(user.id);
    await db.session.updateMany({
      where: { userId: user.id, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await http().get("/api/me").set("Cookie", cookie).expect(401);
    demoCookie = await t.sessionCookie(user.id);
  });

  it("describes the available sign-in methods", async () => {
    await http()
      .get("/api/auth/config")
      .expect(200, { mode: "demo", githubEnabled: true, demoLoginEnabled: true });
  });
});

describe("CSRF protection", () => {
  it("rejects state-changing requests without the dashboard origin", async () => {
    await http().post("/api/auth/demo").expect(403);
    await http().post("/api/auth/demo").set("Origin", "https://evil.example").expect(403);
  });
});

describe("demo sign-in", () => {
  it("sets a secure-by-default session cookie and signs in as the demo viewer", async () => {
    const res = await http().post("/api/auth/demo").set("Origin", PUBLIC_ORIGIN).expect(204);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/rl_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const me = await http()
      .get("/api/me")
      .set("Cookie", cookie.split(";")[0] ?? "")
      .expect(200);
    expect(me.body).toMatchObject({
      mode: "demo",
      user: { login: "demo", isDemo: true },
      memberships: [{ org: { slug: "demo" }, role: "viewer" }],
    });
  });

  it("logout ends the session", async () => {
    const user = await db.user.findFirstOrThrow({ where: { isDemo: true } });
    const cookie = await t.sessionCookie(user.id);
    await http()
      .post("/api/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", PUBLIC_ORIGIN)
      .expect(204);
    await http().get("/api/me").set("Cookie", cookie).expect(401);
  });
});

describe("GitHub sign-in", () => {
  async function start() {
    const res = await http().get("/api/auth/github").expect(302);
    const location = new URL(String(res.headers.location));
    const cookie = String(res.headers["set-cookie"]).split(";")[0] ?? "";
    return { location, cookie, state: location.searchParams.get("state") ?? "" };
  }

  it("redirects to GitHub with state, PKCE, and the read:user scope only", async () => {
    const { location, cookie } = await start();
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("scope")).toBe("read:user");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${PUBLIC_ORIGIN}/api/auth/github/callback`,
    );
    expect(cookie).toMatch(/^rl_oauth=/);
  });

  it("rejects a callback whose state does not match", async () => {
    const { cookie } = await start();
    const res = await http()
      .get("/api/auth/github/callback?code=x&state=wrong")
      .set("Cookie", cookie)
      .expect(302);
    expect(res.headers.location).toBe(`${PUBLIC_ORIGIN}/sign-in?error=invalid-request`);
  });

  it("signs in an owner, applies roles from config, and records an audit event", async () => {
    t.github.profiles.set("owner-code", {
      id: 501,
      login: "Octo-Owner",
      name: "Octo",
      avatarUrl: null,
    });
    const { cookie, state, location } = await start();
    const res = await http()
      .get(`/api/auth/github/callback?code=owner-code&state=${state}`)
      .set("Cookie", cookie)
      .expect(302);
    expect(res.headers.location).toBe(`${PUBLIC_ORIGIN}/projects`);

    // The verifier sent to GitHub matches the challenge in the authorize URL.
    expect(pkceChallenge(t.github.verifiers.at(-1) ?? "")).toBe(
      location.searchParams.get("code_challenge"),
    );

    const session = String(res.headers["set-cookie"])
      .split(",")
      .find((c) => c.trim().startsWith("rl_session="));
    const me = await http()
      .get("/api/me")
      .set("Cookie", session?.split(";")[0]?.trim() ?? "")
      .expect(200);
    const body = me.body as MeResponse;
    expect(body.user.login).toBe("Octo-Owner");
    expect(body.memberships).toEqual(
      expect.arrayContaining([
        { org: { slug: "default", name: "My organization" }, role: "owner" },
        { org: { slug: "demo", name: "Demo organization" }, role: "viewer" },
      ]),
    );

    const audit = await db.auditEvent.findFirst({
      where: { action: "auth.login", actorUserId: body.user.id },
    });
    expect(audit?.metadata).toMatchObject({ method: "github", githubLogin: "Octo-Owner" });
    // The GitHub access token is never stored anywhere.
    expect(JSON.stringify(await db.auditEvent.findMany())).not.toContain("token-for-");
  });

  it("refuses GitHub accounts that are not on the allowlist", async () => {
    t.github.profiles.set("stranger-code", {
      id: 502,
      login: "stranger",
      name: null,
      avatarUrl: null,
    });
    const { cookie, state } = await start();
    const res = await http()
      .get(`/api/auth/github/callback?code=stranger-code&state=${state}`)
      .set("Cookie", cookie)
      .expect(302);
    expect(res.headers.location).toBe(`${PUBLIC_ORIGIN}/sign-in?error=not-allowed`);
    expect(String(res.headers["set-cookie"])).not.toContain("rl_session=");
    expect(await db.user.count({ where: { login: "stranger" } })).toBe(0);
  });

  it("reports GitHub failures without leaking details", async () => {
    const { cookie, state } = await start();
    const res = await http()
      .get(`/api/auth/github/callback?code=unknown-code&state=${state}`)
      .set("Cookie", cookie)
      .expect(302);
    expect(res.headers.location).toBe(`${PUBLIC_ORIGIN}/sign-in?error=github`);
  });
});

describe("projects", () => {
  it("lists the demo projects, most severe first", async () => {
    const res = await http().get("/api/projects").set("Cookie", demoCookie).expect(200);
    const projects = res.body as ProjectSummary[];
    expect(projects.map((p) => p.slug)).toHaveLength(6);
    expect(projects[0]).toMatchObject({ slug: "payments-api", worstSeverity: "high" });
    expect(projects.at(-1)).toMatchObject({ slug: "accounts-api", worstSeverity: null });
    expect(projects.every((p) => p.org.slug === "demo")).toBe(true);
  });

  it("returns project detail with integration freshness", async () => {
    const res = await http()
      .get("/api/orgs/demo/projects/search-api")
      .set("Cookie", demoCookie)
      .expect(200);
    expect(res.body).toMatchObject({ slug: "search-api", role: "viewer" });
    expect(res.body.integrations).toContainEqual(
      expect.objectContaining({ provider: "azure-container-apps", lastErrorKind: "timeout" }),
    );
  });

  it("returns deployment history with commits linked through image digests", async () => {
    const res = await http()
      .get("/api/orgs/demo/projects/storefront-api/deployments")
      .set("Cookie", demoCookie)
      .expect(200);
    expect(res.body[0]).toMatchObject({
      revisionName: "storefront-api--r101",
      isActive: true,
      commitSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      workflowRun: { runId: "101" },
    });
  });

  it("returns findings with facts, inferences, and evidence", async () => {
    const res = await http()
      .get("/api/orgs/demo/projects/storefront-api/findings")
      .set("Cookie", demoCookie)
      .expect(200);
    const [finding] = res.body as FindingItem[];
    expect(finding).toMatchObject({
      ruleId: "deployment.stale",
      severity: "warning",
      state: "open",
    });
    expect(finding?.facts.length).toBeGreaterThan(0);
    expect(finding?.facts.every((f) => f.evidenceIds.length > 0)).toBe(true);
  });

  it("returns workflow runs newest first", async () => {
    const res = await http()
      .get("/api/orgs/demo/projects/checkout-api/workflow-runs?limit=2")
      .set("Cookie", demoCookie)
      .expect(200);
    expect(res.body.map((r: { runId: string }) => r.runId)).toEqual(["103", "102"]);
  });

  it("validates query parameters", async () => {
    await http()
      .get("/api/orgs/demo/projects/checkout-api/workflow-runs?limit=5000")
      .set("Cookie", demoCookie)
      .expect(400);
    await http()
      .get("/api/orgs/demo/projects/checkout-api/findings?state=bogus")
      .set("Cookie", demoCookie)
      .expect(400);
  });
});

describe("authorization boundaries", () => {
  it("hides other organizations' projects as if they did not exist", async () => {
    const hidden = await http()
      .get("/api/orgs/other/projects/secret")
      .set("Cookie", demoCookie)
      .expect(404);
    const missing = await http()
      .get("/api/orgs/other/projects/nope")
      .set("Cookie", demoCookie)
      .expect(404);
    expect(hidden.body.message).toBe(missing.body.message);
  });

  it("applies the same check to every project sub-resource", async () => {
    for (const path of ["deployments", "workflow-runs", "findings"]) {
      await http()
        .get(`/api/orgs/other/projects/secret/${path}`)
        .set("Cookie", demoCookie)
        .expect(404);
    }
  });

  it("keeps the outsider out of the demo organization", async () => {
    const list = await http().get("/api/projects").set("Cookie", outsiderCookie).expect(200);
    expect((list.body as ProjectSummary[]).map((p) => p.slug)).toEqual(["secret"]);
    await http()
      .get("/api/orgs/demo/projects/payments-api")
      .set("Cookie", outsiderCookie)
      .expect(404);
    await http()
      .get("/api/orgs/demo/projects/payments-api/findings")
      .set("Cookie", outsiderCookie)
      .expect(404);
  });

  it("treats malformed slugs as not found", async () => {
    await http().get("/api/orgs/DEMO/projects/..%2Fsecret").set("Cookie", demoCookie).expect(404);
  });
});
