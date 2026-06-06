# SES Layer-C managed customer email — `via.helloautoflow.com` (HEL-615)

Operational runbook for the **managed customer-facing email** path (Layer C of
the comms-stack strategy). The code (`src/comms/transports/sesEmail.ts`,
registered for `kind:'customer'` + `channel:'email'`) is complete and ships
**inert until the AWS/DNS provisioning below is done** — it only registers when
`AUTOFLOW_CUSTOMER_EMAIL_FROM` is set.

Layer C must be **reputation-isolated** from Layer A/B system mail
(`mail.helloautoflow.com`, config set `autoflow-mail`): never a shared IP,
subdomain, or configuration set.

## Why config sets, not IP pools, in code

SES v2 `SendEmail` has **no per-call IP-pool parameter** — a sending IP pool is
bound to a **configuration set** via its delivery options
(`SetConfigurationSetDeliveryOptions → SendingPoolName`). So "dedicated IP pool
per tier" is implemented as **one configuration set per tier, each pointing at
its own pool**. The app only selects the config-set name at send time
(`SES_CONFIGURATION_SET_SMB` / `SES_CONFIGURATION_SET_SME`); the pool binding is
this runbook's job.

## 1. Identity — `via.helloautoflow.com`

1. SES → Verified identities → create a **domain identity** `via.helloautoflow.com`
   (region `us-east-1`, matching `SES_REGION`/`AWS_REGION`). Distinct subdomain
   from `mail.helloautoflow.com` — reputation isolation.
2. Set a custom **MAIL FROM** subdomain (e.g. `bounce.via.helloautoflow.com`) for
   SPF alignment.
3. Publish DNS (zone for `helloautoflow.com`):
   - **DKIM**: the 3 Easy-DKIM CNAMEs SES generates.
   - **SPF** (on the MAIL FROM): `TXT "v=spf1 include:amazonses.com -all"` + the MX.
   - **DMARC**: `_dmarc.via.helloautoflow.com TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@helloautoflow.com"`
     — escalate `none → quarantine → reject` as reputation proves out (HEL-617).
4. Wait for SES "Verified" + DKIM "Successful". Request production access (exit
   sandbox) for the account if not already done.

## 2. Dedicated IP pools + per-tier configuration sets

1. SES → Dedicated IPs → lease IPs; create **two pools**, e.g. `via-smb` and
   `via-sme` (SME = dedicated/isolated; SMB = shared starter pool is acceptable).
2. Create **two configuration sets** with `via.helloautoflow.com` reputation
   metrics + event publishing to the existing SNS topic (so bounces/complaints
   keep flowing to `/api/webhooks/ses-notifications` and tag-correlate):
   - `via-customer-smb` → delivery option `SendingPoolName = via-smb`
   - `via-customer-sme` → delivery option `SendingPoolName = via-sme`
3. Confirm each config set re-publishes bounce/complaint/delivery events to SNS.

## 3. App config (env)

Set on the API + worker (Fly `[env]` / secrets):

| Env | Example | Notes |
|---|---|---|
| `AUTOFLOW_CUSTOMER_EMAIL_FROM` | `AutoFlow <hello@via.helloautoflow.com>` | **Gates registration** — unset ⇒ transport not registered |
| `SES_CONFIGURATION_SET_SMB` | `via-customer-smb` | SMB-segment config set (explore/flow plans) |
| `SES_CONFIGURATION_SET_SME` | `via-customer-sme` | SME-segment config set (automate/scale plans) |
| `SES_REGION` | `us-east-1` | reuses the Layer A/B region resolver |

`managed_email_opt_in` per workspace (NULL ⇒ plan default: SMB opt-in, SME
opt-out) is set in Postgres / a future settings UI, not env.

## 4. IP warming (4–6 weeks)

New dedicated IPs start cold; ramp volume gradually or AWS throttles + reputation
craters. Use SES **auto-warmup** (default on) and/or a manual schedule:

| Week | Daily cap (per IP) |
|---|---|
| 1 | 50 → 1,000 |
| 2 | 1,000 → 5,000 |
| 3 | 5,000 → 20,000 |
| 4 | 20,000 → 100,000 |
| 5–6 | ramp to target; hold if complaint rate > 0.1% or bounce > 5% |

Watch the per-tier config-set reputation dashboard (bounce/complaint). The
per-tenant reputation dashboard + automatic failover is HEL-617.

## 5. Go-live verification (the HEL-615 acceptance)

1. Set the env above; restart API/worker → boot logs `[comms] registered transports: …, ses-email`.
2. Send a managed-tenant `kind:'customer'` email through `comms.send`.
3. Confirm at the recipient: **SPF, DKIM, and DMARC all pass**, From =
   `via.helloautoflow.com`, and the originating IP is in the tier's pool (not a
   Layer A/B IP).
4. Confirm `comms_sends` ledgers `provider:'ses'`, `status:'sent'`; an opted-out
   workspace ledgers `status:'suppressed'` (reason `managed_email_opt_out`); a
   suppressed recipient ledgers `status:'suppressed'`.

## 6. DMARC enforcement escalation (HEL-729)

`via.helloautoflow.com` starts at `p=quarantine` (§1.3). Escalate enforcement as
the per-tier reputation proves out — never jump straight to `reject` on a cold
domain (a misconfigured DKIM/SPF would then silently drop real mail).

| Stage | DMARC `p=` | Enter when |
|---|---|---|
| 1. Monitor | `none` (+ `rua`/`ruf` aggregate+forensic reports) | First 1–2 warming weeks; read the reports, confirm SPF+DKIM align on ~100% of legitimate mail |
| 2. Quarantine | `quarantine` (start `pct=25`, ramp to `100`) | Alignment is clean and complaint rate < 0.1% for a full warming week |
| 3. Reject | `reject` | ≥ 2 weeks at `quarantine; pct=100` with no legitimate mail quarantined and bounce < 5% / complaint < 0.1% |

Roll back a stage immediately if legitimate mail starts failing DMARC (watch the
`rua` reports + the per-tenant reputation dashboard, HEL-728). Apply the same
ladder to Layer A/B `mail.helloautoflow.com` independently. Update the `_dmarc`
TXT record (§1.3) at each stage.

## Related

- Layer A/B system mail: `src/mailer/sesMailer.ts` (HEL-360..366) — keep isolated.
- Opt-out → BYOC routing + BYOC from-identity: **HEL-716**.
- Failover (**HEL-617**, shipped) · provider health probe + DMARC escalation (**HEL-729**) · per-tenant reputation dashboard (**HEL-728**).
