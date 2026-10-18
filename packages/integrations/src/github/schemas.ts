import { z } from "zod";

// Only the fields ReleaseLens uses. Unknown fields are ignored, so GitHub can add
// fields without breaking ingestion; missing required fields are rejected.

export const GithubWorkflowRunSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().nullish(),
  path: z.string().nullish(),
  head_branch: z.string().nullish(),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/),
  status: z.string().nullish(),
  conclusion: z.string().nullish(),
  event: z.string().nullish(),
  run_attempt: z.number().int().nullish(),
  run_started_at: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string(),
  html_url: z.url().nullish(),
});
export type GithubWorkflowRun = z.infer<typeof GithubWorkflowRunSchema>;

export const GithubRepositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
  default_branch: z.string().nullish(),
  owner: z.object({ login: z.string() }),
  html_url: z.url().nullish(),
});
export type GithubRepository = z.infer<typeof GithubRepositorySchema>;

export const GithubInstallationSchema = z.object({
  id: z.number().int().positive(),
  account: z.object({ login: z.string(), type: z.string() }).nullish(),
  repository_selection: z.string().nullish(),
  suspended_at: z.string().nullish(),
  permissions: z.record(z.string(), z.string()).nullish(),
});
export type GithubInstallation = z.infer<typeof GithubInstallationSchema>;

export const InstallationTokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string(),
});

export const WorkflowRunsPageSchema = z.object({
  total_count: z.number().int(),
  workflow_runs: z.array(GithubWorkflowRunSchema),
});

export const InstallationRepositoriesPageSchema = z.object({
  total_count: z.number().int(),
  repositories: z.array(GithubRepositorySchema),
});

// ---- Webhook payloads ----

const InstallationRef = z.object({ id: z.number().int().positive() });
const RepositoryRef = z.object({ id: z.number().int().positive(), full_name: z.string() });

export const WorkflowRunEventSchema = z.object({
  action: z.string(),
  workflow_run: GithubWorkflowRunSchema,
  repository: RepositoryRef,
  installation: InstallationRef.optional(),
});
export type WorkflowRunEvent = z.infer<typeof WorkflowRunEventSchema>;

export const InstallationEventSchema = z.object({
  action: z.string(),
  installation: GithubInstallationSchema,
});
export type InstallationEvent = z.infer<typeof InstallationEventSchema>;

export const InstallationRepositoriesEventSchema = z.object({
  action: z.string(),
  installation: GithubInstallationSchema,
  repositories_removed: z.array(z.object({ id: z.number().int().positive() })).optional(),
});
export type InstallationRepositoriesEvent = z.infer<typeof InstallationRepositoriesEventSchema>;

/** Fields present on most events; used to route a delivery before full parsing. */
export const WebhookEnvelopeSchema = z.object({
  action: z.string().optional(),
  installation: InstallationRef.optional(),
  repository: RepositoryRef.optional(),
});
