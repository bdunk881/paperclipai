---
name: azure-skills
description: >
  Azure backend engineering reference for a Backend Engineer. Covers Azure App
  Service, Azure Functions, Azure SQL, Cosmos DB, Service Bus, and API
  Management. Use when designing, deploying, or troubleshooting Azure-hosted
  backend services.
---

# Azure Skills — Backend Engineer Reference

This skill captures foundational knowledge for a backend engineer working on Azure. It covers the core services used to build, deploy, and operate backend APIs, databases, and messaging infrastructure on Azure.

---

## Role Context: Backend Engineer on Azure

A backend engineer on Azure owns:
- RESTful and GraphQL APIs hosted on managed compute (App Service, Functions, AKS)
- Relational and NoSQL data storage (Azure SQL, Cosmos DB)
- Asynchronous messaging and event-driven architecture (Service Bus, Event Grid)
- API governance and traffic control (Azure API Management)
- Authentication, authorization, and secrets management (Microsoft Entra ID, Key Vault, Managed Identities)
- Observability (Azure Monitor, Application Insights, Log Analytics)

---

## 1. Azure App Service

**What it is:** Fully managed PaaS for hosting web apps, REST APIs, and mobile back ends. Supports .NET, Node.js, Python, Java, PHP, and containers. No infrastructure management required.

**Key concepts:**
- **App Service Plan**: Defines the region, OS, and compute tier (Free, Basic, Standard, Premium, Isolated). All apps in a plan share the same VM resources.
- **Deployment slots**: Staging environments for zero-downtime swaps (e.g., `staging` → `production`).
- **CORS**: Configured at the service level; important when App Service hosts an API consumed by a browser-based frontend.
- **Auto-scaling**: Scale out (add instances) or scale up (larger VM) based on rules or schedules.
- **Managed Identity**: Assign a system- or user-assigned identity to the app to access Azure resources (Key Vault, SQL, Storage) without embedding credentials.

**Deploying a REST API:**
```bash
# Create resource group and plan
az group create --name myRG --location eastus
az appservice plan create --name myPlan --resource-group myRG --sku FREE

# Create the web app
az webapp create --resource-group myRG --plan myPlan --name myApiApp --runtime "PYTHON:3.11"

# Deploy from local git
az webapp config appsettings set --name myApiApp --resource-group myRG \
  --settings DEPLOYMENT_BRANCH='main'
git remote add azure <deploymentLocalGitUrl>
git push azure main
```

**App settings (environment variables):**
```bash
az webapp config appsettings set --name myApiApp --resource-group myRG \
  --settings DATABASE_URL="..." JWT_SECRET="..."
```

**Security best practices:**
- Enable HTTPS-only; redirect HTTP to HTTPS.
- Use Managed Identity instead of connection strings with credentials.
- Restrict access with IP restrictions or virtual network integration.
- Use App Service Environment (ASE) for full network isolation.

---

## 2. Azure Functions

**What it is:** Serverless, event-driven compute. Write individual functions that respond to triggers. Pay only for execution time (Consumption plan). No server management.

**Hosting plans:**
| Plan | Cold start | Max duration | Scale |
|---|---|---|---|
| Consumption | Yes | 10 min | Auto (per event) |
| Premium | No | Unlimited | Pre-warmed instances |
| Dedicated (App Service) | No | Unlimited | Manual / auto |

**Triggers (what starts the function):**
- HTTP — RESTful endpoint
- Timer — CRON schedule
- Queue Storage / Service Bus — message-driven
- Blob Storage — file-driven
- Event Grid / Event Hub — event streams
- Cosmos DB — change feed

**Bindings (declarative I/O connections):**
- Input binding: read data into the function (e.g., Cosmos DB document, Blob)
- Output binding: write data out (e.g., queue message, Cosmos DB document, SendGrid email)

**Python v2 example (HTTP trigger → queue output):**
```python
import azure.functions as func
import logging

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

@app.route(route="process")
@app.queue_output(arg_name="msg", queue_name="jobs", connection="AzureWebJobsStorage")
def process(req: func.HttpRequest, msg: func.Out[func.QueueMessage]) -> func.HttpResponse:
    body = req.get_json()
    msg.set(str(body))
    return func.HttpResponse("Queued", status_code=202)
```

**Key patterns:**
- Use Functions for short-lived, event-driven work (webhooks, background jobs, data pipelines).
- Chain functions with Durable Functions for stateful workflows (fan-out/fan-in, human approval, long-running orchestrations).
- Prefer Premium plan for latency-sensitive APIs that cannot tolerate cold starts.

---

## 3. Azure SQL Database

**What it is:** Fully managed relational database based on SQL Server. Handles patching, backups, HA, and scaling automatically. Two main deployment options:
- **Azure SQL Database** (single database or elastic pool) — best for modern cloud apps.
- **Azure SQL Managed Instance** — near 100% SQL Server compatibility; best for lift-and-shift migrations.

**Connection (Python with pyodbc):**
```python
import pyodbc

conn_str = (
    "Driver={ODBC Driver 18 for SQL Server};"
    "Server=tcp:<server>.database.windows.net,1433;"
    "Database=<db>;"
    "Authentication=ActiveDirectoryMsi;"  # use Managed Identity
    "Encrypt=yes;TrustServerCertificate=no;"
)
conn = pyodbc.connect(conn_str)
```

**Security checklist:**
- Always use `Encrypt=yes; TrustServerCertificate=no` (TLS 1.2+).
- Prefer Microsoft Entra authentication (Managed Identity or Entra groups) over SQL password auth.
- Use private endpoints or VNet service endpoints — never expose to the public internet unnecessarily.
- Enable Microsoft Defender for SQL (threat detection + vulnerability assessment).
- Enable auditing to Log Analytics or Storage.
- Use row-level security and column-level encryption for sensitive data.

**Performance tips:**
- Use elastic pools to share DTUs/vCores across multiple databases with variable load.
- Enable Automatic Tuning (index recommendations, plan regression correction).
- Use read replicas (geo-secondary) for read-heavy analytics queries.

---

## 4. Azure Cosmos DB

**What it is:** Globally distributed, multi-model NoSQL database. Supports document (NoSQL API), key-value, graph (Gremlin), wide-column (Cassandra), and table models. Single-digit millisecond latency at any scale, anywhere.

**Core concepts:**
- **Account → Database → Container → Item** hierarchy.
- **Partition key**: Determines how data is distributed. Choose a key with high cardinality and even distribution (e.g., `userId`, `tenantId`). Avoid hot partitions.
- **Request Units (RU/s)**: Throughput currency. Every read/write/query costs RUs. Provision RU/s at the container or database level (serverless mode also available).
- **Consistency levels** (weakest → strongest): Eventual, Consistent Prefix, Session, Bounded Staleness, Strong. `Session` is the recommended default for most apps.
- **Change feed**: Ordered, persistent log of item changes. Use to trigger Functions, sync data, or build event-driven pipelines.
- **Automatic indexing**: All properties indexed by default. Customize indexing policies for cost and performance optimization.

**Python SDK example:**
```python
from azure.cosmos import CosmosClient
from azure.identity import DefaultAzureCredential

client = CosmosClient(url="https://<account>.documents.azure.com:443/",
                      credential=DefaultAzureCredential())
db = client.get_database_client("mydb")
container = db.get_container_client("items")

# Create
container.create_item({"id": "1", "userId": "u1", "name": "Widget"})

# Query
items = list(container.query_items(
    query="SELECT * FROM c WHERE c.userId = @uid",
    parameters=[{"name": "@uid", "value": "u1"}],
    enable_cross_partition_query=False
))
```

**Best practices:**
- Always supply `partition_key` on reads/writes to avoid cross-partition fan-out.
- Use `session` consistency unless you need stronger guarantees.
- Use TTL on containers to auto-expire transient data (sessions, cache).
- Use serverless mode for unpredictable or low-volume workloads; provisioned throughput for steady traffic.
- Use Cosmos DB as the source for Azure Functions change-feed triggers to build reactive microservices.

---

## 5. Azure Service Bus

**What it is:** Fully managed enterprise message broker for reliable async messaging. Decouples services; guarantees at-least-once delivery. Supports **queues** (point-to-point) and **topics/subscriptions** (pub/sub fan-out).

**Key concepts:**

| Concept | Description |
|---|---|
| Queue | Point-to-point; one consumer per message |
| Topic | One-to-many; multiple subscriptions each get a copy |
| Subscription filter | SQL or correlation filter to route subset of topic messages |
| Dead-letter queue (DLQ) | Messages that cannot be delivered or processed land here |
| Sessions | Strict message ordering per session key |
| Transactions | Atomic operations across entities (receive + send in one tx) |

**Tiers:**
- **Basic**: Queues only.
- **Standard**: Queues + Topics; shared capacity.
- **Premium**: Dedicated capacity; required for sessions, large messages (>256 KB), VNet integration, geo-replication.

**Python SDK example (send + receive):**
```python
from azure.servicebus import ServiceBusClient, ServiceBusMessage
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
sb_client = ServiceBusClient("https://<namespace>.servicebus.windows.net", credential)

# Send
with sb_client.get_queue_sender("myqueue") as sender:
    sender.send_messages(ServiceBusMessage('{"job": "process-order", "id": 42}'))

# Receive
with sb_client.get_queue_receiver("myqueue", max_wait_time=5) as receiver:
    for msg in receiver:
        print(str(msg))
        receiver.complete_message(msg)
```

**Design patterns:**
- Use **queues** for task distribution and load leveling between a producer and a pool of worker Functions/containers.
- Use **topics** to broadcast domain events (e.g., `order.created`) to multiple downstream services without coupling them.
- Use **subscription filters** to route messages to the right consumers (e.g., by region, priority, event type).
- Use **sessions** when ordered processing per entity (e.g., per order ID) is required.
- Always handle the **DLQ**: alert on messages landing there; process them separately.
- Use **AMQP 1.0** protocol for high-throughput scenarios.

**Create namespace + queue via CLI:**
```bash
az servicebus namespace create --resource-group myRG --name myNS --location eastus --sku Standard
az servicebus queue create --resource-group myRG --namespace-name myNS --name myqueue
```

---

## 6. Azure API Management (APIM)

**What it is:** Fully managed API gateway that sits in front of your backend APIs. Provides a unified entry point, enforces policies, handles auth, rate limiting, caching, transformation, and exposes a developer portal.

**Architecture:**
```
Client → [APIM Gateway] → Backend (App Service / Functions / AKS / external)
```

**Key concepts:**
- **API**: A collection of operations (routes) proxied through APIM.
- **Product**: A bundle of APIs with an access policy. Developers subscribe to products to get subscription keys.
- **Policy**: XML-based rules applied in the `inbound`, `backend`, `outbound`, or `on-error` pipeline.
- **Backend**: The actual service behind APIM (can be URL, App Service, Service Fabric, etc.).

**Common policies:**

| Policy | Use case |
|---|---|
| `rate-limit` | Global call rate limit per subscription |
| `rate-limit-by-key` | Rate limit per user/IP/custom key |
| `quota-by-key` | Monthly/daily quota per key |
| `validate-jwt` | Validate Bearer tokens (Entra ID / custom) |
| `cors` | Cross-origin request handling |
| `set-header` / `set-body` | Transform requests or responses |
| `cache-lookup` / `cache-store` | Response caching |
| `rewrite-uri` | URL rewriting before forwarding |
| `send-request` | Call external services in-policy |

**Rate limiting example (XML policy):**
```xml
<policies>
  <inbound>
    <base />
    <!-- 1000 calls/minute across all callers -->
    <rate-limit calls="1000" renewal-period="60" />
    <!-- 10 calls/minute per caller IP -->
    <rate-limit-by-key calls="10" renewal-period="60"
      counter-key="@(context.Request.IpAddress)" />
  </inbound>
  <backend><base /></backend>
  <outbound><base /></outbound>
  <on-error><base /></on-error>
</policies>
```

**JWT validation example:**
```xml
<validate-jwt header-name="Authorization" failed-validation-httpcode="401">
  <openid-config url="https://login.microsoftonline.com/{tenant}/.well-known/openid-configuration" />
  <audiences>
    <audience>api://my-api-client-id</audience>
  </audiences>
</validate-jwt>
```

**Import App Service as an API:**
```bash
# Via CLI
az apim api import --resource-group myRG --service-name myAPIM \
  --api-id myapi --path /myapi \
  --specification-format OpenApi --specification-url https://myapp.azurewebsites.net/openapi.json
```

**Best practices:**
- Place APIM in front of all public-facing APIs; backends should not be internet-accessible directly.
- Use Named Values (key vault references) for secrets in policies.
- Use Managed Identity to authenticate APIM to backends and Key Vault.
- Monitor with Application Insights integration (built-in).
- Version APIs (`/v1`, `/v2`) using APIM versioning; avoid breaking clients.

---

## 7. Authentication & Secrets Management

### Microsoft Entra ID (formerly Azure AD)

- Use **OAuth 2.0 / OIDC** flows:
  - Client credentials (M2M / service accounts)
  - Authorization Code + PKCE (user-facing apps)
- Register an **App Registration** per API/service; use **scopes** to define permissions.
- Validate JWTs using APIM policy or middleware (e.g., `azure-identity` + `msal`).

### Managed Identity

The recommended pattern — no credentials in code or config:

```python
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient

credential = DefaultAzureCredential()  # uses MI when running in Azure
client = SecretClient(vault_url="https://myvault.vault.azure.net/", credential=credential)
secret = client.get_secret("db-password")
```

`DefaultAzureCredential` automatically tries: Managed Identity → environment variables → CLI auth → browser — ideal for local dev AND production with zero code changes.

### Azure Key Vault

- Store secrets, certificates, and keys.
- Reference Key Vault secrets in App Service config: `@Microsoft.KeyVault(SecretUri=...)`.
- Audit all access via Key Vault access logs → Log Analytics.

---

## 8. Observability

| Tool | Purpose |
|---|---|
| **Application Insights** | Distributed tracing, request tracking, exceptions, custom metrics for apps |
| **Azure Monitor** | Platform metrics, alerts, dashboards across all Azure resources |
| **Log Analytics** | Centralized log querying (KQL) across all services |
| **Azure Monitor Alerts** | Alert on metrics/log queries; page on-call via action groups |

**Python logging to App Insights:**
```python
from opencensus.ext.azure.log_exporter import AzureLogHandler
import logging

logger = logging.getLogger(__name__)
logger.addHandler(AzureLogHandler(connection_string="InstrumentationKey=..."))
logger.warning("Request failed", extra={"custom_dimensions": {"userId": "u1"}})
```

---

## 9. Quick Decision Guide

| Need | Service |
|---|---|
| Host a REST API | Azure App Service (always-on) or Azure Functions (event-driven) |
| Serverless background jobs | Azure Functions (Consumption plan) |
| Relational data, SQL workloads | Azure SQL Database |
| Global low-latency NoSQL / document store | Azure Cosmos DB (NoSQL API) |
| Async task queue between services | Azure Service Bus (queue) |
| Event broadcast to multiple consumers | Azure Service Bus (topic/subscriptions) or Azure Event Grid |
| API gateway / rate limiting / auth enforcement | Azure API Management |
| Secrets and key management | Azure Key Vault |
| Passwordless auth from app to Azure services | Managed Identity + `DefaultAzureCredential` |

---

## 10. Learning Resources

- [Azure App Service docs](https://learn.microsoft.com/azure/app-service/)
- [Azure Functions docs](https://learn.microsoft.com/azure/azure-functions/)
- [Azure SQL Database docs](https://learn.microsoft.com/azure/azure-sql/database/)
- [Azure Cosmos DB docs](https://learn.microsoft.com/azure/cosmos-db/)
- [Azure Service Bus docs](https://learn.microsoft.com/azure/service-bus-messaging/)
- [Azure API Management docs](https://learn.microsoft.com/azure/api-management/)
- [Azure Key Vault docs](https://learn.microsoft.com/azure/key-vault/)
- [Azure Monitor docs](https://learn.microsoft.com/azure/azure-monitor/)
- [Microsoft Entra ID docs](https://learn.microsoft.com/azure/active-directory/)
