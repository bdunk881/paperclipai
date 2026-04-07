# ─── Container Apps Environment ───────────────────────────────────────────────

resource "azurerm_container_app_environment" "main" {
  name                       = "cae-${local.prefix}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  infrastructure_subnet_id   = azurerm_subnet.container_apps.id

  # Internal-only ingress; traffic enters through the Container App's own ingress
  internal_load_balancer_enabled = false

  tags = local.tags
}

# ─── GitHub Container Registry pull secret ───────────────────────────────────
# The registry secret is stored in Key Vault and consumed by the Container App.
# The GHCR_PAT secret is written once by a bootstrap script (see infra/README.md).

data "azurerm_key_vault_secret" "ghcr_pat" {
  name         = "GHCR-PAT"
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [azurerm_key_vault_access_policy.terraform_admin]
}

# ─── Backend Container App ────────────────────────────────────────────────────

resource "azurerm_container_app" "backend" {
  name                         = "ca-${local.prefix}-backend"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Multiple"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server               = "ghcr.io"
    username             = "x-access-token"
    password_secret_name = "ghcr-pat"
  }

  secret {
    name  = "ghcr-pat"
    value = data.azurerm_key_vault_secret.ghcr_pat.value
  }

  template {
    min_replicas = var.backend_min_replicas
    max_replicas = var.backend_max_replicas

    container {
      name   = "backend"
      image  = var.backend_image
      cpu    = var.backend_cpu
      memory = var.backend_memory

      # Runtime configuration via environment variables.
      # Secrets are referenced from Key Vault via the app managed identity.
      env {
        name  = "ENVIRONMENT"
        value = var.environment
      }
      env {
        name  = "PORT"
        value = tostring(var.backend_port)
      }
      env {
        name  = "AZURE_STORAGE_ACCOUNT_NAME"
        value = azurerm_storage_account.main.name
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.app.client_id
      }
      # Key Vault URI — tells the backend where to load runtime secrets from.
      # The managed identity (AZURE_CLIENT_ID above) must have Get/List access on this vault.
      # DATABASE_URL, REDIS_URL, Stripe keys, etc. are all loaded from KV at startup.
      env {
        name  = "AZURE_KEY_VAULT_URI"
        value = azurerm_key_vault.main.vault_uri
      }

      liveness_probe {
        path             = "/health"
        port             = var.backend_port
        transport        = "HTTP"
        initial_delay    = 15
        interval_seconds = 30
        failure_count_threshold = 3
      }

      readiness_probe {
        path             = "/health"
        port             = var.backend_port
        transport        = "HTTP"
        initial_delay    = 5
        interval_seconds = 10
        failure_count_threshold = 3
      }
    }

    # Scale on HTTP concurrency
    custom_scale_rule {
      name             = "http-scale"
      custom_rule_type = "http"
      metadata = {
        concurrentRequests = "50"
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.backend_port
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  tags = local.tags
}
