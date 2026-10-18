# Diagnostic Rules

Rules are deterministic and versioned. Each finding records the rule ID and version that produced it, and separates **facts** (observed evidence), **inferences** (what the facts suggest), and **unknowns** (what could not be checked). Every fact cites at least one evidence ID.

Every rule needs tests for the positive case, the negative case, missing data, stale data, and provider errors.

Code: [`packages/diagnostics/src/rules`](../packages/diagnostics/src/rules). Input format: `DiagnosticSnapshot` in [`packages/contracts`](../packages/contracts/src/evidence.ts).

## Shared principles

- **Stale data silences rules, it does not trigger them.** A rule that needs GitHub or Azure data only runs when that integration's last successful sync is within `evidenceFreshnessSeconds` (default 1h). An integration with no sync record counts as stale. `evidence.stale` reports the gap instead.
- **Identity comes from immutable evidence only.** The deployed commit is known if (1) the revision's image digest matches a digest a workflow run produced, or (2) the image carries an OCI revision label or the service reports build metadata. A tag alone is never enough.
- **Timing is a correlation, never a cause.** Rules may mention that two events were close in time, but only as an inference.
- **Findings have stable IDs:** `<rule>/<project>/<service>/<environment>[/<subject>]`, so repeated observations update one finding.

## Policy settings

| Setting                           | Default | Used by                   |
| --------------------------------- | ------- | ------------------------- |
| `healthFailureThreshold`          | 3       | `health.endpoint-failing` |
| `healthFreshnessSeconds`          | 900     | `health.endpoint-failing` |
| `evidenceFreshnessSeconds`        | 3600    | all integration rules     |
| `deploymentGraceSeconds`          | 900     | `deployment.stale`        |
| `staleDeploymentHighAfterSeconds` | 86400   | `deployment.stale`        |

## Rules (v1)

### `deployment.stale`

|                        |                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Question**           | Is the environment running the latest successful release build?                                                                                                                                      |
| **Fires when**         | GitHub and Azure data are fresh, the deployed commit is verified, it differs from the latest successful release run's commit, and that run finished more than `deploymentGraceSeconds` ago           |
| **Severity**           | `warning`; `high` once the expected build is older than `staleDeploymentHighAfterSeconds`                                                                                                            |
| **Confidence**         | `high`                                                                                                                                                                                               |
| **Does not fire when** | Identity is unverified (see next rule); within the grace period; the deployed build is _newer_ than the expected one (for example a hotfix branch). That is an environment difference, not staleness |

### `deployment.identity-unverified`

|                |                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Question**   | Can we tell which source code is running?                                                                                      |
| **Fires when** | Azure data is fresh and the revision has only a mutable tag, or has a digest that no known run produced and no commit metadata |
| **Severity**   | `warning`                                                                                                                      |
| **Confidence** | `high` that identity is unknown. It makes no claim about which commit is running                                               |
| **Next steps** | Deploy by digest; add the `org.opencontainers.image.revision` label; record the pushed digest as a workflow output             |

### `health.endpoint-failing`

|                        |                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Question**           | Is a configured health endpoint failing right now?                                                                                          |
| **Fires when**         | The latest check is within `healthFreshnessSeconds` and the most recent `healthFailureThreshold`+ checks all failed. Evaluated per endpoint |
| **Severity**           | `high`                                                                                                                                      |
| **Confidence**         | `medium`: a failing endpoint does not prove the whole service is down                                                                       |
| **Correlation**        | If the active revision became live up to 1h before the first failure, that is noted as an inference, not a fact                             |
| **Does not fire when** | The latest check passed, results are stale (health is then unknown), or there are fewer failures than the threshold                         |

### `workflow.failed`

|                        |                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Question**           | Did the most recent release run fail?                                                                             |
| **Fires when**         | GitHub data is fresh and the newest completed run on the release branch (and deploy workflow) failed or timed out |
| **Severity**           | `warning`                                                                                                         |
| **Confidence**         | `high`                                                                                                            |
| **Does not fire when** | The run was cancelled, or the failure is on another branch or workflow                                            |

### `evidence.stale`

|                |                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Question**   | Is each integration's data fresh enough to trust?                                                                                   |
| **Fires when** | An integration's last successful sync is older than `evidenceFreshnessSeconds`, or it never synced. One finding per integration     |
| **Severity**   | `warning`                                                                                                                           |
| **Confidence** | `high`                                                                                                                              |
| **Note**       | Sync errors are stored as a category (`timeout`, `unauthorized`, …), never as raw messages, so credentials cannot leak through them |

## Planned

- `migration.unapplied` (Phase 6): an expected migration is missing or failed.
- `environment.config-differs`: an allowlisted, non-secret value differs between environments, contrary to policy.
- `deployment.unexpected-build`: the deployed build is newer than, or unrelated to, the release branch.
