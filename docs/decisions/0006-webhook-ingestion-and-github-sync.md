# 0006. Webhook ingestion: store first, queue second, reconcile always

- Status: Accepted
- Date: 2026-10-19

## Context

GitHub delivers webhooks at least once, possibly out of order, and sometimes not at all. GitHub also expects a response within 10 seconds. ReleaseLens must never double-count a run, regress a finished run to "in progress", or silently miss events.

## Decision

- **The webhook handler only verifies, stores, and queues.** The HMAC signature is checked on the raw bytes. The payload is stored in PostgreSQL with the `X-GitHub-Delivery` ID as a unique key, then the ID (not the payload) is queued in Redis/BullMQ. The handler returns `202`. A duplicate delivery ID returns `200 duplicate` and is not queued again.
- **PostgreSQL is the source of truth, Redis is only a work queue.** A sweeper re-queues deliveries still unprocessed after 2 minutes, so a lost Redis job delays processing instead of losing it.
- **Writes are idempotent and ordered by GitHub's own timestamp.** Workflow runs are upserted with one `INSERT … ON CONFLICT … WHERE stored.updated_at < incoming.updated_at` statement, so duplicates are no-ops and older events cannot overwrite newer ones, even with concurrent workers.
- **Reconciliation backs up webhooks.** Every 10 minutes the worker reads the latest workflow runs through the REST API. Its success time drives the "data freshness" shown in the dashboard and used by `evidence.stale`.
- **Failures are categories, retries are bounded.** Provider errors become `timeout`, `rate-limited`, `unauthorized`, `forbidden`, `not-found`, `server-error`, or `network`. Retryable ones use exponential backoff with full jitter, or GitHub's own wait time for rate limits. Invalid payloads are not retried.
- **A small fetch-based GitHub client instead of Octokit.** Read-only, with timeouts, token caching, and error classification in about 200 lines that are fully unit-tested with a fake `fetch`.
- **Linking installations to organizations:** an owner connects a repository by picking it from the installations the app can see. The API asks GitHub whether that installation can access that repository before creating the project. The first organization to connect a repository from an installation owns that installation; other organizations cannot use it (`409`) and do not see it.

## Consequences

- A webhook arriving before its repository is connected is acknowledged and ignored; reconciliation picks up history once the project exists.
- Payloads are kept only until processed (then cleared), and delivery records for 30 days.
- The installation-linking model assumes owners within one ReleaseLens install are trusted, which matches the single-organization deployment model. A public multi-tenant service would need GitHub's user-to-server verification during installation instead.
- Push, workflow-job, and deployment-status events are accepted but not used yet.
