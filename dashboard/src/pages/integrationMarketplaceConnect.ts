/**
 * Pure helper extracted from IntegrationMarketplace.tsx::handleConnectAction
 * (HEL-57). The original lived inside the React component, which made it
 * hard to unit-test the 7 distinct branches independently.
 *
 * The component still owns the React state setters; this helper takes them
 * (and the side-effects: authorizedFetch, loadStatuses, redirect) as
 * dependencies so a test can drive every branch without rendering the
 * whole component or mocking `window.location.assign` (which JSDOM no
 * longer allows in newer versions).
 */

import type { ProviderKey } from "../integrations/liveConnectorCatalog";

export interface ConnectActionIntegration {
  id: string;
  name: string;
  premium: boolean;
  connected: boolean;
}

export interface LiveConnectorDescriptor {
  supportsOAuth: boolean;
  supportsApiKey: boolean;
}

export interface RunConnectActionDeps {
  authorizedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  loadStatuses: () => Promise<void>;
  providerKeyFor: (id: string) => ProviderKey | null;
  providerCatalog: Record<string, LiveConnectorDescriptor | undefined>;
  redirect: (url: string) => void;
  setBusyIntegrationId: (id: string | null) => void;
  setConnectionError: (message: string | null) => void;
}

export async function runConnectAction(
  integration: ConnectActionIntegration,
  deps: RunConnectActionDeps,
): Promise<void> {
  const providerKey = deps.providerKeyFor(integration.id);
  // Branch 1: premium upsell (not connected) — show paywall, do nothing.
  // Branch 2: integration not in the live-connector catalog — silent no-op.
  if ((integration.premium && !integration.connected) || !providerKey) {
    return;
  }

  const provider = deps.providerCatalog[providerKey];
  deps.setBusyIntegrationId(integration.id);
  deps.setConnectionError(null);

  try {
    // Branch 3: already connected → DELETE + reload.
    if (integration.connected) {
      await deps.authorizedFetch(`/api/integrations/${providerKey}/disconnect`, {
        method: "DELETE",
      });
      await deps.loadStatuses();
      return;
    }

    // Branch 4 + 6: OAuth path. Branch 4 = happy path (redirect URL),
    // branch 6 = missing redirect URL → throws.
    if (provider?.supportsOAuth) {
      const response = await deps.authorizedFetch(
        `/api/integrations/${providerKey}/connect`,
        { method: "POST" },
      );
      const payload = (await response.json()) as { authUrl?: string; redirectUrl?: string };
      const redirectUrl = payload.redirectUrl ?? payload.authUrl;
      if (!redirectUrl) {
        throw new Error(`No OAuth redirect URL returned for ${integration.name}`);
      }
      deps.redirect(redirectUrl);
      return;
    }

    // Branch 5: API-key path → bounce to /integrations to enter the key.
    if (provider?.supportsApiKey) {
      deps.redirect("/integrations");
      return;
    }

    // Branch 7: unsupported flow.
    throw new Error(`${integration.name} does not support a live connection flow yet`);
  } catch (error) {
    deps.setConnectionError(
      error instanceof Error
        ? error.message
        : `Failed to update ${integration.name} connection`,
    );
  } finally {
    deps.setBusyIntegrationId(null);
  }
}
