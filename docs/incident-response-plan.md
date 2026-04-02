# AutoFlow Incident Response Plan (IRP)

**Product**: AutoFlow (helloautoflow.com)
**Version**: 1.0
**Last reviewed**: 2026-04-02
**IRP Owner**: Security Engineer
**Satisfies**: CIS Control #17 (Incident Response Management), NIST CSF RS (Respond)

---

## 1. Purpose and Scope

This Incident Response Plan (IRP) defines how AutoFlow detects, responds to, contains, eradicates, and recovers from security incidents. It applies to all AutoFlow systems, services, data, and personnel.

A **security incident** is any confirmed or suspected event that threatens the confidentiality, integrity, or availability of AutoFlow data or systems, including unauthorized access, data breaches, compromised credentials, malware, DDoS, and insider threats.

---

## 2. Security Incident Response Team (SIRT)

| Role | Responsibilities | Primary Contact |
|------|-----------------|-----------------|
| **SIRT Lead** (Security Engineer) | Coordinates response, owns IRP execution | security@autoflow.com |
| **Engineering Lead / CTO** | Technical escalation, architectural decisions, customer comms approval | cto@autoflow.com |
| **CEO** | Business decisions, regulatory notifications, PR/legal | ceo@autoflow.com |
| **On-Call Engineer** | First responder, initial triage and containment | PagerDuty on-call rotation |
| **Legal Counsel** | Regulatory obligations, breach notifications, liability | legal@autoflow.com |

**SIRT activation**: The on-call engineer or any team member may activate the SIRT by paging the SIRT Lead via PagerDuty (service: `autoflow-security-incidents`).

---

## 3. Severity Levels and SLAs

| Severity | Description | Examples | Initial Response | Escalation |
|----------|-------------|----------|-----------------|------------|
| **P0 – Critical** | Active breach or imminent data loss; service compromised | Active data exfiltration, ransomware, admin account takeover | 15 minutes | SIRT Lead + CTO + CEO immediately |
| **P1 – High** | Confirmed security incident, no active exfiltration yet | Unauthorized access detected, secrets exposed in logs | 1 hour | SIRT Lead within 30 min |
| **P2 – Medium** | Potential incident under investigation | Anomalous login patterns, suspicious API activity | 4 hours | SIRT Lead within 2 hours |
| **P3 – Low** | Policy violation, minor misconfig, no data impact | Failed brute force attempts, expired cert warnings | 1 business day | Weekly security review |

---

## 4. Incident Response Lifecycle

### 4.1 Detection

Detection sources:
- **AWS CloudWatch Alarms** — anomalous API error rates, auth failures (see `infra/monitoring/cloudwatch-alarms.tf`)
- **TruffleHog / secret-scan.yml** — secrets detected in commits
- **CodeQL SAST** — vulnerability findings in CI
- **Trivy weekly scan** — dependency CVEs
- **Azure Entra audit logs** — suspicious login activity, MFA bypass attempts
- **PagerDuty** — infrastructure alerts correlated with security events
- **User reports** — customer or employee reporting suspicious activity

**Immediate action upon detection**: Page on-call via PagerDuty `autoflow-security-incidents` policy.

### 4.2 Triage

Within the initial response window:

1. **Classify severity** (P0/P1/P2/P3) using the table above.
2. **Identify scope**: What systems, data, and users are affected?
3. **Preserve evidence**: Capture logs, screenshots, timestamps *before* any remediation. Export relevant CloudWatch logs to S3 with write-protection.
4. **Open incident channel**: Create a dedicated Slack channel `#incident-YYYY-MM-DD-<slug>` and record all decisions there.
5. **Create incident ticket**: Log in the issue tracker with severity label.

**Do NOT** remediate before preserving evidence. Evidence destruction can complicate legal/regulatory obligations.

### 4.3 Containment

Short-term containment (within 1 hour for P0/P1):

- **Isolate affected systems**: Remove from load balancer, revoke API keys, disable compromised accounts via Azure Entra.
- **Rotate exposed secrets**: Use GitHub Actions secrets rotation + Azure Key Vault. Reference `docs/secrets-management.md`.
- **Enable maintenance mode** if customer-facing systems are at risk.
- **Block malicious IPs** at Cloudflare WAF or Azure Front Door.

Long-term containment (after immediate threat is stabilized):

- Deploy a clean environment alongside the compromised one if needed.
- Implement additional monitoring/alerting for attacker TTPs.

### 4.4 Eradication

1. **Root cause analysis**: Identify the attack vector (CVE, misconfiguration, credential compromise).
2. **Remove malicious artifacts**: Backdoors, unauthorized accounts, injected code.
3. **Patch or mitigate the vulnerability**: Deploy fix via standard CI/CD or emergency hotfix process.
4. **Verify remediation**: Run CodeQL, Trivy, and TruffleHog scans against patched code.
5. **Rotate all potentially exposed credentials**: Database passwords, API keys, JWT signing keys, OAuth secrets.

### 4.5 Recovery

1. **Restore from backup** if data integrity is in question (see `docs/disaster-recovery-runbook.md`).
2. **Gradual service restoration**: Re-enable services incrementally with enhanced monitoring.
3. **Verify integrity**: Run automated test suite + manual smoke tests.
4. **Monitor closely** for 72 hours post-recovery for signs of re-compromise.
5. **Communicate resolution** to affected customers and stakeholders.

### 4.6 Post-Incident Review

Within 5 business days of incident closure:

1. **Write a post-mortem** (blameless): Timeline, root cause, impact, what worked, what didn't.
2. **Document lessons learned** and create action items with owners and due dates.
3. **Update IRP** if gaps were identified.
4. **Update monitoring/alerting** to detect similar attacks faster.
5. **Share summary** with CTO and CEO.

Post-mortem template: `docs/post-mortem-template.md`

---

## 5. Breach Notification Procedure

### 5.1 Internal Notification Timeline

| Time | Action |
|------|--------|
| T+0 | On-call detects incident, pages SIRT Lead |
| T+1h | SIRT Lead assesses breach scope, notifies CTO + CEO |
| T+4h | Legal counsel engaged if PII or regulated data involved |
| T+24h | Preliminary incident report to leadership |
| T+72h | Regulatory notification deadline (GDPR) if applicable |

### 5.2 GDPR (if applicable)

If AutoFlow processes EU personal data and the incident involves a personal data breach:

- **72-hour rule**: Notify the relevant supervisory authority (e.g., ICO in the UK, DPA in the EU member state) within 72 hours of becoming aware of the breach.
- Required notification content:
  - Nature of the breach (categories and approximate number of data subjects affected)
  - Contact details of the Data Protection Officer (or equivalent)
  - Likely consequences of the breach
  - Measures taken or proposed to address the breach
- If notification cannot be made within 72 hours, provide a reason for the delay and phased notification.
- If the breach is likely to result in high risk to individuals, notify affected individuals without undue delay.

**Notification template**: `docs/gdpr-breach-notification-template.md`

### 5.3 Customer Notification

For incidents affecting customer data:
- Notify affected customers via email within 72 hours of confirming scope.
- Template: `docs/customer-breach-notification-template.md`
- All customer communications must be approved by CEO + Legal before sending.

---

## 6. Incident Playbooks

### Playbook 1: Data Breach

**Trigger**: Confirmed unauthorized access to AutoFlow database, S3 buckets, or customer data.

**Step 1 — Immediate Containment (T+0 to T+30 min)**
```bash
# 1. Revoke compromised database credentials
# Azure Portal → Azure Database for PostgreSQL → Connection Security → Reset admin password
# OR via CLI:
az postgres flexible-server update \
  --resource-group autoflow-prod \
  --name autoflow-db \
  --admin-password "$(openssl rand -base64 32)"

# 2. Rotate application database URL secret
gh secret set DATABASE_URL --repo autoflow/autoflow --body "postgresql://..."

# 3. Disable compromised user accounts in Azure Entra
az ad user update --id <upn> --account-enabled false

# 4. Block suspicious IPs at Cloudflare (via API or dashboard)
```

**Step 2 — Evidence Preservation (before any cleanup)**
```bash
# Export CloudWatch logs for the incident window
aws logs get-log-events \
  --log-group-name /autoflow/production \
  --log-stream-name <stream> \
  --start-time <epoch-ms> \
  --end-time <epoch-ms> \
  --output text > incident-logs-$(date +%Y%m%d).txt

# Snapshot compromised database (read-only forensic copy)
aws rds create-db-snapshot \
  --db-instance-identifier autoflow-prod \
  --db-snapshot-identifier forensic-$(date +%Y%m%d)
```

**Step 3 — Scope Assessment**
- Identify which tables/records were accessed (query CloudWatch DB audit logs)
- Determine if data was exfiltrated (egress traffic analysis via VPC Flow Logs)
- Identify affected users/customers

**Step 4 — Eradication**
- Patch the vulnerability (SQLi, exposed credentials, misconfigured S3 bucket ACL, etc.)
- Force-rotate all credentials: database, API keys, JWT signing secret
- Deploy patched code via emergency CI run

**Step 5 — Notification**
- If PII involved: trigger GDPR 72-hour notification process
- Notify affected customers per Section 5.3
- Document in incident ticket

---

### Playbook 2: Compromised Credentials

**Trigger**: A service account, employee, or API key is confirmed or suspected to be compromised (e.g., detected by TruffleHog, unusual login location, MFA fatigue attack).

**Step 1 — Immediate Revocation (T+0 to T+15 min)**
```bash
# Revoke GitHub personal access token or app token
gh auth token --revoke  # or via GitHub Settings → Developer settings

# Revoke Azure Entra app credentials (service principal secret)
az ad app credential delete \
  --id <app-id> \
  --key-id <credential-id>

# Revoke a specific API key in AutoFlow (via admin endpoint)
curl -X DELETE https://api.helloautoflow.com/api/admin/api-keys/<key-id> \
  -H "Authorization: Bearer <admin-token>"

# Disable compromised user in Azure Entra
az ad user update --id <user-upn> --account-enabled false
```

**Step 2 — Audit Access**
```bash
# Check GitHub audit log for actions by the compromised token
# GitHub → Organization → Audit log → filter by actor

# Check Azure Entra sign-in logs for the compromised account
az monitor activity-log list \
  --caller "<compromised-upn>" \
  --start-time "2026-04-01T00:00:00Z"
```

**Step 3 — Determine Blast Radius**
- What systems did the compromised credential have access to?
- Were any secrets, code, or data accessed or modified?
- Were any other credentials or secrets exposed?

**Step 4 — Rotate All Related Secrets**
- Rotate all secrets that the compromised identity had access to
- Update GitHub Actions secrets, Azure Key Vault secrets
- Re-deploy affected services with new credentials

**Step 5 — Re-enable with Enhanced Monitoring**
- Re-enable account (if employee) with mandatory MFA re-enrollment
- Add additional Conditional Access policies if MFA fatigue was the vector
- Monitor account activity for 7 days

**Step 6 — Root Cause**
- Was it a phishing attack? → Security awareness training
- Was it a secret committed to git? → TruffleHog already scanning; review secret management practices
- Was it a weak/reused password? → Enforce password manager, review password policy
- Was it an MFA bypass? → Evaluate phishing-resistant MFA (FIDO2/passkeys)

---

## 7. PagerDuty Security Escalation Policy

A dedicated security escalation policy is configured alongside the existing infrastructure alerts:

**Service**: `autoflow-security-incidents`
**Escalation Policy**: `Security Incident Escalation`

| Level | Target | Timeout |
|-------|--------|---------|
| L1 | On-call Engineer (rotation) | 15 minutes |
| L2 | SIRT Lead (Security Engineer) | 15 minutes |
| L3 | CTO | 15 minutes |
| L4 | CEO | — |

**Integration**: CloudWatch Alarm → SNS Topic `autoflow-security-alerts` → PagerDuty Events API v2

Configuration steps:
1. Create PagerDuty service `autoflow-security-incidents` with the escalation policy above.
2. Add PagerDuty Events API v2 integration to get `PAGERDUTY_SECURITY_ROUTING_KEY`.
3. Store routing key as `PAGERDUTY_SECURITY_ROUTING_KEY` in GitHub Actions secrets and AWS Secrets Manager.
4. Wire CloudWatch security alarms (auth failures, anomalous activity) to SNS → PagerDuty.

Reference alarm configurations: `infra/monitoring/cloudwatch-alarms.tf`

---

## 8. Tabletop Exercise

**Frequency**: Semi-annually (every 6 months)
**Participants**: SIRT Lead, CTO, CEO, On-Call Engineers
**Duration**: 2 hours

**Scenario library** (rotate through scenarios):
1. Data breach via SQL injection
2. Compromised developer credentials / supply chain attack
3. Ransomware on infrastructure
4. Insider threat: disgruntled employee
5. DDoS attack during peak traffic

**Exercise format**:
1. Facilitator presents scenario (no warning to participants)
2. Team walks through IRP steps verbally
3. Identify gaps, unclear ownership, missing contacts
4. Document findings and action items
5. Update IRP within 2 weeks of exercise

**First tabletop exercise**: Schedule with CTO within 30 days of IRP approval.
**Results documented in**: `docs/tabletop-exercise-log.md`

---

## 9. Document Control

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Status | **Approved** |
| Created | 2026-04-02 |
| Approved | 2026-04-02 |
| Next review | 2026-10-02 (6 months) |
| Owner | Security Engineer |
| Approver | CTO |

### Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-02 | Security Engineer | Initial document |
| 1.0 | 2026-04-02 | CTO | Approved |

---

*This document satisfies CIS Control #17.1 (Establish and Maintain a Security Incident Management Program), CIS #17.2 (Establish and Maintain Contact Information for Reporting Security Incidents), CIS #17.3 (Establish and Maintain an Enterprise Process for Reporting Incidents), CIS #17.4 (Establish and Maintain an Incident Response Process), CIS #17.5 (Assign Key Roles and Responsibilities), CIS #17.6 (Define Mechanisms for Communicating During Incident Response), CIS #17.7 (Conduct Routine Incident Response Exercises), CIS #17.8 (Conduct Post-Incident Reviews), and NIST CSF RS.RP (Response Planning), RS.CO (Communications), RS.AN (Analysis), RS.MI (Mitigation).*
