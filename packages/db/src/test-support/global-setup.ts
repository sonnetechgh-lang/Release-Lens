import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { externalDatabase, migrate } from "./external-services.js";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Starts a throwaway PostgreSQL container for the integration tests and applies
 * the real migrations to it. Requires Docker, unless RELEASELENS_TEST_POSTGRES_URL
 * points to a running server (see external-services.ts).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = externalDatabase("db");
  if (external !== null) {
    project.provide("databaseUrl", external);
    return () => Promise.resolve();
  }
  const container = await new PostgreSqlContainer("postgres:18-alpine")
    .withDatabase("releaselens_test")
    // Docker Desktop can be slow to initialise PostgreSQL.
    .withStartupTimeout(300_000)
    .start();
  const databaseUrl = container.getConnectionUri();

  migrate(databaseUrl);

  project.provide("databaseUrl", databaseUrl);
  return async () => {
    await container.stop();
  };
}
