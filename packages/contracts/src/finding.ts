import { z } from "zod";
import {
  ConfidenceSchema,
  EvidenceIdSchema,
  IsoUtcSchema,
  SeveritySchema,
  SlugSchema,
} from "./common.js";

export const FINDING_CATEGORIES = [
  "deployment",
  "workflow",
  "health",
  "migration",
  "evidence",
  "configuration",
] as const;
export const FindingCategorySchema = z.enum(FINDING_CATEGORIES);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

/** One sentence plus the evidence that backs it. */
export const StatementSchema = z.object({
  text: z.string().min(1),
  evidenceIds: z.array(EvidenceIdSchema),
});
export type Statement = z.infer<typeof StatementSchema>;

export const FindingSchema = z.object({
  /**
   * Deterministic fingerprint (rule + subject). Repeated observations of the same
   * problem produce the same ID, so they update one finding instead of creating many.
   */
  id: z.string().min(1),
  ruleId: z.string().min(1),
  ruleVersion: z.int().positive(),
  category: FindingCategorySchema,
  severity: SeveritySchema,
  confidence: ConfidenceSchema,
  title: z.string().min(1),
  subject: z.object({
    projectId: SlugSchema,
    serviceId: SlugSchema,
    environmentId: SlugSchema,
  }),
  detectedAt: IsoUtcSchema,
  /** What was observed. Every fact must cite evidence. */
  facts: z.array(StatementSchema.extend({ evidenceIds: z.array(EvidenceIdSchema).min(1) })).min(1),
  /** What the facts suggest. Never presented as proven. */
  inferences: z.array(StatementSchema),
  /** What could not be checked with the available evidence. */
  unknowns: z.array(z.string().min(1)),
  nextSteps: z.array(z.string().min(1)).min(1),
  /** Every evidence ID cited anywhere in this finding. */
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});
export type Finding = z.infer<typeof FindingSchema>;
