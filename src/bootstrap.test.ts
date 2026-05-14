const mockCheckPostgresConnection = jest.fn();
const mockIsPostgresConfigured = jest.fn();
const mockEnsureSqlMigrationsApplied = jest.fn();
const mockEnsureKnowledgeSchema = jest.fn();

jest.mock("./db/postgres", () => ({
  checkPostgresConnection: () => mockCheckPostgresConnection(),
  getRuntimeEnvironment: (env: NodeJS.ProcessEnv = process.env) =>
    (env.NODE_ENV ?? "development").trim().toLowerCase(),
  inMemoryAllowed: () =>
    ["development", "test"].includes((process.env.NODE_ENV ?? "development").trim().toLowerCase()) &&
    process.env.AUTOFLOW_ALLOW_INMEMORY === "true",
  isPostgresConfigured: () => mockIsPostgresConfigured(),
}));

jest.mock("./db/sqlMigrations", () => ({
  ensureSqlMigrationsApplied: () => mockEnsureSqlMigrationsApplied(),
}));

jest.mock("./knowledge/knowledgeStore", () => ({
  ensureKnowledgeSchema: () => mockEnsureKnowledgeSchema(),
}));

import { PERSISTENCE_REQUIRED_ERROR, initializePersistence, requirePersistence } from "./bootstrap";

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
    logger.log.mockReset();
    logger.warn.mockReset();
    logger.error.mockReset();
  });

  it("skips initialization when postgres is not configured", async () => {
    mockIsPostgresConfigured.mockReturnValue(false);

    await initializePersistence(logger);

    expect(mockCheckPostgresConnection).not.toHaveBeenCalled();
    expect(mockEnsureSqlMigrationsApplied).not.toHaveBeenCalled();
  });

  it("warns and returns when postgres is unreachable in dev/test", async () => {
    // jest.env.cjs sets NODE_ENV=test + AUTOFLOW_ALLOW_INMEMORY=true so this
    // is the default test environment.
    mockIsPostgresConfigured.mockReturnValue(true);
    mockCheckPostgresConnection.mockResolvedValue(false);

    await initializePersistence(logger);

    expect(mockEnsureSqlMigrationsApplied).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "[postgres] Database unreachable — knowledge routes will return empty results"
    );
  });

  it("throws when postgres is unreachable in production (HEL-80 fail-fast)", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      mockIsPostgresConfigured.mockReturnValue(true);
      mockCheckPostgresConnection.mockResolvedValue(false);

      await expect(initializePersistence(logger)).rejects.toThrow(
        /Database is configured but unreachable/,
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/Database is configured but unreachable/),
      );
      expect(mockEnsureSqlMigrationsApplied).not.toHaveBeenCalled();
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
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

describe("requirePersistence", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    mockIsPostgresConfigured.mockReset();
  });

  it("throws a clear error for production boot without DATABASE_URL", () => {
    process.env.NODE_ENV = "production";
    mockIsPostgresConfigured.mockReturnValue(false);

    expect(() => requirePersistence()).toThrow(PERSISTENCE_REQUIRED_ERROR);
  });

  it("allows process-local persistence in development and test", () => {
    mockIsPostgresConfigured.mockReturnValue(false);

    process.env.NODE_ENV = "development";
    expect(() => requirePersistence()).not.toThrow();

    process.env.NODE_ENV = "test";
    expect(() => requirePersistence()).not.toThrow();
  });
});
