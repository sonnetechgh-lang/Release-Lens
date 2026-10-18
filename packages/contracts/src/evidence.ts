import { z } from "zod";
import {
  CommitShaSchema,
  EvidenceIdSchema,
  ImageDigestSchema,
  IsoUtcSchema,
  SlugSchema,
} from "./common.js";

export const PROVIDERS = ["github", "azure-container-apps", "health-probe", "prisma"] as const;
export const ProviderSchema = z.enum(PROVIDERS);
export type Provider = z.infer<typeof ProviderSchema>;

const evidenceBase = {
  id: EvidenceIdSchema,
  /** When ReleaseLens observed this evidence (not when the event happened). */
  observedAt: IsoUtcSchema,
  /** Link back to the source, e.g. the GitHub run page or Azure portal resource. */
  url: z.url({ protocol: /^https?$/ }).optional(),
};

export const WorkflowRunEvidenceSchema = z
  .object({
    ...evidenceBase,
    provider: z.literal("github"),
    runId: z.string().min(1),
    workflowName: z.string().min(1),
    branch: z.string().min(1),
    commitSha: CommitShaSchema,
    status: z.enum(["queued", "in_progress", "completed"]),
    conclusion: z
      .enum([
        "success",
        "failure",
        "cancelled",
        "timed_out",
        "skipped",
        "neutral",
        "action_required",
        "stale",
      ])
      .optional(),
    startedAt: IsoUtcSchema,
    completedAt: IsoUtcSchema.optional(),
    /** Digest of the image this run pushed, if the build reported it. */
    producedImageDigest: ImageDigestSchema.optional(),
  })
  .refine(
    (run) =>
      (run.status === "completed") ===
      (run.conclusion !== undefined && run.completedAt !== undefined),
    { message: "Completed runs need conclusion and completedAt; other runs must have neither" },
  );
export type WorkflowRunEvidence = z.infer<typeof WorkflowRunEvidenceSchema>;

export const DeploymentEvidenceSchema = z
  .object({
    ...evidenceBase,
    provider: z.literal("azure-container-apps"),
    revisionName: z.string().min(1),
    /** Image reference as configured on the revision, e.g. `registry/app:tag` or `registry/app@sha256:...`. */
    imageReference: z.string().min(1),
    imageDigest: ImageDigestSchema.optional(),
    /** Commit read from the image itself (OCI label) or from build metadata the app exposes. */
    commitSha: CommitShaSchema.optional(),
    commitShaSource: z.enum(["oci-label", "build-metadata"]).optional(),
    activeSince: IsoUtcSchema,
    providerStatus: z.enum(["running", "provisioning", "failed", "stopped", "unknown"]),
  })
  .refine((d) => (d.commitSha === undefined) === (d.commitShaSource === undefined), {
    message: "commitSha and commitShaSource must be provided together",
  });
export type DeploymentEvidence = z.infer<typeof DeploymentEvidenceSchema>;

export const HealthCheckEvidenceSchema = z
  .object({
    ...evidenceBase,
    provider: z.literal("health-probe"),
    /** Display name or URL of the checked endpoint (never includes credentials). */
    endpoint: z.string().min(1),
    outcome: z.enum(["pass", "fail"]),
    httpStatus: z.int().min(100).max(599).optional(),
    durationMs: z.int().nonnegative(),
    failureKind: z
      .enum(["timeout", "connection", "unexpected-status", "tls", "blocked"])
      .optional(),
  })
  .refine((h) => (h.outcome === "fail") === (h.failureKind !== undefined), {
    message: "failureKind is required for failed checks and not allowed for passing ones",
  });
export type HealthCheckEvidence = z.infer<typeof HealthCheckEvidenceSchema>;

/**
 * Sync state of one integration. Errors are stored as a category, never as raw
 * provider messages, so credentials or internal details cannot leak through them.
 */
export const SyncStatusEvidenceSchema = z.object({
  id: EvidenceIdSchema,
  provider: ProviderSchema,
  lastAttemptAt: IsoUtcSchema.optional(),
  lastSuccessfulSyncAt: IsoUtcSchema.optional(),
  lastErrorKind: z
    .enum([
      "timeout",
      "rate-limited",
      "unauthorized",
      "forbidden",
      "not-found",
      "server-error",
      "network",
    ])
    .optional(),
});
export type SyncStatusEvidence = z.infer<typeof SyncStatusEvidenceSchema>;

export const PolicySchema = z.object({
  /** Consecutive failed health checks before a finding is raised. */
  healthFailureThreshold: z.int().min(1).default(3),
  /** Health results older than this are treated as unknown. */
  healthFreshnessSeconds: z.int().positive().default(900),
  /** Integration data older than this is treated as stale. */
  evidenceFreshnessSeconds: z.int().positive().default(3600),
  /** Time allowed for a successful build to reach the environment before it counts as stale. */
  deploymentGraceSeconds: z.int().nonnegative().default(900),
  /** A stale deployment older than this is raised as `high` instead of `warning`. */
  staleDeploymentHighAfterSeconds: z.int().positive().default(86_400),
});
export type Policy = z.infer<typeof PolicySchema>;

/**
 * Everything the diagnostics engine knows about one service in one environment
 * at one point in time. Rules are pure functions of this snapshot.
 */
export const DiagnosticSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** The "now" used by all rules, so results are reproducible. */
    evaluatedAt: IsoUtcSchema,
    project: z.object({ id: SlugSchema, name: z.string().min(1) }),
    service: z.object({ id: SlugSchema, name: z.string().min(1) }),
    environment: z.object({
      id: SlugSchema,
      name: z.string().min(1),
      /** Branch whose successful builds should be deployed to this environment. */
      releaseBranch: z.string().min(1),
      /** Only runs of this workflow count as releases. All workflows count if omitted. */
      deployWorkflowName: z.string().min(1).optional(),
    }),
    policy: PolicySchema.prefault({}),
    workflowRuns: z.array(WorkflowRunEvidenceSchema).default([]),
    /** The revision currently serving traffic, if known. */
    deployment: DeploymentEvidenceSchema.optional(),
    healthChecks: z.array(HealthCheckEvidenceSchema).default([]),
    syncStatus: z.array(SyncStatusEvidenceSchema).default([]),
  })
  .superRefine((snapshot, ctx) => {
    const ids = [
      ...snapshot.workflowRuns.map((e) => e.id),
      ...(snapshot.deployment ? [snapshot.deployment.id] : []),
      ...snapshot.healthChecks.map((e) => e.id),
      ...snapshot.syncStatus.map((e) => e.id),
    ];
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate evidence id "${id}"` });
      }
      seen.add(id);
    }
    const providers = snapshot.syncStatus.map((s) => s.provider);
    if (new Set(providers).size !== providers.length) {
      ctx.addIssue({ code: "custom", message: "syncStatus has more than one entry per provider" });
    }
  });
export type DiagnosticSnapshot = z.infer<typeof DiagnosticSnapshotSchema>;
/** Snapshot as written in JSON, before defaults are applied. */
export type DiagnosticSnapshotInput = z.input<typeof DiagnosticSnapshotSchema>;

export type SnapshotParseResult =
  { success: true; snapshot: DiagnosticSnapshot } | { success: false; error: string };

/** Validates untrusted input (e.g. a JSON file) and applies policy defaults. */
export function parseSnapshot(input: unknown): SnapshotParseResult {
  const result = DiagnosticSnapshotSchema.safeParse(input);
  return result.success
    ? { success: true, snapshot: result.data }
    : { success: false, error: z.prettifyError(result.error) };
}
