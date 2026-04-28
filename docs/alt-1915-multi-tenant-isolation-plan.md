# ALT-1915 Multi-Tenant Isolation Plan

**Status:** Draft  
**Author:** Security Engineer (agent c2583093)  
**Date:** 2026-04-28  
**Priority:** High  

## Executive Summary

This plan addresses per-company workspace isolation, secrets management, and agent context boundaries. The codebase has a solid foundation — workspace-scoped tables, RLS policies, and workspace membership — but critical implementation gaps prevent production-grade tenant isolation. This document identifies those gaps and proposes a phased remediation.

---

## Current State Assessment

### What Exists (Foundation)

| Layer | Implementation | Files |
|-------|---------------|-------|
| **Workspace model** | `workspaces` table with `owner_user_id`, `workspace_members` with roles (owner/admin/member) | `migrations/001_autoflow_schema.sql` |
| **Foreign keys** | All business tables (`leads`, `campaigns`, `tickets`, etc.) have `workspace_id NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE` | `migrations/001_autoflow_schema.sql`, `migrations/008_ticketing.sql` |
| **RLS policies** | Policies defined on all major tables checking `workspace_id = app_current_workspace_id()` | `migrations/001_autoflow_schema.sql` |
| **SQL helper functions** | `app_current_workspace_id()` and `app_current_user_id()` reading PostgreSQL session variables | `migrations/001_autoflow_schema.sql` |
| **Auth middleware** | JWT verification via Azure Entra External ID, extracts `sub` (userId) and `tenantId` | `src/auth/authMiddleware.ts` |
| **Company provisioning** | POST `/api/companies` creates company + workspace + team + agents | `src/companies/companyRoutes.ts` |
| **Secret binding** | Per-company `secretBindings` accepted at provisioning, masked in responses | `src/companies/companyRoutes.ts`, `src/controlPlane/controlPlaneStore.ts` |

### Critical Gaps (Vulnerabilities)

#### GAP-1: PostgreSQL Session Variables Never Set (CRITICAL)

**Impact:** RLS policies are defined but non-functional. All RLS checks against `app_current_workspace_id()` return NULL, making tenant isolation at the database layer ineffective.

**Location:** No middleware or query wrapper calls `SET app.current_workspace_id` or `SET app.current_user_id`.

**Risk:** BOLA (Broken Object Level Authorization) — any authenticated user can potentially access any tenant's data if queries bypass RLS or if RLS evaluates permissively on NULL.

#### GAP-2: Control Plane State In-Memory Only (HIGH)

**Impact:** Teams, agents, executions, secret bindings, and company records live in `Map<>` objects in `controlPlaneStore.ts`. A restart wipes all provisioned state.

**Risk:** Data loss, inconsistent tenant state, inability to audit. Secret bindings are unrecoverable after restart.

#### GAP-3: Secrets Stored Unencrypted in Memory (CRITICAL)

**Impact:** `companySecretBindings` is a plain `Map<string, Record<string, string>>` holding secrets in cleartext. No encryption at rest, no vault integration.

**Risk:** Memory dump / heap inspection exposes all company secrets. No rotation, expiration, or access audit.

#### GAP-4: No Workspace Context in API Routing (HIGH)

**Impact:** API endpoints accept no `workspace_id` parameter. If a user owns multiple workspaces, there's no mechanism to select or scope requests.

**Risk:** Ambiguous data access when users have multiple workspaces; impossible to implement proper multi-workspace support.

#### GAP-5: QA Auth Bypass Active (MEDIUM)

**Impact:** `requireAuthOrQaBypass` accepts `X-User-Id` header to impersonate any user when `QA_BYPASS_ENABLED` is set.

**Location:** `src/auth/authMiddleware.ts`

**Risk:** If this flag leaks to production, full tenant impersonation is possible.

#### GAP-6: No Cross-Tenant Audit Trail (MEDIUM)

**Impact:** No centralized audit log for workspace access, secret reads, or cross-tenant operations.

**Risk:** Compliance gap — cannot prove who accessed what data and when.

---

## Remediation Plan

### Phase 1: Activate Database-Layer Isolation (Week 1-2)

**Objective:** Make existing RLS policies functional by wiring PostgreSQL session variables.

#### 1.1 Workspace Context Middleware

Create middleware that runs on every authenticated request:

```typescript
// src/middleware/workspaceContext.ts
export async function setWorkspaceContext(
  pool: Pool,
  workspaceId: string,
  userId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SET app.current_workspace_id = $1", [workspaceId]);
    await client.query("SET app.current_user_id = $1", [userId]);
  } finally {
    client.release();
  }
}
```

**Key decisions:**
- Workspace ID must be derived from the request (header, path param, or resolved from userId for single-workspace users)
- Session variables must be set per-connection, per-request (connection pooling requires `SET` on every checkout)
- Consider using `SET LOCAL` within transactions for safer scoping

#### 1.2 Workspace Resolution Strategy

For requests without explicit workspace context:
1. Resolve default workspace from `workspaces` table using `owner_user_id`
2. For multi-workspace users, require `X-Workspace-Id` header
3. Validate workspace membership before setting session variable

#### 1.3 RLS Policy Audit

- Verify all RLS policies handle NULL `app_current_workspace_id()` safely (should DENY, not allow)
- Add explicit NULL check: `workspace_id = app_current_workspace_id() AND app_current_workspace_id() IS NOT NULL`
- Test with `SET ROLE` to confirm policies enforce correctly

**Subtask assignments:**
- Backend Engineer: Implement workspace context middleware and wire into Express pipeline
- Security Engineer (self): Audit and harden RLS policies, write test cases

---

### Phase 2: Persist Control Plane to PostgreSQL (Week 2-3)

**Objective:** Move all in-memory state to durable, workspace-scoped storage.

#### 2.1 New Migration: Control Plane Tables

```sql
CREATE TABLE provisioned_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  name text NOT NULL,
  external_company_id text,
  budget_monthly_usd numeric(10,2) NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (idempotency_key)
);

ALTER TABLE provisioned_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY provisioned_companies_tenant_isolation ON provisioned_companies
  USING (workspace_id = app_current_workspace_id());

CREATE TABLE control_plane_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id uuid REFERENCES provisioned_companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  user_id text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE control_plane_teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY teams_tenant_isolation ON control_plane_teams
  USING (workspace_id = app_current_workspace_id());

CREATE TABLE control_plane_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES control_plane_teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text NOT NULL,
  model text,
  budget_allocated_usd numeric(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE control_plane_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY agents_tenant_isolation ON control_plane_agents
  USING (workspace_id = app_current_workspace_id());
```

#### 2.2 Migrate controlPlaneStore to PostgreSQL-backed Implementation

Replace `Map<>` stores with a repository layer that queries PostgreSQL with RLS active.

**Subtask assignments:**
- Backend Engineer: Implement PostgreSQL-backed control plane store
- Security Engineer (self): Verify RLS coverage on new tables

---

### Phase 3: Secrets Management (Week 3-4)

**Objective:** Encrypted, audited secrets storage with rotation support.

#### 3.1 Encrypted Secrets Table

```sql
CREATE TABLE company_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES provisioned_companies(id) ON DELETE CASCADE,
  key text NOT NULL,
  encrypted_value bytea NOT NULL,
  encryption_key_id text NOT NULL, -- reference to key version for rotation
  created_at timestamptz DEFAULT now(),
  rotated_at timestamptz,
  expires_at timestamptz,
  UNIQUE (company_id, key)
);

ALTER TABLE company_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY secrets_tenant_isolation ON company_secrets
  USING (workspace_id = app_current_workspace_id());
```

#### 3.2 Encryption Strategy

**Option A (Recommended for MVP):** Application-layer encryption using `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` with AES-256-GCM. Key stored in environment, per-secret IV stored alongside ciphertext.

**Option B (Target State):** Azure Key Vault integration. Each company gets a dedicated key in Key Vault. Application calls Key Vault for encrypt/decrypt operations. Provides HSM backing, automatic rotation, and audit trail.

#### 3.3 Secret Access Audit Table

```sql
CREATE TABLE secret_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  company_id uuid NOT NULL,
  secret_key text NOT NULL,
  accessed_by text NOT NULL, -- agent ID or user ID
  access_type text NOT NULL, -- 'read', 'write', 'rotate', 'delete'
  accessed_at timestamptz DEFAULT now()
);
-- No RLS on audit table; read access restricted to security/admin roles via application layer
```

**Subtask assignments:**
- Backend Engineer: Implement encryption/decryption service
- DevOps Engineer: Set up Azure Key Vault if Option B
- Security Engineer (self): Define rotation policy, audit requirements

---

### Phase 4: Agent Context Isolation (Week 4-5)

**Objective:** Ensure agents can only access data within their company's workspace.

#### 4.1 Agent Execution Context

Every agent execution must carry:
- `workspaceId` — the company workspace it operates within
- `agentId` — the specific agent identity
- `teamId` — the team scope
- Derived permissions based on agent role

#### 4.2 Agent-to-Workspace Binding

- Agent instructions directory already scoped: `.paperclip/instances/default/companies/{companyId}/agents/{agentId}/`
- Ensure filesystem isolation: agents must not traverse to other company directories
- Validate `companyId` in path matches the agent's provisioned company

#### 4.3 Agent API Scoping

All API calls made by agents must include workspace context:
- Inject `X-Workspace-Id` header from agent execution context
- Validate agent's team belongs to the workspace
- Rate-limit per-agent, per-workspace (not just per-user)

**Subtask assignments:**
- Backend Engineer: Wire agent execution context through API layer
- Security Engineer (self): Validate path traversal protections, test cross-tenant agent access

---

### Phase 5: Hardening and Compliance (Week 5-6)

#### 5.1 QA Bypass Guard

- Add environment check: `QA_BYPASS_ENABLED` must only be set when `NODE_ENV !== 'production'`
- Log all QA bypass authentications
- Consider removing entirely and using proper test user provisioning

#### 5.2 Centralized Audit Log

```sql
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid,
  actor_type text NOT NULL, -- 'user', 'agent', 'system'
  actor_id text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  metadata jsonb DEFAULT '{}',
  ip_address inet,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_log_workspace ON audit_log (workspace_id, created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log (actor_id, created_at DESC);
```

#### 5.3 Cross-Tenant Access Prevention Checklist

- [ ] All SELECT queries go through connections with `app.current_workspace_id` set
- [ ] No raw SQL bypasses RLS (audit all `pool.query()` calls)
- [ ] Agent filesystem access restricted to own company directory
- [ ] Secret access logged and auditable
- [ ] QA bypass disabled in production
- [ ] Rate limiting scoped per-workspace, per-agent
- [ ] Workspace membership validated before setting context
- [ ] NULL workspace context results in query denial (not permissive access)

---

## Threat Model Summary

| Threat | Current Risk | After Remediation | Phase |
|--------|-------------|-------------------|-------|
| Cross-tenant data access via API | **CRITICAL** (RLS inactive) | Low (RLS + middleware) | 1 |
| Data loss on restart | **HIGH** (in-memory store) | Low (PostgreSQL persistence) | 2 |
| Secret exposure in memory | **CRITICAL** (plaintext Map) | Low (encrypted storage) | 3 |
| Agent cross-tenant access | **HIGH** (no workspace binding) | Low (execution context) | 4 |
| User impersonation via QA bypass | **MEDIUM** (env flag) | Low (production guard) | 5 |
| Compliance audit failure | **MEDIUM** (no audit trail) | Low (audit log) | 5 |

---

## Success Criteria

1. **RLS Functional:** `SET app.current_workspace_id` called on every authenticated DB connection; verified by integration tests showing cross-tenant queries return zero rows
2. **Persistent State:** Control plane survives process restart; verified by restart test
3. **Encrypted Secrets:** No plaintext secrets in memory or database; verified by heap dump analysis
4. **Agent Isolation:** Agent A cannot read Agent B's workspace data; verified by cross-tenant test
5. **Audit Coverage:** All secret access and cross-tenant operations logged; verified by log review
6. **QA Bypass Guarded:** Production deployment rejects `X-User-Id` header; verified by staging test

---

## Dependencies and Risks

- **Backend Engineer** needed for middleware implementation, PostgreSQL store migration
- **DevOps Engineer** needed for Azure Key Vault setup (Phase 3 Option B)
- **Risk:** Large migration surface — recommend phased rollout with feature flags per phase
- **Risk:** Connection pool behavior with `SET` — must verify pgBouncer/connection pooler compatibility
- **Risk:** Performance impact of per-request `SET` — benchmark required

---

## Next Steps

1. CTO review and approval of this plan
2. Create subtasks for Backend Engineer (Phase 1.1, 2.2) and DevOps Engineer (Phase 3 Key Vault)
3. Security Engineer begins Phase 1.3 (RLS audit) immediately
