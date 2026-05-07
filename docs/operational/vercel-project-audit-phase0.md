# Phase 0: Vercel Project Audit

> Phase 0 deliverable for [ALT-2302](/ALT/issues/ALT-2302). Prepared for [ALT-2306](/ALT/issues/ALT-2306) on 2026-05-04.

## Scope

Audit the Vercel team `brad-duncans-projects` and identify which projects are real migration candidates versus cleanup/cancel candidates before the Cloudflare Pages migration work.

## Snapshot

- Audit date: 2026-05-04
- Vercel scope: `brad-duncans-projects`
- Project count found: 7
- Clearly active AutoFlow surfaces: `autoflow-landing`, `dashboard`
- Clear cancel candidates: `paperclip-alt1646`, `alt1634-master`
- Non-AutoFlow or unclear ownership projects to review separately: `v0-minivibesonly`, `abovethewild-jjt9`, `abovethewild`

## Audit Table

| Project | Project ID | Domain(s) | Last 30d build minutes | In use status | Framework | Migration target | Last production deploy | Notes |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| `autoflow-landing` | `prj_4E4xutXatU8zclIbhAva1n0nLAD8` | `helloautoflow.com`; `www.helloautoflow.com -> helloautoflow.com`; `staging.helloautoflow.com`; `autoflow-landing-psi.vercel.app` | 776.00 | Active | Next.js | `autoflow-landing` (Cloudflare Pages, proposed) | 2026-05-04 21:58 UTC (`staging`, `READY`) | Core AutoFlow landing surface. Heavy deploy volume and live custom domains make this a keep-and-migrate project. |
| `dashboard` | `prj_Ib88Fvyw0cn2AlNgGiSUa5DMWtuM` | `app.helloautoflow.com`; `staging.app.helloautoflow.com`; `dashboard-beta-one-42.vercel.app` | 972.41 | Active | Vite | `dashboard` (Cloudflare Pages, proposed) | 2026-05-03 21:11 UTC (`master`, `READY`) | Primary AutoFlow app surface. Function invocation and observability usage confirm live traffic. |
| `paperclip-alt1646` | `prj_Fq5CtAEoeT4BQu7p0UClGqHbwg69` | `paperclip-alt1646.vercel.app` | 0.08 | Inactive | Services | None; cancel candidate | 2026-04-23 02:51 UTC (`ERROR`) | Single failed deployment, no custom domains, no sign of live traffic. |
| `alt1634-master` | `prj_AO3saZVvtjyuLXtdAl80O9Pnt1lY` | `alt1634-master.vercel.app` | 0.14 | Inactive | Services | None; cancel candidate | 2026-04-22 22:55 UTC (`ERROR`) | Error-only sandbox with default Vercel hostname only. |
| `v0-minivibesonly` | `prj_I7NFmm0asAXGe0Q2Ixnl2GaO6cuN` | `minivibesonly.com -> www.minivibesonly.com`; `www.minivibesonly.com`; `v0-minivibesonly.vercel.app` | 0.74 | Active, but non-AutoFlow | Next.js | None in AutoFlow migration plan | 2026-04-30 22:49 UTC (`main`, `READY`) | Real custom-domain site, but repo and domain indicate unrelated product. Do not fold into AutoFlow Pages work without owner confirmation. |
| `abovethewild-jjt9` | `prj_U58MlssTMZT1dhzh9bqiybGCbfFy` | `abovethewild-jjt9.vercel.app` | 0.50 | Low/unknown | Other | None in AutoFlow migration plan | 2026-04-30 22:49 UTC (`main`, `READY`) | Default Vercel hostname only. Recent deploys exist, but there is no clear AutoFlow domain or migration destination. |
| `abovethewild` | `prj_xgiiEGAkCR5l8gBTbOFaNL18uC8o` | `abovethewild.vercel.app` | 0.04 | Low/unknown | Other | None in AutoFlow migration plan | 2026-04-30 22:34 UTC (`main`, `READY`) | Default Vercel hostname only with minimal recent activity. Needs owner check before cancel/migrate decisions. |

## Initial Recommendation

| Bucket | Projects | Action |
| --- | --- | --- |
| Migrate to Cloudflare Pages | `autoflow-landing`, `dashboard` | Create matching Pages projects first, then move DNS, deploy hooks, and branch build settings in later phases. |
| Cancel after confirmation | `paperclip-alt1646`, `alt1634-master` | Safe first-pass cleanup candidates once no dependent work remains. |
| Hold for ownership review | `v0-minivibesonly`, `abovethewild-jjt9`, `abovethewild` | Treat as out-of-scope until product ownership and retention intent are confirmed. |

## Method

- Project inventory: `vercel project ls --token "$Vercel_API_KEY" --scope brad-duncans-projects --json`
- Project metadata: `vercel project inspect` plus `GET /v10/projects/{name}`
- Domains: `GET /v9/projects/{name}/domains`
- Recent deployment status: `GET /v6/deployments?projectId={name}&since=...`
- Build-minute figure in the table:
  - Calculated as the sum of `(ready - buildingAt)` across deployments seen in the last 30 days for each project.
  - This is an audit-friendly runtime approximation of build consumption.
  - Vercel CLI `usage --group-by project` only exposed cost-weighted usage rows such as `Build Minutes` and `Build CPU Minutes`, not raw minute counts, so the table uses deployment timings rather than billing dollars.
- In-use status:
  - Marked `Active` when the project had live custom domains and recent production-ready deployments or traffic-related usage signals.
  - Marked `Inactive` when the project only had failed/default-hostname deployments with no traffic signal.
  - Marked `Low/unknown` when recent deploys existed but ownership or live traffic could not be established from Vercel alone.
