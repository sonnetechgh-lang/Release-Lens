import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "./cli.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function exec(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await run(argv, {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    cwd: REPO_ROOT,
  });
  return { code, stdout, stderr };
}

describe("releaselens diagnose", () => {
  it("prints a Markdown report for a scenario directory", async () => {
    const { code, stdout } = await exec("diagnose", "tests/fixtures/scenarios/stale-deployment");
    expect(code).toBe(0);
    expect(stdout).toContain("# ReleaseLens diagnostic report");
    expect(stdout).toContain("[WARNING] Production is running an older build");
  });

  it("prints JSON when asked", async () => {
    const { code, stdout } = await exec(
      "diagnose",
      "tests/fixtures/scenarios/failed-workflow/snapshot.json",
      "--format",
      "json",
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { findings: { ruleId: string }[] };
    expect(parsed.findings.map((f) => f.ruleId)).toEqual(["workflow.failed"]);
  });

  it("exits 0 with no findings for the healthy baseline", async () => {
    const { code, stdout } = await exec("diagnose", "tests/fixtures/scenarios/healthy-baseline");
    expect(code).toBe(0);
    expect(stdout).toContain("No findings.");
  });

  it("exits 1 with a readable error for an invalid snapshot", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "releaselens-"));
    const file = path.join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, evaluatedAt: "yesterday" }));
    const { code, stderr } = await exec("diagnose", file);
    expect(code).toBe(1);
    expect(stderr).toContain("is not a valid snapshot");
    expect(stderr).toContain("evaluatedAt");
  });

  it("exits 1 for malformed JSON and missing files", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "releaselens-"));
    const file = path.join(dir, "broken.json");
    writeFileSync(file, "{ not json");
    expect((await exec("diagnose", file)).code).toBe(1);
    expect((await exec("diagnose", path.join(dir, "missing.json"))).code).toBe(1);
  });

  it("exits 2 on usage errors", async () => {
    expect((await exec()).code).toBe(2);
    expect((await exec("explode", "x")).code).toBe(2);
    expect((await exec("diagnose", "x", "--format", "xml")).code).toBe(2);
    expect((await exec("diagnose", "x", "--nope")).code).toBe(2);
  });

  it("prints help", async () => {
    const { code, stdout } = await exec("--help");
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: releaselens diagnose");
  });
});
