import { describe, expect, it } from "vitest";
import { REDACTED, boundedExcerpt, redact, redactString } from "./redact.js";

// All secrets below are synthetic and have never been valid credentials.
const GH_TOKEN = `ghp_${"A1b2C3d4E5".repeat(4)}`;
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ";

describe("redactString", () => {
  it.each([
    ["GitHub token", `cloning with ${GH_TOKEN} failed`, GH_TOKEN],
    ["fine-grained PAT", `token github_pat_${"x1".repeat(20)}`, `github_pat_${"x1".repeat(20)}`],
    ["JWT", `got ${JWT}`, JWT],
    ["bearer header", "Authorization: Bearer abc.def-ghi_jkl123", "abc.def-ghi_jkl123"],
    ["URL credentials", "postgres://app:s3cr3t-pw@db.internal:5432/app", "s3cr3t-pw"],
    ["key=value password", "connecting with password=hunter2 to db", "hunter2"],
    ["JSON-style secret", '{"client_secret": "abcd1234efgh"}', "abcd1234efgh"],
    [
      "Azure storage key",
      "DefaultEndpointsProtocol=https;AccountName=demo;AccountKey=ZmFrZWtleQ==;EndpointSuffix=core.windows.net",
      "ZmFrZWtleQ==",
    ],
    [
      "SAS signature",
      "https://demo.blob.core.windows.net/c?sv=2024&sig=AbCdEf%2B123",
      "AbCdEf%2B123",
    ],
    ["AWS access key", "key AKIAABCDEFGHIJKLMNOP used", "AKIAABCDEFGHIJKLMNOP"],
    [
      "private key block",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----",
      "MIIEow",
    ],
  ])("removes a %s", (_name, input, secret) => {
    const output = redactString(input);
    expect(output).not.toContain(secret);
    expect(output).toContain(REDACTED);
  });

  it("keeps the non-secret parts of the text", () => {
    expect(redactString("postgres://app:pw123456@db:5432/app")).toBe(
      `postgres://app:${REDACTED}@db:5432/app`,
    );
    expect(redactString("password=hunter2 user=alice")).toBe(`password=${REDACTED} user=alice`);
  });

  it("leaves ordinary text alone", () => {
    const text = "Deployed revision storefront-api--r102 with commit a1b2c3d in 42 ms";
    expect(redactString(text)).toBe(text);
  });
});

describe("redact", () => {
  it("redacts values under sensitive keys and scans nested strings", () => {
    const input = {
      user: "alice",
      password: "hunter2",
      headers: { authorization: "Bearer xyz", "x-request-id": "req-1" },
      nested: [{ message: `token ${GH_TOKEN}` }],
      databaseConnectionString: "Server=x;Password=y",
    };
    expect(redact(input)).toEqual({
      user: "alice",
      password: REDACTED,
      headers: { authorization: REDACTED, "x-request-id": "req-1" },
      nested: [{ message: `token ${REDACTED}` }],
      databaseConnectionString: REDACTED,
    });
  });

  it("does not mutate the input", () => {
    const input = { password: "hunter2" };
    redact(input);
    expect(input.password).toBe("hunter2");
  });

  it("handles errors, cycles, and deep nesting", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(redact(cyclic)).toEqual({ a: 1, self: "[CIRCULAR]" });

    expect(redact(new Error("bad password=hunter2"))).toEqual({
      name: "Error",
      message: `bad password=${REDACTED}`,
    });

    let deep: unknown = "leaf";
    for (let i = 0; i < 20; i++) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain("[TRUNCATED]");
  });

  it("passes through primitives", () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });
});

describe("boundedExcerpt", () => {
  it("redacts and truncates", () => {
    const excerpt = boundedExcerpt(`password=hunter2 ${"x".repeat(1000)}`, 50);
    expect(excerpt).not.toContain("hunter2");
    expect(excerpt.endsWith("… [truncated]")).toBe(true);
    expect(excerpt.length).toBeLessThan(70);
  });
});
