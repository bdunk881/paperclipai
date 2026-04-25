# ── Azure Policy Module ────────────────────────────────────────────────────────
#
# CAF governance guardrails deployed as Azure Policy at the autoflow management
# group scope. All assignments start with enforce=false (Audit mode) so they
# surface compliance gaps without blocking workloads.
#
# Policy inventory:
#   Policy 1  — Tag enforcement (project, environment, managed_by) on RGs
#   Policy 2  — No public IPs on AKS node pools  [custom definition]
#   Policy 3a — ACR must use private endpoint
#   Policy 3b — Key Vault must use private endpoint
#   Policy 4  — Allowed locations
#   Policies 1-4 are grouped into the "autoflow-baseline" initiative.
#
#   Policy 5  — Microsoft Defender for Containers should be enabled
#   Policy 6  — Configure Activity Log → central Log Analytics workspace (DINE)

# ── Custom Policy Definition: AKS no public node IPs ─────────────────────────
#
# There is no built-in policy that audits node pool-level public IP enablement
# directly, so we define a custom one scoped to the autoflow management group.

resource "azurerm_policy_definition" "aks_no_public_node_ip" {
  name         = "aks-no-public-node-ip"
  policy_type  = "Custom"
  mode         = "Indexed"
  display_name = "AKS node pools must not have public IP addresses"
  description  = "Audits AKS clusters where agent pool profiles have enableNodePublicIP set to true."

  management_group_id = var.management_group_id

  metadata = jsonencode({
    category = "Kubernetes"
    version  = "1.0.0"
  })

  parameters = jsonencode({
    effect = {
      type = "String"
      metadata = {
        displayName = "Effect"
        description = "Audit or Deny the request."
      }
      allowedValues = ["Audit", "Deny", "Disabled"]
      defaultValue  = "Audit"
    }
  })

  policy_rule = jsonencode({
    "if" = {
      allOf = [
        {
          field  = "type"
          equals = "Microsoft.ContainerService/managedClusters"
        },
        {
          count = {
            field = "Microsoft.ContainerService/managedClusters/agentPoolProfiles[*]"
            where = {
              field  = "Microsoft.ContainerService/managedClusters/agentPoolProfiles[*].enableNodePublicIP"
              equals = "true"
            }
          }
          greater = 0
        }
      ]
    }
    then = {
      effect = "[parameters('effect')]"
    }
  })
}

# ── Policy Initiative: autoflow-baseline (Policies 1–4) ───────────────────────

resource "azurerm_policy_set_definition" "autoflow_baseline" {
  name         = "autoflow-baseline"
  policy_type  = "Custom"
  display_name = "AutoFlow Baseline Governance"
  description  = "CAF baseline guardrails: tag enforcement, AKS no public IPs, private endpoints, allowed locations."

  management_group_id = var.management_group_id

  metadata = jsonencode({
    category = "AutoFlow"
    version  = "1.0.0"
  })

  # Initiative-level parameter — surfaced so the assignment can override allowed
  # locations without editing the initiative definition.
  parameters = jsonencode({
    allowedLocations = {
      type = "Array"
      metadata = {
        displayName = "Allowed Locations"
        description = "The list of locations that are allowed for resource deployments."
        strongType  = "location"
      }
    }
  })

  # ── 1a. Require 'project' tag on resource groups ───────────────────────────
  # Built-in: "Require a tag on resource groups"
  policy_definition_reference {
    policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025"
    reference_id         = "require-tag-project"
    parameter_values = jsonencode({
      tagName = { value = "project" }
    })
  }

  # ── 1b. Require 'environment' tag on resource groups ──────────────────────
  policy_definition_reference {
    policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025"
    reference_id         = "require-tag-environment"
    parameter_values = jsonencode({
      tagName = { value = "environment" }
    })
  }

  # ── 1c. Require 'managed_by' tag on resource groups ───────────────────────
  policy_definition_reference {
    policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/96670d01-0a4d-4649-9c89-2d3abc0a5025"
    reference_id         = "require-tag-managed-by"
    parameter_values = jsonencode({
      tagName = { value = "managed_by" }
    })
  }

  # ── 2. No public IPs on AKS node pools (custom) ───────────────────────────
  policy_definition_reference {
    policy_definition_id = azurerm_policy_definition.aks_no_public_node_ip.id
    reference_id         = "aks-no-public-node-ip"
    parameter_values = jsonencode({
      effect = { value = "Audit" }
    })
  }

  # ── 3a. ACR must use private link ──────────────────────────────────────────
  # Built-in: "Container registries should use private link"
  policy_definition_reference {
    policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/0fdf0491-d080-4575-b627-ad0e843cba0f"
    reference_id         = "acr-private-endpoint"
  }

  # ── 3b. Key Vault must use private link ────────────────────────────────────
  # Built-in: "Azure Key Vault should use private link"
  policy_definition_reference {
    policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/a6abeaec-4d90-4a02-805f-6b26c4d3fbe9"
    reference_id         = "keyvault-private-endpoint"
  }

  # ── 4. Allowed locations ────────────────────────────────────────────────────
  # Built-in: "Allowed locations"
  policy_definition_reference {
    policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/e56962a6-4747-49cd-b67b-bf8b01975c4c"
    reference_id         = "allowed-locations"
    parameter_values = jsonencode({
      listOfAllowedLocations = { value = "[parameters('allowedLocations')]" }
    })
  }

  depends_on = [azurerm_policy_definition.aks_no_public_node_ip]
}

# ── Initiative Assignment: autoflow-baseline ──────────────────────────────────

resource "azurerm_management_group_policy_assignment" "baseline" {
  name                 = "autoflow-baseline"
  display_name         = "AutoFlow Baseline Governance"
  description          = "Assigns CAF baseline guardrails (tags, AKS, private endpoints, allowed locations)."
  policy_definition_id = azurerm_policy_set_definition.autoflow_baseline.id
  management_group_id  = var.management_group_id

  enforce = false # Audit mode — does not block deployments

  parameters = jsonencode({
    allowedLocations = { value = var.allowed_locations }
  })

  metadata = jsonencode({
    assignedBy = "terraform"
  })
}

# ── Policy 5: Microsoft Defender for Containers ───────────────────────────────
# Built-in: "Microsoft Defender for Containers should be enabled"
# Audits subscriptions that do not have Defender for Containers active.

resource "azurerm_management_group_policy_assignment" "defender_containers" {
  name                 = "defender-containers"
  display_name         = "Microsoft Defender for Containers should be enabled"
  description          = "Audits subscriptions where Microsoft Defender for Containers is not enabled."
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/1c988dd6-ade4-430f-a608-2a3e5b0a6d38"
  management_group_id  = var.management_group_id

  enforce = false

  metadata = jsonencode({
    assignedBy = "terraform"
  })
}

# ── Policy 6: Diagnostic settings → central Log Analytics workspace ───────────
# Built-in (DINE): "Configure Azure Activity logs to stream to specified Log
# Analytics workspace"
# Effect: DeployIfNotExists — requires a managed identity on the assignment so
# the policy engine can create the diagnostic setting on behalf of the principal.

resource "azurerm_management_group_policy_assignment" "diag_activity_log" {
  name                 = "diag-activity-log-law"
  display_name         = "Configure Azure Activity logs to stream to Log Analytics"
  description          = "Deploys diagnostic settings so Activity Log entries are streamed to the central Log Analytics workspace."
  policy_definition_id = "/providers/Microsoft.Authorization/policyDefinitions/2465583e-4e78-4c15-b6be-a36cbc7c8b0f"
  management_group_id  = var.management_group_id

  # Location is mandatory when an identity is attached.
  location = var.location

  # SystemAssigned identity is required for DeployIfNotExists remediation tasks.
  identity {
    type = "SystemAssigned"
  }

  enforce = false

  parameters = jsonencode({
    logAnalytics = { value = var.log_analytics_workspace_id }
  })

  metadata = jsonencode({
    assignedBy = "terraform"
  })
}
