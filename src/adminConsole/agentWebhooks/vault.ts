/**
 * Encryption vault for Ask-an-Agent webhook secrets (HEL infra PR #2).
 *
 * Reuses the platform's KeyVersionedSecretVault — same envelope used for
 * connector credentials — under its own key env var. HMAC secrets and
 * custom-headers JSON both go through this vault so the React app never
 * sees them once written.
 */

import { KeyVersionedSecretVault } from "../../secrets/keyVersionedSecretVault";

export class AgentWebhookSecretVault extends KeyVersionedSecretVault {
  constructor() {
    super({
      currentKeyEnvVars: [
        "ADMIN_AGENT_WEBHOOK_ENCRYPTION_KEY",
        // Fallback so dev/test environments that already have the connector
        // key set don't need another env. Production should set the dedicated
        // key explicitly.
        "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY",
      ],
      previousKeyEnvVars: ["ADMIN_AGENT_WEBHOOK_ENCRYPTION_KEY_PREVIOUS"],
      salts: ["autoflow-agent-webhook-salt"],
      keyLabel: "agent webhook secret",
    });
  }
}

let cached: AgentWebhookSecretVault | null = null;

export function getAgentWebhookVault(): AgentWebhookSecretVault {
  if (!cached) cached = new AgentWebhookSecretVault();
  return cached;
}

export function __resetAgentWebhookVaultForTests(): void {
  cached = null;
}
