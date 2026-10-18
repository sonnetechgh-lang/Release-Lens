# 0005. Server-side sessions, origin checks, and not-found for forbidden projects

- Status: Accepted
- Date: 2026-10-18

## Context

Phase 2 adds sign-in and the first protected API. Decisions were needed on session storage, CSRF protection, what happens to the GitHub token, and how to answer requests for projects a user cannot see.

## Decision

- **Sessions live in PostgreSQL.** The browser gets a random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when the public URL is HTTPS). Only its SHA-256 hash is stored, so a database leak does not leak usable sessions. Sessions expire (7 days by default) and logout deletes them.
- **One origin for the browser.** The dashboard proxies `/api/*` to the API, so the cookie is first-party and the API needs no CORS.
- **CSRF:** `SameSite=Lax` plus a global guard that rejects any non-GET request whose `Origin` is not the dashboard's origin.
- **GitHub sign-in uses OAuth with `state` and PKCE**, requests only `read:user`, and discards the access token after reading the profile. ReleaseLens never stores a user's GitHub token. Repository access will come from the GitHub App (Phase 3), not from users' tokens.
- **Allowlist, not open sign-up.** Only logins listed in `RELEASELENS_OWNER_GITHUB_LOGINS` or `RELEASELENS_ALLOWED_GITHUB_LOGINS` can sign in. Roles are re-applied from configuration at every login.
- **Demo login** exists only when `RELEASELENS_MODE=demo` and signs in as a read-only viewer of the synthetic demo organization.
- **Forbidden = not found.** A single access service resolves `org + project + user` in one query. A project the user cannot access returns the same 404 as one that does not exist.

## Consequences

- No password storage or reset flows.
- Every request touches the database to validate the session. That is acceptable at this scale; a cache can be added later if needed.
- A Content Security Policy is not yet set on the dashboard (tracked in the threat model).
