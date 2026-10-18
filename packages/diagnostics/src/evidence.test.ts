import { describe, expect, it } from "vitest";
import { formatDuration, isProviderFresh, resolveDeployedIdentity } from "./evidence.js";
import { SHA, baseline, setSync } from "./test-support/fixtures.js";

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [45, "45s"],
    [900, "15m"],
    [3600, "1h"],
    [13_860, "3h 51m"],
    [86_400, "1d"],
    [90_000, "1d 1h"],
  ])("%d seconds -> %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});

describe("isProviderFresh", () => {
  it("is true for a recent successful sync", () => {
    expect(isProviderFresh(baseline(), "github")).toBe(true);
  });

  it("is false when the provider has no sync record", () => {
    expect(isProviderFresh(baseline(), "prisma")).toBe(false);
  });

  it("is false when the provider never synced or synced too long ago", () => {
    expect(
      isProviderFresh(
        baseline((i) => setSync(i, "github", undefined)),
        "github",
      ),
    ).toBe(false);
    expect(
      isProviderFresh(
        baseline((i) => setSync(i, "github", "2026-10-18T10:59:59Z")),
        "github",
      ),
    ).toBe(false);
  });
});

describe("resolveDeployedIdentity", () => {
  it("verifies via digest match with the run that built the image", () => {
    expect(resolveDeployedIdentity(baseline())).toMatchObject({
      verified: true,
      via: "digest-match",
      commitSha: SHA.B,
      evidenceIds: ["deploy-r102", "run-102"],
    });
  });

  it("prefers the digest match over embedded metadata", () => {
    const snapshot = baseline((i) => {
      i.deployment = { ...i.deployment!, commitSha: SHA.A, commitShaSource: "oci-label" };
    });
    expect(resolveDeployedIdentity(snapshot)).toMatchObject({
      via: "digest-match",
      commitSha: SHA.B,
    });
  });

  it("reports tag-only and digest-without-commit as unverified", () => {
    const tagOnly = baseline((i) => {
      delete i.deployment!.imageDigest;
    });
    expect(resolveDeployedIdentity(tagOnly)).toEqual({ verified: false, reason: "tag-only" });

    const unknownDigest = baseline((i) => {
      i.deployment!.imageDigest = `sha256:${"f".repeat(64)}`;
    });
    expect(resolveDeployedIdentity(unknownDigest)).toEqual({
      verified: false,
      reason: "digest-without-commit",
    });
  });

  it("reports a missing deployment", () => {
    expect(resolveDeployedIdentity(baseline((i) => delete i.deployment))).toEqual({
      verified: false,
      reason: "no-deployment",
    });
  });
});
