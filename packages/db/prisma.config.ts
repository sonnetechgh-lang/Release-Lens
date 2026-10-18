import { defineConfig } from "prisma/config";

// Prisma 7 does not load .env files itself. Use the repo root .env if present.
try {
  process.loadEnvFile("../../.env");
} catch {
  // No .env file: rely on the real environment.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node dist/seed/main.js",
  },
  datasource: {
    // Optional so `prisma generate` works without a database.
    url: process.env.DATABASE_URL ?? "",
  },
});
