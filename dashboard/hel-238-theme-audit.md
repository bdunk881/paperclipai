# HEL-238 theme audit checklist

This audit covers `dashboard/src/` before re-enabling the v2 dashboard light / dark / system toggle. The toggle remains beta-gated until the page QA list stays clean.

## Feature flag

The dashboard applies dark mode only when one of these is true:

- Build-time: `VITE_AF2_THEME_TOGGLE_BETA=true`
- Manual local flag: `localStorage.setItem("autoflow.themeToggleBeta", "true")`, then reload

User preference is stored locally as `autoflow.themeMode` and synced to `/api/user-profile/preferences` as `preferences.themeMode`.

## Token risks found

- [x] Replace the dead `data-af2-theme="dark"` token selector with the shipped `data-theme="dark"` selector.
- [x] Define dark counterparts for every existing `--af2-*` variable.
- [x] Add missing semantic variables used by v2 surfaces:
  - `--af2-border`
  - `--af2-muted`
  - `--af2-paper-soft`
  - `--af2-sage-soft`
  - `--af2-mustard-soft`
  - `--af2-on-*`
- [x] Move af2 Tailwind shadows to token-backed variables so dark mode can change them without `dark:` variants.
- [ ] Watch dual-role `--af2-card`: it is both a surface background and avatar-stack ring. Current dark values keep enough contrast, but page QA should keep checking dense avatar rows.

## Hardcoded color offenders found

### Highest-priority offenders fixed in this PR

- [x] `dashboard/src/af2-components.css`
  - `#fff` / `white` on clay buttons and avatars
  - hardcoded status pill rgba fills and borders
  - hardcoded avatar gradient stops
  - light-only input focus shadow
- [x] `dashboard/src/styles/af2-v2-shell.css`
  - `#fff` on primary / danger / sage buttons and permission sliders
  - black rgba selected-control shadows
  - light-only pro block, modal overlay, modal shadows, and user-menu shadows
  - hardcoded status pill border rgba values
- [x] `dashboard/src/index.css`
  - auth primary button `#fff`, hardcoded active clay, white inset shadow
  - command palette black shadow

### Remaining known offenders to keep checking while the beta flag is on

- [ ] Inline fallback chains such as `var(--af2-card, #fff)` and `var(--af2-paper-2, #fafafa)` remain in older modal components (`HandoffModal`, `JobDescriptionWizardModal`, `OnboardingTour`, `SectionEditor`, `ToastProvider`). These render acceptably with the defined token present, but should be removed during component cleanup.
- [ ] Repeated alert tint rgba values remain across ticket / approval / settings surfaces. They should become shared token classes if those pages show low contrast in dark QA.
- [ ] `WorkflowBuilder.tsx` still has several `bg-white` utility surfaces. It is not part of the primary v2 shell path but should be prioritized if the beta is expanded to workflow editing.
- [ ] `LandingPage.tsx` is intentionally out of scope for HEL-238 because the issue excludes marketing pages.

## Logo.dev variant pass

- [x] Add a `theme="auto" | "light" | "dark"` prop to `CompanyLogo`.
- [x] Thread the resolved active theme through dashboard logo.dev call sites:
  - `components/missions/AgentToolChips.tsx`
  - `pages/Connections.tsx`
  - `pages/ConnectorHealth.tsx`
  - `pages/LLMProviders.tsx`
  - `pages/Login.tsx`
  - `pages/MCPIntegrations.tsx`
  - `pages/Settings.tsx`

## Page QA checklist

Initial dark-mode smoke QA should cover at least:

- [ ] Dashboard
- [ ] Connections
- [ ] Models / LLM providers
- [ ] Connector health
- [ ] MCP integrations
- [ ] Settings
- [ ] Account
- [ ] Billing
- [ ] Approvals
- [ ] Tickets / ticket detail
- [ ] Hiring plan review

Release rule: keep the beta badge and manual flag until this list has no unreadable text, swallowed foregrounds, missing borders, or broken shadows.

