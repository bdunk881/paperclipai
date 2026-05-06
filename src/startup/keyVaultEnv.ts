import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

type Logger = Pick<typeof console, "log" | "warn">;

interface SecretReader {
  getSecret(name: string): Promise<{ value?: string }>;
}

interface SecretTarget {
  envName: string;
  secretName: string;
}

function splitDelimitedValues(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeEnvName(value: string): string {
  return value.trim().toUpperCase();
}

export function deriveKeyVaultSecretName(envName: string): string {
  return normalizeEnvName(envName).toLowerCase().replace(/_/g, "-");
}

export function resolveKeyVaultSecretTargets(env: NodeJS.ProcessEnv = process.env): SecretTarget[] {
  const explicitMappings = new Map<string, string>();
  for (const entry of splitDelimitedValues(env.KEY_VAULT_SECRET_MAPPINGS)) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new Error(
        `Invalid KEY_VAULT_SECRET_MAPPINGS entry "${entry}". Expected ENV_NAME=secret-name.`
      );
    }

    const envName = normalizeEnvName(entry.slice(0, separatorIndex));
    const secretName = entry.slice(separatorIndex + 1).trim();
    if (!secretName) {
      throw new Error(
        `Invalid KEY_VAULT_SECRET_MAPPINGS entry "${entry}". Secret name cannot be empty.`
      );
    }
    explicitMappings.set(envName, secretName);
  }

  const targets: SecretTarget[] = [];
  const seen = new Set<string>();

  for (const envName of splitDelimitedValues(env.KEY_VAULT_REQUIRED_SECRETS).map(normalizeEnvName)) {
    targets.push({ envName, secretName: explicitMappings.get(envName) ?? deriveKeyVaultSecretName(envName) });
    seen.add(envName);
  }

  for (const [envName, secretName] of explicitMappings.entries()) {
    if (seen.has(envName)) {
      continue;
    }
    targets.push({ envName, secretName });
  }

  return targets;
}

function createSecretClient(vaultUrl: string): SecretReader {
  return new SecretClient(vaultUrl, new DefaultAzureCredential());
}

function hasNonEmptyValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export async function hydrateProcessEnvFromKeyVault(
  logger: Logger = console,
  env: NodeJS.ProcessEnv = process.env,
  createClient: (vaultUrl: string) => SecretReader = createSecretClient
): Promise<boolean> {
  const vaultUrl = env.KEY_VAULT_URL?.trim();
  if (!vaultUrl) {
    return false;
  }

  const targets = resolveKeyVaultSecretTargets(env);
  if (targets.length === 0) {
    logger.warn("[startup/keyvault] KEY_VAULT_URL is set but no secret targets were configured");
    return false;
  }

  const overrideExisting = env.KEY_VAULT_OVERRIDE_EXISTING === "true";
  const pendingTargets = targets.filter(
    ({ envName }) => overrideExisting || !hasNonEmptyValue(env[envName])
  );

  if (pendingTargets.length === 0) {
    logger.log("[startup/keyvault] All configured secret-backed env vars are already present");
    return true;
  }

  const client = createClient(vaultUrl);

  for (const { envName, secretName } of pendingTargets) {
    const secret = await client.getSecret(secretName);
    if (!hasNonEmptyValue(secret.value)) {
      throw new Error(
        `[startup/keyvault] Secret "${secretName}" for env "${envName}" is missing or empty`
      );
    }
    env[envName] = secret.value;
  }

  logger.log(
    `[startup/keyvault] Hydrated ${pendingTargets.length} env vars from ${pendingTargets.length} Key Vault secrets`
  );
  return true;
}
