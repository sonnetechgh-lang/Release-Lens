# 0004. Provider interfaces with fakes; demo mode on fakes

- Status: Accepted
- Date: 2026-10-18

## Context

There is no Azure subscription yet, and reviewers should be able to try ReleaseLens without creating a GitHub App or an Azure account. Diagnostic rules must also be testable without network access.

## Decision

- Every external system is accessed through an interface (`SourceControlProvider`, `DeploymentTargetProvider`, `HealthProbe`, `MigrationInspector`).
- Each interface has a real adapter and a fake implementation driven by fixtures.
- `RELEASELENS_MODE=demo` wires only fakes and synthetic data.
- The Azure adapter is developed against mocked SDK responses, then verified briefly against a real, disposable Azure environment with a budget alert and a teardown script.

## Consequences

- Fault scenarios can be reproduced deterministically in CI.
- Mocks can drift from real provider behavior; mitigated by recording sanitized fixtures from real APIs when verifying.
- Slightly more code per integration (interface + fake).
