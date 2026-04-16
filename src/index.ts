import { loadSecretsFromKeyVault } from "./secrets/keyVaultSecrets";

const PORT = process.env.PORT || 3000;

async function start() {
  // Load secrets from Azure Key Vault BEFORE importing ./app or any module
  // that snapshots env at module-eval time (e.g. billing/stripeClient's
  // PRICING_TIERS, llmConfig/llmConfigStore's ENCRYPTION_KEY). Crashes fast
  // if Key Vault is configured but unreachable.
  await loadSecretsFromKeyVault();

  // Dynamic imports — MUST run after loadSecretsFromKeyVault so that any
  // module-eval-time reads of process.env see vault-injected values.
  const { default: app } = await import("./app");
  const { WORKFLOW_TEMPLATES } = await import("./templates");

  app.listen(PORT, () => {
    console.log(`AutoFlow API running on port ${PORT}`);
    console.log(`Loaded ${WORKFLOW_TEMPLATES.length} workflow templates`);
  });
}

start().catch((err) => {
  console.error("[startup] Fatal error:", err);
  process.exit(1);
});
