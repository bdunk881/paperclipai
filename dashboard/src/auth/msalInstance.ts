import { AuthenticationResult, PublicClientApplication } from "@azure/msal-browser";
import { msalConfig } from "./msalConfig";

export const msalInstance = new PublicClientApplication(msalConfig);

let initializePromise: Promise<PublicClientApplication> | null = null;

export function initializeMsalInstance(): Promise<PublicClientApplication> {
  if (!initializePromise) {
    initializePromise = msalInstance.initialize().then(async () => {
      const redirectResult = (await msalInstance.handleRedirectPromise().catch((error) => {
        console.warn("[MSAL] Failed to process redirect result:", error);
        return null;
      })) as AuthenticationResult | null;

      if (redirectResult?.account) {
        msalInstance.setActiveAccount(redirectResult.account);
        return msalInstance;
      }

      const activeAccount = msalInstance.getActiveAccount();
      if (!activeAccount) {
        const [firstAccount] = msalInstance.getAllAccounts();
        if (firstAccount) {
          msalInstance.setActiveAccount(firstAccount);
        }
      }
      return msalInstance;
    });
  }

  return initializePromise;
}
