# AutoFlow Disaster Recovery Runbook

**Product**: AutoFlow (helloautoflow.com)
**Stack**: Next.js · PostgreSQL 16 · Hetzner VPS · Docker / Coolify · GitHub Actions
**Last reviewed**: 2026-04-02
**Runbook owner**: Infra Lead

---

## Recovery Objectives

| Metric | Target |
|--------|--------|
| **RPO** (Recovery Point Objective) | ≤ 24 hours |
| **RTO** (Recovery Time Objective) | ≤ 4 hours |

The daily backup at 02:00 UTC provides at most 24h of potential data loss. The 4h RTO assumes a trained operator following this runbook from scratch.

---

## Backup Schedule

| Schedule | Time | Retention |
|----------|------|-----------|
| Daily database snapshot | 02:00 UTC every day | 7 days |
| Monthly restore verification | 03:00 UTC on the 1st | N/A (test only) |

Backup storage: `s3://autoflow-db-backups/postgres/` (STANDARD_IA storage class)

---

## Contacts

| Role | Name | Contact |
|------|------|---------|
| On-call Engineer | _[Placeholder]_ | _[Pager/phone/Slack]_ |
| Infra Lead | _[Placeholder]_ | _[Email/Slack]_ |
| Hetzner Support | Hetzner Online GmbH | https://www.hetzner.com/support |
| DNS / Cloudflare | _[Placeholder]_ | _[Account owner]_ |

---

## Section 1: Restore from Database Backup

Use this procedure when the database is corrupt, accidentally dropped, or data has been unintentionally deleted.

### 1.1 Identify the correct backup

```bash
# List all available backups (newest last)
aws s3 ls s3://autoflow-db-backups/postgres/ \
  --region us-east-1 \
  | sort -k1,2

# Example output:
# 2026-03-26 02:01:33  187432011 autoflow_20260326T020133Z.dump.gz
# 2026-03-27 02:01:41  188104220 autoflow_20260327T020141Z.dump.gz
```

### 1.2 Download the backup

```bash
BACKUP_FILE="autoflow_20260401T020145Z.dump.gz"  # Adjust to correct file

aws s3 cp \
  "s3://autoflow-db-backups/postgres/${BACKUP_FILE}" \
  "/tmp/${BACKUP_FILE}" \
  --region us-east-1

# Verify download integrity (check non-zero file size)
ls -lh "/tmp/${BACKUP_FILE}"
```

### 1.3 Decompress

```bash
gunzip "/tmp/${BACKUP_FILE}"
# Creates: /tmp/autoflow_20260401T020145Z.dump
DUMP_FILE="/tmp/${BACKUP_FILE%.gz}"
```

### 1.4 Stop application traffic (prevent writes during restore)

Option A — Via Coolify: set the app service to "maintenance mode" or stop the container.

Option B — Via Hetzner firewall: temporarily block inbound port 443 to the VPS while restoring.

```bash
# Option B: Block HTTPS at Hetzner firewall (requires Hetzner CLI or console)
# Restore this rule immediately after the restore is complete.
```

### 1.5 Drop and recreate the database

Connect to the PostgreSQL host as a superuser (e.g., via the Coolify terminal or SSH into the VPS):

```bash
# SSH into VPS first:
ssh root@<HETZNER_VPS_IP>

# Connect to Postgres running in Docker:
docker exec -it <postgres_container_name> psql -U postgres
```

```sql
-- Terminate active connections to the database
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = 'autoflow'
    AND pid <> pg_backend_pid();

-- Drop and recreate
DROP DATABASE autoflow WITH (FORCE);
CREATE DATABASE autoflow OWNER app;
\q
```

### 1.6 Restore the dump

Run `pg_restore` from a machine that has network access to the database host:

```bash
pg_restore \
  --host=<DB_HOST> \
  --port=5432 \
  --username=postgres \
  --dbname=autoflow \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  --exit-on-error \
  --verbose \
  "${DUMP_FILE}" 2>&1 | tee /tmp/restore-$(date +%Y%m%d).log

echo "Exit code: $?"
```

`--jobs=4` enables parallel restore (requires custom-format dump, which this backup produces).

### 1.7 Verify the restore

```bash
psql -h <DB_HOST> -U postgres -d autoflow << 'SQL'
-- Count tables
SELECT COUNT(*) AS table_count
  FROM information_schema.tables
  WHERE table_schema = 'public';

-- Spot-check row counts in critical tables
SELECT schemaname, tablename, n_live_tup
  FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC
  LIMIT 20;

-- Check sequences are valid
SELECT sequencename, last_value
  FROM pg_sequences
  WHERE schemaname = 'public';
SQL
```

### 1.8 Re-enable application traffic

If you stopped the app in Step 1.4, restart it via Coolify or remove the firewall rule.

### 1.9 Clean up

```bash
rm "${DUMP_FILE}"
```

---

## Section 2: Application Recovery (Containers Down)

Use this procedure when the application containers are down but the Hetzner VPS and Coolify are still running.

### 2.1 Check container status

```bash
ssh root@<HETZNER_VPS_IP>
docker ps -a | grep autoflow
```

### 2.2 Restart via Coolify

1. Log into the Coolify dashboard: `https://<HETZNER_VPS_IP>:8000` (or your Coolify domain).
2. Navigate to **Applications → autoflow**.
3. Click **Restart** (or **Redeploy** to pull the latest image).
4. Monitor the deployment log until all containers report healthy.

### 2.3 Force redeploy via GitHub Actions

If Coolify's auto-deploy is stuck or the image is stale:

```bash
# Trigger a fresh deployment from the default branch
gh workflow run deploy.yml \
  --repo <org>/paperclipai \
  --ref main
```

### 2.4 Verify application health

```bash
# Check the health endpoint
curl -sf https://helloautoflow.com/api/health | jq .

# Expected: {"status":"ok","db":"connected"}
```

### 2.5 Check logs for root cause

```bash
# Coolify app logs
docker logs --tail=200 <app_container_name>

# Database logs
docker logs --tail=100 <postgres_container_name>
```

---

## Section 3: Hetzner VPS Recovery (VPS Lost)

Use this procedure when the Hetzner VPS is lost, destroyed, or unrecoverable. This is the most severe scenario.

**Estimated time**: 2–4 hours

### 3.1 Provision a new Hetzner VPS

1. Log into [Hetzner Cloud Console](https://console.hetzner.cloud).
2. Create a new server:
   - **Type**: CX31 or larger (minimum 4 vCPU / 8 GB RAM recommended)
   - **Image**: Ubuntu 24.04 LTS
   - **Location**: Same region as previous (for latency and data residency)
   - **SSH key**: Add your existing SSH public key
3. Note the new VPS IP address.

### 3.2 Update DNS

```bash
# Point the A record for helloautoflow.com to the new IP
# Do this FIRST so DNS propagates while you install Coolify.
# Via Cloudflare CLI or dashboard:
# helloautoflow.com  A  <new-vps-ip>  TTL: 60
```

### 3.3 Install Coolify on the new VPS

```bash
ssh root@<NEW_VPS_IP>

# Official Coolify installation script
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# Wait for Coolify to start (check port 8000)
docker ps | grep coolify
```

### 3.4 Configure Coolify

1. Access Coolify at `https://<NEW_VPS_IP>:8000`.
2. Complete the initial setup wizard (admin account, SSH key).
3. Add a new **Server** pointing to localhost (`127.0.0.1`) with the root SSH key.

### 3.5 Restore PostgreSQL first

Before deploying the application, restore the database:

```bash
# Install PostgreSQL client tools on the new VPS
apt-get install -y postgresql-client-16

# Download and restore the latest backup (follow Section 1 above)
# Use the Postgres container that Coolify will provision, or start one manually:
docker run -d \
  --name postgres \
  -e POSTGRES_USER=app \
  -e POSTGRES_PASSWORD=<APP_DB_PASSWORD> \
  -e POSTGRES_DB=autoflow \
  -p 5432:5432 \
  postgres:16-alpine
```

Then follow **Section 1.2 through 1.8** to restore the dump into this new container.

### 3.6 Redeploy application from container registry

In Coolify:

1. Create a new **Application**.
2. Point it to the GitHub repository (`<org>/paperclipai`) or to the container image in GHCR (`ghcr.io/<org>/paperclipai:<tag>`).
3. Set all required environment variables (copy from `.env.production` or the Coolify secret store backup).
4. Click **Deploy**.

### 3.7 Verify full stack

```bash
# DNS propagation
dig helloautoflow.com A +short

# Application health
curl -sf https://helloautoflow.com/api/health | jq .

# TLS certificate
curl -vI https://helloautoflow.com 2>&1 | grep -E "SSL|issuer|expire"
```

### 3.8 Update monitoring and alerting

- Update any uptime monitors (e.g., Uptime Robot, Better Stack) with the new IP.
- Verify alert channels (Slack, PagerDuty) are still routing correctly.

---

## Section 4: Backup Verification (Monthly Test)

The monthly restore-test job in GitHub Actions (`db-backup.yml`, job: `restore-test`) runs automatically on the 1st of each month at 03:00 UTC. It:

1. Downloads the latest backup from S3.
2. Restores it into a fresh `postgres:16-alpine` service container.
3. Asserts that at least one table was restored successfully.

### 4.1 Trigger a manual restore test

```bash
gh workflow run db-backup.yml \
  --repo <org>/paperclipai \
  --field reason="Manual restore verification"
```

### 4.2 Manual restore test procedure

If the automated job is unavailable, run the verification manually:

```bash
# 1. Start a local throwaway Postgres instance
docker run -d \
  --name restore-test-pg \
  -e POSTGRES_USER=restore_test \
  -e POSTGRES_PASSWORD=restore_test_pw \
  -e POSTGRES_DB=restore_test_db \
  -p 5433:5432 \
  postgres:16-alpine

# Wait for it to be ready
docker exec restore-test-pg pg_isready -U restore_test

# 2. Download and decompress latest backup (see Section 1.2–1.3)

# 3. Restore
PGPASSWORD=restore_test_pw pg_restore \
  --host=localhost \
  --port=5433 \
  --username=restore_test \
  --dbname=restore_test_db \
  --no-owner \
  --no-privileges \
  --jobs=2 \
  /tmp/autoflow_<TIMESTAMP>.dump

# 4. Verify
PGPASSWORD=restore_test_pw psql \
  -h localhost -p 5433 \
  -U restore_test -d restore_test_db \
  -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"

# 5. Clean up
docker rm -f restore-test-pg
rm /tmp/autoflow_<TIMESTAMP>.dump
```

### 4.3 Document the test result

Record the outcome in the incident log (Section 6) even for successful tests, using the "backup-verification" type.

---

## Section 5: Runbook Maintenance

| Task | Frequency | Owner |
|------|-----------|-------|
| Review and update this runbook | Quarterly | Infra Lead |
| Rotate AWS IAM backup credentials | Every 90 days | Infra Lead |
| Verify Coolify SSH key is current | After any team change | On-call Engineer |
| Test restore end-to-end manually | Every 6 months | On-call Engineer |

---

## Section 6: Incident Log Template

Copy this table into a new row in your incident tracker (Notion, Linear, etc.) each time a DR event occurs.

| Field | Value |
|-------|-------|
| **Incident ID** | INC-YYYY-NNN |
| **Date/Time (UTC)** | YYYY-MM-DD HH:MM |
| **Type** | `db-restore` / `container-restart` / `vps-recovery` / `backup-verification` |
| **Severity** | P0 (production down) / P1 (degraded) / P2 (test/drill) |
| **Detected by** | Alert / Monitoring / Manual discovery |
| **On-call Engineer** | _name_ |
| **Timeline** | |
| &nbsp;&nbsp;HH:MM | Incident detected |
| &nbsp;&nbsp;HH:MM | Runbook section N started |
| &nbsp;&nbsp;HH:MM | Service restored |
| **Root cause** | _Brief description_ |
| **Backup used** | `autoflow_YYYYMMDDTHHMMSSZ.dump.gz` (or N/A) |
| **Data loss (actual RPO)** | _e.g., 6 hours_ |
| **Recovery time (actual RTO)** | _e.g., 1h 45m_ |
| **Action items** | _Numbered list of follow-up tasks with owners_ |
| **Post-mortem link** | _URL or N/A_ |
