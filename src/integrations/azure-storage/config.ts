export const STORAGE_ACCOUNT_NAME =
  process.env.AZURE_STORAGE_ACCOUNT_NAME || "altitudemediastorage";

export const STORAGE_ACCOUNT_URL = `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`;

export const CONTAINERS = {
  contentPipeline: "content-pipeline",
  mediaAssets: "media-assets",
  exports: "exports",
  backups: "backups",
} as const;

export type ContainerName = (typeof CONTAINERS)[keyof typeof CONTAINERS];
