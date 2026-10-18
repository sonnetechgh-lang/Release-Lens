import { z } from "zod";

/** ISO 8601 timestamp in UTC (must end in `Z`). Everything is stored in UTC. */
export const IsoUtcSchema = z.iso.datetime();

/** Full 40-character Git commit SHA. Short SHAs are ambiguous, so they are rejected. */
export const CommitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "Expected a full 40-character lowercase commit SHA");

/** Immutable container image digest. */
export const ImageDigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "Expected an image digest like sha256:<64 hex characters>");

/** Identifier for a single piece of evidence, referenced by findings. */
export const EvidenceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/, "Evidence IDs use letters, digits, . _ : -");

/** Lowercase identifier for projects, services, and environments. */
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "Use lowercase letters, digits, and hyphens");

export const SEVERITIES = ["info", "warning", "high", "critical"] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

export const CONFIDENCES = ["low", "medium", "high"] as const;
export const ConfidenceSchema = z.enum(CONFIDENCES);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Higher number = more severe. Useful for sorting. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  info: 0,
  warning: 1,
  high: 2,
  critical: 3,
};
