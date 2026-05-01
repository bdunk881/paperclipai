---
name: azure-skills
description: >
  Azure QA and testing platform knowledge for the Quality Assurance Engineer role.
  Covers Azure DevOps Test Plans, Azure Load Testing, Azure Monitor, Application
  Insights, Azure Pipelines CI/CD for automated tests, and Microsoft Playwright
  Testing. Use when planning, executing, or automating quality assurance workflows
  on Azure.
---

# Azure Skills — QA Engineer Reference

This skill captures foundational and advanced knowledge for a Quality Assurance Engineer working on Azure. It covers the services used to plan, execute, automate, monitor, and report on software quality across the full testing lifecycle.

---

## Role Context: QA Engineer on Azure

A QA Engineer on Azure owns:
- **Test planning and management** using Azure DevOps Test Plans
- **Automated test execution** integrated into Azure Pipelines CI/CD
- **Performance and load testing** via Azure Load Testing
- **Observability and diagnostics** using Azure Monitor and Application Insights
- **End-to-end browser testing at scale** via Microsoft Playwright Testing
- **Cross-team quality traceability** linking test cases to user stories in Azure Boards

### Core Responsibilities

- Analyze requirements and design test plans, test cases, and test suites
- Execute manual, exploratory, and automated tests across web, API, and database layers
- Build and maintain automated test frameworks (Playwright, Selenium, pytest, MSTest/NUnit/xUnit)
- Integrate automated tests into CI/CD pipelines with quality gates
- Conduct performance and load testing to validate scalability
- Track defects, report quality metrics, and communicate risk to stakeholders
- Instrument test environments with Application Insights for deep diagnostics

### Key Technical Skills (Azure-Focused)

| Area | Skills |
|---|---|
| Test Management | Azure DevOps Test Plans, Azure Boards, exploratory testing |
| Automation | Playwright, Selenium, Cypress, MSTest, NUnit, xUnit, pytest |
| CI/CD Integration | Azure Pipelines (YAML), test result publishing, quality gates |
| Performance Testing | Azure Load Testing, Apache JMeter, k6 |
| Observability | Azure Monitor, Application Insights, KQL, Log Analytics |
| Languages | C#, TypeScript/JavaScript, Python |
| Version Control | Azure Repos, Git, pull request gating |
| BDD | SpecFlow (.NET), Cucumber/Gherkin |
| Certifications | ISTQB CTFL, AZ-400 (DevOps), AZ-900 (Azure Fundamentals) |

---

## 1. Azure DevOps Test Plans

**What it is:** Browser-based test management within Azure DevOps for planned manual testing, UAT, exploratory testing, and automated test traceability. Integrates natively with Azure Boards (requirements), Azure Pipelines (automation), and the Analytics service (reporting).

### Key Concepts

| Term | Definition |
|---|---|
| **Test Plan** | Top-level container for a sprint or release test effort. |
| **Test Suite** | Grouping of test cases — static, requirement-based, or query-based. |
| **Test Case** | Work item defining a scenario with steps, expected results, and parameters. |
| **Shared Steps** | Reusable step sequences referenced across multiple test cases. |
| **Shared Parameters** | Reusable data sets for data-driven testing. |
| **Test Configuration** | Environment matrix (OS, browser, version) to test against. |
| **Test Run** | An execution instance of one or more test cases. |
| **Test Result** | Pass/fail/blocked outcome of a single test case in a run. |
| **Exploratory Testing** | Unscripted testing via the Test & Feedback browser extension. |

### Access Requirements

- **Basic** — Run tests, exploratory testing, browse results
- **Basic + Test Plans** (or Visual Studio Enterprise subscription) — Create/manage plans, suites, configurations

### Basic Workflow

1. Navigate to **Test Plans hub**: `https://dev.azure.com/{org}/{project}/_testManagement`
2. **Create a Test Plan** — name it, associate with a sprint, assign a build
3. **Add Test Suites** — static (manual list), requirement-based (auto-links to user stories), or query-based
4. **Author Test Cases** — define steps, expected results, shared steps, and parameters
5. **Assign Testers** — assign team members to specific test cases
6. **Run Tests** — testers use Test Runner to step through cases, capture screenshots, mark pass/fail
7. **File Bugs** — bugs filed during execution automatically include diagnostic data linked to the failing test case
8. **Track Progress** — Progress Report hub or dashboard charts by priority, configuration, tester

### Linking Automated Tests to Test Cases

Associate automated test methods from your test assembly to test case work items, then run them via pipeline:

```yaml
# Run automated tests associated with a test plan
- task: AzureTestPlan@0
  inputs:
    testSelector: 'automatedTests'
    testPlan: '$(testPlanId)'
    testSuite: '$(testSuiteId)'
    testConfiguration: '$(testConfigId)'
    testRunTitle: 'Automated regression - $(Build.BuildNumber)'
```

### Reporting

- **Progress Report hub** — completion rate, pass/fail/blocked counts, daily execution rate
- **Test Runs hub** — all manual and automated runs with drill-down summaries
- **Requirements Quality widget** — pass rate mapped to linked user stories
- **Test Results Trend (Advanced) widget** — pass rates and durations across pipeline runs
- **Power BI** — analytics via OData API for custom dashboards

---

## 2. Azure Load Testing

**What it is:** Fully managed cloud load-testing service built on Apache JMeter and Locust. Generates high-scale traffic against any application (Azure-hosted, on-premises, or other cloud). No infrastructure to manage — just upload a script and scale.

### Key Concepts

| Term | Definition |
|---|---|
| **Test** | The load test artifact — script, parameters, fail criteria, monitoring, load settings. |
| **Test Run** | One execution of a test; captures client- and server-side metrics. |
| **Test Engine** | Managed VM (4 vCPU/16 GB) running the JMeter/Locust script. Scale by adding engines. |
| **Virtual Users (VUs)** | Simulated concurrent users: `VUs = threads per engine × number of engine instances`. |
| **Client-Side Metrics** | Response time, latency, requests/sec, error rate (from test engines). |
| **Server-Side Metrics** | CPU, memory, HTTP codes from Azure Monitor for Azure-hosted app components. |
| **Fail Criteria** | Threshold conditions that mark a run as failed (up to 50 per test). |
| **Auto-Stop** | Halts a run automatically if error rate exceeds a threshold. |
| **Quick Test** | URL-only test — Azure auto-generates the JMX script. |

### Scaling Formula

```
Total Virtual Users = Threads (in JMX) × Number of Engine Instances
```

Microsoft recommends < 250 threads per engine. Example: 250 threads × 4 engines = 1,000 VUs.

### Quick Test (URL-Based)

1. Create an Azure Load Testing resource in the Azure portal
2. **Create** → **Create a URL-based test**
3. Enter URL, configure duration, VUs, and ramp-up
4. **Run test** — Azure auto-generates JMX and scales infrastructure
5. View metrics on the live dashboard

### JMeter Script Upload

1. Prepare `.jmx` script in Apache JMeter locally
2. **Upload scripts** in the Azure portal → upload `.jmx` and supporting files (CSV data, plugins)
3. Configure environment variables, secrets (via Azure Key Vault), certificates
4. Set number of engine instances and fail criteria
5. Add Azure app components to monitor (pulls server-side metrics from Azure Monitor)

### CI/CD YAML Configuration

```yaml
# config.yaml — committed to source control
version: v0.1
testId: RegressionLoadTest
displayName: Regression load test
testPlan: regression.jmx
description: Load test core API endpoints
engineInstances: 4
failureCriteria:
  - avg(response_time_ms) > 500
  - percentage(error) > 5
  - GetUserProfile: avg(latency) > 200
autoStop:
  errorPercentage: 80
  timeWindow: 120
```

### Azure Pipelines Integration

```yaml
- task: AzureLoadTest@1
  inputs:
    azureSubscription: $(serviceConnection)
    loadTestConfigFile: 'config.yaml'
    loadTestResource: $(loadTestResource)
    resourceGroup: $(loadTestResourceGroup)
    secrets: |
      [
        {
          "name": "appToken",
          "value": "$(mySecret)"
        }
      ]

- publish: $(System.DefaultWorkingDirectory)/loadTest
  artifact: loadTestResults
```

### Supported Fail Criteria Metrics

| Metric | Aggregate Functions |
|---|---|
| `response_time_ms` | `avg`, `max`, `p90`, `p95`, `p99` |
| `latency` | `avg`, `max`, `p90`, `p95`, `p99` |
| `error` | `percentage` |
| `requests_per_sec` | `avg` |
| `requests` | `count` |

---

## 3. Azure Monitor

**What it is:** Unified observability platform for collecting, analyzing, and acting on telemetry from Azure, hybrid, and on-premises environments. Combines metrics, logs, traces, and events into a single platform backed by Log Analytics (KQL) and Azure Monitor Workspaces (PromQL).

### Key QA Use Cases

- Diagnose failures across Azure-hosted services during or after test runs
- Query application and infrastructure logs with KQL to find error patterns
- Alert on error rates, latency spikes, or resource exhaustion during load tests
- Monitor infrastructure health (CPU, memory, disk) for VMs, containers, databases
- Route resource logs to Log Analytics via Diagnostic Settings
- Build visual test health monitors with Workbooks

### Key Concepts

| Term | Definition |
|---|---|
| **Log Analytics Workspace** | Central store for log and trace data; all KQL queries run here. |
| **Diagnostic Settings** | Routes an Azure resource's logs/metrics to Log Analytics, Storage, or Event Hub. |
| **KQL (Kusto Query Language)** | Query language for Azure Monitor Logs; powerful for ad-hoc analysis and alerts. |
| **Metrics** | Numerical time-series data (CPU %, request count, response time). |
| **Alerts** | Rules that notify when conditions are met in metrics or log query results. |
| **Workbooks** | Interactive, parameterized reports combining text, metrics charts, and log queries. |
| **Dynamic Thresholds** | ML-based alert thresholds that adapt to baseline patterns. |

### Alert Types

| Type | Trigger |
|---|---|
| **Metric Alert** | When a resource metric crosses a static or dynamic threshold. |
| **Log Alert** | When a KQL query returns results matching defined conditions. |
| **Activity Log Alert** | When a specific Azure management operation or service health event occurs. |

### Getting Started

1. **Enable Diagnostic Settings** on your resource → send to a Log Analytics workspace
2. **Query logs with KQL** in Log Analytics:

```kusto
// Find all HTTP 500 errors in the last hour
AppServiceHTTPLogs
| where TimeGenerated > ago(1h)
| where ScStatus == 500
| summarize count() by CsUriStem, bin(TimeGenerated, 5m)

// Find failed Azure management operations
AzureActivity
| where TimeGenerated > ago(1h)
| where ActivityStatus == "Failed"
```

3. **Create Alerts** from a query or metric → define threshold → configure action group (email, webhook, Teams)
4. **Azure Load Testing** pulls server-side metrics directly from Azure Monitor during test runs

### Key QA-Relevant Log Tables

| Table | Contents |
|---|---|
| `AppServiceHTTPLogs` | HTTP request/response logs for App Service |
| `AppServiceConsoleLogs` | Application stdout/stderr |
| `exceptions` (App Insights) | Unhandled exception telemetry |
| `requests` (App Insights) | HTTP request telemetry with duration and result codes |
| `traces` (App Insights) | Custom trace/log messages |
| `ContainerLog` | Stdout/stderr from AKS pods |

---

## 4. Application Insights

**What it is:** Application Performance Monitoring (APM) feature of Azure Monitor. Instruments application code to collect requests, dependencies, exceptions, traces, custom events, and metrics via OpenTelemetry. Provides rich investigation tools in the Azure portal.

### Key QA Use Cases

- **Exception tracking** — capture unhandled exceptions with full stack traces
- **Performance monitoring** — identify slow requests and slow dependencies (DB calls, HTTP calls)
- **Distributed tracing** — correlate a single user request across multiple microservices
- **Availability monitoring** — run synthetic tests (URL pings, multi-step web tests) from Azure edge locations globally
- **Live Metrics** — real-time 1-second telemetry feed for validating behavior after deployment
- **Failure analysis** — aggregate errors by operation, exception type, and dependency for QA triage

### Key Concepts

| Term | Definition |
|---|---|
| **Connection String** | Credentials directing telemetry to your App Insights resource. |
| **OpenTelemetry Distro** | `Azure.Monitor.OpenTelemetry.AspNetCore` — recommended .NET package. |
| **Autoinstrumentation** | Codeless telemetry collection via toggle in App Service, AKS, Azure Functions. |
| **Application Map** | Visual topology of app components with error/performance indicators. |
| **Live Metrics** | Sub-second real-time telemetry — ideal for validating new deployments. |
| **Sampling** | Reduces telemetry volume while keeping distributed traces coherent. |
| **Availability Tests** | Synthetic tests that ping your endpoint from Azure edge nodes globally. |
| **Snapshot Debugger** | Automatically captures a debug snapshot when an exception occurs. |

### Setup (.NET / ASP.NET Core)

```bash
dotnet add package Azure.Monitor.OpenTelemetry.AspNetCore
```

```csharp
// Program.cs
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenTelemetry().UseAzureMonitor();
var app = builder.Build();
app.Run();
```

```
# Environment variable (or appsettings.json)
APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=00000000-...;IngestionEndpoint=https://...
```

### Tracking Exceptions (Classic API)

```csharp
using Microsoft.ApplicationInsights;
using Microsoft.ApplicationInsights.DataContracts;

public class ExampleService
{
    private readonly TelemetryClient _telemetryClient;

    public ExampleService(TelemetryClient telemetryClient)
    {
        _telemetryClient = telemetryClient;
    }

    public void HandleRequest()
    {
        using IOperationHolder<RequestTelemetry> operation =
            _telemetryClient.StartOperation<RequestTelemetry>("ExampleRequest");
        try
        {
            // ... request handling
            operation.Telemetry.Success = true;
        }
        catch (Exception ex)
        {
            operation.Telemetry.Success = false;
            _telemetryClient.TrackException(ex);
            throw;
        }
    }
}
```

### KQL Queries for QA

```kusto
// Top exceptions in the last 24 hours
exceptions
| where timestamp > ago(24h)
| summarize count() by type, outerMessage
| top 20 by count_

// Slow requests (>2s) in the last hour
requests
| where timestamp > ago(1h) and duration > 2000
| project timestamp, name, duration, resultCode, url

// Correlate exceptions with their requests
exceptions
| join (requests) on operation_Id
| project timestamp, operation_Id, name, type, outerMessage
```

### Key Investigation Views

| View | QA Use |
|---|---|
| **Failures** | Top exception types, failed dependencies, HTTP error codes per operation |
| **Performance** | Duration distribution; drill into slow samples |
| **Application Map** | Visual health of all services and dependencies |
| **Transaction Details** | Full end-to-end trace for a single request |
| **Live Metrics** | Real-time feed during deployment or load test |
| **Availability** | Ping/multi-step test results from global edge locations |

---

## 5. Azure Pipelines (for QA)

**What it is:** CI/CD service within Azure DevOps that automates building, testing, and deploying applications. For QA engineers, it is the primary mechanism for running automated tests on every code change, publishing test results, collecting code coverage, and enforcing quality gates.

### Key Concepts

| Term | Definition |
|---|---|
| **Pipeline** | YAML or classic definition of the full build-test-deploy workflow. |
| **Stage** | Logical phase (Build, Test, Deploy) containing jobs. |
| **Job** | Execution boundary on a single agent; steps run sequentially. |
| **Task** | Prepackaged automation unit (e.g., `VSTest@3`, `PublishTestResults@2`). |
| **Agent** | Machine (Microsoft-hosted or self-hosted) running pipeline jobs. |
| **Trigger** | Push to branch, PR, schedule, or completion of another pipeline. |
| **Environment** | Deployment target with optional approvals and quality checks. |

### Core Test Tasks

| Task | Purpose |
|---|---|
| `VSTest@3` | Run .NET tests (MSTest, NUnit, xUnit, Selenium, Appium) |
| `DotNetCoreCLI@2` | Run `dotnet test` with coverage collection |
| `PublishTestResults@2` | Publish TRX, JUnit, NUnit, or xUnit results to Azure DevOps |
| `PublishCodeCoverageResults@2` | Publish Cobertura or JaCoCo coverage reports |
| `AzureLoadTest@1` | Trigger an Azure Load Testing run with pass/fail gate |
| `AzureTestPlan@0` | Run automated tests linked to a Test Plans test plan |

### Example: Full Test Pipeline

```yaml
trigger:
  - main

pool:
  vmImage: ubuntu-latest

stages:
- stage: Test
  jobs:
  - job: UnitAndIntegration
    steps:
    - task: DotNetCoreCLI@2
      displayName: 'Build'
      inputs:
        command: build
        projects: '**/*.csproj'
        arguments: '--configuration Release'

    - task: DotNetCoreCLI@2
      displayName: 'Run Unit Tests'
      inputs:
        command: test
        projects: '**/*Tests/*.csproj'
        arguments: '--configuration Release --collect:"XPlat Code Coverage"'
        publishTestResults: true

    - task: PublishCodeCoverageResults@2
      displayName: 'Publish Coverage'
      inputs:
        codeCoverageTool: 'Cobertura'
        summaryFileLocation: '$(Agent.TempDirectory)/**/coverage.cobertura.xml'

- stage: E2E
  dependsOn: Test
  condition: succeeded()
  jobs:
  - job: PlaywrightTests
    steps:
    - script: npm ci
    - script: npx playwright install --with-deps
    - script: npx playwright test --config=playwright.service.config.ts --workers=20
      env:
        PLAYWRIGHT_SERVICE_URL: $(PLAYWRIGHT_SERVICE_URL)
        AZURE_CLIENT_ID: $(AZURE_CLIENT_ID)
        AZURE_TENANT_ID: $(AZURE_TENANT_ID)
        AZURE_CLIENT_SECRET: $(AZURE_CLIENT_SECRET)

- stage: LoadTest
  dependsOn: E2E
  condition: succeeded()
  jobs:
  - job: RunLoadTest
    steps:
    - task: AzureLoadTest@1
      inputs:
        azureSubscription: $(serviceConnection)
        loadTestConfigFile: 'load-test-config.yaml'
        loadTestResource: $(loadTestResource)
        resourceGroup: $(loadTestResourceGroup)
    - publish: $(System.DefaultWorkingDirectory)/loadTest
      artifact: loadTestResults
```

### Parallel Test Execution (up to 99 agents)

```yaml
jobs:
- job: ParallelTesting
  strategy:
    parallel: 4
  steps:
  - task: VSTest@3
    inputs:
      testSelector: testAssemblies
      testAssemblyVer2: '**\*test*.dll'
      distributionBatchType: basedOnExecutionTime
```

### Publishing JUnit Results (Node.js/Python/Java)

```yaml
- task: PublishTestResults@2
  condition: succeededOrFailed()
  inputs:
    testRunner: JUnit
    testResultsFiles: '**/test-results.xml'
```

### Test Reporting

After `PublishTestResults@2`:
- Pipeline run → **Tests** tab: pass/fail/skipped counts, individual results, error messages, stack traces
- **Test Results Trend (Advanced)** dashboard widget: trends across pipeline runs
- **Requirements Quality** widget: pass rate mapped to linked user stories

---

## 6. Microsoft Playwright Testing (Azure-Hosted)

**What it is:** Fully managed Azure service for running Playwright end-to-end tests at scale using cloud-hosted browsers. Eliminates browser infrastructure management, enables massive parallelization, and provides centralized test results and trace artifacts via a portal.

> **Note (as of April 2026):** The original Preview service is being retired; the new service is **Playwright Workspace** in **Azure App Testing** (generally available). Migration guidance: `https://aka.ms/mpt/migration-guidance`.

### Key QA Use Cases

- **Cross-browser, cross-OS testing at scale** — Chromium, Firefox, WebKit on Windows and Linux
- **Parallel test acceleration** — run a 30-minute suite in 2-3 minutes with 20-50 parallel cloud browsers
- **CI/CD integration** — plug into GitHub Actions or Azure Pipelines with no code changes
- **Centralized artifact reporting** — screenshots, videos, trace files stored 90 days in the portal
- **Testing localhost / private endpoints** — cloud browsers can reach development servers
- **Visual regression testing** — consistent environments eliminate "works on my machine" flakiness

### Key Concepts

| Term | Definition |
|---|---|
| **Workspace** | Azure resource that stores Playwright test run data for a selected region. |
| **Service Configuration** (`playwright.service.config.ts`) | Auto-generated config that redirects Playwright to cloud-hosted browsers. |
| **Parallel Workers** | Number of concurrent browser instances (up to 50). |
| **Test Run** | One execution of your test suite; results retained 90 days. |
| **Trace Viewer** | Interactive timeline in the portal to step through each test action with DOM snapshots and network activity. |
| **Entra ID Auth** | Default auth method — uses `az login` locally. |

### Getting Started

```bash
# Step 1: Initialize service configuration
npm init @azure/microsoft-playwright-testing@latest

# Step 2: Set region endpoint (from the Playwright portal)
# .env file:
PLAYWRIGHT_SERVICE_URL=wss://eastus.api.playwright.microsoft.com/accounts/{workspace-id}/browsers

# Step 3: Authenticate (local dev)
az login

# Step 4: Run tests against the cloud service
npx playwright test --config=playwright.service.config.ts --workers=20
```

### Enable Artifact Collection

```typescript
// playwright.config.ts
use: {
  trace: 'on-first-retry',
  video: 'retain-on-failure',
  screenshot: 'on'
}
```

### .NET (NUnit) Integration

```bash
dotnet add package Azure.Developer.MicrosoftPlaywrightTesting.NUnit --prerelease
```

```csharp
// PlaywrightServiceSetup.cs
using Azure.Developer.MicrosoftPlaywrightTesting.NUnit;

namespace PlaywrightTests;

[SetUpFixture]
public class PlaywrightServiceSetup : PlaywrightServiceNUnit {};
```

```bash
dotnet test --settings:.runsettings --logger "microsoft-playwright-testing" -- NUnit.NumberOfTestWorkers=20
```

### Azure Pipelines Integration

```yaml
- task: NodeTool@0
  inputs:
    versionSpec: '18.x'

- script: npm ci
- script: npx playwright install --with-deps
- script: npx playwright test --config=playwright.service.config.ts --workers=20
  env:
    PLAYWRIGHT_SERVICE_URL: $(PLAYWRIGHT_SERVICE_URL)
    AZURE_CLIENT_ID: $(AZURE_CLIENT_ID)
    AZURE_TENANT_ID: $(AZURE_TENANT_ID)
    AZURE_CLIENT_SECRET: $(AZURE_CLIENT_SECRET)
```

### Portal: Viewing Results

After a run, the terminal prints a portal link where you can:
- See overall pass/fail summary with commit ID and CI build details
- Drill into individual test results with retry history
- View screenshots, video recordings, and console logs
- Use **Trace Viewer** — hover over any test action to see DOM state before/after, network requests, console errors

---

## 7. Recommended QA Architecture on Azure

```
Code commit → Azure Pipelines triggered
  ├─ Stage 1 — Build & Unit Tests
  │    DotNetCoreCLI build + test → PublishTestResults → PublishCodeCoverage
  │
  ├─ Stage 2 — E2E Tests (parallel, cross-browser)
  │    Playwright tests → Microsoft Playwright Testing (20–50 workers)
  │    └─ Results stored in Playwright portal (90 days)
  │
  ├─ Stage 3 — Load Test (performance gate)
  │    AzureLoadTest@1 → Azure Load Testing (JMeter/Locust)
  │    └─ Fail criteria: p95 latency, error %, requests/sec
  │
  └─ Stage 4 — Deploy to Staging (if all gates pass)

During all stages:
  ├─ Application instrumented with Application Insights (OpenTelemetry)
  │    → exceptions, traces, dependencies → Log Analytics workspace
  │
  ├─ Azure Monitor Alerts fire on error rate / latency threshold breach
  │
  └─ Azure Monitor Workbooks provide combined test health dashboard

Test Management (manual / UAT):
  └─ Azure DevOps Test Plans
       ├─ Requirement-based suites linked to user stories
       ├─ Automated test cases associated with pipeline runs
       ├─ Manual regression suites per sprint
       └─ Stakeholder UAT via Test & Feedback browser extension
```

---

## 8. QA Decision Guide

| Testing Need | Azure Service / Tool |
|---|---|
| Manage and track manual test cases | Azure DevOps Test Plans |
| Execute structured manual or UAT testing | Azure Test Plans + Test Runner |
| Run unscripted exploratory testing | Test & Feedback browser extension |
| Automate unit and integration tests in CI | Azure Pipelines (`DotNetCoreCLI@2`, `VSTest@3`) |
| Run cross-browser E2E tests at scale | Microsoft Playwright Testing |
| Perform load and performance testing | Azure Load Testing |
| Monitor app behavior during tests | Application Insights |
| Query logs and diagnose failures | Azure Monitor / Log Analytics (KQL) |
| Alert on quality regressions in real time | Azure Monitor Alerts |
| Link automated tests back to user stories | Azure Test Plans + Azure Pipelines |
| Manage test secrets in pipelines | Azure Key Vault + Variable Groups |

---

## 9. Learning Resources

- [Azure DevOps Test Plans](https://learn.microsoft.com/azure/devops/test/overview?view=azure-devops)
- [Azure Load Testing](https://learn.microsoft.com/azure/load-testing/overview-what-is-azure-load-testing)
- [Azure Monitor Overview](https://learn.microsoft.com/azure/azure-monitor/overview)
- [Application Insights Overview](https://learn.microsoft.com/azure/azure-monitor/app/app-insights-overview)
- [Azure Pipelines — CI/CD for Testing](https://learn.microsoft.com/azure/devops/pipelines/get-started/key-pipelines-concepts?view=azure-devops)
- [Microsoft Playwright Testing](https://learn.microsoft.com/azure/playwright-testing/overview-what-is-microsoft-playwright-testing)
- [ISTQB Foundation Level Syllabus](https://www.istqb.org/certifications/certified-tester-foundation-level)
- [AZ-400: DevOps Engineer Expert](https://learn.microsoft.com/credentials/certifications/devops-engineer/)
- [AZ-900: Azure Fundamentals](https://learn.microsoft.com/credentials/certifications/azure-fundamentals/)
