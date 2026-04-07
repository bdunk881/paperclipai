const _accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
if (!_accountName) {
  throw new Error(
    "AZURE_STORAGE_ACCOUNT_NAME environment variable is required but not set"
  );
}

export const STORAGE_ACCOUNT_NAME = _accountName;

export const STORAGE_ACCOUNT_URL = `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`;

export const CONTAINERS = {
  contentPipeline: "content-pipeline",
  mediaAssets: "media-assets",
  exports: "exports",
  backups: "backups",
} as const;

export type ContainerName = (typeof CONTAINERS)[keyof typeof CONTAINERS];
