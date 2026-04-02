# AutoFlow Database Backup — Operations Guide

PostgreSQL 16 running on a Hetzner VPS (managed by Coolify). Backups use `pg_dump` → gzip → S3 with a 7-day rolling retention window.

---

## How it works

1. **Schedule**: GitHub Actions triggers the backup daily at **02:00 UTC** via `db-backup.yml`.
2. **Dump**: `pg_dump` produces a custom-format dump (supports parallel restore via `pg_restore`), piped directly through `gzip --best` to minimize disk I/O.
3. **Upload**: The compressed dump is uploaded to S3 at `s3://<bucket>/postgres/<dbname>_<YYYYMMDDTHHMMSSZ>.dump.gz` using `STANDARD_IA` storage class (cheaper for infrequently accessed backups).
4. **Retention**: After upload, the script lists all objects under the `postgres/` prefix and deletes any older than `BACKUP_RETENTION_DAYS` (default: 7).
5. **Notification**: If `BACKUP_ALERT_URL` is set, a JSON webhook is POSTed on both success and failure:
   ```json
   { "status": "success|failure", "message": "..." }
   ```

---

## Required GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions**:

| Secret name            | Description                                                              | Example                                       |
|------------------------|--------------------------------------------------------------------------|-----------------------------------------------|
| `DATABASE_URL`         | Full PostgreSQL DSN including credentials                                | `postgres://app:pass@db.internal:5432/autoflow` |
| `S3_BACKUP_BUCKET`     | S3 bucket name (bucket must already exist)                               | `autoflow-db-backups`                         |
| `AWS_ACCESS_KEY_ID`    | IAM user access key (s3:PutObject, s3:ListBucket, s3:DeleteObject)      | `AKIA...`                                     |
| `AWS_SECRET_ACCESS_KEY`| IAM user secret key                                                      | `wJalr...`                                    |
| `AWS_DEFAULT_REGION`   | AWS region of the S3 bucket                                              | `us-east-1`                                   |
| `BACKUP_ALERT_URL`     | Optional webhook URL for notifications (e.g. Slack incoming webhook)     | `https://hooks.slack.com/services/...`        |

### Minimum IAM policy for the backup user

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::autoflow-db-backups",
        "arn:aws:s3:::autoflow-db-backups/postgres/*"
      ]
    }
  ]
}
```

---

## Manually triggering a backup

From GitHub UI:

1. Go to **Actions → Database Backup**
2. Click **Run workflow**
3. Optionally enter a reason in the input field
4. Click **Run workflow**

From the CLI:

```bash
gh workflow run db-backup.yml \
  --repo <org>/paperclipai \
  --field reason="Pre-deployment manual backup"
```

---

## Restore procedure

### Quick restore to production

```bash
# 1. List available backups
aws s3 ls s3://autoflow-db-backups/postgres/ --region us-east-1

# 2. Download the desired backup
aws s3 cp \
  s3://autoflow-db-backups/postgres/autoflow_20260401T020145Z.dump.gz \
  /tmp/autoflow_20260401T020145Z.dump.gz

# 3. Decompress
gunzip /tmp/autoflow_20260401T020145Z.dump.gz
# Result: /tmp/autoflow_20260401T020145Z.dump

# 4. (Recommended) Drop and recreate the target database to avoid conflicts
# Connect as a superuser — NOT as the application user
psql -h <DB_HOST> -U postgres -c "DROP DATABASE autoflow WITH (FORCE);"
psql -h <DB_HOST> -U postgres -c "CREATE DATABASE autoflow OWNER app;"

# 5. Restore
pg_restore \
  --host=<DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=autoflow \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  /tmp/autoflow_20260401T020145Z.dump

# 6. Verify row counts in critical tables
psql -h <DB_HOST> -U postgres -d autoflow \
  -c "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;"

# 7. Clean up local dump file
rm /tmp/autoflow_20260401T020145Z.dump
```

### Point-in-time note

This setup provides daily backups (RPO ≤ 24h). If you require sub-daily RPO, consider enabling PostgreSQL WAL archiving and WAL-G or pgBackRest in addition to this daily snapshot approach.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `pg_dump failed` | `DATABASE_URL` wrong or DB unreachable from GHA runner | Verify secret; check DB host allows external connections |
| `S3 upload failed` | Bad AWS credentials or wrong region | Check `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION` |
| `No backup found` in restore test | Bucket name wrong or empty prefix | Check `S3_BACKUP_BUCKET` secret; verify bucket contents |
| Old backups not deleted | IAM user missing `s3:DeleteObject` | Update IAM policy |
| Alert not sent | `BACKUP_ALERT_URL` malformed | Test curl manually against the URL |
