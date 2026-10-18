import "reflect-metadata";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpGithubOAuthClient } from "./auth/github-oauth.client.js";
import { OriginGuard } from "./auth/guards.js";
import { hashToken } from "./auth/session.service.js";
import { loadConfig } from "./config/config.js";
import { requestIdFor } from "./logging/logging.module.js";

const BASE = { DATABASE_URL: "postgresql://u:p@localhost/db" };

describe("loadConfig", () => {
  it("applies safe defaults", () => {
    const config = loadConfig(BASE);
    expect(config).toMatchObject({
      mode: "demo",
      port: 4000,
      host: "127.0.0.1",
      publicOrigin: "http://localhost:3000",
      cookieSecure: false,
      github: null,
    });
    expect(config.allowedLogins.size).toBe(0);
  });

  it("uses secure cookies for https and lets owners sign in", () => {
    const config = loadConfig({
      ...BASE,
      PUBLIC_URL: "https://releaselens.example.com/",
      RELEASELENS_OWNER_GITHUB_LOGINS: "Alice, bob",
      RELEASELENS_ALLOWED_GITHUB_LOGINS: "carol",
    });
    expect(config.cookieSecure).toBe(true);
    expect(config.publicUrl).toBe("https://releaselens.example.com");
    expect([...config.allowedLogins].sort()).toEqual(["alice", "bob", "carol"]);
    expect([...config.ownerLogins].sort()).toEqual(["alice", "bob"]);
  });

  it("treats empty values as unset", () => {
    const config = loadConfig({
      ...BASE,
      GITHUB_OAUTH_CLIENT_ID: "",
      GITHUB_OAUTH_CLIENT_SECRET: "",
      API_PORT: "",
    });
    expect(config.github).toBeNull();
    expect(config.port).toBe(4000);
  });

  it("requires GitHub credentials in pairs", () => {
    expect(() => loadConfig({ ...BASE, GITHUB_OAUTH_CLIENT_ID: "id" })).toThrow(/both/);
  });

  it("lists every problem at once", () => {
    expect(() => loadConfig({ API_PORT: "99999", RELEASELENS_MODE: "chaos" })).toThrow(
      /DATABASE_URL[\s\S]*API_PORT|API_PORT[\s\S]*DATABASE_URL/,
    );
  });
});

describe("requestIdFor", () => {
  function call(header?: string) {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (k: string, v: string) => (headers[k] = v),
    } as unknown as ServerResponse;
    const req = {
      headers: header === undefined ? {} : { "x-request-id": header },
    } as IncomingMessage;
    return { id: requestIdFor(req, res), headers };
  }

  it("reuses a well-formed incoming ID and echoes it", () => {
    expect(call("abc-123-def")).toEqual({
      id: "abc-123-def",
      headers: { "X-Request-Id": "abc-123-def" },
    });
  });

  it("replaces malformed IDs (log injection) with a fresh UUID", () => {
    const { id } = call("bad\nid injected");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("OriginGuard", () => {
  const guard = new OriginGuard(loadConfig(BASE), new Reflector());
  const ctx = (method: string, origin?: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ method, headers: origin ? { origin } : {} }) }),
      getHandler: () => () => undefined,
      getClass: () => Object,
    }) as unknown as ExecutionContext;

  it("allows safe methods from anywhere", () => {
    expect(guard.canActivate(ctx("GET"))).toBe(true);
  });

  it("allows writes only from the dashboard origin", () => {
    expect(guard.canActivate(ctx("POST", "http://localhost:3000"))).toBe(true);
    expect(() => guard.canActivate(ctx("POST"))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx("DELETE", "http://localhost:3000.evil.example"))).toThrow(
      ForbiddenException,
    );
  });
});

describe("hashToken", () => {
  it("is deterministic and does not contain the token", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toContain("abc");
    expect(hashToken("abc")).toHaveLength(64);
  });
});

describe("HttpGithubOAuthClient", () => {
  const client = new HttpGithubOAuthClient(
    loadConfig({ ...BASE, GITHUB_OAUTH_CLIENT_ID: "id", GITHUB_OAUTH_CLIENT_SECRET: "secret" }),
  );
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges a code and sends the PKCE verifier", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ access_token: "tok" })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client.exchangeCode("code", "verifier", "http://cb")).resolves.toBe("tok");
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, string>;
    expect(body).toMatchObject({
      code: "code",
      code_verifier: "verifier",
      redirect_uri: "http://cb",
    });
  });

  it("surfaces GitHub's error code but not the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "bad_verification_code" }))),
    );
    await expect(client.exchangeCode("c", "v", "http://cb")).rejects.toThrow(
      "bad_verification_code",
    );
  });

  it("rejects malformed profile responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ login: 42 }))));
    await expect(client.fetchProfile("tok")).rejects.toThrow(/profile request failed/);
  });
});
