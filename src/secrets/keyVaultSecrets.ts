import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

const KV_URI = process.env.AZURE_KEY_VAULT_URI;

type SecretNames =
  | "stripe-secret-key"
  | "stripe-webhook-secret"
  | "stripe-flow-price-id"
  | "stripe-automate-price-id"
  | "stripe-scale-price-id"
  | "llm-config-encryption-key"
  | "database-url"
  | "redis-url"
  | "entra-client-secret";

const SECRET_MAP: Record<SecretNames, string> = {
  "stripe-secret-key": "STRIPE_SECRET_KEY",
  "stripe-webhook-secret": "STRIPE_WEBHOOK_SECRET",
  "stripe-flow-price-id": "STRIPE_FLOW_PRICE_ID",
  "stripe-automate-price-id": "STRIPE_AUTOMATE_PRICE_ID",
  "stripe-scale-price-id": "STRIPE_SCALE_PRICE_ID",
  "llm-config-encryption-key": "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY",
  "database-url": "DATABASE_URL",
  "redis-url": "REDIS_URL",
  "entra-client-secret": "AZURE_CIAM_CLIENT_SECRET",
};

let secretsLoaded = false;

export async function loadSecretsFromKeyVault(): Promise<void> {
  if (secretsLoaded) return;

  if (!KV_URI) {
    console.log("[keyvault] AZURE_KEY_VAULT_URI not set — skipping Key Vault load (dev mode)");
    secretsLoaded = true;
    return;
  }

  try {
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(KV_URI, credential);

    const secrets = Object.keys(SECRET_MAP) as SecretNames[];

    for (const secretName of secrets) {
      try {
        const secret = await client.getSecret(secretName);
        if (secret.value) {
          process.env[SECRET_MAP[secretName]] = secret.value;
        }
      } catch (err) {
        console.warn(`[keyvault] Failed to load secret "${secretName}": ${(err as Error).message}`);
      }
    }

    console.log(`[keyvault] Loaded ${Object.keys(SECRET_MAP).length} secrets from ${KV_URI}`);
    secretsLoaded = true;
  } catch (err) {
    console.error(`[keyvault] Fatal: cannot reach Key Vault at ${KV_URI}: ${(err as Error).message}`);
    console.error("[keyvault] Set AZURE_KEY_VAULT_URI or remove it to skip KV in dev mode");
    process.exit(1);
  }
}
