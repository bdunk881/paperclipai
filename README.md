# AutoFlow

**Hire AI. Deploy Fast. Earn More.**

AutoFlow is an open-source AI workflow automation platform. Spin up autonomous AI businesses in minutes — complete with agents, workflow templates, and revenue infrastructure.

> **Live demo:** [autoflow.app/demo](https://autoflow.app/demo)
> **Docs:** [docs.autoflow.app](https://docs.autoflow.app)
> **Product Hunt:** [producthunt.com/posts/autoflow](https://www.producthunt.com/posts/autoflow)

---

## What is AutoFlow?

AutoFlow gives you a library of pre-built AI workflow templates that you can deploy, configure, and run against your own data. Each template is a multi-step workflow with trigger, LLM, transform, and action steps that chain together into an autonomous pipeline.

**Built-in templates:**

| Template | Category | What it does |
|---|---|---|
| Lead Enrichment | Sales | Enriches incoming leads, scores them 0–100 with AI, routes hot leads to your CRM |
| Content Generator | Content | Takes a brief, generates an AI draft, applies brand voice + SEO meta, pushes to publish queue |
| Customer Support Bot | Support | Classifies inbound tickets, generates AI replies, escalates edge cases to humans |

---

## Quick Start

### Prerequisites

- Node.js 18+
- Docker (optional, for containerized deployment)

### Run locally

```bash
# Clone the repo
git clone https://github.com/autoflow-hq/autoflow.git
cd autoflow

# Install dependencies
npm install

# Start the API server (port 3000)
npm run dev
```

### Verify it works

```bash
# Health check
curl http://localhost:3000/health

# List templates
curl http://localhost:3000/api/templates

# Run a workflow
curl -X POST http://localhost:3000/api/runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "tpl-lead-enrich",
    "input": {
      "name": "Jane Smith",
      "email": "jane@acme.com",
      "company": "Acme Corp"
    },
    "config": {
      "crmIntegration": "hubspot",
      "idealCustomerProfile": "Series A SaaS, 50-200 employees"
    }
  }'
```

### Run via Docker

```bash
docker compose up
```

The API is available at `http://localhost:8000`.

---

## API Reference

Full API docs at [docs.autoflow.app/api-reference](https://docs.autoflow.app/api-reference).

### Core endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check + run stats |
| `GET` | `/api/templates` | List all workflow templates |
| `GET` | `/api/templates/:id` | Get a single template definition |
| `GET` | `/api/templates/:id/sample` | Get sample input/output for a template |
| `POST` | `/api/runs` | Start a new workflow run |
| `GET` | `/api/runs` | List all runs |
| `GET` | `/api/runs/:id` | Get a specific run + logs |
| `POST` | `/api/webhooks/:templateId` | Trigger a workflow from a webhook |

---

## Project Structure

```
autoflow/
├── src/                  # Backend API (Node.js + Express)
│   ├── app.ts            # Express app (routes)
│   ├── index.ts          # Server entry point
│   ├── engine/           # Workflow execution engine
│   │   ├── WorkflowEngine.ts
│   │   ├── queue.ts
│   │   ├── runStore.ts
│   │   └── stepHandlers.ts
│   ├── templates/        # Built-in workflow templates
│   │   ├── lead-enrichment.ts
│   │   ├── content-generator.ts
│   │   └── customer-support-bot.ts
│   └── types/            # TypeScript types
│       └── workflow.ts
├── dashboard/            # React dashboard UI
├── landing/              # Marketing site (Next.js)
├── docs/                 # Documentation site (Next.js)
├── docker/               # Dockerfiles
├── infra/                # Deployment config (Hetzner + Coolify)
└── docker-compose.yml
```

---

## Deployment

AutoFlow is deployed on [Hetzner](https://www.hetzner.com/) via [Coolify](https://coolify.io/) (self-hosted PaaS). See [`infra/README.md`](infra/README.md) for full setup instructions.

### CI/CD

Push to `main` → GitHub Actions builds Docker images → pushes to GHCR → Coolify redeploys.

---

## Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feat/my-feature`
3. Make your changes and add tests
4. Run `npm test` to verify everything passes
5. Open a PR

### Running tests

```bash
npm test              # All tests
npm run test:engine   # Workflow engine
npm run test:api      # API endpoints
npm run test:templates # Template definitions
npm run test:coverage  # Coverage report (80% threshold)
```

---

## License

MIT — see [LICENSE](LICENSE).

---

## Links

- **Website:** [autoflow.app](https://autoflow.app)
- **Demo:** [autoflow.app/demo](https://autoflow.app/demo)
- **Docs:** [docs.autoflow.app](https://docs.autoflow.app)
- **Issues:** [github.com/autoflow-hq/autoflow/issues](https://github.com/autoflow-hq/autoflow/issues)
