# ── Entra External ID (CIAM) Tenant + App Registration ─────────────────────
#
# Provisions an Azure AD B2C-equivalent CIAM directory and registers the
# AutoFlow SPA application inside it.
#
# Prerequisites:
#   - The deploying service principal needs:
#       * Microsoft.AzureActiveDirectory/ciamDirectories/write on the subscription
#       * Application.ReadWrite.All on MS Graph (for app registration in the new tenant)
#   - azurerm provider >= 3.100 (for azurerm_aadb2c_directory, used as the closest
#     Terraform resource for CIAM directories)
#
# Note: As of April 2026, the azurerm_aadb2c_directory resource provisions the
# CIAM directory. The newer "Entra External ID" branding maps to this same
# underlying resource type (Microsoft.AzureActiveDirectory/b2cDirectories).
# If Terraform adds a dedicated CIAM resource, migrate to it.

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.50"
    }
  }
}

locals {
  display_name = var.ciam_display_name != "" ? var.ciam_display_name : "${var.prefix}-${var.environment}-ciam"
  normalized_spa_redirect_uris = [
    for uri in var.spa_redirect_uris :
    can(regex("^https?://[^/]+$", uri)) ? "${uri}/" : uri
  ]
  msa_federation_redirect_uris = length(var.msa_federation_redirect_uris) > 0 ? var.msa_federation_redirect_uris : [
    "https://${var.ciam_tenant_subdomain}.ciamlogin.com/${var.existing_ciam_tenant_id}/federation/oauth2",
    "https://${var.ciam_tenant_subdomain}.ciamlogin.com/${var.ciam_tenant_subdomain}.onmicrosoft.com/federation/oauth2",
  ]
}

# ── CIAM Directory ──────────────────────────────────────────────────────────
# This creates the External ID tenant linked to the Azure subscription for billing.

resource "azurerm_aadb2c_directory" "ciam" {
  count = 0

  domain_name             = "${var.ciam_tenant_subdomain}.onmicrosoft.com"
  display_name            = local.display_name
  resource_group_name     = var.resource_group_name
  country_code            = "US"
  data_residency_location = "United States"
  sku_name                = "PremiumP1"

  tags = var.tags
}

# ── App Registration (SPA) ──────────────────────────────────────────────────
# Registers AutoFlow as a Single Page Application in the CIAM tenant.
#
# IMPORTANT: This azuread_application resource targets the NEW CIAM tenant,
# not the workforce tenant. The azuread provider must be aliased to authenticate
# against the CIAM tenant once it exists. See outputs for the tenant_id needed.
#
# For initial deployment, the app registration below documents the desired
# config. Use infra/azure/scripts/sync-ciam-redirect-uris.sh to keep the live
# registration aligned with the dashboard auth routes after domain changes.

resource "azuread_application" "autoflow_spa" {
  display_name     = "${var.prefix}-dashboard"
  sign_in_audience = "AzureADMyOrg"

  single_page_application {
    redirect_uris = local.normalized_spa_redirect_uris
  }

  required_resource_access {
    resource_app_id = "00000003-0000-0000-c000-000000000000" # Microsoft Graph

    resource_access {
      id   = "e1fe6dd8-ba31-4d61-89e7-88639da4683d" # User.Read (delegated)
      type = "Scope"
    }
    resource_access {
      id   = "37f7f235-527c-4136-accd-4a02d197296e" # openid (delegated)
      type = "Scope"
    }
    resource_access {
      id   = "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0" # email (delegated)
      type = "Scope"
    }
    resource_access {
      id   = "14dad69e-099b-42c9-810b-d002981feec1" # profile (delegated)
      type = "Scope"
    }
  }

  web {
    implicit_grant {
      access_token_issuance_enabled = false
      id_token_issuance_enabled     = false
    }
  }

  api {
    requested_access_token_version = 2
  }

  lifecycle {
    ignore_changes = [
      # User flows and branding are configured in Azure Portal
      tags,
    ]
  }
}

resource "azuread_application" "autoflow_msa_federation" {
  display_name     = var.msa_federation_display_name
  sign_in_audience = "AzureADandPersonalMicrosoftAccount"

  web {
    homepage_url  = "https://app.helloautoflow.com/login"
    redirect_uris = local.msa_federation_redirect_uris

    implicit_grant {
      access_token_issuance_enabled = false
      id_token_issuance_enabled     = false
    }
  }

  api {
    requested_access_token_version = 2
  }

  optional_claims {
    id_token {
      name = "family_name"
    }

    id_token {
      name = "given_name"
    }
  }

  lifecycle {
    ignore_changes = [
      tags,
    ]
  }
}

resource "azuread_application_password" "autoflow_msa_federation" {
  application_id = azuread_application.autoflow_msa_federation.id
  display_name   = "Terraform-managed Microsoft Account OIDC secret"
}
