import { loadSecretsFromKeyVault } from "./secrets/keyVaultSecrets";
import app from "./app";
import { WORKFLOW_TEMPLATES } from "./templates";

const PORT = process.env.PORT || 3000;

async function start() {
  // Load secrets from Azure Key Vault before the server accepts traffic.
  // In production this replaces all env-var secrets with vault-resolved values.
  // Crashes fast if Key Vault is configured but unreachable.
  await loadSecretsFromKeyVault();

  app.listen(PORT, () => {
    console.log(`AutoFlow API running on port ${PORT}`);
    console.log(`Loaded ${WORKFLOW_TEMPLATES.length} workflow templates`);
  });
}

start().catch((err) => {
  console.error("[startup] Fatal error:", err);
  process.exit(1);
});
