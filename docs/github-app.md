# Setting up the GitHub App

ReleaseLens reads workflow runs through a GitHub App. The app is **read-only**: it cannot push code, change settings, re-run workflows, or create deployments.

You create your own app, so you control its permissions and can uninstall it at any time.

## 1. Create the app

Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App** (for an organization: **Organization settings → Developer settings → GitHub Apps**).

| Setting                          | Value                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------- |
| GitHub App name                  | Anything unique, e.g. `releaselens-yourname`                                    |
| Homepage URL                     | Your dashboard URL, e.g. `http://localhost:3000`                                |
| Callback URL / OAuth             | Leave empty (sign-in uses a separate OAuth app)                                 |
| Webhook → Active                 | ✅                                                                              |
| Webhook URL                      | `https://<public-host>/api/webhooks/github` (for local development, see step 4) |
| Webhook secret                   | A random string of at least 16 characters, e.g. `openssl rand -hex 32`          |
| Where can this app be installed? | **Only on this account** (recommended)                                          |

**Repository permissions** (everything else stays "No access"):

| Permission  | Access    | Why                                                |
| ----------- | --------- | -------------------------------------------------- |
| Actions     | Read-only | Workflow runs and their results                    |
| Contents    | Read-only | Default branch and commit metadata                 |
| Deployments | Read-only | Reserved for deployment events (not processed yet) |
| Metadata    | Read-only | Required by GitHub for all apps                    |

**Subscribe to events:** `Workflow run`. Installation events are sent automatically.

After creating the app:

1. Note the **App ID** and the app's **URL slug** (the last part of `https://github.com/apps/<slug>`).
2. Under **Private keys**, click **Generate a private key**. A `.pem` file downloads. Store it **outside** the repository; `*.pem` is git-ignored as a safety net.

## 2. Configure ReleaseLens

In `.env`:

```sh
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=releaselens-yourname
GITHUB_APP_PRIVATE_KEY_PATH=/secure/path/releaselens.private-key.pem
GITHUB_WEBHOOK_SECRET=<the webhook secret from step 1>
```

The API uses these to list installations and receive webhooks; the worker uses them to read workflow runs. `GITHUB_APP_PRIVATE_KEY` (the PEM contents, with `\n` for line breaks) works too if your secret store cannot hold files.

Restart `pnpm dev`.

## 3. Install the app and connect a repository

1. Sign in to ReleaseLens as an owner (a login listed in `RELEASELENS_OWNER_GITHUB_LOGINS`).
2. On **Projects**, click **Connect a repository**, then **Install the GitHub App**. Choose **Only select repositories** and pick the ones you want.
3. Back in ReleaseLens, click **Connect** next to a repository. Set the release branch (defaults to the repository's default branch) and, optionally, the name of the workflow that deploys.

ReleaseLens immediately reads the latest 50 workflow runs, then keeps up to date through webhooks and a reconciliation pass every 10 minutes (`RECONCILE_INTERVAL_MINUTES`).

## 4. Receiving webhooks during local development

GitHub cannot reach `localhost`. Use a webhook relay such as [smee.io](https://smee.io):

1. Open https://smee.io/new and copy the channel URL.
2. Set it as the app's **Webhook URL**.
3. Run the relay, pointing at the API directly:

   ```sh
   npx smee-client --url https://smee.io/<channel> --target http://localhost:4000/api/webhooks/github
   ```

Signatures are preserved through the relay, so verification still applies. Without a relay, everything still works; runs just arrive on the reconciliation schedule instead of instantly.

## How webhooks are handled

1. The API checks the `X-Hub-Signature-256` HMAC against the raw body. Invalid signatures get `401` and are not stored.
2. The delivery is stored with its `X-GitHub-Delivery` ID as a unique key. A redelivery gets `200 {"status":"duplicate"}` and is not processed again.
3. The delivery ID is queued in Redis and the API returns `202` immediately.
4. The worker processes it: workflow runs are upserted (an older event never overwrites newer data), diagnostics re-run, and the stored payload is cleared.
5. If Redis loses the job, a sweeper re-queues deliveries that are still unprocessed after 2 minutes. Delivery records are deleted after 30 days.

## Troubleshooting

| Symptom                                         | Check                                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| "The GitHub App is not configured"              | `GITHUB_APP_ID` and a private key are set, then restart                                                    |
| Webhooks return 401                             | `GITHUB_WEBHOOK_SECRET` matches the app's webhook secret exactly                                           |
| Webhooks return 404                             | `GITHUB_WEBHOOK_SECRET` is not set                                                                         |
| Integration shows `suspended` or `disconnected` | The app was suspended, uninstalled, or lost access to the repository on GitHub                             |
| GitHub data marked stale                        | The worker is not running, or sync errors appear on the project page (e.g. `rate-limited`, `unauthorized`) |
