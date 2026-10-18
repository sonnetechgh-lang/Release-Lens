import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "../errors.js";
import { createAppJwt } from "./app-auth.js";
import { GithubAppClient, classifyGithubResponse } from "./client.js";
import { toWorkflowRunRecord } from "./normalize.js";
import type { GithubWorkflowRun } from "./schemas.js";
import { signWebhookBody, verifyWebhookSignature } from "./webhook.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const NOW = Date.parse("2026-10-18T12:00:00Z");

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

function client(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, now = () => NOW) {
  return new GithubAppClient({
    appId: "12345",
    privateKey: PEM,
    fetch: fetchImpl as typeof fetch,
    now,
  });
}

const RUN: GithubWorkflowRun = {
  id: 9001,
  name: "build-and-deploy",
  head_branch: "main",
  head_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  status: "completed",
  conclusion: "success",
  event: "push",
  run_started_at: "2026-10-18T10:00:00Z",
  created_at: "2026-10-18T09:59:00Z",
  updated_at: "2026-10-18T10:08:00Z",
  html_url: "https://github.com/example/app/actions/runs/9001",
};

describe("createAppJwt", () => {
  it("produces an RS256 JWT signed by the app key with GitHub's required claims", () => {
    const jwt = createAppJwt("12345", PEM, NOW);
    const [header, payload, signature] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<
      string,
      number | string
    >;
    expect(claims).toEqual({ iss: "12345", iat: NOW / 1000 - 60, exp: NOW / 1000 + 540 });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });
});

describe("GithubAppClient", () => {
  function tokenThenRuns() {
    const calls: { url: string; auth: string }[] = [];
    const fetchImpl = vi.fn((url: string, init: RequestInit) => {
      const auth = String((init.headers as Record<string, string>).Authorization);
      calls.push({ url, auth });
      if (url.endsWith("/access_tokens")) {
        return Promise.resolve(
          json({ token: "ghs_installation", expires_at: "2026-10-18T13:00:00Z" }),
        );
      }
      return Promise.resolve(json({ total_count: 1, workflow_runs: [RUN] }));
    });
    return { calls, fetchImpl };
  }

  it("authenticates as the installation and caches the token", async () => {
    const { calls, fetchImpl } = tokenThenRuns();
    const gh = client(fetchImpl);
    await gh.listWorkflowRuns(77, "example/app");
    const runs = await gh.listWorkflowRuns(77, "example/app");

    expect(runs).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/access_tokens"))).toHaveLength(1);
    expect(calls[0]?.auth).toMatch(/^Bearer ey/); // app JWT for the token request
    expect(calls[1]?.auth).toBe("Bearer ghs_installation");
    expect(calls[1]?.url).toBe("https://api.github.com/repos/example/app/actions/runs?per_page=50");
  });

  it("refreshes the token shortly before it expires", async () => {
    const { calls, fetchImpl } = tokenThenRuns();
    let now = NOW;
    const gh = client(fetchImpl, () => now);
    await gh.listWorkflowRuns(77, "example/app");
    now = Date.parse("2026-10-18T12:56:00Z"); // 4 minutes before expiry
    await gh.listWorkflowRuns(77, "example/app");
    expect(calls.filter((c) => c.url.endsWith("/access_tokens"))).toHaveLength(2);
  });

  it("drops a cached token that GitHub rejects", async () => {
    const { calls, fetchImpl } = tokenThenRuns();
    const gh = client(fetchImpl);
    await gh.listWorkflowRuns(77, "example/app");
    fetchImpl.mockImplementationOnce(() => Promise.resolve(json({}, { status: 401 })));
    await expect(gh.listWorkflowRuns(77, "example/app")).rejects.toMatchObject({
      kind: "unauthorized",
    });
    await gh.listWorkflowRuns(77, "example/app");
    expect(calls.filter((c) => c.url.endsWith("/access_tokens"))).toHaveLength(2);
  });

  it("turns timeouts and network failures into categories", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    await expect(client(() => Promise.reject(timeout)).listInstallations()).rejects.toMatchObject({
      kind: "timeout",
    });
    await expect(
      client(() => Promise.reject(new TypeError("fetch failed"))).listInstallations(),
    ).rejects.toMatchObject({ kind: "network", retryable: true });
  });

  it("rejects responses that do not match the expected shape", async () => {
    const gh = client((url) =>
      Promise.resolve(
        url.endsWith("/access_tokens")
          ? json({ token: "t", expires_at: "2026-10-18T13:00:00Z" })
          : json({ workflow_runs: "nope" }),
      ),
    );
    await expect(gh.listWorkflowRuns(1, "example/app")).rejects.toMatchObject({
      kind: "server-error",
    });
  });

  it("refuses repository names that could change the request path", async () => {
    const gh = client(() => Promise.resolve(json({})));
    await expect(gh.listWorkflowRuns(1, "../../app/installations")).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it("follows pagination for installation repositories", async () => {
    const repo = (id: number) => ({
      id,
      name: `r${String(id)}`,
      full_name: `o/r${String(id)}`,
      private: true,
      owner: { login: "o" },
    });
    const gh = client((url) => {
      if (url.endsWith("/access_tokens"))
        return Promise.resolve(json({ token: "t", expires_at: "2026-10-18T13:00:00Z" }));
      const page = Number(new URL(url).searchParams.get("page"));
      return Promise.resolve(
        json({ total_count: 3, repositories: page === 1 ? [repo(1), repo(2)] : [repo(3)] }),
      );
    });
    expect((await gh.listInstallationRepositories(1)).map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

describe("classifyGithubResponse", () => {
  const classify = (status: number, headers: Record<string, string> = {}) =>
    classifyGithubResponse(new Response(null, { status, headers }), "GitHub GET /x", NOW);

  it("detects primary rate limits and waits until the reset time", () => {
    const error = classify(403, {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(NOW / 1000 + 120),
    });
    expect(error).toMatchObject({ kind: "rate-limited", retryAfterMs: 120_000, retryable: true });
  });

  it("detects secondary rate limits with retry-after", () => {
    expect(classify(403, { "retry-after": "30" })).toMatchObject({
      kind: "rate-limited",
      retryAfterMs: 30_000,
    });
    expect(classify(429)).toMatchObject({ kind: "rate-limited", retryAfterMs: 60_000 });
  });

  it("maps other statuses", () => {
    expect(classify(401).kind).toBe("unauthorized");
    expect(classify(403).kind).toBe("forbidden");
    expect(classify(404)).toMatchObject({ kind: "not-found", retryable: false });
    expect(classify(502)).toMatchObject({ kind: "server-error", retryable: true });
  });
});

describe("webhook signatures", () => {
  const body = Buffer.from('{"action":"completed"}');

  it("accepts a correct signature", () => {
    expect(verifyWebhookSignature("s3cret", body, signWebhookBody("s3cret", body))).toBe(true);
  });

  it("rejects wrong secrets, tampered bodies, and malformed or missing headers", () => {
    const sig = signWebhookBody("s3cret", body);
    expect(verifyWebhookSignature("other", body, sig)).toBe(false);
    expect(verifyWebhookSignature("s3cret", Buffer.from('{"action":"created"}'), sig)).toBe(false);
    expect(verifyWebhookSignature("s3cret", body, sig.replace("sha256=", "sha1="))).toBe(false);
    expect(verifyWebhookSignature("s3cret", body, "sha256=abc")).toBe(false);
    expect(verifyWebhookSignature("s3cret", body, undefined)).toBe(false);
    expect(verifyWebhookSignature("", body, signWebhookBody("", body))).toBe(false);
  });
});

describe("toWorkflowRunRecord", () => {
  it("maps a completed run", () => {
    expect(toWorkflowRunRecord(RUN)).toEqual({
      externalId: "9001",
      workflowName: "build-and-deploy",
      branch: "main",
      commitSha: RUN.head_sha,
      status: "completed",
      conclusion: "success",
      startedAt: new Date("2026-10-18T10:00:00Z"),
      completedAt: new Date("2026-10-18T10:08:00Z"),
      url: RUN.html_url,
      providerUpdatedAt: new Date("2026-10-18T10:08:00Z"),
    });
  });

  it("treats waiting/requested runs as queued and leaves them without a conclusion", () => {
    expect(toWorkflowRunRecord({ ...RUN, status: "waiting", conclusion: null })).toMatchObject({
      status: "queued",
      conclusion: null,
      completedAt: null,
    });
  });

  it("maps conclusions the contracts do not know", () => {
    expect(toWorkflowRunRecord({ ...RUN, conclusion: "startup_failure" }).conclusion).toBe(
      "failure",
    );
    expect(toWorkflowRunRecord({ ...RUN, conclusion: "brand_new_value" }).conclusion).toBe(
      "neutral",
    );
  });
});
