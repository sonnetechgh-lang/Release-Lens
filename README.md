# ReleaseLens

> **Status: early development (Phase 1).** The diagnostics engine runs on synthetic scenarios; GitHub and Azure integrations are not built yet. See the [development plan](docs/Development_Plan.md).

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
apps/cli/             # releaselens diagnose command
packages/contracts/   # validated evidence and finding schemas (Zod)
packages/diagnostics/ # deterministic rules and Markdown reports
packages/config/      # shared TypeScript config
tests/fixtures/       # synthetic fault scenarios
docs/                 # plans, architecture, threat model, decision records
```

## Try it

With Node.js 24+ and pnpm 11+:

```sh
pnpm install
pnpm diagnose tests/fixtures/scenarios/stale-deployment
pnpm diagnose tests/fixtures/scenarios/broken-health-endpoint --format json
```

This prints an evidence-backed report that separates facts, inferences, and unknowns. See the [fault scenarios](tests/fixtures/scenarios/README.md) for the full list.

## Development

Requirements: Node.js 24+, pnpm 11+.

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Documentation

- [Project plan](docs/ReleaseLens_Project_Plan.md): requirements and scope
- [Development plan](docs/Development_Plan.md): phases and decisions
- [Architecture](docs/architecture.md)
- [Threat model](docs/threat-model.md)
- [Diagnostic rules](docs/diagnostic-rules.md)
- [Decision records](docs/decisions/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue, see [SECURITY.md](SECURITY.md); please do not open a public issue.

## License

[MIT](LICENSE)
