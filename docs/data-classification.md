# AutoFlow Data Classification Policy

Satisfies CIS Control #3 (Data Protection) and NIST CSF PR.DS (Data Security).

---

## 1. Classification Tiers

AutoFlow classifies all data into four tiers based on sensitivity and the impact of unauthorised disclosure.

| Tier | Label | Description | Example Disclosure Impact |
|------|-------|-------------|--------------------------|
| 0 | **Public** | Intended for public consumption; no harm if disclosed | Marketing copy, public API docs |
| 1 | **Internal** | Not meant for public release but low sensitivity | Internal tooling READMEs, non-sensitive metrics |
| 2 | **Confidential** | Business-sensitive; disclosure could cause competitive or reputational harm | Customer workflow outputs, usage analytics, model cost logs |
| 3 | **Restricted** | Highest sensitivity; unauthorised disclosure causes significant harm | LLM API keys, auth tokens, PII, credentials |

---

## 2. AutoFlow Data Type Inventory

### 2.1 Restricted (Tier 3)

| Data Type | Storage Location | Handling Requirements |
|-----------|-----------------|----------------------|
| LLM provider API keys | `llm_configs` table (AES-256 encrypted column) | Never logged; AES-256 at rest; TLS in transit; only decrypted in memory during request execution |
| OAuth/JWT tokens | In-memory (never persisted) | Never written to disk or logs; short-lived; revoked on sign-out |
| Database credentials | Environment variables / Key Vault | Never committed to source; rotated quarterly |
| User PII (names, emails, phone numbers) | `users` table | Encrypted at rest; redacted from all log output; governed by data-handling consent |
| LLM prompt content containing PII | In-memory only during execution | Must not be logged; if diagnostic logging is needed, PII must be redacted first via `piiRedactor` |

### 2.2 Confidential (Tier 2)

| Data Type | Storage Location | Handling Requirements |
|-----------|-----------------|----------------------|
| Workflow execution outputs | `run_steps` table | Encrypted at rest; accessible only to workflow owner and Admin role |
| LLM cost/token usage logs | `runs` table | Not publicly accessible; Admin-only export |
| Approval request content | `approvals` table | RBAC-controlled; Operator+ required |
| Webhook payloads | Transit only (not persisted by default) | TLS required; contents treated as Confidential unless content confirms otherwise |

### 2.3 Internal (Tier 1)

| Data Type | Storage Location | Handling Requirements |
|-----------|-----------------|----------------------|
| Workflow template definitions | `templates` table / source repo | Internal; do not expose unauthenticated |
| System metrics (latency, error rates) | Monitoring stack | Role-gated dashboards; not public |
| Audit/security event logs | stdout → log aggregator | Structured JSON; no PII; retained 90 days |

### 2.4 Public (Tier 0)

| Data Type | Storage Location | Handling Requirements |
|-----------|-----------------|----------------------|
| Marketing copy and landing page content | `landing/` directory / CMS | No restrictions |
| OpenAPI spec (non-auth endpoints) | `openapi.yaml` | Publishable; keep auth details out |
| Brand assets | `autoflow-brand/` | No restrictions |

---

## 3. Encryption at Rest Requirements

### 3.1 PostgreSQL

**Cloud-managed (recommended for production):**
- AWS RDS / Azure Database for PostgreSQL Flexible Server: enable the **encrypted storage** option at instance creation. Once enabled, all data files, backups, and replicas are encrypted with AES-256.
- Key management: use the platform-managed KMS key by default; migrate to a customer-managed key (CMK) when required for Restricted data under contractual obligations.

**Self-managed / Docker:**
- Enable the `pgcrypto` extension and encrypt Restricted columns at the application layer:
  ```sql
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- Example: store LLM API key ciphertext
  UPDATE llm_configs
  SET api_key = pgp_sym_encrypt(plaintext_key, current_setting('app.encryption_key'));
  ```
- Store the encryption key in an environment variable (`APP_ENCRYPTION_KEY`) sourced from a secrets manager or Key Vault — never hardcoded.
- Apply volume encryption (LUKS on Linux or AWS/Azure encrypted EBS/Managed Disk) to the PostgreSQL data directory so the underlying block device is encrypted independently of pgcrypto.

> **Note:** The `llmConfigStore` already uses AES-256-GCM application-layer encryption for `api_key` fields (see `src/llmConfig/llmConfigStore.ts`). Volume-level encryption is a defence-in-depth layer.

### 3.2 Redis

Redis does not provide native transparent encryption of its RDB/AOF files. Encryption at rest for Redis is achieved at the infrastructure layer:

**Cloud-managed:**
- AWS ElastiCache: enable the **At-Rest Encryption** checkbox when creating the cluster. Uses AES-256 via AWS KMS.
- Azure Cache for Redis: Premium tier supports encryption at rest using customer-managed keys via Azure Key Vault.

**Self-managed / Docker:**
- Mount the Redis data directory from an encrypted volume (LUKS/EBS/Managed Disk).
- Enable TLS to encrypt data in transit (complements at-rest protection):
  ```yaml
  # docker-compose.yml excerpt — production TLS variant
  redis:
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --tls-port 6380
      --port 0
      --tls-cert-file /certs/redis.crt
      --tls-key-file /certs/redis.key
      --tls-ca-cert-file /certs/ca.crt
  ```
- For development environments, the current `--requirepass` configuration is acceptable; volume encryption is the required additional control before production use.

### 3.3 LLM API Keys (Application-Layer Encryption)

API keys are already encrypted at the application layer using AES-256-GCM in `src/llmConfig/llmConfigStore.ts`. The key is derived from `process.env.ENCRYPTION_KEY`. This satisfies the Restricted tier requirement for this data type independent of database-level encryption.

---

## 4. PII in LLM Prompt and Response Logging

### 4.1 Policy

LLM prompt content and model responses **must not be logged in plaintext** in any environment. This applies to:
- Input payloads sent to LLM providers
- Raw text responses from LLM providers
- Interpolated prompt templates that may contain user-supplied data

### 4.2 Implementation

A PII redaction utility (`src/auth/piiRedactor.ts`) is applied before any log emission that could contain user-controlled content. The redactor masks:
- Email addresses → `[EMAIL]`
- Phone numbers → `[PHONE]`
- Credit card numbers → `[CARD]`
- SSNs → `[SSN]`
- Bearer / API key tokens → `[TOKEN]`

The `logSecurityEvent` function in `src/auth/securityLogger.ts` calls `redactPii` on all `extras` before writing to stdout.

### 4.3 Diagnostic Logging Guidelines

If prompt content must be captured for debugging:
1. Log only in a non-production environment with debug logging explicitly enabled.
2. Run the content through `redactPii` before writing.
3. Truncate prompts to ≤ 200 characters in log entries.
4. Delete debug logs once the investigation is complete.

---

## 5. Developer Onboarding: Data Handling Checklist

New contributors must read this document and comply with the following before handling AutoFlow data:

- [ ] **Never log raw prompts or LLM responses.** Pass any string containing user data through `redactPii()` before logging.
- [ ] **Never hardcode credentials.** Use environment variables sourced from `.env` (local dev) or Key Vault (staging/prod).
- [ ] **Never store Restricted data outside designated encrypted fields.** LLM API keys go in `llm_configs` via `llmConfigStore`; tokens stay in memory.
- [ ] **Always use TLS for external calls.** All HTTP clients must enforce `https://` for LLM provider endpoints and webhooks.
- [ ] **Label data in code comments.** When introducing a new persisted field containing Confidential or Restricted data, add a comment: `// DATA_CLASS: Confidential` or `// DATA_CLASS: Restricted`.
- [ ] **Report a suspected data leak immediately** using the Incident Response Plan (`docs/incident-response-plan.md`).

---

## 6. Review and Approval

| Field | Value |
|-------|-------|
| Author | Security Engineer |
| Status | **Approved** |
| Approval date | 2026-04-02 |
| Next review | 2027-04-02 |
| Satisfies | CIS Control #3 (Data Protection), NIST CSF PR.DS |
