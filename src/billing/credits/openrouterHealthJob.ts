/**
 * OpenRouter health watchdog — compat shim (HEL-601).
 *
 * The implementation moved to `sourceHealthJob.ts`, which generalizes the
 * watchdog into a factory (`runSourceHealthCheck`) and adds the direct-provider
 * funding checks (`runAnthropicHealthCheck` / `runOpenAIHealthCheck`). This
 * module re-exports the OpenRouter wrapper unchanged so existing imports keep
 * working — `index.ts` (startup), `adminConsole/infra/computeMutationRoutes.ts`
 * (manual trigger), and `openrouterHealthJob.test.ts`.
 */
export {
  runOpenrouterHealthCheck,
  startOpenrouterHealthJob,
  readOpenRouterBalance,
  type HealthCheckResult,
  type OpenRouterCreditsResponse,
} from "./sourceHealthJob";
