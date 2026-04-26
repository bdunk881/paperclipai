import { PublicClientApplication } from "@azure/msal-browser";
import { msalConfig } from "./msalConfig";

export const msalInstance = new PublicClientApplication(msalConfig);

let initializePromise: Promise<PublicClientApplication> | null = null;

export function initializeMsalInstance(): Promise<PublicClientApplication> {
  if (!initializePromise) {
    initializePromise = msalInstance.initialize().then(() => {
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
