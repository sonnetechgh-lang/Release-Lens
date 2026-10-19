import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";
import type { TestProject } from "vitest/node";
import { externalDatabase, externalRedis, migrate } from "@releaselens/db/testing";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

/** Throwaway PostgreSQL (with real migrations) and Redis for the API tests. Requires Docker. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Reuse running servers when RELEASELENS_TEST_POSTGRES_URL / _REDIS_URL are set.
  const externalDb = externalDatabase("api");
  const externalRedisUrl = await externalRedis(14);
  if (externalDb !== null && externalRedisUrl !== null) {
    project.provide("databaseUrl", externalDb);
    project.provide("redisUrl", externalRedisUrl);
    return () => Promise.resolve();
  }
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

  migrate(databaseUrl);

  project.provide("databaseUrl", databaseUrl);
  project.provide("redisUrl", `redis://${redis.getHost()}:${String(redis.getMappedPort(6379))}`);
  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
