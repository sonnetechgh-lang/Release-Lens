# Threat Model (draft)

> First draft, written in Phase 0. Review it at the end of each phase and whenever an integration is added.

## What we protect

| Asset                                                      | Why it matters                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| GitHub App private key and webhook secret                  | Lets an attacker read repositories or forge events                |
| Azure identity (service principal or federated credential) | Read access to cloud resource metadata                            |
| Migration-check database credentials                       | Access to a user's application database                           |
| User sessions                                              | Access to all connected project data                              |
| Stored evidence and findings                               | May contain commit messages, URLs, resource IDs, and log excerpts |

## Trust boundaries

1. Internet → API (webhooks, browser requests)
2. API and worker → external providers (GitHub, Azure, health endpoints, application databases)
3. Worker → user-configured URLs (health checks): the main SSRF surface
4. ReleaseLens → outbound channels (email): the main data-leakage surface

## Threats and mitigations

| #   | Threat                                                  | Mitigation                                                                                                                                                                            | Verified by                                         |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| T1  | Forged or replayed webhooks                             | HMAC-SHA256 over the raw body with constant-time comparison; unique delivery IDs; payload size limits                                                                                 | Signature and duplicate-delivery tests (scenario 7) |
| T2  | SSRF via health-check URLs                              | http/https only; resolve DNS and block loopback, private, link-local, and cloud metadata ranges (e.g. 169.254.169.254); revalidate every redirect; bounded timeouts and response size | Tests with blocked targets and redirect chains      |
| T3  | Secrets leaking into logs, findings, reports, or emails | One shared redaction utility (tokens, passwords, connection strings, auth headers, common secret patterns) used by the logger and every output; store bounded excerpts only           | Redaction tests (scenario 8)                        |
| T4  | Cross-project data access                               | Server-side organization/project check on every request; never trust client-supplied IDs alone                                                                                        | Authorization-boundary tests (API and E2E)          |
| T5  | Credential theft from the database                      | Credentials encrypted at rest (managed key service when deployed); never sent to the browser; revoking an integration deletes them                                                    | Revocation integration tests                        |
| T6  | Over-privileged integrations                            | GitHub App with read-only permissions; Azure `Reader` scoped to one resource group; migration DB role with SELECT on `_prisma_migrations` only                                        | Documented in setup guides                          |
| T7  | ReleaseLens modifying user infrastructure               | No write APIs called; the migration inspector runs one fixed query; no arbitrary SQL or shell commands                                                                                | Code review rule and tests                          |
| T8  | Misleading diagnosis (stale data shown as healthy)      | Data freshness tracked per integration; stale or missing data produces `unknown`                                                                                                      | Missing- and stale-data rule tests                  |
| T9  | Denial of service (webhook floods, slow providers)      | Rate limits, payload limits, queue concurrency limits, timeouts, retries with backoff and jitter                                                                                      | Integration tests (later phase)                     |
| T10 | Supply-chain compromise                                 | Committed lockfile, Dependabot, CI with a read-only token, versioned actions                                                                                                          | CI configuration                                    |
| T11 | Sensitive data sent to an AI provider (if ever added)   | Off by default; only redacted evidence is sent; a deterministic path always exists                                                                                                    | Deferred until AI summaries are considered          |

## Open questions

- How should self-hosters provide the credential encryption key when not on Azure (environment-provided key or an external KMS)?
- What default retention periods should apply to evidence, findings, and audit events?
