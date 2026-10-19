import { readFileSync } from "node:fs";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  GITHUB_APP_ID: z.string().regex(/^\d+$/).optional(),
  /** PEM contents. Prefer GITHUB_APP_PRIVATE_KEY_PATH so the key stays out of the environment. */
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  RECONCILE_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(10),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  /** off: targets are not read. simulated: recorded responses. azure: the real Azure API. */
  AZURE_PROVIDER_MODE: z.enum(["off", "simulated", "azure"]).default("off"),
  /** Directory of recorded responses for simulated mode. Defaults to the shipped fixtures. */
  AZURE_FIXTURES_DIR: z.string().optional(),
  AZURE_SYNC_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(5),
  AZURE_REQUEST_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(10),
});

export type AzureMode = "off" | "simulated" | "azure";

export interface WorkerConfig {
  env: "development" | "test" | "production";
  databaseUrl: string;
  redisUrl: string;
  logLevel: string;
  githubApp: { appId: string; privateKey: string } | null;
  reconcileIntervalMs: number;
  concurrency: number;
  azure: {
    mode: AzureMode;
    fixturesDir: string | undefined;
    syncIntervalMs: number;
    requestTimeoutMs: number;
  };
}

/** Reads the GitHub App private key from a file or the environment. */
function privateKeyFrom(env: z.infer<typeof EnvSchema>): string | undefined {
  if (env.GITHUB_APP_PRIVATE_KEY_PATH !== undefined) {
    return readFileSync(env.GITHUB_APP_PRIVATE_KEY_PATH, "utf8");
  }
  // Allow single-line keys with literal \n, as many secret stores require.
  return env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  const e = result.data;
  const privateKey = privateKeyFrom(e);
  if ((e.GITHUB_APP_ID === undefined) !== (privateKey === undefined)) {
    throw new Error(
      "Invalid configuration: set both GITHUB_APP_ID and a GitHub App private key, or neither",
    );
  }
  return {
    env: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    logLevel: e.LOG_LEVEL,
    githubApp:
      e.GITHUB_APP_ID !== undefined && privateKey !== undefined
        ? { appId: e.GITHUB_APP_ID, privateKey }
        : null,
    reconcileIntervalMs: e.RECONCILE_INTERVAL_MINUTES * 60 * 1000,
    concurrency: e.WORKER_CONCURRENCY,
    azure: {
      mode: e.AZURE_PROVIDER_MODE,
      fixturesDir: e.AZURE_FIXTURES_DIR,
      syncIntervalMs: e.AZURE_SYNC_INTERVAL_MINUTES * 60 * 1000,
      requestTimeoutMs: e.AZURE_REQUEST_TIMEOUT_SECONDS * 1000,
    },
  };
}
