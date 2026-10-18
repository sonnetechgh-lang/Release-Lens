import { defineConfig } from "vitest/config";

// Every test in this package needs PostgreSQL, started in Docker by the global setup.
export default defineConfig({
  test: {
    include: ["src/**/*.int.test.ts"],
    globalSetup: ["./src/test-support/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
