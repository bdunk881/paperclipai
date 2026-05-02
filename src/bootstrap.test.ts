const mockCheckPostgresConnection = jest.fn();
const mockIsPostgresConfigured = jest.fn();
const mockEnsureSqlMigrationsApplied = jest.fn();
const mockEnsureKnowledgeSchema = jest.fn();
const mockLoadSecretsFromKeyVault = jest.fn();

jest.mock("./db/postgres", () => ({
  checkPostgresConnection: () => mockCheckPostgresConnection(),
  isPostgresConfigured: () => mockIsPostgresConfigured(),
}));

jest.mock("./db/sqlMigrations", () => ({
  ensureSqlMigrationsApplied: () => mockEnsureSqlMigrationsApplied(),
}));

jest.mock("./knowledge/knowledgeStore", () => ({
  ensureKnowledgeSchema: () => mockEnsureKnowledgeSchema(),
}));

jest.mock("./secrets/keyVaultSecrets", () => ({
  loadSecretsFromKeyVault: () => mockLoadSecretsFromKeyVault(),
}));

import { initializePersistence } from "./bootstrap";

describe("initializePersistence", () => {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    mockCheckPostgresConnection.mockReset();
    mockIsPostgresConfigured.mockReset();
    mockEnsureSqlMigrationsApplied.mockReset();
    mockEnsureKnowledgeSchema.mockReset();
    mockLoadSecretsFromKeyVault.mockReset();
    logger.log.mockReset();
    logger.warn.mockReset();
    logger.error.mockReset();
  });

  it("skips initialization when postgres is not configured", async () => {
    mockIsPostgresConfigured.mockReturnValue(false);

    await initializePersistence(logger);

    expect(mockLoadSecretsFromKeyVault).toHaveBeenCalledTimes(1);
    expect(mockCheckPostgresConnection).not.toHaveBeenCalled();
    expect(mockEnsureSqlMigrationsApplied).not.toHaveBeenCalled();
  });

  it("warns and returns when postgres is unreachable", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    mockCheckPostgresConnection.mockResolvedValue(false);

    await initializePersistence(logger);

    expect(mockLoadSecretsFromKeyVault).toHaveBeenCalledTimes(1);
    expect(mockEnsureSqlMigrationsApplied).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "[postgres] Database unreachable — knowledge routes will return empty results"
    );
  });

  it("applies migrations before initializing knowledge schema", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    mockCheckPostgresConnection.mockResolvedValue(true);
    mockEnsureSqlMigrationsApplied.mockResolvedValue(12);
    mockEnsureKnowledgeSchema.mockResolvedValue(undefined);

    await initializePersistence(logger);

    expect(logger.log).toHaveBeenNthCalledWith(1, "[postgres] Connection verified");
    expect(mockEnsureSqlMigrationsApplied).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenNthCalledWith(2, "[postgres] Applied 12 SQL migration files");
    expect(mockEnsureKnowledgeSchema).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenNthCalledWith(3, "[knowledge] Schema initialized");
  });

  it("loads Key Vault secrets before checking postgres availability", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    mockCheckPostgresConnection.mockResolvedValue(false);

    await initializePersistence(logger);

    expect(mockLoadSecretsFromKeyVault.mock.invocationCallOrder[0]).toBeLessThan(
      mockCheckPostgresConnection.mock.invocationCallOrder[0]
    );
  });

  it("surfaces migration failures", async () => {
    const error = new Error("ENOENT: missing migrations directory");
    mockIsPostgresConfigured.mockReturnValue(true);
    mockCheckPostgresConnection.mockResolvedValue(true);
    mockEnsureSqlMigrationsApplied.mockRejectedValue(error);

    await expect(initializePersistence(logger)).rejects.toThrow(error);
    expect(mockEnsureKnowledgeSchema).not.toHaveBeenCalled();
  });

  it("logs knowledge schema failures without failing startup", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    mockCheckPostgresConnection.mockResolvedValue(true);
    mockEnsureSqlMigrationsApplied.mockResolvedValue(2);
    mockEnsureKnowledgeSchema.mockRejectedValue(new Error("schema failure"));

    await initializePersistence(logger);

    expect(logger.error).toHaveBeenCalledWith("[knowledge] Schema init failed:", "schema failure");
  });
});
