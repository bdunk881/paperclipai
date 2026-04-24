/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_URL: string;
  readonly VITE_AZURE_CIAM_CLIENT_ID: string;
  readonly VITE_AZURE_CIAM_AUTHORITY?: string;
  readonly VITE_AZURE_CIAM_KNOWN_AUTHORITIES?: string;
  readonly VITE_AZURE_CIAM_TENANT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
