# AutoFlow Account Management Procedures

Satisfies CIS Control #5 (Account Management) and NIST CSF PR.AA (Identity Management, Authentication, and Access Control).

---

## 1. MFA Enforcement

### Policy

Multi-Factor Authentication (MFA) is **mandatory** for all human users accessing AutoFlow systems via Azure Entra External ID. No exceptions are permitted.

### Entra Configuration

MFA is enforced via a Conditional Access policy applied to the AutoFlow app registration:

| Setting | Value |
|---------|-------|
| Policy name | `AutoFlow – Require MFA` |
| Users/groups | All users assigned to the application |
| Cloud apps | AutoFlow app registration |
| Grant control | Require multifactor authentication |
| Policy state | **On** |

### Verification Steps

To confirm MFA is active:

1. Sign in to [portal.azure.com](https://portal.azure.com) with a Global Administrator or Conditional Access Administrator account.
2. Navigate to **Entra ID → Protection → Conditional Access → Policies**.
3. Locate `AutoFlow – Require MFA` and verify **State = On**.
4. Select the policy and confirm:
   - **Assignments → Users** includes all AutoFlow users (or the relevant group).
   - **Assignments → Cloud apps** targets the AutoFlow app registration.
   - **Grant → Require multifactor authentication** is checked.
5. Screenshot the policy overview and store it in `docs/screenshots/mfa-policy-confirmed-<YYYY-MM-DD>.png`.

> **Last confirmed:** 2026-04-02 — policy active, applied to all assigned users.

### Token Lifetime Configuration

To limit the blast radius of a compromised token, the following token lifetime policies apply:

| Token type | Max lifetime | Setting |
|------------|-------------|---------|
| Access token | 1 hour | `AccessTokenLifetime: 01:00:00` |
| Refresh token (single-session) | 24 hours | `MaxInactiveTime: 1.00:00:00` |
| ID token | 1 hour | matches access token |

These are enforced via an Entra Token Lifetime Policy bound to the AutoFlow service principal:

```bash
# Create or update token lifetime policy (Azure CLI / Graph API)
# Reference: https://learn.microsoft.com/en-us/azure/active-directory/develop/configure-token-lifetimes

az rest --method POST \
  --uri "https://graph.microsoft.com/v1.0/policies/tokenLifetimePolicies" \
  --body '{
    "displayName": "AutoFlow Token Lifetime Policy",
    "isOrganizationDefault": false,
    "definition": [
      "{\"TokenLifetimePolicy\":{\"Version\":1,\"AccessTokenLifetime\":\"01:00:00\",\"MaxInactiveTime\":\"01:00:00\"}}"
    ]
  }'
```

After creating the policy, bind it to the AutoFlow service principal:

```bash
az rest --method POST \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/<SP_OBJECT_ID>/tokenLifetimePolicies/\$ref" \
  --body '{"@odata.id": "https://graph.microsoft.com/v1.0/policies/tokenLifetimePolicies/<POLICY_ID>"}'
```

---

## 2. Account Provisioning Process

### New User Onboarding

1. **Request** — Line manager submits an access request via the internal ticketing system, specifying:
   - User full name and email
   - Role required: `Viewer`, `Operator`, or `Admin` (see `docs/rbac.md`)
   - Business justification
2. **Approval** — Security Engineer or CTO approves the request.
3. **Provisioning** — Admin performs:
   a. Invite the user to the Azure Entra External ID tenant (B2B invite if external).
   b. Assign the appropriate app role in **Enterprise Applications → AutoFlow → Users and groups**.
   c. Confirm MFA registration prompt is triggered on first sign-in.
4. **Notification** — User receives welcome email with link to AutoFlow and MFA setup instructions.
5. **Audit** — Log the provisioning event in the access log (`docs/access-log.md` or ticketing system).

### Least-Privilege Principle

- Default role for new users: **Viewer**.
- Operator and Admin roles require explicit approval.
- Admin role is restricted to ≤ 2 named individuals at any time.

---

## 3. User Offboarding SOP

Execute the following checklist within **4 business hours** of a termination notice.

### Offboarding Checklist

- [ ] **Disable Entra account** — In Azure Portal, go to **Entra ID → Users**, find the user, select **Edit**, set **Account enabled = No**.
- [ ] **Remove app role assignment** — In **Enterprise Applications → AutoFlow → Users and groups**, remove the user's role assignment.
- [ ] **Revoke active sessions** — In **Entra ID → Users → [user] → Authentication methods**, click **Revoke sessions**.
- [ ] **Audit active runs** — Query the AutoFlow backend for any in-progress runs owned by the user and cancel or reassign them.
- [ ] **Rotate shared secrets (if applicable)** — If the user had access to any shared credentials (e.g., service account passwords, API keys stored in shared vaults), rotate those secrets immediately.
- [ ] **Remove from distribution groups / Teams** — Remove the user from any internal collaboration channels with access to sensitive AutoFlow configuration.
- [ ] **Confirm no personal API keys remain** — Search Key Vault and environment variable stores for any keys provisioned specifically for that user.
- [ ] **Document completion** — Record the offboarding in the access log with timestamp and approver.

### Offboarding Verification Command

```bash
# Confirm account is disabled and has no active role assignments
az rest --method GET \
  --uri "https://graph.microsoft.com/v1.0/users/<USER_ID>?$select=accountEnabled,displayName,userPrincipalName"

az rest --method GET \
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/<SP_OBJECT_ID>/appRoleAssignedTo" \
  | grep -i "<USER_ID>"
```

---

## 4. Service Account Inventory

All non-human principals with API access to AutoFlow systems are documented below. This inventory must be reviewed quarterly.

> **Last reviewed:** 2026-04-02

| Account | Type | Purpose | Permissions | Owner | Credentials Location | Rotation Schedule |
|---------|------|---------|-------------|-------|---------------------|-------------------|
| `autoflow-backend-sp` | Entra Service Principal | Backend API authentication | `User.Read` (delegated) | CTO | Azure Key Vault: `autoflow-kv` → `backend-sp-secret` | 90 days |
| `autoflow-ci-sp` | Entra Service Principal | CI/CD pipeline deployments (Azure DevOps) | `Contributor` on resource group `autoflow-rg` | CTO | Azure DevOps service connection | 180 days |
| `autoflow-monitoring-sp` | Entra Service Principal | Read-only monitoring / log ingestion | `Monitoring Reader` on subscription | CTO | Azure Key Vault: `autoflow-kv` → `monitoring-sp-secret` | 180 days |
| `github-actions-oidc` | GitHub Actions OIDC | Keyless deployment via OIDC federation | `Contributor` on resource group `autoflow-rg` | CTO | Federated credential (no stored secret) | N/A (OIDC) |

### Least-Privilege Review Notes

- `autoflow-backend-sp`: scoped to `User.Read` only; does not hold admin directory roles.
- `autoflow-ci-sp`: scoped to the `autoflow-rg` resource group only; does not have subscription-level write.
- `autoflow-monitoring-sp`: read-only role; cannot modify resources.
- `github-actions-oidc`: uses Workload Identity Federation — no long-lived secret stored anywhere.

### Adding a New Service Account

1. Create the Entra app registration / managed identity with the minimum required permissions.
2. Add an entry to this table.
3. Store credentials in Azure Key Vault with access restricted to the owning workload identity.
4. Set a calendar reminder for the rotation schedule.
5. Document the justification for any permissions beyond `Reader`.

### Removing a Service Account

1. Revoke/delete credentials from Key Vault.
2. Remove the service principal's role assignments.
3. Delete the Entra app registration.
4. Remove the entry from this table.

---

## 5. Periodic Review Requirements

| Activity | Frequency | Owner |
|----------|-----------|-------|
| Confirm MFA policy is active | Quarterly | Security Engineer |
| Review user role assignments | Quarterly | Security Engineer |
| Service account inventory review | Quarterly | Security Engineer |
| Token lifetime policy validation | Bi-annually | Security Engineer |
| Offboarding SOP tabletop drill | Annually | Security Engineer + CTO |
