/**
 * Anthropic credits-mode auth guard (HEL-602).
 *
 * The 2026-06-15 Anthropic billing split routes Agent-SDK calls that
 * authenticate via a Claude *subscription* (Pro/Max/Team OAuth) into a
 * separate, capped $20–$200/mo Agent-SDK credit pool. Calls that
 * authenticate with an API key (`ANTHROPIC_API_KEY`) bill the prepaid
 * balance and are unaffected. Our credits-mode Anthropic traffic MUST
 * bill the prepaid balance, so it MUST use an API key — never a
 * subscription-OAuth token, or it silently lands in the capped pool and
 * can starve all subscription traffic.
 *
 * This module is the single source of truth for that invariant. It is
 * intentionally dependency-free (pure string checks + a constant) so the
 * agent runtime can import it without dragging in the credits/provider
 * graph (`creditsRouter` → `getProvider` eagerly loads every adapter).
 *
 * Two callers enforce it:
 *   - `creditsRouter.callWithCredits` rejects a direct Anthropic key
 *     source provisioned with an OAuth token, before any spend.
 *   - `claudeSdkBackend.buildAnthropicSdkEnv` rejects an OAuth binding and
 *     strips ambient OAuth/bearer env vars so the embedded Claude Code CLI
 *     can't override `ANTHROPIC_API_KEY` with subscription auth.
 */

/**
 * Credential env vars the embedded Claude Code CLI honors *instead of*
 * `ANTHROPIC_API_KEY`. If present in a spawned subprocess env, either
 * would route an Agent-SDK call around our explicit API key:
 *   - `CLAUDE_CODE_OAUTH_TOKEN` — subscription OAuth token (`claude setup-token`)
 *   - `ANTHROPIC_AUTH_TOKEN`    — generic bearer override (sent as `Authorization`)
 * Neither is used anywhere in this codebase, so stripping them before we
 * spawn the SDK is zero-risk and preserves API-key billing.
 */
export const SUBSCRIPTION_AUTH_ENV_VARS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_AUTH_TOKEN",
] as const;

/**
 * True iff `key` looks like an Anthropic subscription-OAuth credential
 * rather than an API key. Anthropic OAuth tokens are prefixed:
 *   - `sk-ant-oat…` — OAuth access token
 *   - `sk-ant-ort…` — OAuth refresh token
 * API keys are `sk-ant-api…`. The check is conservative: only a positive
 * OAuth signature matches, so API keys, OpenRouter keys (`sk-or-…`) and
 * test fakes all pass.
 */
export function isAnthropicSubscriptionOAuthKey(
  key: string | null | undefined,
): boolean {
  if (!key) return false;
  const normalized = key.trim().toLowerCase();
  return (
    normalized.startsWith("sk-ant-oat") || normalized.startsWith("sk-ant-ort")
  );
}

export interface AnthropicCreditsAuthArgs {
  /** Provider the key is being used for. Only `"anthropic"` is guarded. */
  provider: string;
  /** Plaintext credential. */
  apiKey: string | null | undefined;
  /** Human-readable source for the error message (key-source label, etc.). */
  sourceLabel?: string;
}

/**
 * Throws when an Anthropic credential is a subscription-OAuth token, which
 * would mis-bill into the capped Agent-SDK pool from the 2026-06-15
 * billing split (HEL-602). No-op for any non-Anthropic provider, an API
 * key, or an empty/missing key (other layers handle "no credential").
 */
export function assertAnthropicApiKeyForCredits(
  args: AnthropicCreditsAuthArgs,
): void {
  if (args.provider.toLowerCase() !== "anthropic") return;
  if (!isAnthropicSubscriptionOAuthKey(args.apiKey)) return;
  const where = args.sourceLabel ? ` (source: ${args.sourceLabel})` : "";
  throw new Error(
    `[HEL-602] Anthropic credits-mode auth must use an API key `
      + `(ANTHROPIC_API_KEY), not a subscription-OAuth token${where}. A `
      + `subscription-OAuth credential (sk-ant-oat…/sk-ant-ort…) bills the `
      + `capped Agent-SDK pool created by the 2026-06-15 billing split instead `
      + `of our prepaid balance. Provision an Anthropic API key (sk-ant-api…) `
      + `for this source.`,
  );
}
