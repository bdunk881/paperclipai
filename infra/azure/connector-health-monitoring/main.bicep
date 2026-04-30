@description('Azure region for connector health monitoring resources')
param location string = resourceGroup().location

@description('Short environment name used in resource naming')
param environment string

@description('Existing Log Analytics workspace resource ID that stores connector telemetry')
param logAnalyticsWorkspaceResourceId string

@description('Email address for connector-health alert notifications')
param alertEmail string

@description('Optional action group name override')
param actionGroupName string = 'ag-autoflow-${environment}-connector-health'

@description('Optional alert name prefix')
param alertPrefix string = 'autoflow-${environment}-connector'

resource workspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' existing = {
  scope: resourceGroup()
  name: last(split(logAnalyticsWorkspaceResourceId, '/'))
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  properties: {
    groupShortName: 'ConnHlth'
    enabled: true
    emailReceivers: [
      {
        name: 'primary-ops'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

resource connectorWideDegradation 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${alertPrefix}-degraded'
  location: location
  properties: {
    description: 'Fires when any Tier 1 connector reports degraded or provider_error state within five minutes.'
    enabled: true
    severity: 2
    scopes: [
      workspace.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT5M'
    criteria: {
      allOf: [
        {
          query: '''
            ConnectorHealth_CL
            | where State_s in ('degraded', 'provider_error')
            | summarize AffectedConnectors = dcount(ConnectorKey_s) by bin(TimeGenerated, 5m)
          '''
          timeAggregation: 'Count'
          metricMeasureColumn: 'AffectedConnectors'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

resource repeatedAuthFailures 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${alertPrefix}-auth-failures'
  location: location
  properties: {
    description: 'Fires when a connector exceeds repeated auth failures in a 15 minute window.'
    enabled: true
    severity: 2
    scopes: [
      workspace.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''
            ConnectorHealth_CL
            | where State_s == 'auth_failed'
            | summarize AuthFailures = count() by ConnectorKey_s, bin(TimeGenerated, 15m)
          '''
          timeAggregation: 'Maximum'
          metricMeasureColumn: 'AuthFailures'
          operator: 'GreaterThanOrEqual'
          threshold: 5
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

resource extendedRateLimiting 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${alertPrefix}-rate-limit'
  location: location
  properties: {
    description: 'Fires when repeated provider throttling crosses the sustained rate-limit threshold.'
    enabled: true
    severity: 3
    scopes: [
      workspace.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''
            ConnectorHealth_CL
            | where State_s == 'rate_limited'
            | summarize RateLimitEvents = count() by ConnectorKey_s, bin(TimeGenerated, 15m)
          '''
          timeAggregation: 'Maximum'
          metricMeasureColumn: 'RateLimitEvents'
          operator: 'GreaterThanOrEqual'
          threshold: 5
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}
