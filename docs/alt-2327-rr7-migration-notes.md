# ALT-2327 RR7 migration notes

This heartbeat moves the dashboard routing layer off declarative `<BrowserRouter>/<Routes>` wiring and onto a React Router data router using route objects, loaders, and an action-backed ticket creation flow.

What landed:

- app shell route tree now lives in `dashboard/src/router.tsx`
- `/tickets` hydrates from a route loader and submits create-ticket mutations through a route action
- `/tickets/:ticketId` hydrates from a route loader so direct entry has data-router parity
- existing UI surfaces stay visually unchanged; this is a routing/runtime migration only

What remains for full Phase 4a closure:

- migrate the remaining high-value mutation flows from component-local fetch calls to route actions, starting with `TicketDetail`
- convert the dashboard from Vite SPA hosting to React Router framework SPA mode (`ssr: false`) once the deployment target is aligned
- update hosting config for the framework build output instead of the current Vite `dist` conventions

Deployment handoff notes:

- current dashboard hosting assumes Vite output plus SPA rewrites in `dashboard/vercel.json` and `dashboard/staticwebapp.config.template.json`
- official React Router SPA mode emits a framework client build and still requires all non-asset URLs to resolve to the generated `index.html`
- Cloudflare Pages support needs to be validated against the React Router framework build before the final `ssr: false` cutover
