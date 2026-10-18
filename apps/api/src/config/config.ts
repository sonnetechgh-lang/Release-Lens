import { readFileSync } from "node:fs";
import { z } from "zod";

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item !== ""),
  );

const boolish = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true" || value === "1"));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    RELEASELENS_MODE: z.enum(["demo", "standard"]).default("demo"),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    API_HOST: z.string().default("127.0.0.1"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    /** Public URL of the dashboard. The API is reached through it at /api. */
    PUBLIC_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(24 * 7),
    COOKIE_SECURE: boolish,
    GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
    GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
    /** GitHub logins allowed to sign in. Owners are always allowed. */
    RELEASELENS_ALLOWED_GITHUB_LOGINS: csv,
    /** GitHub logins that become owners of the primary organization. */
    RELEASELENS_OWNER_GITHUB_LOGINS: csv,
    RELEASELENS_ORG_SLUG: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
      .default("default"),
    RELEASELENS_ORG_NAME: z.string().min(1).default("My organization"),
    REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
    /** Secret configured on the GitHub App's webhook. Webhooks are rejected without it. */
    GITHUB_WEBHOOK_SECRET: z
      .string()
      .min(16, "GITHUB_WEBHOOK_SECRET must be at least 16 characters")
      .optional(),
    GITHUB_APP_ID: z.string().regex(/^\d+$/, "GITHUB_APP_ID must be numeric").optional(),
    /** URL slug of the GitHub App, used to build its install link. */
    GITHUB_APP_SLUG: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY_PATH: z.string().optional(),
  })
  .refine(
    (env) =>
      (env.GITHUB_OAUTH_CLIENT_ID === undefined) === (env.GITHUB_OAUTH_CLIENT_SECRET === undefined),
    { message: "Set both GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET, or neither" },
  );

export interface AppConfig {
  env: "development" | "test" | "production";
  mode: "demo" | "standard";
  port: number;
  host: string;
  databaseUrl: string;
  publicUrl: string;
  /** Origin of PUBLIC_URL, e.g. http://localhost:3000. State-changing requests must come from it. */
  publicOrigin: string;
  logLevel: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
  github: { clientId: string; clientSecret: string } | null;
  allowedLogins: ReadonlySet<string>;
  ownerLogins: ReadonlySet<string>;
  primaryOrg: { slug: string; name: string };
  redisUrl: string;
  githubWebhookSecret: string | null;
  githubApp: { appId: string; privateKey: string; slug: string | null } | null;
}

export const APP_CONFIG = Symbol("APP_CONFIG");

/** Parses and validates environment variables. Throws a readable error listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Treat empty values (e.g. `GITHUB_OAUTH_CLIENT_ID=` copied from .env.example) as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  const e = result.data;
  const publicUrl = new URL(e.PUBLIC_URL);
  const privateKey =
    e.GITHUB_APP_PRIVATE_KEY_PATH !== undefined
      ? readFileSync(e.GITHUB_APP_PRIVATE_KEY_PATH, "utf8")
      : // Allow single-line keys with literal \n, as many secret stores require.
        e.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if ((e.GITHUB_APP_ID === undefined) !== (privateKey === undefined)) {
    throw new Error(
      "Invalid configuration: set both GITHUB_APP_ID and a GitHub App private key, or neither",
    );
  }
  return {
    env: e.NODE_ENV,
    mode: e.RELEASELENS_MODE,
    port: e.API_PORT,
    host: e.API_HOST,
    databaseUrl: e.DATABASE_URL,
    publicUrl: publicUrl.href.replace(/\/$/, ""),
    publicOrigin: publicUrl.origin,
    logLevel: e.LOG_LEVEL,
    sessionTtlMs: e.SESSION_TTL_HOURS * 60 * 60 * 1000,
    cookieSecure: e.COOKIE_SECURE ?? publicUrl.protocol === "https:",
    github:
      e.GITHUB_OAUTH_CLIENT_ID !== undefined && e.GITHUB_OAUTH_CLIENT_SECRET !== undefined
        ? { clientId: e.GITHUB_OAUTH_CLIENT_ID, clientSecret: e.GITHUB_OAUTH_CLIENT_SECRET }
        : null,
    allowedLogins: new Set([
      ...e.RELEASELENS_ALLOWED_GITHUB_LOGINS,
      ...e.RELEASELENS_OWNER_GITHUB_LOGINS,
    ]),
    ownerLogins: new Set(e.RELEASELENS_OWNER_GITHUB_LOGINS),
    primaryOrg: { slug: e.RELEASELENS_ORG_SLUG, name: e.RELEASELENS_ORG_NAME },
    redisUrl: e.REDIS_URL,
    githubWebhookSecret: e.GITHUB_WEBHOOK_SECRET ?? null,
    githubApp:
      e.GITHUB_APP_ID !== undefined && privateKey !== undefined
        ? { appId: e.GITHUB_APP_ID, privateKey, slug: e.GITHUB_APP_SLUG ?? null }
        : null,
  };
}
