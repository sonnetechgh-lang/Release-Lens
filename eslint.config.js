// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/src/generated/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Tests build fixtures by mutating known-good data; `!` and terse arrows keep them readable.
    files: ["**/*.test.ts", "**/test-support/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      // HTTP response bodies in API tests are untyped JSON.
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  {
    // NestJS modules are intentionally empty classes configured by decorators.
    files: ["**/*.module.ts"],
    rules: { "@typescript-eslint/no-extraneous-class": "off" },
  },
  {
    // Tool config files are not part of any TypeScript project, so lint them without type info.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
);
