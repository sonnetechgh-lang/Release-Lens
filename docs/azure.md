# Azure Container Apps

ReleaseLens reads which revision of a container app is serving traffic, which image it runs, and
whether Azure reports it as healthy. It only reads: no request it sends can change anything in
Azure.

## Modes

Set `AZURE_PROVIDER_MODE` for both the API and the worker (they share `.env`):

| Mode        | What happens                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `off`       | Default. Owners can connect targets, but nothing is read, so their data stays unknown.                                                                             |
| `simulated` | The real adapter runs against recorded responses instead of Azure. No Azure account needed. See [the fixtures](../packages/integrations/fixtures/azure/README.md). |
| `azure`     | The real Azure Resource Manager API, with the credentials described below.                                                                                         |

Other settings (worker):

| Variable                        | Default          | Meaning                                                   |
| ------------------------------- | ---------------- | --------------------------------------------------------- |
| `AZURE_SYNC_INTERVAL_MINUTES`   | `5`              | How often every target is read                            |
| `AZURE_REQUEST_TIMEOUT_SECONDS` | `10`             | Timeout for each Azure request, including getting a token |
| `AZURE_FIXTURES_DIR`            | shipped fixtures | Recorded responses for `simulated` mode                   |

## Try it without Azure

1. Set `AZURE_PROVIDER_MODE=simulated` in `.env` and restart the API and the worker.
2. Open a project as an owner and choose **Connect an Azure Container App**. The form is
   pre-filled with the simulated subscription (`00000000-0000-0000-0000-000000000000`) and resource
   group (`releaselens-demo`).
3. Pick an app, for example `failed-rollout-api` (newest revision failed, the previous one still
   serves) or `slow-api` (Azure never answers, so the sync times out and the data goes stale).

## Connect a real container app

1. **Create an identity for ReleaseLens.** Pick one:
   - **Managed identity** (ReleaseLens itself runs in Azure): enable a user-assigned managed
     identity on the worker and set `AZURE_CLIENT_ID` to its client ID.
   - **Workload identity federation** (ReleaseLens runs in Kubernetes or GitHub Actions): no
     secret to store; set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_FEDERATED_TOKEN_FILE`.
   - **Service principal with a secret** (anywhere else, e.g. Docker Compose at home): set
     `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`. Secrets expire; when one
     does, the dashboard shows the Azure sync failing with `unauthorized`.

   The worker uses Azure's standard credential chain (`DefaultAzureCredential`), which picks up
   whichever of these is configured.

2. **Grant `Reader` on the resource group, and nothing else.**

   ```sh
   az role assignment create \
     --assignee <client-id> \
     --role Reader \
     --scope /subscriptions/<subscription-id>/resourceGroups/<resource-group>
   ```

   `Reader` cannot read secrets or app settings values through the data plane, and ReleaseLens
   never asks for them. Scope it to the resource group that holds the container apps, not the
   subscription.

3. Set `AZURE_PROVIDER_MODE=azure`, restart the API and the worker, and connect the app from the
   project page.

## What is read

One call per target and sync, plus pagination:
`GET /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.App/containerApps/{app}/revisions?api-version=2024-03-01`

From each revision ReleaseLens keeps the name, the image reference of the app's container (or the
container you named), its creation time, traffic weight, and state. Revisions Azure no longer lists
stay in ReleaseLens as history.

- **Serving revision**: the active revision with the most traffic; newest first on a tie. A
  failed revision is never treated as serving.
- **Image identity**: a digest is recorded only when the image is pinned by digest
  (`registry/app@sha256:...`). A tag is never resolved to a digest, so tag-only deployments are
  reported as unverified.
- **"Active since"** is the revision's creation time. Azure does not report when a revision began
  to receive traffic.
- **Status**: `failed`, `provisioning`, `degraded` (unhealthy replicas), `running`, `stopped`, or
  `unknown` for anything not recognised.

## Failures

Each failure is stored as a category on the project's Azure integration; Azure's own messages are
never stored or shown. The last successful sync time is kept, so the dashboard shows how old the
data is, and the `evidence.stale` rule reports it once it is older than the policy allows.

| Azure response                        | Category       | Retried?                                   |
| ------------------------------------- | -------------- | ------------------------------------------ |
| No answer within the timeout          | `timeout`      | Yes, with backoff                          |
| 429 Too Many Requests                 | `rate-limited` | Yes, after `Retry-After` (60 s if missing) |
| 5xx                                   | `server-error` | Yes, with backoff (or after `Retry-After`) |
| 401, expired or rejected credential   | `unauthorized` | No: fix the credential                     |
| 403 (usually the missing Reader role) | `forbidden`    | No: fix the role assignment                |
| 404                                   | `not-found`    | No: check the names                        |

A failing target does not stop the others in the same project.

## Limits (Phase 4a)

- Verified only against responses shaped after Microsoft's API documentation. Phase 4b verifies
  the adapter against a real subscription and records sanitized fixtures from it.
- The commit inside an image (OCI labels) is not read yet; that is part of correlation in Phase 5.
