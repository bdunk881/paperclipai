# Changelog

All notable changes to AutoFlow are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.2.0] - 2026-04-02

### Added

#### Core Platform
- Core agent runtime execution engine with queue and step handlers
- OpenAPI 3.0 spec for AutoFlow runtime API
- Webhook trigger support and retry queue
- Multi-agent parallel execution engine with visual canvas

#### Dashboard & UX
- RunMonitor and RunHistory pages
- Dashboard API client with full real-API integration
- Beta onboarding flow: welcome → template picker → configurator → first run
- Settings sub-pages: Profile, Security, Notifications, API Keys
- LLM Providers settings page
- Wireframe pages for all board-approved features
- Playwright E2E tests for critical dashboard paths

#### Workflow Builder
- WorkflowBuilder UI with all Phase 1 workflow templates
- Step kinds: agent, approval, MCP, file_trigger
- AI debugger integrated into workflow builder
- Natural language workflow generation wired to `/api/workflows/generate` (F3)
- 3 Sprint 1 workflow templates: Lead Enrichment, Content Generator, Social Scheduler
- 3 Sprint 2 workflow templates: Invoice Extractor, Social Scheduler, Meeting Summarizer

#### Features (Sprint 2)
- **BYOLLM** — LLM provider adapter layer; CRUD API with AES-256-GCM encrypted key storage; tiered LLM routing to reduce inference costs
- **MCP** — MCP server registry + `mcp` step backend
- **File triggers** — Multi-modal file upload UI + parsing backend
- **Persistent memory** — Vector store + UI for persistent context memory
- **HITL approvals** — Human-in-the-loop approval inbox UI + backend
- **Billing** — Stripe checkout for F1 flat-fee pricing
- **Authentication** — Microsoft Entra External ID (CIAM) authentication
- **Email automation** — `user_signed_up` event wired to Loops.so on Stripe payment confirmation

#### Infrastructure & DevOps
- Azure Cloud Adoption Framework (CAF) hub-and-spoke network topology
  - Hub VNet: Azure Firewall, Bastion, Key Vault, Private DNS
  - Spoke VNet: NSGs, peering, DNS, flow logs
  - Route tables, UDRs, AKS egress firewall rules
  - CAF management groups + RBAC hierarchy
  - CAF policy module (autoflow-baseline initiative + Defender for Cloud)
- AKS CI/CD pipeline and Kubernetes manifests
- Azure Static Web Apps deployment config and CI/CD workflow
- Azure Defender for Cloud module wired into main stack
- UptimeRobot monitoring setup
- CAF architecture diagrams and hub-and-spoke README

#### Landing & Marketing
- AutoFlow landing page (Next.js 15 + Tailwind + Stripe + Resend)
- Waitlist email capture with Vercel deployment
- Show HN prerequisites: demo page, docs site, polished README
- Domain migrated from `autoflow.app` → `helloautoflow.com`

#### Observability
- Usage events, error tracking, and run analytics (telemetry)
- `/api/analytics/runs` endpoint with JWT auth

### Fixed
- JWT auth enforced on all unauthenticated endpoints; removed trust in `X-User-Id` header
- Rate-limit regression in auth routes
- Stale CORS configuration in production
- Duplicate Log Analytics workspaces consolidated
- Dashboard TypeScript strict-mode type errors
- Test suite: NODE_ENV, E2E exclusion, fetch mocks, JSON parse error handler

### Changed
- Infrastructure migrated from AWS ECS / Terraform → Hetzner + Coolify → Azure AKS (CAF)
- Azure promoted to primary infrastructure track
- Branch coverage pushed above 80% threshold

---

## [0.1.0] - 2026-03-01

### Added
- Initial project scaffold: backend (Node/TypeScript), dashboard (React), landing page
- CI/CD pipeline (initial AWS ECS deployment)
- Core workflow templates (Phase 1)
- Mock mode and Vercel deployment config for wireframe

---

[Unreleased]: https://github.com/yourorg/helloautoflow/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/yourorg/helloautoflow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/yourorg/helloautoflow/releases/tag/v0.1.0
