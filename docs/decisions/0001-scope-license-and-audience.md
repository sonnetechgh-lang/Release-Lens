# 0001. Portfolio-first, self-hostable, MIT licensed

- Status: Accepted
- Date: 2026-10-18

## Context

ReleaseLens is built primarily as an engineering portfolio project, but it is also released as open source. The two goals pull in different directions: a portfolio needs a polished, easy-to-review demo, while a tool for others needs installability and configuration.

## Decision

- Optimize for reviewers first: demo mode, synthetic fixtures, documentation, and tests.
- Keep it self-hostable: one organization per install, run with Docker Compose. No hosted SaaS, multi-tenancy, or billing.
- License the code under MIT, the simplest widely recognized permissive license.

## Consequences

- The data model keeps an `Organization` boundary, but only one organization is supported per install.
- Configuration is documented in `.env.example` from the start, so self-hosting stays possible.
- MIT includes no explicit patent grant. That is acceptable for this project.
