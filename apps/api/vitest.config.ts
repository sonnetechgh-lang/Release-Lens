import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// NestJS relies on decorator metadata, which esbuild cannot emit, so tests compile with SWC.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          globalSetup: ["./src/test-support/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 360_000,
        },
      },
    ],
  },
});
