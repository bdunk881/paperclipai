# ── Management Group Hierarchy ────────────────────────────────────────────────
#
# CAF-aligned tree:
#   Root (tenant root)
#    └── autoflow                     (top-level org MG)
#         ├── Platform
#         │    ├── Connectivity
#         │    ├── Identity
#         │    └── Management
#         └── LandingZones
#              ├── Production
#              └── Development
#
# No Owner or Contributor is assigned at root scope.
# All RBAC assignments follow least-privilege, scoped to the narrowest MG
# that covers the access requirement.

# ── Tenant Root Group reference ───────────────────────────────────────────────

data "azurerm_management_group" "root" {
  # The tenant root group ID is always the tenant ID.
  name = var.tenant_id
}

# ── Top-level: autoflow ───────────────────────────────────────────────────────

resource "azurerm_management_group" "autoflow" {
  display_name               = var.prefix
  parent_management_group_id = data.azurerm_management_group.root.id
}

# ── Platform subtree ──────────────────────────────────────────────────────────

resource "azurerm_management_group" "platform" {
  display_name               = "${var.prefix}-platform"
  parent_management_group_id = azurerm_management_group.autoflow.id
}

resource "azurerm_management_group" "connectivity" {
  display_name               = "${var.prefix}-connectivity"
  parent_management_group_id = azurerm_management_group.platform.id
}

resource "azurerm_management_group" "identity" {
  display_name               = "${var.prefix}-identity"
  parent_management_group_id = azurerm_management_group.platform.id
}

resource "azurerm_management_group" "management" {
  display_name               = "${var.prefix}-management"
  parent_management_group_id = azurerm_management_group.platform.id
}

# ── Landing Zones subtree ─────────────────────────────────────────────────────

resource "azurerm_management_group" "landing_zones" {
  display_name               = "${var.prefix}-landing-zones"
  parent_management_group_id = azurerm_management_group.autoflow.id
}

resource "azurerm_management_group" "lz_production" {
  display_name               = "${var.prefix}-lz-production"
  parent_management_group_id = azurerm_management_group.landing_zones.id
}

resource "azurerm_management_group" "lz_development" {
  display_name               = "${var.prefix}-lz-development"
  parent_management_group_id = azurerm_management_group.landing_zones.id
}

# ── RBAC: DevOps pipeline SP ──────────────────────────────────────────────────
#
# Contributor on Production and Development Landing Zone MGs only.
# Two separate assignments — one per MG — so access cannot be escalated by
# moving a subscription between them.

resource "azurerm_role_assignment" "devops_sp_lz_prod" {
  scope                = azurerm_management_group.lz_production.id
  role_definition_name = "Contributor"
  principal_id         = var.devops_sp_object_id
}

resource "azurerm_role_assignment" "devops_sp_lz_dev" {
  scope                = azurerm_management_group.lz_development.id
  role_definition_name = "Contributor"
  principal_id         = var.devops_sp_object_id
}

# ── RBAC: Monitoring agents ───────────────────────────────────────────────────
#
# Monitoring Reader at the autoflow root MG so monitoring agents can read
# metrics across all child subscriptions without write access.

resource "azurerm_role_assignment" "monitoring_reader" {
  for_each = toset(var.monitoring_principal_ids)

  scope                = azurerm_management_group.autoflow.id
  role_definition_name = "Monitoring Reader"
  principal_id         = each.value
}

# ── RBAC: AKS workload identity → Key Vault ───────────────────────────────────
#
# Key Vault Secrets User scoped directly to the active environment Key Vault
# resource (not MG). Narrowest possible scope — pods only read secrets, cannot
# manage vault config.

resource "azurerm_role_assignment" "aks_kv_secrets_user" {
  scope                = var.key_vault_id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = var.aks_workload_identity_principal_id
}
