# 0002. pnpm + Turborepo monorepo, TypeScript 6.0

- Status: Accepted
- Date: 2026-10-18

## Context

The project has a web app, an API, a worker, and shared packages that must share types and build in dependency order.

## Decision

- pnpm workspaces for package management, Turborepo for task orchestration and caching.
- Node.js 24 LTS (`.nvmrc`), strict TypeScript, ES modules.
- Pin TypeScript to `~6.0`. TypeScript 7 (the native compiler) is available, but `typescript-eslint` supports only `<6.1`, and NestJS tooling depends on the JavaScript compiler API. Revisit when the ecosystem supports 7.
- One root ESLint flat config with type-aware `strictTypeChecked` rules; Prettier for formatting.
- Vitest for packages; Jest for the NestJS API (its default); Playwright for end-to-end tests.

## Consequences

- Packages build to `dist/` and are consumed through their `exports`, so `typecheck` and `test` depend on upstream builds (`^build` in `turbo.json`).
- Moving to TypeScript 7 later will need a separate decision record.
