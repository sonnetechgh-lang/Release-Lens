# Diagnostic Rules

Rules are deterministic and versioned. Each finding records the rule ID and version that produced it, and separates **facts** (observed evidence), **inferences** (what the facts suggest), and **unknowns** (what could not be checked).

Every rule needs tests for the positive case, the negative case, missing data, stale data, and provider errors.

## First three rules (Phase 1)

### `deployment.stale` (v1)

|                        |                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Question**           | Is the deployed revision running the commit we expect?                                                                                            |
| **Inputs**             | Expected commit (latest successful workflow run on the environment's release branch); deployed commit verified via image digest or build metadata |
| **Fires when**         | Both commits are known and verified, and they differ                                                                                              |
| **Severity**           | `warning` by default; `high` if the deployed commit lags longer than a configured threshold                                                       |
| **Confidence**         | `high` (both identities are verified)                                                                                                             |
| **Does not fire when** | The deployed commit cannot be verified; `deployment.identity-unverified` covers that case                                                         |
| **Next step**          | Compare the image digest the workflow pushed with the one the revision runs; check the deploy job logs                                            |

### `deployment.identity-unverified` (v1)

|                |                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Question**   | Can we tell which source code is actually running?                                                                  |
| **Inputs**     | Revision image reference; image digest; OCI labels such as `org.opencontainers.image.revision`; build metadata      |
| **Fires when** | The revision references only a mutable tag (e.g. `:latest`, `:main`) with no digest and no embedded commit metadata |
| **Severity**   | `warning`                                                                                                           |
| **Confidence** | `high` that the identity is unknown; makes no claim about which commit is running                                   |
| **Next step**  | Deploy by digest and add the commit SHA as an image label                                                           |

### `health.endpoint-failing` (v1)

|                        |                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Question**           | Is the configured health endpoint responding as expected?                                                                              |
| **Inputs**             | The most recent health-check results for a service and environment (status code, duration, timestamp)                                  |
| **Fires when**         | At least `failureThreshold` consecutive checks fail (unexpected status, timeout, or connection error)                                  |
| **Severity**           | `high`                                                                                                                                 |
| **Confidence**         | `medium`: a failing endpoint does not prove the whole service is down                                                                  |
| **Does not fire when** | Fewer checks than the threshold have failed, or the latest result is older than the freshness window (health is then `unknown`)        |
| **Next step**          | Check the revision's logs and replica state; compare when failures started with recent deployments (a correlation, not proof of cause) |

## Planned next

- `workflow.failed`: the workflow run for the intended release failed.
- `evidence.stale`: an integration's last successful sync is older than its freshness threshold.
- `migration.unapplied` (Phase 6): an expected migration is missing or failed.
- `environment.config-differs`: an allowlisted, non-secret value differs between environments, contrary to policy.
