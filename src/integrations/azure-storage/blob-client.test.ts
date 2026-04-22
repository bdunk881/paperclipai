import { AzureBlobClient } from "./blob-client";
import { BlobNotFoundError, BlobPermissionError } from "./errors";
import { CONTAINERS } from "./config";

const mockUploadData = jest.fn().mockResolvedValue({});
const mockDownloadToBuffer = jest.fn();
const mockDeleteIfExists = jest.fn().mockResolvedValue({});
const mockExists = jest.fn();
const mockListBlobsFlat = jest.fn();
const mockGetUserDelegationKey = jest.fn();

const mockBlockBlobClient = {
  uploadData: mockUploadData,
  downloadToBuffer: mockDownloadToBuffer,
  deleteIfExists: mockDeleteIfExists,
  exists: mockExists,
  url: "https://altitudemediastorage.blob.core.windows.net/content-pipeline/test.txt",
};

const mockContainerClient = {
  getBlockBlobClient: jest.fn().mockReturnValue(mockBlockBlobClient),
  listBlobsFlat: mockListBlobsFlat,
};

const mockServiceClient = {
  getContainerClient: jest.fn().mockReturnValue(mockContainerClient),
  getUserDelegationKey: mockGetUserDelegationKey,
  accountName: "altitudemediastorage",
} as any;

describe("AzureBlobClient", () => {
  let client: AzureBlobClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new AzureBlobClient(mockServiceClient);
  });

  describe("upload", () => {
    it("uploads a string as buffer with default content type", async () => {
      await client.upload(CONTAINERS.contentPipeline, "test.txt", "hello world");

      expect(mockUploadData).toHaveBeenCalledWith(
        Buffer.from("hello world", "utf-8"),
        {
          blobHTTPHeaders: { blobContentType: "application/octet-stream" },
          metadata: undefined,
        }
      );
    });

    it("uploads a buffer with custom content type and metadata", async () => {
      const buf = Buffer.from("data");
      await client.upload(CONTAINERS.mediaAssets, "image.png", buf, {
        contentType: "image/png",
        metadata: { source: "pexels" },
      });

      expect(mockUploadData).toHaveBeenCalledWith(buf, {
        blobHTTPHeaders: { blobContentType: "image/png" },
        metadata: { source: "pexels" },
      });
    });

    it("wraps 403 errors as BlobPermissionError", async () => {
      mockUploadData.mockRejectedValueOnce({ statusCode: 403, code: "AuthorizationPermissionMismatch", message: "forbidden" });

      await expect(
        client.upload(CONTAINERS.contentPipeline, "test.txt", "data")
      ).rejects.toThrow(BlobPermissionError);
    });
  });

  describe("download", () => {
    it("returns buffer from blob", async () => {
      const expected = Buffer.from("file contents");
      mockDownloadToBuffer.mockResolvedValueOnce(expected);

      const result = await client.download(CONTAINERS.exports, "report.csv");
      expect(result).toBe(expected);
    });

    it("wraps 404 errors as BlobNotFoundError", async () => {
      mockDownloadToBuffer.mockRejectedValueOnce({ statusCode: 404, code: "BlobNotFound" });

      await expect(
        client.download(CONTAINERS.exports, "missing.csv")
      ).rejects.toThrow(BlobNotFoundError);
    });
  });

  describe("downloadAsString", () => {
    it("returns string from blob", async () => {
      mockDownloadToBuffer.mockResolvedValueOnce(Buffer.from("text content"));

      const result = await client.downloadAsString(CONTAINERS.contentPipeline, "note.txt");
      expect(result).toBe("text content");
    });
  });

  describe("list", () => {
    it("lists blobs with prefix", async () => {
      const blobs = [
        {
          name: "folder/a.txt",
          properties: { contentLength: 100, contentType: "text/plain", lastModified: new Date("2026-01-01") },
          metadata: {},
        },
        {
          name: "folder/b.txt",
          properties: { contentLength: 200, contentType: "text/plain", lastModified: new Date("2026-01-02") },
          metadata: { tag: "test" },
        },
      ];
      mockListBlobsFlat.mockReturnValueOnce((async function* () {
        for (const b of blobs) yield b;
      })());

      const result = await client.list(CONTAINERS.contentPipeline, { prefix: "folder/" });

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("folder/a.txt");
      expect(result[1].metadata).toEqual({ tag: "test" });
    });

    it("respects maxResults", async () => {
      const blobs = Array.from({ length: 10 }, (_, i) => ({
        name: `file${i}.txt`,
        properties: { contentLength: 10, contentType: "text/plain", lastModified: new Date() },
      }));
      mockListBlobsFlat.mockReturnValueOnce((async function* () {
        for (const b of blobs) yield b;
      })());

      const result = await client.list(CONTAINERS.contentPipeline, { maxResults: 3 });
      expect(result).toHaveLength(3);
    });
  });

  describe("delete", () => {
    it("calls deleteIfExists", async () => {
      await client.delete(CONTAINERS.backups, "old-backup.tar.gz");
      expect(mockDeleteIfExists).toHaveBeenCalled();
    });
  });

  describe("exists", () => {
    it("returns true when blob exists", async () => {
      mockExists.mockResolvedValueOnce(true);
      const result = await client.exists(CONTAINERS.mediaAssets, "logo.png");
      expect(result).toBe(true);
    });

    it("returns false when blob does not exist", async () => {
      mockExists.mockResolvedValueOnce(false);
      const result = await client.exists(CONTAINERS.mediaAssets, "nope.png");
      expect(result).toBe(false);
    });
  });
});
