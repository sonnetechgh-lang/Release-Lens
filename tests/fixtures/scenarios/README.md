# Fault scenarios

Each folder holds a synthetic evidence snapshot (`snapshot.json`) and the findings it must produce (`expected.json`). The diagnostics test suite runs every folder automatically, so adding a scenario is just adding a folder.

All data is synthetic. Every scenario is evaluated at `2026-10-18T12:00:00Z` and starts from `healthy-baseline`, changing only what the fault needs.

| Scenario                 | Plan fault # | What is wrong                                                           | Expected finding                                                             |
| ------------------------ | ------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `healthy-baseline`       |              | Nothing                                                                 | none                                                                         |
| `stale-deployment`       | 1            | Production runs run 101's image; run 102 succeeded ~4h ago              | `deployment.stale` (warning)                                                 |
| `failed-workflow`        | 2            | Newest run failed; production correctly runs the last good build        | `workflow.failed` (warning), _not_ stale                                     |
| `broken-health-endpoint` | 3            | 3 consecutive `/healthz` failures, 3 min after a new revision went live | `health.endpoint-failing` (high, medium confidence)                          |
| `missing-build-metadata` | 4            | Deployed by `:latest` tag, no digest or commit label                    | `deployment.identity-unverified`, _not_ stale                                |
| `azure-api-timeout`      | 6            | Azure sync timing out for 3.5h; last known revision looks stale         | `evidence.stale` only. Stale data must not be reported as a stale deployment |

Plan faults 5 (unapplied migration), 7 (duplicate webhook), and 8 (secret in logs) need the migration adapter, webhook ingestion, and redaction pipeline. They arrive in Phases 6, 3, and 2.

Try one:

```sh
pnpm diagnose tests/fixtures/scenarios/stale-deployment
```
