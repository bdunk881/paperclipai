# Infrastructure Comparison: Hetzner + Coolify vs Azure AKS

> Decision context: The current primary deployment path ([ALT-31](/ALT/issues/ALT-31)) uses
> Hetzner VPS + Coolify. This document compares that path with the Azure-native alternative
> to help the CTO choose the right track, especially in light of the M365 E5 + Entra alignment
> in [ALT-142](/ALT/issues/ALT-142).

---

## Summary

| Factor | Hetzner + Coolify | Azure AKS |
|---|---|---|
| **Monthly cost (early stage)** | ~€7.49/mo (~$8) | ~$80–$150/mo |
| **Monthly cost (scaled, 5 nodes)** | ~€30–€50/mo (upgrade VPS) | ~$300–$600/mo |
| **Time to first deploy** | 1–2 hours | 2–4 hours (after Terraform apply) |
| **Operational complexity** | Low — Coolify UI handles most ops | High — kubectl, Helm, RBAC, AKS upgrades |
| **Scaling model** | Manual VPS resize or add servers | Automatic node autoscaling |
| **Vendor alignment (M365/Entra)** | None | Native — same tenant, same IAM |
| **Entra External ID integration** | Requires external config | First-class, same Azure AD tenant |
| **CI/CD pipeline** | GitHub Actions (already built) | Azure DevOps or GitHub Actions |
| **Secrets management** | Coolify env vars | Azure Key Vault or K8s secrets |
| **Observability** | Basic (Coolify logs + uptime) | Full stack: App Insights, Log Analytics, Alerts |
| **Container registry** | GitHub Container Registry (free) | ACR Premium ~$0.167/day + storage |
| **Private networking** | Not supported on Hetzner basic | Native VNet, private endpoints, NSG |
| **SOC2 / compliance evidence** | Manual, limited audit trail | Azure Policy, Defender for Cloud, audit logs |
| **Disaster recovery** | Single VPS — no built-in HA | Multi-AZ node pools (with config) |
| **Team learning curve** | Near zero — Coolify is GUI-driven | Significant — Kubernetes expertise required |

---

## Cost Breakdown

### Option A: Hetzner CX32 + Coolify

| Resource | Cost |
|---|---|
| Hetzner CX32 VPS (4 vCPU, 8 GB RAM) | ~€7.49/mo |
| GitHub Container Registry | Free (public repos) / $0 (included in GH plans) |
| Cloudflare (DDoS, DNS) | Free tier |
| **Total** | **~€7.49/mo (~$8/mo)** |

Upgrade path: Hetzner CX52 (~€21/mo) or add a second server for HA (~€15/mo each).

### Option B: Azure AKS + ACR + Azure DevOps

| Resource | Est. Cost/mo |
|---|---|
| AKS (2× Standard_B2s nodes, system pool) | ~$60 |
| ACR Premium (storage + ops) | ~$10–$20 |
| Azure Load Balancer (Standard) | ~$18 |
| Log Analytics (30 days, ~5 GB/day) | ~$10–$15 |
| Application Insights | ~$5–$10 |
| Azure DevOps (5 users, hosted agents) | Free (first 1,800 min/mo free) |
| **Total (staging + production)** | **~$103–$123/mo** |

> Note: Costs scale linearly with node count. 5× Standard_B2s = ~$150/mo for compute alone.
> B-series VMs are burstable — appropriate for early stage but not for consistently high CPU.

---

## Detailed Trade-offs

### Cost
**Hetzner wins decisively** at early stage. ~15× cheaper per month. For a pre-revenue startup,
the $100+/month difference compounds fast. The Azure cost is justified when:
- Revenue covers infrastructure (~$500+/mo MRR makes $150/mo trivial)
- Enterprise customers require Azure hosting for compliance/data residency
- SOC2 Type II requires Azure-native audit controls

### Complexity
**Hetzner wins**. Coolify provides a Heroku-like UI. No Kubernetes expertise needed. Rollbacks,
logs, env vars, and deploys are all 2–3 clicks. AKS requires knowledge of: kubectl, Helm charts,
Kubernetes RBAC, persistent volume claims, ingress controllers, and cluster upgrade cycles.

### Vendor Alignment (Entra / M365 E5)
**Azure wins**. AutoFlow's auth strategy uses Entra External ID ([ALT-142](/ALT/issues/ALT-142)).
Running on Azure means:
- Same IAM tenant — workload identity, managed identity, no secrets rotation
- Single pane of glass for security: Microsoft Defender for Cloud covers both the app and infra
- Conditional Access policies can apply to the app
- Compliance reports (SOC2, ISO 27001) shared with Microsoft's audit trail

This is the **strongest argument for Azure** — particularly relevant for enterprise sales where
procurement asks "where does your data live?"

### Observability
**Azure wins**. Application Insights + Log Analytics give production-grade observability out of
the box: distributed tracing, anomaly detection, availability tests, and alerting. Hetzner/Coolify
requires assembling Prometheus + Grafana + Alertmanager manually.

### CI/CD
**Roughly equal.** GitHub Actions (current) works with both. Azure DevOps (this track) offers
tighter integration with Azure environments and the manual approval gate is native. The existing
GitHub Actions deploy workflow can push to ACR just as easily as GHCR — no pipeline rewrite needed.

### Disaster Recovery / HA
**Azure wins**. AKS multi-node-pool across availability zones provides HA. Single Hetzner VPS is
a single point of failure (though Coolify makes it easy to spin up a replacement).

---

## Recommendation

| Scenario | Recommendation |
|---|---|
| Pre-revenue, speed matters, cost-sensitive | **Stay on Hetzner + Coolify** |
| Enterprise pilot / customer requires Azure or M365 alignment | **Migrate to AKS** |
| SOC2 Type II in 12 months | **Migrate to AKS** (or at minimum Azure App Service) |
| Existing M365 E5 + Entra External ID already adopted | **AKS is the natural fit** |

**Suggested path:** Continue with Hetzner until the first enterprise customer or until ARR reaches
~$20K (cost becomes irrelevant). At that point, migrate to this Azure track — the Terraform
modules here make the lift a single `terraform apply`.

---

## Migration path (when ready)

1. Run `terraform apply` for the Azure environment.
2. Push existing Docker images to ACR: `docker pull ghcr.io/... && docker tag ... && docker push <acr>.azurecr.io/...`
3. Update DNS (Cloudflare): point to Azure Load Balancer IP.
4. Verify health checks pass on Azure.
5. Decommission Coolify apps (keep VPS for 1 week as rollback safety net).
6. Cancel Hetzner VPS.

Migration can be done with zero downtime using a blue/green DNS cutover.
