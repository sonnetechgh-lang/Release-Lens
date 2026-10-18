import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const DB_PACKAGE_DIR = fileURLToPath(new URL("../../../../packages/db/", import.meta.url));

/**
 * Starts a throwaway PostgreSQL container for the integration tests and applies
 * the real migrations to it. Requires Docker.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer("postgres:18-alpine")
    .withDatabase("releaselens_test")
    .start();
  const databaseUrl = container.getConnectionUri();

  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy"], {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
    shell: process.platform === "win32",
  });

  project.provide("databaseUrl", databaseUrl);
  return async () => {
    await container.stop();
  };
}
