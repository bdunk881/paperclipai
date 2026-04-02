# AutoFlow Encryption at Rest — Operations Guide

Satisfies CIS Control #3 (Data Protection) — storage encryption requirement.
See `docs/data-classification.md` for the policy that mandates these controls.

---

## 1. PostgreSQL

### 1.1 Cloud-Managed (Production Recommendation)

| Platform | Setting | How to Enable |
|----------|---------|---------------|
| AWS RDS | Storage encrypted | Set `StorageEncrypted: true` at instance creation; select KMS key (default AWS-managed or CMK) |
| Azure Database for PostgreSQL Flexible Server | Storage encryption | Enabled by default with platform-managed key; configure CMK via Azure Key Vault for Restricted data |
| Google Cloud SQL | Disk encryption | Enabled by default with Google-managed key; configure CMEK in instance settings |

> **CMK requirement:** Upgrade to a customer-managed key (CMK) when the data includes Restricted-tier content under contractual data-processing agreements.

### 1.2 Self-Managed / Docker Compose

Two complementary controls are required:

#### A. Volume Encryption (block-device level)

Encrypt the named volume at the host OS before starting the container. Example for Linux with LUKS:

```bash
# Create a LUKS-encrypted device (run once on the host)
sudo cryptsetup luksFormat /dev/sdX
sudo cryptsetup open /dev/sdX autoflow-pg-data
sudo mkfs.ext4 /dev/mapper/autoflow-pg-data
sudo mkdir -p /mnt/autoflow-pg-data
sudo mount /dev/mapper/autoflow-pg-data /mnt/autoflow-pg-data
```

Then mount that path as the Docker volume in `docker-compose.yml`:

```yaml
volumes:
  postgres_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /mnt/autoflow-pg-data
```

For cloud VMs, use AWS EBS encryption or Azure Managed Disk encryption instead of LUKS.

#### B. pgcrypto (Column-Level Encryption for Restricted Fields)

Enable the extension in the initialization script:

```sql
-- infra/postgres/init.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Add this init file to the compose service:

```yaml
postgres:
  image: postgres:16-alpine
  volumes:
    - postgres_data:/var/lib/postgresql/data
    - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/01-pgcrypto.sql:ro
```

Application usage (via `pgcrypto`):

```sql
-- Encrypt a Restricted field on write
INSERT INTO llm_configs (user_id, api_key)
VALUES ($1, pgp_sym_encrypt($2, current_setting('app.encryption_key')));

-- Decrypt on read (only in trusted backend context)
SELECT pgp_sym_decrypt(api_key::bytea, current_setting('app.encryption_key'))
FROM llm_configs
WHERE id = $1;
```

> **Note:** `llmConfigStore` already performs AES-256-GCM encryption at the application layer. `pgcrypto` provides defence-in-depth at the database layer.

Set `APP_ENCRYPTION_KEY` in your secrets manager (Key Vault, AWS Secrets Manager, or `.env` for local dev only — never commit it).

---

## 2. Redis

### 2.1 Cloud-Managed (Production Recommendation)

| Platform | Setting | How to Enable |
|----------|---------|---------------|
| AWS ElastiCache | At-Rest Encryption | Enable `AtRestEncryptionEnabled: true` when creating the cluster |
| Azure Cache for Redis | Customer-managed keys | Premium tier required; configure via Azure Key Vault |

### 2.2 Self-Managed / Docker Compose

Redis has no native transparent data encryption for its RDB/AOF snapshots. Two controls are required:

#### A. Encrypted Volume

Apply the same LUKS or cloud-native encrypted-volume approach as PostgreSQL to the Redis data directory. Since the current `docker-compose.yml` uses `--save ""` (no persistence), this is only needed if persistence is later enabled.

#### B. TLS for Encryption in Transit

TLS encrypts data between clients and Redis, which complements volume encryption. For Redis 6+:

```yaml
# docker-compose.yml — production TLS variant
redis:
  image: redis:7-alpine
  command: >
    redis-server
    --requirepass ${REDIS_PASSWORD}
    --tls-port 6380
    --port 0
    --tls-cert-file /certs/redis.crt
    --tls-key-file /certs/redis.key
    --tls-ca-cert-file /certs/ca.crt
    --save ""
  volumes:
    - ./certs:/certs:ro
  read_only: true
  tmpfs:
    - /tmp
```

Update `REDIS_URL` in the backend service:

```
REDIS_URL=rediss://:${REDIS_PASSWORD}@redis:6380
```

Note: `rediss://` (double-s) enables TLS in the `ioredis` / `bull` clients.

#### C. Development Environment

The current `docker-compose.yml` configuration (password-protected, no persistence, `read_only: true`) is acceptable for local development only. The encrypted-volume and TLS controls above are required before promoting to staging or production.

---

## 3. Key Management

| Secret | Storage (Dev) | Storage (Prod) |
|--------|--------------|----------------|
| `ENCRYPTION_KEY` (AES key for llmConfigStore) | `.env` (git-ignored) | Azure Key Vault / AWS Secrets Manager |
| `APP_ENCRYPTION_KEY` (pgcrypto column key) | `.env` (git-ignored) | Azure Key Vault / AWS Secrets Manager |
| `REDIS_PASSWORD` | `.env` (git-ignored) | Azure Key Vault / AWS Secrets Manager |
| `POSTGRES_PASSWORD` | `.env` (git-ignored) | Azure Key Vault / AWS Secrets Manager |
| LLM provider API keys | Never in env; stored in DB via llmConfigStore | Same |

**Rotation policy:** Rotate all Restricted-tier credentials quarterly or immediately on suspected compromise. Follow `docs/account-management.md` for the rotation procedure.

---

## 4. Verification Checklist

Before marking an environment as production-ready, confirm:

- [ ] PostgreSQL storage is encrypted (RDS `StorageEncrypted: true` or LUKS on self-managed)
- [ ] `pgcrypto` extension is enabled and Restricted fields use `pgp_sym_encrypt`
- [ ] Redis is on an encrypted volume (or ElastiCache at-rest encryption is enabled)
- [ ] Redis TLS is configured (`rediss://` connection string in use)
- [ ] `ENCRYPTION_KEY` and `APP_ENCRYPTION_KEY` are sourced from Key Vault, not `.env`
- [ ] No encryption keys appear in source control (`git log --all -S "ENCRYPTION_KEY"` returns no secrets)
- [ ] `piiRedactor` is active in all log paths (verify with `grep -r "redactPii" src/`)
