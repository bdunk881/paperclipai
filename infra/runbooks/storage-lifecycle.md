# Storage object lifecycle + retention (HEL-358)

How object expiry is enforced for first-party storage (R2/S3), how to apply the
rules to a bucket, and how drift is detected.

## Retention classes → lifecycle

`file_objects.retention_class` is the source of truth, and it is also the
**top-level key prefix** of every object (see `src/storage/storageKey.ts`):

```
{retentionClass}/workspaces/{workspaceId}/{collection}/{objectId}
```

Retention is a top-level prefix because **R2 lifecycle rules are prefix + age only
(no tag filters)** — so a small fixed set of prefix rules covers every workspace.

| retention_class | prefix         | lifecycle action                         |
|-----------------|----------------|------------------------------------------|
| `short`         | `short/`       | delete 30 days after creation            |
| `standard`      | `standard/`    | delete 365 days after creation           |
| `legal_hold`    | `legal_hold/`  | **never** auto-delete (no expiration rule) |

Plus a bucket-wide rule: **abort incomplete multipart uploads after 7 days**.

The mapping + the rendered config live in `src/storage/retentionPolicy.ts`
(`RETENTION_LIFECYCLE`, `buildLifecycleConfiguration()`) — the single source of
truth shared by the apply script and the reconciliation watchdog.

## Applying the rules to a bucket

Lifecycle rules are **not** applied automatically — run the script once per bucket
(dev, then staging) after the provider credentials exist:

```bash
# dev (STORAGE_* come from Infisical dev)
infisical run --env=dev -- npm run storage:apply-lifecycle

# or with STORAGE_* already exported in the shell
npm run storage:apply-lifecycle
```

It reads `STORAGE_*` via `getStorageAdapter()`, asserts the provider supports
lifecycle (r2/s3 — never the in-memory adapter), and PUTs
`buildLifecycleConfiguration()`. Idempotent: `PutBucketLifecycleConfiguration`
replaces the whole config each run.

> ⛔ **Blocked on the R2 dashboard token** for the R2 bucket (S3-API tokens are
> dashboard-mint only). The S3 dev bucket can be done now. Until applied, the
> reconciliation watchdog will report drift ("no lifecycle configuration set").

### `legal_hold` immutability (provisioning step)

The lifecycle config only *omits* expiry for `legal_hold/`; it does not make those
objects immutable. True immutability is a provider feature configured at the bucket
level, **outside this script**:

- **S3:** Object Lock must be enabled **at bucket creation** (it cannot be turned on
  for an existing bucket). If hard legal-hold is required, recreate the bucket with
  Object Lock and a default retention, or apply per-object legal holds.
- **R2:** add a **bucket lock** rule on the `legal_hold/` prefix (can be added any
  time; takes precedence over lifecycle). See
  https://developers.cloudflare.com/r2/buckets/bucket-locks/.

## Drift detection (reconciliation watchdog)

`src/storage/storageLifecycleReconcileJob.ts` runs daily (started from
`src/index.ts`, `setInterval` — same shape as the credits maintenance jobs). It is
**read-only**: it fetches the bucket's actual lifecycle config, diffs it against
`buildLifecycleConfiguration()`, and on any difference:

- logs a `warn`,
- `Sentry.captureMessage("storage lifecycle configuration drift detected", …)`,
- records a `storage_lifecycle_reconcile` row in the admin job-history
  (`safeLogJobRun`) with `drift_count` + the drift details.

It **disables itself** (no timer) when storage is unconfigured or the adapter has
no lifecycle support (in-memory dev/test), so it never produces noise locally.

Poke a single cycle in code/tests via `runStorageLifecycleReconcile()`; the pure
comparison is `diffLifecycle(expected, actual)`.

## Known follow-up

Bucket-native expiry deletes the **object**, not the `file_objects` **row** — so a
row whose object the bucket has expired will linger (a later download 404s). The
reconciliation watchdog here checks **rule-config drift** only. Reconciling expired
**rows** (marking `deleted_at` for objects past their retention age) is a tracked
follow-up, not part of this change.
