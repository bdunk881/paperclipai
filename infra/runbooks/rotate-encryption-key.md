# Encryption key rotation runbook

This runbook covers `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` and `LLM_CONFIG_ENCRYPTION_KEY`.
Do not rotate these keys on this ticket. Use this procedure only for suspected compromise or the approved annual rotation window.

## Safety model

- V1 remains the existing Infisical secret.
- V2 is introduced alongside V1 as:
  - `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_V2`
  - `LLM_CONFIG_ENCRYPTION_KEY_V2`
- App code writes new connector and LLM credential ciphertext with V2 when any configured V2 key is present.
- App code continues to read legacy `iv:tag:ciphertext` V1 payloads and explicit `v2:iv:tag:ciphertext` payloads.
- The backfill job re-encrypts persisted credential fields and sets `key_version = 2` only when every encrypted field in that row is V2.

Current LLM credentials are stored in `connector_credentials` with `service = 'llm-config'`. The backfill also checks for a future `llm_credentials` table and skips it safely when absent.

## Prerequisites

1. Confirm the migration that adds `connector_credentials.key_version` has shipped:

   ```sql
   select column_name
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'connector_credentials'
     and column_name = 'key_version';
   ```

2. Generate V2 key material offline. Do not paste key values into tickets, PRs, Slack, or chat.
3. Add V2 secrets to Infisical for the target environment, leaving V1 secrets untouched.
4. Deploy the app version that supports dual-read/V2-write.
5. Confirm Sentry, Datadog, Fly logs, and database access are available for the rotation window.

## Staging rehearsal

Run the full procedure in staging before production:

```bash
infisical run --env=staging -- npm run build
infisical run --env=staging -- npx ts-node src/secrets/backfillCredentialEncryptionKey.ts --dry-run
infisical run --env=staging -- npx ts-node src/secrets/backfillCredentialEncryptionKey.ts --write --batch-size=100
```

Verification:

```sql
select key_version, count(*)
from connector_credentials
group by key_version
order by key_version;

select service, count(*) as remaining_v1
from connector_credentials
where key_version = 1
group by service
order by service;
```

Expected result: zero V1 rows after the write run. Exercise at least one connector credential and one LLM credential read path before production.

## Production procedure

1. Announce the rotation window and freeze credential-related deploys.
2. Add `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_V2` and `LLM_CONFIG_ENCRYPTION_KEY_V2` in Infisical production. Keep V1 keys present.
3. Deploy/restart production so all Fly machines pick up both V1 and V2.
4. Confirm new writes use V2:

   ```sql
   select key_version, count(*)
   from connector_credentials
   group by key_version
   order by key_version;
   ```

5. Run the dry run:

   ```bash
   infisical run --env=production -- npx ts-node src/secrets/backfillCredentialEncryptionKey.ts --dry-run --batch-size=100
   ```

   Stop if any row fails. Investigate the row by `service` and `id`; do not print or export plaintext secrets.

6. Run the write backfill:

   ```bash
   infisical run --env=production -- npx ts-node src/secrets/backfillCredentialEncryptionKey.ts --write --batch-size=100
   ```

7. Verify completion:

   ```sql
   select count(*) as connector_credentials_remaining_v1
   from connector_credentials
   where key_version = 1;

   select service, key_version, count(*)
   from connector_credentials
   group by service, key_version
   order by service, key_version;
   ```

   Expected result: `connector_credentials_remaining_v1 = 0`.

8. Run connector smoke checks and LLM-provider smoke checks.
9. Keep V1 secrets in Infisical until the cleanup deploy that removes V1 read support has shipped and passed smoke checks.
10. After cleanup deploy validation, delete V1 from Infisical.

## Monitoring during the window

Watch these signals from step 3 through final verification:

- Sentry: any increase in credential decrypt errors, connector auth failures, or LLM config failures.
- Fly logs: `[credential-key-backfill] Failed`, `Unable to decrypt connector credential`, and credential registry persistence errors.
- Datadog/Fly metrics: 5xx rate, request latency, restart loops, and database connection errors.
- Database:
  - `connector_credentials where key_version = 1` trending to zero.
  - no growth in failed backfill rows from the job summary.
- Product smoke checks:
  - create/update a connector credential.
  - read an existing connector credential.
  - run an LLM-backed workflow with an existing LLM credential.

Page the founder-on-call if decrypt failures or 5xx rates rise above the normal deploy baseline.

## Rollback

Before V1 is deleted, rollback is configuration-only:

1. Remove or unset `*_ENCRYPTION_KEY_V2` in Infisical for the affected environment.
2. Restart app machines so writes return to V1.
3. Keep V1 present and investigate failed rows.

After rows have been backfilled to V2, do not remove V2. If the cleanup deploy has not happened, the app can read both versions. If cleanup has happened and V1 was deleted, restore V1 from Infisical history only if a human incident lead confirms it is required.

## Stop conditions

Stop the rotation if any of these occur:

- dry run or write run reports a failed row.
- any credential read path starts failing in Sentry/Fly logs.
- verification shows non-zero V1 rows after a completed write run.
- uncertainty about which Infisical environment is being changed.

Do not proceed to V1 removal until all stop conditions are cleared.
