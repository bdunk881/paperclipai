/**
 * Azure Key Vault secrets loader.
 *
 * Loads secrets from Key Vault at startup using DefaultAzureCredential
 * (works with managed identity in Container Apps / App Service, and with
 * az CLI / env credential locally for developer machines).
 *
 * Resolved secrets are written into process.env so the rest of the codebase
 * continues to read process.env.<NAME> without any changes.
 *
 * Required env var (config, not secret):
 *   AZURE_KEY_VAULT_URI  — e.g. "https://myapp-kv.vault.azure.net"
 *
 * Secrets stored in Key Vault and their corresponding env var names:
 *   stripe-secret-key          → STRIPE_SECRET_KEY
 *   stripe-webhook-secret      → STRIPE_WEBHOOK_SECRET
 *   stripe-flow-price-id       → STRIPE_FLOW_PRICE_ID
 *   stripe-automate-price-id   → STRIPE_AUTOMATE_PRICE_ID
 *   stripe-scale-price-id      → STRIPE_SCALE_PRICE_ID
 *   llm-config-encryption-key  → LLM_CONFIG_ENCRYPTION_KEY
 *   database-url               → DATABASE_URL
 *   redis-url                  → REDIS_URL
 *   entra-client-secret        → AZURE_CLIENT_SECRET
 */

import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";

/** Map of Key Vault secret name → process.env key */
const SECRET_MAP: Record<string, string> = {
  "stripe-secret-key": "STRIPE_SECRET_KEY",
  "stripe-webhook-secret": "STRIPE_WEBHOOK_SECRET",
  "stripe-flow-price-id": "STRIPE_FLOW_PRICE_ID",
  "stripe-automate-price-id": "STRIPE_AUTOMATE_PRICE_ID",
  "stripe-scale-price-id": "STRIPE_SCALE_PRICE_ID",
  "llm-config-encryption-key": "LLM_CONFIG_ENCRYPTION_KEY",
  "database-url": "DATABASE_URL",
  "redis-url": "REDIS_URL",
  "entra-client-secret": "AZURE_CLIENT_SECRET",
};

let _client: SecretClient | null = null;

function getClient(vaultUri: string): SecretClient {
  if (!_client) {
    _client = new SecretClient(vaultUri, new DefaultAzureCredential());
  }
  return _client;
}

/**
 * Load all secrets from Azure Key Vault and inject them into process.env.
 *
 * In development (AZURE_KEY_VAULT_URI not set), this is a no-op and the
 * process relies on locally set environment variables. A warning is emitted
 * so it is visible in dev logs.
 *
 * In production (AZURE_KEY_VAULT_URI is set), all secrets are fetched in
 * parallel. If any secret is missing from the vault it is skipped with a
 * warning (allows gradual migration). If Key Vault itself is unreachable,
 * the error is re-thrown so the process crashes fast at startup.
 */
export async function loadSecretsFromKeyVault(): Promise<void> {
  const vaultUri = process.env.AZURE_KEY_VAULT_URI;

  if (!vaultUri) {
    console.warn(
      "[secrets] AZURE_KEY_VAULT_URI not set — skipping Key Vault. " +
        "Using environment variables directly (development mode only)."
    );
    return;
  }

  console.log(`[secrets] Loading secrets from Key Vault: ${vaultUri}`);

  const client = getClient(vaultUri);

  // Health check — fail fast if Key Vault is unreachable before attempting
  // to load individual secrets.
  await checkKeyVaultHealth(client, vaultUri);

  const entries = Object.entries(SECRET_MAP);
  const results = await Promise.allSettled(
    entries.map(async ([kvName, envName]) => {
      const secret = await client.getSecret(kvName);
      if (secret.value == null) {
        console.warn(`[secrets] Key Vault secret "${kvName}" exists but has no value — skipping`);
        return;
      }
      process.env[envName] = secret.value;
      console.log(`[secrets] Loaded "${kvName}" → ${envName}`);
    })
  );

  let loadedCount = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const [kvName] = entries[i];
    if (result.status === "fulfilled") {
      loadedCount++;
    } else {
      const err = result.reason as { code?: string; statusCode?: number };
      if (err.statusCode === 404 || err.code === "SecretNotFound") {
        console.warn(`[secrets] Secret "${kvName}" not found in Key Vault — skipping`);
      } else {
        // Re-throw unexpected errors (auth failure, network, etc.)
        throw result.reason;
      }
    }
  }

  console.log(`[secrets] Key Vault load complete — ${loadedCount}/${entries.length} secrets loaded`);
}

/**
 * Verify Key Vault is reachable by attempting a getProperties call on the
 * client. Throws with a clear message if unreachable so the process crashes
 * at startup rather than silently degrading later.
 */
async function checkKeyVaultHealth(
  client: SecretClient,
  vaultUri: string
): Promise<void> {
  try {
    // Listing one secret name is a cheap way to verify connectivity and auth.
    // We don't care about the result — just that the call succeeds.
    const iter = client.listPropertiesOfSecrets();
    await iter.next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[secrets] Key Vault health check failed — cannot reach ${vaultUri}. ` +
        `Ensure the managed identity has "Key Vault Secrets User" role and the vault URI is correct. ` +
        `Original error: ${message}`
    );
  }
}
