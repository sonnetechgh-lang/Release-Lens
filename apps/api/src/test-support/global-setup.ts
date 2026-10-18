import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

const DB_PACKAGE_DIR = fileURLToPath(new URL("../../../../packages/db/", import.meta.url));

/** Throwaway PostgreSQL (with real migrations) and Redis for the API tests. Requires Docker. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Started one at a time with a generous timeout: Docker Desktop can be slow to initialise PostgreSQL.
  const postgres = await new PostgreSqlContainer("postgres:18-alpine")
    .withDatabase("releaselens_test")
    .withStartupTimeout(300_000)
    .start();
  const redis = await new GenericContainer("redis:8-alpine")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
    .withStartupTimeout(300_000)
    .start();
  const databaseUrl = postgres.getConnectionUri();

  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy"], {
    cwd: DB_PACKAGE_DIR,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
    shell: process.platform === "win32",
  });

  project.provide("databaseUrl", databaseUrl);
  project.provide("redisUrl", `redis://${redis.getHost()}:${String(redis.getMappedPort(6379))}`);
  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
