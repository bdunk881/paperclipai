import {
  BlobServiceClient,
  ContainerClient,
  BlockBlobClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
  SASProtocol,
} from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { STORAGE_ACCOUNT_URL, type ContainerName } from "./config";
import { wrapStorageError } from "./errors";

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface ListBlobsOptions {
  prefix?: string;
  maxResults?: number;
}

export interface BlobItem {
  name: string;
  contentLength: number;
  contentType: string;
  lastModified: Date;
  metadata?: Record<string, string>;
}

export class AzureBlobClient {
  private serviceClient: BlobServiceClient;

  constructor(serviceClient?: BlobServiceClient) {
    this.serviceClient =
      serviceClient ??
      new BlobServiceClient(STORAGE_ACCOUNT_URL, new DefaultAzureCredential());
  }

  private container(name: ContainerName): ContainerClient {
    return this.serviceClient.getContainerClient(name);
  }

  private blob(container: ContainerName, blobPath: string): BlockBlobClient {
    return this.container(container).getBlockBlobClient(blobPath);
  }

  async upload(
    container: ContainerName,
    blobPath: string,
    data: Buffer | string,
    options: UploadOptions = {}
  ): Promise<void> {
    const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
    try {
      await this.blob(container, blobPath).uploadData(buf, {
        blobHTTPHeaders: {
          blobContentType: options.contentType || "application/octet-stream",
        },
        metadata: options.metadata,
      });
    } catch (err) {
      wrapStorageError(err, container, blobPath);
    }
  }

  async download(container: ContainerName, blobPath: string): Promise<Buffer> {
    try {
      const response = await this.blob(container, blobPath).downloadToBuffer();
      return response;
    } catch (err) {
      wrapStorageError(err, container, blobPath);
    }
  }

  async downloadAsString(
    container: ContainerName,
    blobPath: string
  ): Promise<string> {
    const buf = await this.download(container, blobPath);
    return buf.toString("utf-8");
  }

  async list(
    container: ContainerName,
    options: ListBlobsOptions = {}
  ): Promise<BlobItem[]> {
    try {
      const items: BlobItem[] = [];
      const iter = this.container(container).listBlobsFlat({
        prefix: options.prefix,
      });

      for await (const blob of iter) {
        items.push({
          name: blob.name,
          contentLength: blob.properties.contentLength || 0,
          contentType: blob.properties.contentType || "application/octet-stream",
          lastModified: blob.properties.lastModified || new Date(0),
          metadata: blob.metadata,
        });
        if (options.maxResults && items.length >= options.maxResults) break;
      }

      return items;
    } catch (err) {
      wrapStorageError(err, container);
    }
  }

  async delete(container: ContainerName, blobPath: string): Promise<void> {
    try {
      await this.blob(container, blobPath).deleteIfExists();
    } catch (err) {
      wrapStorageError(err, container, blobPath);
    }
  }

  async exists(container: ContainerName, blobPath: string): Promise<boolean> {
    try {
      return await this.blob(container, blobPath).exists();
    } catch (err) {
      wrapStorageError(err, container, blobPath);
    }
  }

  async generateSasUrl(
    container: ContainerName,
    blobPath: string,
    expiresInMinutes = 60,
    permissions: "r" | "rw" = "r"
  ): Promise<string> {
    const blobClient = this.blob(container, blobPath);

    const userDelegationKey = await this.serviceClient.getUserDelegationKey(
      new Date(),
      new Date(Date.now() + expiresInMinutes * 60 * 1000)
    );

    const sasPermissions = new BlobSASPermissions();
    sasPermissions.read = true;
    if (permissions === "rw") sasPermissions.write = true;

    const sasToken = generateBlobSASQueryParameters(
      {
        containerName: container,
        blobName: blobPath,
        permissions: sasPermissions,
        startsOn: new Date(),
        expiresOn: new Date(Date.now() + expiresInMinutes * 60 * 1000),
        protocol: SASProtocol.Https,
      },
      userDelegationKey,
      this.serviceClient.accountName
    ).toString();

    return `${blobClient.url}?${sasToken}`;
  }
}
