# Decision Records

Short records of significant design decisions: what was decided, why, and what it costs. Add a new numbered file when a decision changes; don't rewrite history. Mark superseded records as such.

| #                                                 | Decision                                                   | Status   |
| ------------------------------------------------- | ---------------------------------------------------------- | -------- |
| [0001](0001-scope-license-and-audience.md)        | Portfolio-first, self-hostable, MIT licensed               | Accepted |
| [0002](0002-monorepo-tooling.md)                  | pnpm + Turborepo monorepo, TypeScript 6.0                  | Accepted |
| [0003](0003-github-sign-in-and-github-app.md)     | GitHub OAuth for sign-in, GitHub App for repository data   | Accepted |
| [0004](0004-provider-interfaces-and-demo-mode.md) | Provider interfaces with fakes; demo mode on fakes         | Accepted |
| [0005](0005-sessions-csrf-and-access-control.md)  | Server-side sessions, origin checks, forbidden = not found | Accepted |

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences
```
