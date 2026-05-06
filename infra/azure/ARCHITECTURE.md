# AutoFlow — Azure CAF Architecture

## Hub-and-Spoke Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Management Group Hierarchy                   │
│                                                                     │
│   Tenant Root Group                                                 │
│       └── autoflow-mg  (policy, RBAC, cost management scope)        │
│               ├── Landing Zones MG  (future: per-env sub scoping)   │
│               └── [Subscription — single sub, current setup]        │
└─────────────────────────────────────────────────────────────────────┘

                              Internet
                                 │
                    ┌────────────▼────────────┐
                    │   Azure Firewall        │
                    │   (Hub, 10.1.64.0/26)   │
                    │   + Bastion             │
                    └────────────┬────────────┘
                                 │  VNet peering (bidirectional)
              ┌──────────────────┼──────────────────┐
              │                  │                  │
   ┌──────────▼──────┐  ┌────────▼────────┐  ┌─────▼────────────┐
   │   Hub VNet      │  │ Spoke: Prod     │  │ Spoke: Staging   │
   │  10.1.0.0/16    │  │ 10.2.0.0/16     │  │ 10.3.0.0/16      │
   │                 │  │                 │  │                  │
   │ ┌─────────────┐ │  │ ┌─────────────┐ │  │ ┌──────────────┐ │
   │ │ hub-subnet  │ │  │ │ aks-subnet  │ │  │ │ aks-subnet   │ │
   │ │ 10.1.1.0/24 │ │  │ │10.2.1.0/24 │ │  │ │ 10.3.1.0/24  │ │
   │ ├─────────────┤ │  │ ├─────────────┤ │  │ ├──────────────┤ │
   │ │ fw-subnet   │ │  │ │ pe-subnet   │ │  │ │ pe-subnet    │ │
   │ │ 10.1.64.0/26│ │  │ │10.2.2.0/24 │ │  │ │ 10.3.2.0/24  │ │
   │ ├─────────────┤ │  │ ├─────────────┤ │  │ ├──────────────┤ │
   │ │ bastion     │ │  │ │ svc-subnet  │ │  │ │ svc-subnet   │ │
   │ │ 10.1.2.0/26 │ │  │ │10.2.3.0/24 │ │  │ │ 10.3.3.0/24  │ │
   │ └─────────────┘ │  │ └─────────────┘ │  │ └──────────────┘ │
   │                 │  │       │         │  │       │          │
   │ ┌─────────────┐ │  │  ┌────▼──────┐  │  │  ┌────▼──────┐  │
   │ │ Key Vault   │ │  │  │ AKS       │  │  │  │ AKS       │  │
   │ │ (private EP)│ │  │  │ (prod)    │  │  │  │ (staging) │  │
   │ └─────────────┘ │  │  └───────────┘  │  │  └───────────┘  │
   └─────────────────┘  └─────────────────┘  └─────────────────┘
                                 │
              ┌──────────────────▼──────────────────┐
              │  Azure Container Registry (ACR)      │
              │  Premium SKU, private endpoint        │
              │  ghcr.io images pulled by AKS        │
              └─────────────────────────────────────┘
```

## Network Addressing

| VNet / Subnet | CIDR | Purpose |
|---|---|---|
| Hub VNet | `10.1.0.0/16` | Shared services (Firewall, Bastion, Key Vault) |
| Hub — hub-subnet | `10.1.1.0/24` | General hub workloads |
| Hub — AzureFirewallSubnet | `10.1.64.0/26` | Azure Firewall (required /26) |
| Hub — AzureBastionSubnet | `10.1.2.0/26` | Azure Bastion (required /26) |
| Prod Spoke VNet | `10.2.0.0/16` | Production workloads |
| Prod — aks-subnet | `10.2.1.0/24` | AKS node pools (production) |
| Prod — pe-subnet | `10.2.2.0/24` | Private endpoints (ACR, etc.) |
| Prod — svc-subnet | `10.2.3.0/24` | Internal services / Load Balancer |
| Staging Spoke VNet | `10.3.0.0/16` | Staging workloads |
| Staging — aks-subnet | `10.3.1.0/24` | AKS node pools (staging) |
| Staging — pe-subnet | `10.3.2.0/24` | Private endpoints (staging) |
| Staging — svc-subnet | `10.3.3.0/24` | Internal services (staging) |

## Security Traffic Flow

```
Inbound (Internet → App):
  Internet → Azure Load Balancer (AKS managed) → AKS Ingress → Pod

Egress (Pod → Internet):
  Pod → AKS node → UDR (0.0.0.0/0 → Firewall private IP) → Azure Firewall
  → Internet (only allowed destinations pass firewall policy)

Cross-spoke:
  Prod Pod → Hub Firewall → Staging Pod  (firewall policy controls inter-spoke)

Key Vault access:
  Pod → private endpoint (hub pe-subnet) → Key Vault (no public internet)

ACR pull:
  AKS kubelet → private endpoint (spoke pe-subnet) → ACR (no public internet)
```

## Module Dependency Graph

```
main.tf
  ├── module.hub         (hub VNet, Firewall, Bastion, Key Vault)
  │       └── [no upstream module deps]
  ├── module.spoke_prod  (spoke VNet + peering → hub)
  │       └── depends on: module.hub (hub_vnet_id, hub_vnet_name, firewall_private_ip)
  ├── module.spoke_staging
  │       └── depends on: module.hub
  ├── module.acr         (Container Registry + private endpoint)
  │       └── depends on: spoke (pe_subnet_id, vnet_id)
  ├── module.aks         (AKS cluster + Log Analytics)
  │       └── depends on: spoke (aks_subnet_id), acr (acr_id)
  ├── module.management  (Management Groups, RBAC, Key Vault policies)
  │       └── depends on: hub (key_vault_id), explicit workload principal IDs
  ├── module.monitoring  (App Insights, metric alerts)
  │       └── depends on: aks (cluster_id, log_analytics_workspace_id)
  ├── module.policy      (Azure Policy, initiative assignments)
  │       └── depends on: management (autoflow_mg_id), aks (log_analytics_workspace_id)
  └── module.security    (Defender for Cloud, security contacts, auto-provisioning)
          └── depends on: aks (log_analytics_workspace_id)
```

## Module Descriptions

| Module | Path | Key Resources |
|---|---|---|
| `hub` | `modules/hub` | Hub VNet, Azure Firewall, Azure Bastion, Key Vault, private DNS zones |
| `spoke` | `modules/spoke` | Spoke VNet, subnets, route table (UDR → Firewall), VNet peering (bidirectional) |
| `acr` | `modules/acr` | Azure Container Registry (Premium), private endpoint, diagnostic settings |
| `aks` | `modules/aks` | AKS cluster, system/user node pools, Log Analytics workspace, kubelet identity |
| `management` | `modules/management` | Management Group hierarchy, RBAC role assignments, Key Vault access policies |
| `monitoring` | `modules/monitoring` | Application Insights, Log Analytics workspace linkage, metric alert rules |
| `policy` | `modules/policy` | Azure Policy initiative, assignment at MG scope, allowed-locations guardrails |
| `security` | `modules/security` | Defender for Containers/KeyVaults, security contact, auto-provisioning, diagnostic export |
| `networking` (legacy) | `modules/networking` | **Superseded by hub + spoke.** Retained for reference only. |
