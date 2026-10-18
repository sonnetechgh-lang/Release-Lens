# Contributing to ReleaseLens

Thanks for your interest! ReleaseLens is in early development, so the codebase changes quickly.

## Getting started

1. Install Node.js 24+ and pnpm 11+.
2. Fork and clone the repository.
3. Run `pnpm install`.
4. Before opening a pull request, make sure these pass:

   ```sh
   pnpm lint
   pnpm format:check
   pnpm typecheck
   pnpm test
   pnpm build
   ```

## Ground rules

- **Read-only by design.** ReleaseLens must never modify cloud resources, run migrations, or execute arbitrary commands on user infrastructure. PRs that add such behavior will not be accepted.
- **Unknown is not healthy.** Missing or stale data must surface as `unknown` or `unverified`.
- **No secrets in code, fixtures, logs, or tests.** Use synthetic data only.
- **Every diagnostic rule needs tests** for positive, negative, missing-data, and stale-data cases.
- Significant design changes should come with a short decision record in `docs/decisions/`.

## Pull requests

- Keep PRs focused on one change.
- Describe what changed and why, and how you tested it.
- Use clear commit messages (for example `feat(diagnostics): add stale deployment rule`).

## Code of conduct

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
