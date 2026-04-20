export class BlobStorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "BlobStorageError";
  }
}

export class BlobNotFoundError extends BlobStorageError {
  constructor(container: string, blobPath: string) {
    super(
      `Blob not found: ${container}/${blobPath}`,
      "BLOB_NOT_FOUND",
      404
    );
    this.name = "BlobNotFoundError";
  }
}

export class BlobPermissionError extends BlobStorageError {
  constructor(container: string, operation: string) {
    super(
      `Permission denied: ${operation} on container ${container}`,
      "PERMISSION_DENIED",
      403
    );
    this.name = "BlobPermissionError";
  }
}

export function wrapStorageError(err: unknown, container: string, blobPath?: string): never {
  if (err instanceof BlobStorageError) throw err;

  const restErr = err as { statusCode?: number; code?: string; message?: string };
  const status = restErr.statusCode;
  const code = restErr.code;

  if (status === 404 || code === "BlobNotFound") {
    throw new BlobNotFoundError(container, blobPath || "(unknown)");
  }

  if (status === 403 || code === "AuthorizationPermissionMismatch") {
    throw new BlobPermissionError(container, blobPath ? `access ${blobPath}` : "access container");
  }

  throw new BlobStorageError(
    restErr.message || "Unknown storage error",
    code || "UNKNOWN",
    status
  );
}
