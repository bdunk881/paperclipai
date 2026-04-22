@description('Name for the Static Web App resource')
param appName string = 'autoflow-dashboard'

@description('Azure region for the SWA resource (must support Standard tier + Entra External ID)')
param location string = 'eastus2'

@description('Custom domain to bind (e.g. app.helloautoflow.com). Leave empty to skip.')
param customDomain string = ''

@description('URL of the linked backend (e.g. https://api.helloautoflow.com). Leave empty to skip.')
param linkedBackendUrl string = ''

@description('Resource tags')
param tags object = {
  project: 'autoflow'
  component: 'dashboard'
  managedBy: 'bicep'
}

resource swa 'Microsoft.Web/staticSites@2023-01-01' = {
  name: appName
  location: location
  tags: tags
  sku: {
    // Standard plan required for: Entra External ID auth, private endpoints,
    // SLA guarantee, and more than 3 staging environments.
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    // Branch and repo are configured via the GitHub Actions deployment token;
    // leave blank here so Bicep doesn't try to set up its own workflow.
    repositoryUrl: ''
    branch: ''
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
    // Enforce HTTPS — SWA defaults to this, but be explicit.
    httpsOnly: true
  }
}

// Optionally bind a custom domain
resource customDomainBinding 'Microsoft.Web/staticSites/customDomains@2023-01-01' = if (!empty(customDomain)) {
  parent: swa
  name: customDomain
  properties: {}
}

// Optionally link a backend (App Service / Container App) to proxy /api requests
resource linkedBackend 'Microsoft.Web/staticSites/linkedBackends@2023-01-01' = if (!empty(linkedBackendUrl)) {
  parent: swa
  name: 'autoflow-api'
  properties: {
    backendResourceId: linkedBackendUrl
    region: location
  }
}

// Outputs needed by CI and operators
output swaName string = swa.name
output swaDefaultHostname string = swa.properties.defaultHostname
output swaId string = swa.id
