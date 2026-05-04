# ALT-2303 Azure Resource Inventory

Last updated: 2026-05-04

## Scope and method

This inventory was produced from the live Terraform backend in `infra/azure` using:

```bash
terraform init -backend-config=backend-config/production.hcl -input=false
terraform state list
terraform show -json
terraform plan -refresh-only -lock=false -input=false -no-color
```

## What the current state actually contains

- `terraform state list` returned 91 state addresses.
- 85 of those are managed Terraform resources.
- 6 are data sources / metadata objects:
  - `data.azurerm_client_config.current`
  - `data.azurerm_log_analytics_workspace.hub_shared`
  - `data.azurerm_private_dns_zone.acr_shared`
  - `module.aks.data.azurerm_client_config.current`
  - `module.management.data.azurerm_subscription.current`
  - `module.security.data.azurerm_client_config.current`
- The live estate is staging-centric. The billable runtime resources currently in state are:
  - `autoflow-staging-aks`
  - `autoflowstagingacr`
  - shared hub resources such as `autoflow-hub-fw`, `autoflow-hub-bastion`, and `autoflow-hub-kv`
- The state also still contains both `module.spoke_prod` and `module.spoke_staging` network objects inside the same staging resource-group footprint, which is an important drift/config signal for Phase 0.

## Billable-resource summary

These are the resources most likely driving spend. Estimates are rough East US 2 list-price bands derived from the live SKU/state shape and intended for migration prioritization, not invoice reconciliation.

| Resource | Current shape from state | Estimated monthly cost | Migration target |
|---|---|---:|---|
| `module.hub.azurerm_firewall.hub` | Azure Firewall Standard (`AZFW_VNet`) with dedicated public IP | `~$900-$1,100 + data processed` | Remove; no equivalent in target stack |
| `module.hub.azurerm_bastion_host.hub` | Bastion Standard, `scale_units = 2` | `~$140-$200` | Remove; no equivalent in target stack |
| `module.aks.azurerm_kubernetes_cluster.main` | AKS Free tier, `Standard_D2s_v3`, autoscale `1-5`, managed LB | `~$80-$140` base infra | Fly.io for FastAPI, Cloudflare Workers if Node API remains separate |
| `module.acr.azurerm_container_registry.main` | ACR Premium | `~$20-$30` | Fly.io registry path or GHCR |
| `module.acr.azurerm_private_endpoint.acr[0]` | ACR private endpoint | `~$7-$10 + data` | Remove with ACR |
| `module.hub.azurerm_public_ip.bastion` | Standard static public IP | `~$3-$5` | Remove |
| `module.hub.azurerm_public_ip.firewall` | Standard static public IP | `~$3-$5` | Remove |
| `module.monitoring.azurerm_application_insights.main` | App Insights | `~$5-$50+` usage-based | Cloudflare/Fly/Supabase native monitoring |
| `module.monitoring.azurerm_application_insights_web_test.health` | Availability web test | `low single digits` | Cloudflare/Fly health checks |
| `module.monitoring.azurerm_monitor_metric_alert.*` | 2 metric alerts | `low single digits each` | Platform-native alerting |
| `module.hub.azurerm_key_vault.hub` | Shared Key Vault | `<$5 unless high op volume` | 1Password + platform secret stores |
| `module.security.azurerm_security_center_subscription_pricing.*` | Defender plans for ARM, Containers, DNS, Key Vaults, Storage | `usage-based; potentially material` | Remove with Azure subscription |
| `module.security.azurerm_security_center_workspace.main` | Defender workspace binding | `indirect; depends on Log Analytics usage` | Remove with Azure subscription |
| `module.hub.azurerm_private_dns_zone.*` | 3 private DNS zones | `low, query-based` | Remove |

## Drift findings from refresh-only plan

The refresh-only plan surfaced meaningful drift/state mismatch even before the CIAM auth failure stopped the run:

1. `module.spoke_prod.azurerm_route_table.{aks,pe,svc}` and `module.spoke_staging.azurerm_route_table.{aks,pe,svc}`
   show routes changing from `default-via-firewall` to `default-to-internet`.
2. `module.spoke_prod.azurerm_virtual_network.spoke` and `module.spoke_staging.azurerm_virtual_network.spoke`
   show `dns_servers = ["10.1.0.4"]` disappearing.
3. `module.hub.azurerm_virtual_network.hub`
   shows Firewall/Bastion subnet representation shifting in state.
4. `module.security.azurerm_security_center_workspace.main`
   wants to move from the shared hub Log Analytics workspace to `autoflow-production-aks-logs`.
5. `module.monitoring.azurerm_monitor_metric_alert.{aks_cpu,aks_memory}`
   show action-block normalization changes.
6. Output values indicate inconsistent expectations between production and staging objects:
   - `hub_firewall_private_ip` drops to `null`
   - `spoke_staging_vnet_id` drops to `null`
   - `spoke_prod_vnet_id` becomes recomputed

## Blocker on final drift validation

The refresh-only plan could not complete because the aliased `azuread.ciam` provider is configured against CIAM tenant `5e4f1080-8afc-4005-b05e-32b21e69363a`, but the current service principal (`paperclip-cost-reader`, app ID `98480fb7-9347-4b9f-9b09-f7a9c031d53f`) does not exist in that tenant.

Observed error:

```text
AADSTS700016: Application with identifier '98480fb7-9347-4b9f-9b09-f7a9c031d53f' was not found in the directory 'Autoflow CIAM'.
```

That means the inventory below is valid as a state-backed resource census, but the Phase 0 instruction to "run terraform plan and resolve drift before relying on inventory" is not yet fully satisfied. The next unblock action is to provide CIAM-tenant-capable credentials for the `azuread.ciam` provider or adjust the provider strategy for drift-only reads.

## Managed-resource inventory

| Address | Type | Name | Module | Resource Group | Cost Estimate | Migration Target | Dependencies |
|---|---|---|---|---|---|---|---|
| `azurerm_resource_group.main` | `azurerm_resource_group` | `autoflow-staging-rg` | `main` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; delete during Azure teardown | Container for hub/spoke/monitoring resources |
| `module.acr.azurerm_container_registry.main` | `azurerm_container_registry` | `autoflowstagingacr` | `acr` | `rg-spoke-nonprod` | ~$20-$30/mo (Premium SKU) | Fly.io image registry path or GHCR; remove Azure ACR | Depends on spoke network/private endpoint and private DNS |
| `module.acr.azurerm_private_endpoint.acr[0]` | `azurerm_private_endpoint` | `autoflow-staging-acr-pe` | `acr` | `rg-spoke-nonprod` | ~$7-$10/mo + data processed | Fly.io image registry path or GHCR; remove Azure ACR | Depends on ACR and spoke PE subnet/private DNS link |
| `module.aks.azurerm_kubernetes_cluster.main` | `azurerm_kubernetes_cluster` | `autoflow-staging-aks` | `aks` | `rg-spoke-nonprod` | ~$80-$140/mo base infra (1x Standard_D2s_v3 node, LB, disk; excludes app workload growth) | Fly.io for FastAPI workloads; Cloudflare Workers if Node API remains separate | Depends on spoke subnet, ACR pull role, Log Analytics workspace, managed identity |
| `module.aks.azurerm_role_assignment.acr_pull` | `azurerm_role_assignment` | `66dc3d87-b9aa-4704-6904-c9e5f7b7f506` | `aks` | `n/a` | $0 standalone / bundled control-plane object | Fly.io for FastAPI workloads; Cloudflare Workers if Node API remains separate | Binds identity access to ACR/Key Vault/resource groups |
| `module.hub.azurerm_bastion_host.hub` | `azurerm_bastion_host` | `autoflow-hub-bastion` | `hub` | `autoflow-staging-rg` | ~$140-$200/mo (Standard, 2 scale units) | No direct replacement; retire after cutover off Azure networking | Depends on hub VNet, Bastion subnet, and bastion public IP |
| `module.hub.azurerm_firewall.hub` | `azurerm_firewall` | `autoflow-hub-fw` | `hub` | `autoflow-staging-rg` | ~$900-$1,100/mo + data processed | No direct replacement; retire after cutover off Azure networking | Depends on hub VNet, Firewall subnet, public IP, and firewall policy |
| `module.hub.azurerm_firewall_policy.hub` | `azurerm_firewall_policy` | `autoflow-hub-fw-policy` | `hub` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to hub firewall and rule collection groups |
| `module.hub.azurerm_firewall_policy_rule_collection_group.aks_egress` | `azurerm_firewall_policy_rule_collection_group` | `aks-egress` | `hub` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on hub firewall policy |
| `module.hub.azurerm_firewall_policy_rule_collection_group.default_deny` | `azurerm_firewall_policy_rule_collection_group` | `default-deny` | `hub` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on hub firewall policy |
| `module.hub.azurerm_key_vault.hub` | `azurerm_key_vault` | `autoflow-hub-kv` | `hub` | `rg-hub-shared` | <$5/mo unless secret/operation volume is high | 1Password plus Fly.io/Cloudflare/Supabase secret stores | Shared hub vault; RBAC and private DNS consumers depend on it |
| `module.hub.azurerm_private_dns_zone.acr` | `azurerm_private_dns_zone` | `privatelink.azurecr.io` | `hub` | `autoflow-staging-rg` | Low cost; DNS zone/query based | No direct replacement; retire after cutover off Azure networking | Linked to hub/spoke VNets and private endpoints |
| `module.hub.azurerm_private_dns_zone.blob` | `azurerm_private_dns_zone` | `privatelink.blob.core.windows.net` | `hub` | `autoflow-staging-rg` | Low cost; DNS zone/query based | No direct replacement; retire after cutover off Azure networking | Linked to hub/spoke VNets and private endpoints |
| `module.hub.azurerm_private_dns_zone.keyvault` | `azurerm_private_dns_zone` | `privatelink.vaultcore.azure.net` | `hub` | `autoflow-staging-rg` | Low cost; DNS zone/query based | No direct replacement; retire after cutover off Azure networking | Linked to hub/spoke VNets and private endpoints |
| `module.hub.azurerm_private_dns_zone_virtual_network_link.acr_hub` | `azurerm_private_dns_zone_virtual_network_link` | `autoflow-hub-acr-dns-link` | `hub` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on private DNS zone and linked VNet |
| `module.hub.azurerm_private_dns_zone_virtual_network_link.blob_hub` | `azurerm_private_dns_zone_virtual_network_link` | `autoflow-hub-blob-dns-link` | `hub` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on private DNS zone and linked VNet |
| `module.hub.azurerm_private_dns_zone_virtual_network_link.keyvault_hub` | `azurerm_private_dns_zone_virtual_network_link` | `autoflow-hub-kv-dns-link` | `hub` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on private DNS zone and linked VNet |
| `module.hub.azurerm_public_ip.bastion` | `azurerm_public_ip` | `autoflow-hub-bastion-pip` | `hub` | `autoflow-staging-rg` | ~$3-$5/mo each (Standard static IPv4) | No direct replacement; retire after cutover off Azure networking | Consumed by Bastion or Firewall |
| `module.hub.azurerm_public_ip.firewall` | `azurerm_public_ip` | `autoflow-hub-fw-pip` | `hub` | `autoflow-staging-rg` | ~$3-$5/mo each (Standard static IPv4) | No direct replacement; retire after cutover off Azure networking | Consumed by Bastion or Firewall |
| `module.hub.azurerm_subnet.bastion` | `azurerm_subnet` | `AzureBastionSubnet` | `hub` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Child of hub/spoke VNet; may host AKS, private endpoints, or platform subnets |
| `module.hub.azurerm_subnet.firewall` | `azurerm_subnet` | `AzureFirewallSubnet` | `hub` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Child of hub/spoke VNet; may host AKS, private endpoints, or platform subnets |
| `module.hub.azurerm_subnet.gateway` | `azurerm_subnet` | `GatewaySubnet` | `hub` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Child of hub/spoke VNet; may host AKS, private endpoints, or platform subnets |
| `module.hub.azurerm_subnet.mgmt` | `azurerm_subnet` | `mgmt-subnet` | `hub` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Child of hub/spoke VNet; may host AKS, private endpoints, or platform subnets |
| `module.hub.azurerm_virtual_network.hub` | `azurerm_virtual_network` | `autoflow-hub-vnet` | `hub` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Parent for subnets, peerings, DNS links, and network policy objects |
| `module.management.azurerm_role_assignment.aks_kv_secrets_user` | `azurerm_role_assignment` | `e8e2f05d-006c-7456-50f7-8936b4fa3369` | `management` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire with Azure subscription | Binds identity access to ACR/Key Vault/resource groups |
| `module.management.azurerm_role_assignment.devops_sp_rg_contributor["primary"]` | `azurerm_role_assignment` | `8f109a0d-6b6d-aa49-0387-76260496259e` | `management` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire with Azure subscription | Binds identity access to ACR/Key Vault/resource groups |
| `module.monitoring.azurerm_application_insights.main` | `azurerm_application_insights` | `autoflow-staging-appinsights` | `monitoring` | `autoflow-staging-rg` | Usage-based, typically ~$5-$50+/mo | Cloudflare/Fly/Supabase native monitoring and health checks | Monitors AKS/backend estate |
| `module.monitoring.azurerm_application_insights_web_test.health` | `azurerm_application_insights_web_test` | `autoflow-staging-health-ping` | `monitoring` | `autoflow-staging-rg` | Low single-digit $/mo | Cloudflare/Fly/Supabase native monitoring and health checks | Depends on Application Insights component and public endpoint |
| `module.monitoring.azurerm_monitor_action_group.oncall` | `azurerm_monitor_action_group` | `autoflow-staging-oncall` | `monitoring` | `autoflow-staging-rg` | $0 standalone | Cloudflare/Fly/Supabase native monitoring and health checks | Notification target for metric alerts |
| `module.monitoring.azurerm_monitor_metric_alert.aks_cpu` | `azurerm_monitor_metric_alert` | `autoflow-staging-aks-cpu-high` | `monitoring` | `autoflow-staging-rg` | Low single-digit $/mo each | Cloudflare/Fly/Supabase native monitoring and health checks | Depends on monitored AKS metrics and on-call action group |
| `module.monitoring.azurerm_monitor_metric_alert.aks_memory` | `azurerm_monitor_metric_alert` | `autoflow-staging-aks-memory-high` | `monitoring` | `autoflow-staging-rg` | Low single-digit $/mo each | Cloudflare/Fly/Supabase native monitoring and health checks | Depends on monitored AKS metrics and on-call action group |
| `module.policy.azurerm_policy_definition.aks_no_public_node_ip` | `azurerm_policy_definition` | `aks-no-public-node-ip` | `policy` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire with Azure subscription | Referenced by subscription policy assignments |
| `module.policy.azurerm_policy_set_definition.autoflow_baseline` | `azurerm_policy_set_definition` | `autoflow-baseline` | `policy` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire with Azure subscription | Referenced by subscription policy assignments |
| `module.policy.azurerm_subscription_policy_assignment.baseline_sub[0]` | `azurerm_subscription_policy_assignment` | `autoflow-baseline` | `policy` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire with Azure subscription | Depends on policy definition/set and subscription scope |
| `module.policy.azurerm_subscription_policy_assignment.defender_containers_sub[0]` | `azurerm_subscription_policy_assignment` | `defender-containers` | `policy` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire with Azure subscription | Depends on policy definition/set and subscription scope |
| `module.policy.azurerm_subscription_policy_assignment.diag_activity_log_sub[0]` | `azurerm_subscription_policy_assignment` | `diag-activity-log-law` | `policy` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire with Azure subscription | Depends on policy definition/set and subscription scope |
| `module.security.azurerm_security_center_contact.main` | `azurerm_security_center_contact` | `default1` | `security` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire with Azure subscription | State-only control-plane dependency; see module graph |
| `module.security.azurerm_security_center_subscription_pricing.arm` | `azurerm_security_center_subscription_pricing` | `arm` | `security` | `n/a` | Usage-based Defender spend; potentially material | No direct replacement; retire with Azure subscription | Subscription-wide Defender plan binding |
| `module.security.azurerm_security_center_subscription_pricing.containers` | `azurerm_security_center_subscription_pricing` | `containers` | `security` | `n/a` | Usage-based Defender spend; potentially material | No direct replacement; retire with Azure subscription | Subscription-wide Defender plan binding |
| `module.security.azurerm_security_center_subscription_pricing.dns` | `azurerm_security_center_subscription_pricing` | `dns` | `security` | `n/a` | Usage-based Defender spend; potentially material | No direct replacement; retire with Azure subscription | Subscription-wide Defender plan binding |
| `module.security.azurerm_security_center_subscription_pricing.key_vaults` | `azurerm_security_center_subscription_pricing` | `key_vaults` | `security` | `n/a` | Usage-based Defender spend; potentially material | No direct replacement; retire with Azure subscription | Subscription-wide Defender plan binding |
| `module.security.azurerm_security_center_subscription_pricing.storage_accounts` | `azurerm_security_center_subscription_pricing` | `storage_accounts` | `security` | `n/a` | Usage-based Defender spend; potentially material | No direct replacement; retire with Azure subscription | Subscription-wide Defender plan binding |
| `module.security.azurerm_security_center_workspace.main` | `azurerm_security_center_workspace` | `main` | `security` | `n/a` | Indirect; depends on attached Log Analytics ingestion/retention | No direct replacement; retire with Azure subscription | Points Defender exports at Log Analytics workspace |
| `module.spoke_prod.azurerm_network_security_group.aks` | `azurerm_network_security_group` | `autoflow-prod-spoke-aks-nsg` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via NSG associations |
| `module.spoke_prod.azurerm_network_security_group.pe` | `azurerm_network_security_group` | `autoflow-prod-spoke-pe-nsg` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via NSG associations |
| `module.spoke_prod.azurerm_network_security_group.svc` | `azurerm_network_security_group` | `autoflow-prod-spoke-svc-nsg` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via NSG associations |
| `module.spoke_prod.azurerm_private_dns_zone_virtual_network_link.acr` | `azurerm_private_dns_zone_virtual_network_link` | `autoflow-prod-spoke-acr-dns-link` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on private DNS zone and linked VNet |
| `module.spoke_prod.azurerm_private_dns_zone_virtual_network_link.blob` | `azurerm_private_dns_zone_virtual_network_link` | `autoflow-prod-spoke-blob-dns-link` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on private DNS zone and linked VNet |
| `module.spoke_prod.azurerm_private_dns_zone_virtual_network_link.keyvault` | `azurerm_private_dns_zone_virtual_network_link` | `autoflow-prod-spoke-kv-dns-link` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on private DNS zone and linked VNet |
| `module.spoke_prod.azurerm_route_table.aks` | `azurerm_route_table` | `autoflow-prod-spoke-aks-rt` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via route table associations |
| `module.spoke_prod.azurerm_route_table.pe` | `azurerm_route_table` | `autoflow-prod-spoke-pe-rt` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via route table associations |
| `module.spoke_prod.azurerm_route_table.svc` | `azurerm_route_table` | `autoflow-prod-spoke-svc-rt` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via route table associations |
| `module.spoke_prod.azurerm_subnet.aks` | `azurerm_subnet` | `aks-subnet` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Child of hub/spoke VNet; may host AKS, private endpoints, or platform subnets |
| `module.spoke_prod.azurerm_subnet.pe` | `azurerm_subnet` | `pe-subnet` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Child of hub/spoke VNet; may host AKS, private endpoints, or platform subnets |
| `module.spoke_prod.azurerm_subnet.svc` | `azurerm_subnet` | `svc-subnet` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Child of hub/spoke VNet; may host AKS, private endpoints, or platform subnets |
| `module.spoke_prod.azurerm_subnet_network_security_group_association.aks` | `azurerm_subnet_network_security_group_association` | `aks` | `spoke_prod` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and NSG |
| `module.spoke_prod.azurerm_subnet_network_security_group_association.pe` | `azurerm_subnet_network_security_group_association` | `pe` | `spoke_prod` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and NSG |
| `module.spoke_prod.azurerm_subnet_network_security_group_association.svc` | `azurerm_subnet_network_security_group_association` | `svc` | `spoke_prod` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and NSG |
| `module.spoke_prod.azurerm_subnet_route_table_association.aks` | `azurerm_subnet_route_table_association` | `aks` | `spoke_prod` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and route table |
| `module.spoke_prod.azurerm_subnet_route_table_association.pe` | `azurerm_subnet_route_table_association` | `pe` | `spoke_prod` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and route table |
| `module.spoke_prod.azurerm_subnet_route_table_association.svc` | `azurerm_subnet_route_table_association` | `svc` | `spoke_prod` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and route table |
| `module.spoke_prod.azurerm_virtual_network.spoke` | `azurerm_virtual_network` | `autoflow-prod-spoke-vnet` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Parent for subnets, peerings, DNS links, and network policy objects |
| `module.spoke_prod.azurerm_virtual_network_peering.hub_to_spoke` | `azurerm_virtual_network_peering` | `autoflow-hub-to-prod-spoke` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on paired VNets |
| `module.spoke_prod.azurerm_virtual_network_peering.spoke_to_hub` | `azurerm_virtual_network_peering` | `autoflow-prod-spoke-to-hub` | `spoke_prod` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on paired VNets |
| `module.spoke_staging.azurerm_network_security_group.aks` | `azurerm_network_security_group` | `autoflow-staging-spoke-aks-nsg` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via NSG associations |
| `module.spoke_staging.azurerm_network_security_group.pe` | `azurerm_network_security_group` | `autoflow-staging-spoke-pe-nsg` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via NSG associations |
| `module.spoke_staging.azurerm_network_security_group.svc` | `azurerm_network_security_group` | `autoflow-staging-spoke-svc-nsg` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via NSG associations |
| `module.spoke_staging.azurerm_private_dns_zone_virtual_network_link.acr` | `azurerm_private_dns_zone_virtual_network_link` | `autoflow-staging-spoke-acr-dns-link` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on private DNS zone and linked VNet |
| `module.spoke_staging.azurerm_private_dns_zone_virtual_network_link.blob` | `azurerm_private_dns_zone_virtual_network_link` | `autoflow-staging-spoke-blob-dns-link` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on private DNS zone and linked VNet |
| `module.spoke_staging.azurerm_private_dns_zone_virtual_network_link.keyvault` | `azurerm_private_dns_zone_virtual_network_link` | `autoflow-staging-spoke-kv-dns-link` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on private DNS zone and linked VNet |
| `module.spoke_staging.azurerm_route_table.aks` | `azurerm_route_table` | `autoflow-staging-spoke-aks-rt` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via route table associations |
| `module.spoke_staging.azurerm_route_table.pe` | `azurerm_route_table` | `autoflow-staging-spoke-pe-rt` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via route table associations |
| `module.spoke_staging.azurerm_route_table.svc` | `azurerm_route_table` | `autoflow-staging-spoke-svc-rt` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Attached to spoke subnets via route table associations |
| `module.spoke_staging.azurerm_subnet.aks` | `azurerm_subnet` | `aks-subnet` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Child of hub/spoke VNet; may host AKS, private endpoints, or platform subnets |
| `module.spoke_staging.azurerm_subnet.pe` | `azurerm_subnet` | `pe-subnet` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Child of hub/spoke VNet; may host AKS, private endpoints, or platform subnets |
| `module.spoke_staging.azurerm_subnet.svc` | `azurerm_subnet` | `svc-subnet` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Child of hub/spoke VNet; may host AKS, private endpoints, or platform subnets |
| `module.spoke_staging.azurerm_subnet_network_security_group_association.aks` | `azurerm_subnet_network_security_group_association` | `aks` | `spoke_staging` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and NSG |
| `module.spoke_staging.azurerm_subnet_network_security_group_association.pe` | `azurerm_subnet_network_security_group_association` | `pe` | `spoke_staging` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and NSG |
| `module.spoke_staging.azurerm_subnet_network_security_group_association.svc` | `azurerm_subnet_network_security_group_association` | `svc` | `spoke_staging` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and NSG |
| `module.spoke_staging.azurerm_subnet_route_table_association.aks` | `azurerm_subnet_route_table_association` | `aks` | `spoke_staging` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and route table |
| `module.spoke_staging.azurerm_subnet_route_table_association.pe` | `azurerm_subnet_route_table_association` | `pe` | `spoke_staging` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and route table |
| `module.spoke_staging.azurerm_subnet_route_table_association.svc` | `azurerm_subnet_route_table_association` | `svc` | `spoke_staging` | `n/a` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on subnet and route table |
| `module.spoke_staging.azurerm_virtual_network.spoke` | `azurerm_virtual_network` | `autoflow-staging-spoke-vnet` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Parent for subnets, peerings, DNS links, and network policy objects |
| `module.spoke_staging.azurerm_virtual_network_peering.hub_to_spoke` | `azurerm_virtual_network_peering` | `autoflow-hub-to-staging-spoke` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on paired VNets |
| `module.spoke_staging.azurerm_virtual_network_peering.spoke_to_hub` | `azurerm_virtual_network_peering` | `autoflow-staging-spoke-to-hub` | `spoke_staging` | `autoflow-staging-rg` | $0 standalone / bundled control-plane object | No direct replacement; retire after cutover off Azure networking | Depends on paired VNets |
