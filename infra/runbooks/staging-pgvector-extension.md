# Staging pgvector Extension Runbook

Use this runbook when the staging backend fails schema initialization with an Azure PostgreSQL Flexible Server error like:

```text
extension "vector" is not allow-listed for "azure_pg_admin" users
```

## Targets

- PostgreSQL Flexible Server: `autoflowstgpg15p3v2`
- Resource group: `rg-autoflow-staging`
- Staging backend Container App: `ca-autoflow-staging-backend`

## 1. Confirm the current allow-list

```bash
az postgres flexible-server parameter show \
  --resource-group rg-autoflow-staging \
  --server-name autoflowstgpg15p3v2 \
  --name azure.extensions \
  --query value \
  -o tsv
```

Expected healthy value includes `vector`. Preserve existing extensions when updating the set. For the current staging server that means:

```bash
az postgres flexible-server parameter set \
  --resource-group rg-autoflow-staging \
  --server-name autoflowstgpg15p3v2 \
  --name azure.extensions \
  --value pgcrypto,vector
```

## 2. If direct SQL verification is needed, align the firewall rule to the current runner IP

```bash
RUNNER_IP=$(curl -sS https://ifconfig.me)

az postgres flexible-server firewall-rule update \
  --resource-group rg-autoflow-staging \
  --name autoflowstgpg15p3v2 \
  --rule-name allow-runner-ip \
  --start-ip-address "$RUNNER_IP" \
  --end-ip-address "$RUNNER_IP"
```

Reason: the runner egress IP is not stable. If the saved `allow-runner-ip` rule points to an older address, `psql` and `pg_isready` will hang or fail even though `allow-azure-services` is enabled.

## 3. Restart the active staging backend revision

```bash
LATEST_REVISION=$(
  az containerapp show \
    --name ca-autoflow-staging-backend \
    --resource-group rg-autoflow-staging \
    --query properties.latestRevisionName \
    -o tsv
)

az containerapp revision restart \
  --name ca-autoflow-staging-backend \
  --resource-group rg-autoflow-staging \
  --revision "$LATEST_REVISION"
```

## 4. Verify backend health

```bash
curl -sS https://staging-api.helloautoflow.com/health
```

Expected response includes:

- `"status":"ok"`
- `"postgres":{"configured":true,"connected":true}`

## 5. Verify the extension exists in Postgres

The staging Container App stores the database connection as the `db-url` secret. Use split connection fields so reserved characters in the password do not break URI parsing in CLI tools:

```bash
DATABASE_URL=$(
  az containerapp secret show \
    --name ca-autoflow-staging-backend \
    --resource-group rg-autoflow-staging \
    --secret-name db-url \
    --query value \
    -o tsv
)

proto_removed=${DATABASE_URL#postgresql://}
host_and_path=${proto_removed##*@}
creds=${proto_removed%@$host_and_path}
pg_user=${creds%%:*}
pg_pass=${creds#*:}
pg_hostport=${host_and_path%%/*}
pg_dbq=${host_and_path#*/}
pg_db=${pg_dbq%%\?*}
pg_host=${pg_hostport%%:*}
pg_port=${pg_hostport##*:}

PGPASSWORD="$pg_pass" PGCONNECT_TIMEOUT=5 psql \
  "host=$pg_host port=$pg_port dbname=$pg_db user=$pg_user sslmode=require" \
  -tAc "SELECT extname FROM pg_extension WHERE extname='vector';"
```

Expected output:

```text
vector
```
