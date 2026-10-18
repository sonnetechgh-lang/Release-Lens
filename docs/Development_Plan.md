# ReleaseLens — Development Plan

Companion to `ReleaseLens_Project_Plan.md`. That document says _what_ to build; this one says _how and in what order_.

## Decisions

| Topic                  | Decision                                                    | Notes                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audience               | Portfolio first, self-hostable second                       | One organization per install, run with Docker Compose. No hosted SaaS, no multi-tenancy or billing.                                                         |
| License                | MIT                                                         | `LICENSE` file at the repo root from the first commit.                                                                                                      |
| User sign-in           | GitHub OAuth                                                | Handled by the API. The browser only holds an httpOnly session cookie, never a GitHub token.                                                                |
| Repository integration | GitHub App (not a personal access token)                    | Least-privilege, read-only permissions, built-in webhooks, short-lived installation tokens. Self-hosters create their own app from a manifest file we ship. |
| Azure                  | No subscription yet                                         | Build against an `AzureAdapter` interface with a fake implementation and recorded fixtures. Verify against real Azure later (see Phase 4).                  |
| Pace                   | 20+ hours/week                                              | Estimates below assume that pace. They are targets, not promises.                                                                                           |
| Tooling                | pnpm workspaces + Turborepo, Node 24 LTS, TypeScript strict | ESLint + Prettier, Vitest for packages, Jest for NestJS (its default), Playwright for E2E.                                                                  |
| Stack                  | As in the project plan                                      | Next.js, NestJS, PostgreSQL + Prisma, Redis + BullMQ, Docker Compose.                                                                                       |

## Guiding rules

1. **Engine first, UI last.** The diagnostics engine is a pure TypeScript package with no database, HTTP or provider code, so it is fully testable with fixtures.
2. **Every provider sits behind an interface** (`SourceControlProvider`, `DeploymentTargetProvider`, `MigrationInspector`) with a fake implementation. Demo mode runs entirely on the fakes, so reviewers need no GitHub App or Azure account.
3. **Unknown is a first-class result.** Missing or stale data produces `unknown` or `unverified`, never `healthy`.
4. **Read-only, always.** No code path may mutate cloud resources or databases outside ReleaseLens's own database.
5. **Each phase ends with something runnable and a green CI.**

## Phase 0 — Repo bootstrap and problem definition (week 1) ✅ done

- `git init`, MIT `LICENSE`, `README.md` (problem statement + "status: early development"), `.gitignore`, `.editorconfig`, `.env.example`.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (how to report vulnerabilities), issue and PR templates.
- pnpm + Turborepo skeleton with only `packages/config` and `packages/diagnostics` at first.
- GitHub Actions CI: install, lint, typecheck, test, build. Add Dependabot and secret scanning.
- Docs: `docs/architecture.md` (Mermaid diagram from the plan), `docs/threat-model.md` (first draft: webhooks, SSRF, credentials, log leakage, authorization), `docs/decisions/0001-*.md` ADRs recording the decisions above.
- **Exit:** CI is green on an empty-but-real monorepo; the threat model and the first three rules are written down.

## Phase 1 — Diagnostics engine on fixtures (weeks 2–3) ✅ done

Matches priority #1 in the project plan.

- `packages/contracts`: Zod schemas for normalized evidence (`WorkflowRunEvidence`, `DeploymentEvidence`, `HealthCheckEvidence`, `MigrationEvidence`) and `Finding` (id, rule id + version, category, severity, confidence, fact/inference/unknown sections, evidence refs, recommended next step).
- `packages/diagnostics`: a rule interface `evaluate(snapshot) → Finding[]`, plus a rule registry with versioned rules.
- First rules: **stale deployment**, **image identity unverified** (tag only, no digest/metadata), **health endpoint failing**. Then **workflow failed** and **evidence stale**.
- `tests/fixtures/scenarios/*`: one folder per fault scenario (input snapshot + expected findings). These are the plan's fault-injection scenarios in data form.
- A small CLI (`pnpm diagnose fixtures/stale-image`) that prints findings and a Markdown report, so the engine can be demoed early.
- Tests: positive, negative, missing-data and stale-data cases for every rule.
- **Exit:** at least 3 fixture scenarios produce exactly the expected findings in CI.

## Phase 2 — Foundation: API, database, auth, basic UI (weeks 4–6) ✅ done

- `docker-compose.yml`: Postgres, Redis, Mailpit.
- `apps/api` (NestJS): config validation, structured logging (pino) with a redaction utility, correlation IDs, `/healthz` and `/readyz`, OpenAPI generation, global validation pipe, rate limiting.
- Prisma schema for the core entities in plan §8 (Organization, Membership, Project, Environment, Integration, WorkflowRun, Artifact, Deployment, HealthCheck, MigrationCheck, DiagnosticFinding, Incident, AuditEvent). Unique constraints on provider event and delivery IDs.
- GitHub OAuth sign-in, server-side sessions, roles (`owner`, `viewer`), and an authorization guard that checks org/project ownership on every request.
- Seed script that loads fixture scenarios as a demo project.
- `apps/web` (Next.js + Tailwind + shadcn/ui): sign-in, project list, deployment history, findings list. Basic but with loading and error states.
- Tests: Supertest integration tests against a real Postgres (Testcontainers or a Compose service in CI), plus authorization-boundary tests (user A cannot read project B).
- **Exit:** `docker compose up` → sign in → see a seeded project with deterministic deployment history and findings.

## Phase 3 — GitHub integration (weeks 7–8) ✅ done

- GitHub App manifest and setup docs. Permissions: Actions read, Contents read, Deployments read, Metadata read.
- Webhook endpoint: raw-body HMAC-SHA256 signature check, payload size limit, persist delivery ID (unique) → enqueue → return 2xx fast.
- `apps/worker` (BullMQ): normalize `workflow_run`, `workflow_job`, `push` and `deployment_status` events, with idempotent upserts.
- Reconciliation job: periodically pull recent workflow runs to fill gaps from missed webhooks.
- Error states in the UI: integration revoked, permissions missing, rate limited.
- Tests: signature validation, duplicate delivery (scenario 7), and rate-limit/retry handling with mocked Octokit.
- **Exit:** pushing to a demo repo makes a workflow run appear exactly once, linked to its commit and to GitHub.

## Phase 4 — Deployment target: Azure Container Apps (weeks 9–10)

Without a subscription, this phase is split into two parts.

**4a — no Azure needed:**

- `DeploymentTargetProvider` interface. Implement `AzureContainerAppsProvider` with `@azure/arm-appcontainers` + `@azure/identity`, unit-tested against mocked SDK responses that are shaped after the documented API.
- `FakeDeploymentTarget` for demo mode and local development.
- Sync status per integration: last success, last error, which data is missing.
- Timeout, throttling (429) and expired-credential handling (scenario 6).
- Document the required Azure role (`Reader` scoped to the resource group) and the identity options (managed identity, or a service principal / workload identity federation).

**4b — real Azure (short, time-boxed):**

- Open an Azure free account when 4a is done, so the free credits are spent on verification instead of sitting idle. Check current free-tier terms first.
- Deploy the disposable demo app with Bicep (`infra/azure`), verify the adapter against real responses, and record sanitized fixtures from them. Set a budget alert and a teardown script on day one.
- **Exit:** the dashboard shows real (or fake-provider) revision state and openly marks missing or stale data.

## Phase 5 — Correlation, health checks, incidents (weeks 11–12)

- Correlation service: commit ↔ workflow run ↔ image digest ↔ revision. Prefer digests and OCI labels (`org.opencontainers.image.revision`). Anything not verifiable is marked `unverified`.
- HTTP health checks with an SSRF guard: https/http only, DNS resolved and checked against loopback/private/link-local ranges, redirects revalidated, bounded timeouts and response size, response stored as a redacted excerpt.
- Worker runs the diagnostics engine on new evidence and stores findings with evidence refs. Finding states: open → acknowledged → resolved.
- Incident timeline UI with filters; Markdown export.
- **Exit:** fault scenarios 1–4 and 6–8 reproduce end-to-end through the real pipeline, not just fixtures.

## Phase 6 — Migrations and notifications (weeks 13–14)

- `PrismaMigrationInspector`: reads only `_prisma_migrations` over a dedicated read-only role. The query is fixed in code (no user-supplied SQL). Compares against expected migrations from release metadata. Other migration systems are reported as `unsupported`.
- Test it against a disposable Postgres with an unapplied/failed migration (scenario 5).
- Email notifications (Nodemailer → Mailpit locally) with dedup keyed on finding fingerprint + state.
- Security and retention review: retention jobs, audit events, and redaction tests over notifications and reports.
- **Exit:** migration state is reported without executing anything; no secrets in any output channel.

## Phase 7 — Public release v0.1.0 (weeks 15–16)

- README per plan §15: GIF, screenshots, architecture, setup, environment-variable reference, scenarios, security model, limitations.
- Playwright E2E suite in CI on the demo-mode stack.
- Published Docker images (GHCR) and a tagged `v0.1.0` release with a changelog (Changesets or release-please).
- Public demo running on fake providers + synthetic data. Pick hosting after checking current pricing.
- "Good first issue" labels and a short roadmap (Slack notifications, more migration adapters, optional AI summaries).
- **Exit:** the Definition of Done checklist in plan §17 is all ticked.

## Repo layout at v0.1.0

```text
releaselens/
├── apps/{web,api,worker}
├── packages/{contracts,diagnostics,integrations,config}
├── infra/{docker,azure}
├── tests/{integration,e2e,fixtures}
├── docs/{architecture,security,threat-model,runbook}.md, docs/decisions/
├── docker-compose.yml, .env.example, LICENSE (MIT), README.md
```

## Still to decide (not blocking Phase 0)

- GitHub owner for the public repo (personal account or an org), and whether the `releaselens` name is free there and on npm/GHCR.
- Where the public demo is hosted (decide in Phase 7 after a price check).
- Which demo app gets deployed in Phase 4b (a tiny Prisma + Express/Nest service is enough).
