data "azurerm_client_config" "current" {}

resource "azurerm_kubernetes_cluster" "main" {
  name                      = "${var.prefix}-${var.environment}-aks"
  location                  = var.location
  resource_group_name       = var.resource_group_name
  dns_prefix                = "${var.prefix}-${var.environment}"
  kubernetes_version        = var.kubernetes_version
  automatic_channel_upgrade = "patch"

  # ── Default node pool ──────────────────────────────────────────────────────
  default_node_pool {
    name            = "default"
    node_count      = var.node_count
    vm_size         = var.node_vm_size
    vnet_subnet_id  = var.aks_subnet_id
    os_disk_size_gb = 50
    type            = "VirtualMachineScaleSets"

    enable_auto_scaling = true
    min_count           = var.min_node_count
    max_count           = var.max_node_count

    node_labels = {
      role = "system"
    }
  }

  # ── Identity — workload identity enables pod-level RBAC (no secrets) ───────
  identity {
    type = "SystemAssigned"
  }

  workload_identity_enabled = true
  oidc_issuer_enabled       = true

  # ── Networking ──────────────────────────────────────────────────────────────
  network_profile {
    network_plugin    = "azure"
    network_policy    = "calico"
    load_balancer_sku = "standard"
    outbound_type     = "loadBalancer"
  }

  # ── Add-ons ─────────────────────────────────────────────────────────────────
  azure_policy_enabled             = true
  http_application_routing_enabled = false

  oms_agent {
    log_analytics_workspace_id = azurerm_log_analytics_workspace.aks.id
  }

  # ── API server access ────────────────────────────────────────────────────────
  dynamic "api_server_access_profile" {
    for_each = length(var.api_server_authorized_ips) == 0 ? [] : [var.api_server_authorized_ips]
    content {
      authorized_ip_ranges = api_server_access_profile.value
    }
  }

  tags = var.tags

  lifecycle {
    ignore_changes = [
      default_node_pool[0].node_count, # managed by autoscaler
    ]
  }
}

# ── Log Analytics workspace for AKS monitoring ────────────────────────────────

resource "azurerm_log_analytics_workspace" "aks" {
  name                = "${var.prefix}-${var.environment}-aks-logs"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = 30

  tags = var.tags
}

# ── Grant AKS kubelet managed identity pull access to ACR ────────────────────

resource "azurerm_role_assignment" "acr_pull" {
  scope                = var.acr_id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}
