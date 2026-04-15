/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK: string;
  readonly VITE_API_URL: string;
  readonly VITE_AZURE_CIAM_CLIENT_ID?: string;
  readonly VITE_AZURE_CIAM_TENANT_SUBDOMAIN?: string;
  readonly VITE_AZURE_CIAM_TENANT_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
