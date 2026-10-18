import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseSnapshot,
  type DiagnosticSnapshot,
  type DiagnosticSnapshotInput,
} from "@releaselens/contracts";

export const SCENARIOS_DIR = fileURLToPath(
  new URL("../../../../tests/fixtures/scenarios/", import.meta.url),
);

export const SHA = {
  A: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  B: "b2c3d4e5f60718293a4b5c6d7e8f901234567890",
  C: "c3d4e5f60718293a4b5c6d7e8f90123456789012",
} as const;

export const DIGEST = {
  A: `sha256:${"a".repeat(64)}`,
  B: `sha256:${"b".repeat(64)}`,
  C: `sha256:${"c".repeat(64)}`,
} as const;

export interface ExpectedFinding {
  ruleId: string;
  severity: string;
  confidence: string;
  evidenceIds: string[];
}

export interface Scenario {
  name: string;
  description: string;
  input: unknown;
  expected: ExpectedFinding[];
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

export function listScenarios(): Scenario[] {
  return readdirSync(SCENARIOS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = `${SCENARIOS_DIR}${entry.name}/`;
      const expected = readJson(`${dir}expected.json`) as {
        description: string;
        findings: ExpectedFinding[];
      };
      return {
        name: entry.name,
        description: expected.description,
        input: readJson(`${dir}snapshot.json`),
        expected: expected.findings,
      };
    });
}

/** Parses a snapshot and throws if it is invalid, so tests fail loudly on bad fixtures. */
export function parse(input: unknown): DiagnosticSnapshot {
  const result = parseSnapshot(input);
  if (!result.success) throw new Error(`Invalid test snapshot:\n${result.error}`);
  return result.snapshot;
}

/**
 * Returns the healthy baseline scenario (no findings), optionally modified.
 * Every rule test starts from here and changes only what it needs.
 */
export function baseline(modify?: (input: DiagnosticSnapshotInput) => void): DiagnosticSnapshot {
  const input = structuredClone(
    readJson(`${SCENARIOS_DIR}healthy-baseline/snapshot.json`),
  ) as DiagnosticSnapshotInput;
  modify?.(input);
  return parse(input);
}

/** Sets one integration's last successful sync time (or removes it). */
export function setSync(
  input: DiagnosticSnapshotInput,
  provider: string,
  lastSuccessfulSyncAt: string | undefined,
  lastErrorKind?: "timeout" | "unauthorized" | "rate-limited",
): void {
  const status = input.syncStatus?.find((s) => s.provider === provider);
  if (status === undefined) throw new Error(`No sync status for ${provider} in baseline`);
  if (lastSuccessfulSyncAt === undefined) delete status.lastSuccessfulSyncAt;
  else status.lastSuccessfulSyncAt = lastSuccessfulSyncAt;
  if (lastErrorKind !== undefined) status.lastErrorKind = lastErrorKind;
}
