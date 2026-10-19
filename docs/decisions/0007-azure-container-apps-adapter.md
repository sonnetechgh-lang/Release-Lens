# 0007. Azure Container Apps: direct ARM REST calls, simulated by recorded responses

- Status: Accepted
- Date: 2026-10-19

## Context

Phase 4 adds the first deployment target. There is no Azure subscription yet, so the adapter must
be built and tested without one, and a self-hoster must be able to try the feature without one.
The development plan suggested `@azure/arm-appcontainers`.

## Decision

- **Call the Azure Resource Manager REST API directly** (one documented `GET` per target, plus
  pagination) instead of using the management SDK. Only `@azure/identity` is used, for
  credentials. This mirrors the GitHub client (decision 0006): timeouts on every request
  including token acquisition, error categories instead of provider messages, and a code path
  that can be tested with a fake `fetch`. Recorded HTTP responses can be replayed as they are.
- **Simulated mode runs the real adapter on recorded responses.** `AZURE_PROVIDER_MODE=simulated`
  swaps only the transport (a fixture-backed `fetch`) and the credential, so parsing, status
  mapping, pagination and error handling are the same code as in production. Fixture files can
  also return errors or hang, which reproduces throttling, missing roles, expired credentials and
  timeouts (fault scenario 6) on any laptop.
- **`FakeDeploymentTarget`** is an in-memory implementation of the `DeploymentTargetProvider`
  interface for worker tests.
- **Targets map one service in one environment to one container app.** Sync status is kept per
  project and provider on the existing `Integration` row, so the diagnostics snapshot and the
  freshness cards work unchanged.
- **Nothing is inferred.** A tag is never resolved to a digest, and creation time is reported as
  creation time. Unknown Azure states map to `unknown`.

## Consequences

- No SDK means following API versions ourselves; the version is pinned (`2024-03-01`) and changed
  deliberately.
- Fixtures are written after the documentation until Phase 4b replaces or confirms them with
  sanitized recordings from a real subscription.
- Per-project sync status is coarse: one failing target marks the whole project's Azure data as
  failing, although other targets were read. This keeps the snapshot model simple and errs on
  the side of reporting a problem.
