terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.110"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.52"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Backend populated by CI via -backend-config flags.
  # See environments/*.backend for per-environment backend config.
  backend "azurerm" {}
}

provider "azurerm" {
  # OIDC authentication — no stored credentials.
  # In GitHub Actions: azure/login sets AZURE_CLIENT_ID, AZURE_TENANT_ID,
  # AZURE_SUBSCRIPTION_ID, and ARM_OIDC_TOKEN_FILE_PATH via federated identity.
  use_oidc = true

  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
    cognitive_account {
      purge_soft_delete_on_destroy = false
    }
  }
}

provider "azuread" {
  use_oidc = true
}
