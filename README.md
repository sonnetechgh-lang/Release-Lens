# ReleaseLens

> **Status: early development (Phase 3).** Demo data, the dashboard, and GitHub integration (workflow runs via a read-only GitHub App) work. Azure integration is not built yet. See the [development plan](docs/Development_Plan.md).

ReleaseLens is an open-source, read-only deployment diagnostics tool. It correlates evidence from source control, CI/CD, cloud deployments, health checks, and database migrations to answer questions like:

- Is the commit I expect actually deployed?
- Which container image and revision are running?
- Did the CI workflow succeed, and is the app healthy?
- Are the expected database migrations applied?
- What changed right before an incident, and which conclusions are facts versus hypotheses?

It is designed to **complement** tools like Azure Monitor and GitHub Actions, not replace them. It never restarts services, runs migrations, or changes infrastructure.

## Initial scope

- GitHub (via a read-only GitHub App) for commits and workflow runs
- Azure Container Apps for deployed revisions
- HTTP health checks
- Prisma migration status
- A demo mode that runs entirely on synthetic data, with no GitHub or Azure account needed

## Repository layout

```text
apps/web/             # Next.js dashboard
apps/api/             # NestJS API: sign-in, sessions, access control, project data, webhooks
apps/worker/          # BullMQ worker: webhook processing, GitHub reconciliation, diagnostics
apps/cli/             # releaselens diagnose command
packages/contracts/   # validated evidence, finding, and API schemas (Zod)
packages/diagnostics/ # deterministic rules and Markdown reports
packages/db/          # Prisma schema, migrations, evidence storage, demo seed
packages/redact/      # secret redaction for logs and stored metadata
packages/integrations/ # read-only GitHub App client, webhook verification
packages/jobs/        # queue names, job payloads, retry policy
packages/config/      # shared TypeScript config
tests/fixtures/       # synthetic fault scenarios
docs/                 # plans, architecture, threat model, decision records
```

## Run it locally

Requirements: Node.js 24+, pnpm 11+, and Docker.

```sh
cp .env.example .env
pnpm install
pnpm db:setup  # starts PostgreSQL and Redis in Docker, applies migrations, loads demo data
pnpm dev       # API on :4000, worker, dashboard on http://localhost:3000
```

Open http://localhost:3000 and choose **Explore the demo**. The demo has six services, each showing one kind of deployment problem. All data is synthetic.

If port 5432 is already in use, set `POSTGRES_PORT=5433` in `.env` and use the same port in `DATABASE_URL`.

### GitHub sign-in (optional)

1. Create an OAuth app at https://github.com/settings/developers with the callback URL `http://localhost:3000/api/auth/github/callback`.
2. Put its client ID and secret in `.env` (`GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`).
3. Add your GitHub login to `RELEASELENS_OWNER_GITHUB_LOGINS`. Only listed logins can sign in.

ReleaseLens uses the GitHub token once to read your profile and never stores it.

### Connecting real repositories (optional)

Create a read-only GitHub App and connect repositories from the dashboard. See [docs/github-app.md](docs/github-app.md).

### Azure Container Apps (optional)

Set `AZURE_PROVIDER_MODE=simulated` to try deployment targets on recorded Azure responses, with no Azure account. To read real container apps, see [docs/azure.md](docs/azure.md); ReleaseLens needs only the `Reader` role on a resource group.

## Try the diagnostics engine without Docker

```sh
pnpm install
pnpm diagnose tests/fixtures/scenarios/stale-deployment
pnpm diagnose tests/fixtures/scenarios/broken-health-endpoint --format json
```

This prints an evidence-backed report that separates facts, inferences, and unknowns. See the [fault scenarios](tests/fixtures/scenarios/README.md).

## Development

```sh
pnpm lint
pnpm typecheck
pnpm test               # unit tests, no Docker needed
pnpm test:integration   # database, API and worker tests against throwaway PostgreSQL and Redis containers (needs Docker)
pnpm build
```

If containers start too slowly on your machine, reuse the servers from `pnpm db:up` instead. Each suite then gets its own `releaselens_<suite>_test` database and Redis database 14 or 15, wiped before the run; nothing else is touched:

```sh
RELEASELENS_TEST_POSTGRES_URL=postgresql://releaselens:releaselens@localhost:5432/releaselens RELEASELENS_TEST_REDIS_URL=redis://127.0.0.1:6379 pnpm test:integration
```

API documentation (OpenAPI) is served at http://localhost:4000/api/docs while the API runs.

## Documentation

- [Project plan](docs/ReleaseLens_Project_Plan.md): requirements and scope
- [Development plan](docs/Development_Plan.md): phases and decisions
- [Architecture](docs/architecture.md)
- [Threat model](docs/threat-model.md)
- [Diagnostic rules](docs/diagnostic-rules.md)
- [GitHub App setup](docs/github-app.md)
- [Azure Container Apps](docs/azure.md)
- [Decision records](docs/decisions/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue, see [SECURITY.md](SECURITY.md); please do not open a public issue.

## License

[MIT](LICENSE)
