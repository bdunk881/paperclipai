# AutoFlow RBAC Model

## Overview

AutoFlow implements Role-Based Access Control (RBAC) using Azure Entra app roles. Roles are defined in the app registration manifest and emitted as the `roles` claim in the Entra-issued JWT. The backend enforces these roles on every protected request via the `requireRole` middleware in `src/auth/authMiddleware.ts`.

This satisfies CIS Control #6 (Access Control Management) and NIST CSF PR.AA (Identity Management, Authentication, and Access Control).

## Roles

| Role | Description |
|------|-------------|
| **Viewer** | Read-only. Can list and view own runs and approvals. Cannot trigger runs or modify any resource. |
| **Operator** | Viewer + can trigger workflow runs, fire webhooks, and resolve approval requests. |
| **Admin** | Operator + can manage LLM provider configurations (create, update, delete, set default). |

### Hierarchy

```
Admin ⊇ Operator ⊇ Viewer
```

Admin users must be explicitly assigned the `Admin` role in Entra. Being Admin does **not** automatically grant Operator or Viewer in the JWT `roles` claim — the API enforces `requireRole("Operator", "Admin")` for Operator-level endpoints to account for this.

## Protected Endpoints

| Method | Path | Required Role(s) |
|--------|------|-----------------|
| `POST` | `/api/runs` | Operator, Admin |
| `POST` | `/api/webhooks/:templateId` | Operator, Admin |
| `POST` | `/api/workflows/generate` | Operator, Admin |
| `POST` | `/api/approvals/:id/resolve` | Operator, Admin |
| `GET` | `/api/approvals` | Any authenticated user (scoped to own) |
| `GET` | `/api/approvals/:id` | Any authenticated user (owner check) |
| `GET` | `/api/runs` | Any authenticated user (scoped to own) |
| `GET` | `/api/runs/:id` | Any authenticated user (owner check) |
| `*` | `/api/llm-configs` | Admin |

## Resource Ownership Scoping

In addition to role checks, read endpoints for runs and approvals are scoped to the authenticated user:

- `GET /api/runs` returns only runs created by the caller (`userId = req.auth.sub`).
- `GET /api/runs/:id` returns 404 if the run belongs to a different user.
- `GET /api/approvals` returns only approvals belonging to the caller.
- `GET /api/approvals/:id` returns 404 if the approval belongs to a different user.

## Azure Entra Setup

1. Open the app registration in the Azure Portal.
2. Navigate to **App roles** and add the three roles from `infra/azure/app-manifest-roles.json`.
3. In **Enterprise Applications → Users and groups**, assign users to the appropriate role.
4. Tokens issued after role assignment will include the `roles` claim with the assigned role values.

The role GUIDs in `app-manifest-roles.json` are placeholders — replace them with real UUIDs when importing into Azure.

## Implementation Reference

- Role type and `requireAuth` / `requireRole` middleware: `src/auth/authMiddleware.ts`
- Authorization failure audit events (`authz_failure`): `src/auth/securityLogger.ts`
- Azure Entra app manifest roles stanza: `infra/azure/app-manifest-roles.json`
