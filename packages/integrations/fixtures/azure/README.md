# Simulated Azure responses

Used when `AZURE_PROVIDER_MODE=simulated` and by the adapter's unit tests. The files follow the
documented shape of _Container Apps Revisions - List Revisions_ (`Microsoft.App`, api-version
`2024-03-01`). When real Azure access is verified (Phase 4b), sanitized recordings replace or
join them.

Layout: `<resource group>/<container app>/revisions.json`, plus `revisions.<n>.json` for further
pages. Any subscription ID works. A file can wrap a failure instead of data:

```json
{
  "$response": {
    "status": 429,
    "headers": { "retry-after": "30" },
    "body": { "error": { "code": "TooManyRequests" } }
  }
}
```

`{ "$response": { "hang": true } }` never answers, so the request times out.

Resource group `releaselens-demo`:

| Container app        | What it simulates                                                     |
| -------------------- | --------------------------------------------------------------------- |
| `storefront-api`     | Healthy: new revision pinned by digest serves 100%, old one stopped   |
| `tag-only-api`       | Image referenced by a mutable tag (`:latest`), so identity unverified |
| `failed-rollout-api` | Newest revision failed to provision; the previous one still serves    |
| `canary-api`         | Traffic split 80/20 between two revisions                             |
| `sidecar-api`        | Two containers; the app container is degraded                         |
| `paged-api`          | Revisions spread over two pages                                       |
| `throttled-api`      | 429 Too Many Requests with `Retry-After: 30`                          |
| `slow-api`           | Never answers: Azure API timeout (fault scenario 6)                   |
| `forbidden-api`      | 403 `AuthorizationFailed`: Reader role missing                        |
| `expired-token-api`  | 401 `ExpiredAuthenticationToken`: expired credential                  |
| `unavailable-api`    | 503 Service Unavailable with `Retry-After: 10`                        |
