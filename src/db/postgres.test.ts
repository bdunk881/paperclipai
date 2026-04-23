const mockOn = jest.fn();
const mockQuery = jest.fn();
const mockEnd = jest.fn().mockResolvedValue(undefined);
const mockPool = {
  on: mockOn,
  query: mockQuery,
  end: mockEnd,
};
const mockPoolConstructor = jest.fn(() => mockPool);

jest.mock("pg", () => ({
  Pool: mockPoolConstructor,
}));

import { closePostgresPoolForTests, queryPostgres } from "./postgres";

describe("postgres pool", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPersistenceFlag = process.env.WORKFLOW_RUNTIME_PERSISTENCE_ENABLED;
  const originalJestWorkerId = process.env.JEST_WORKER_ID;

  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://autoflow:test@localhost:5432/autoflow";
    process.env.WORKFLOW_RUNTIME_PERSISTENCE_ENABLED = "1";
    delete process.env.JEST_WORKER_ID;
    mockOn.mockClear();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockEnd.mockClear();
    mockPoolConstructor.mockClear();
  });

  afterEach(async () => {
    await closePostgresPoolForTests();
  });

  afterAll(() => {
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.WORKFLOW_RUNTIME_PERSISTENCE_ENABLED = originalPersistenceFlag;
    if (originalJestWorkerId !== undefined) {
      process.env.JEST_WORKER_ID = originalJestWorkerId;
    }
  });

  it("registers an error listener on the shared pool", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await queryPostgres("SELECT 1");

    expect(mockPoolConstructor).toHaveBeenCalledWith({
      connectionString: "postgres://autoflow:test@localhost:5432/autoflow",
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 30000,
    });
    expect(mockOn).toHaveBeenCalledWith("error", expect.any(Function));

    const errorHandler = mockOn.mock.calls.find(([eventName]) => eventName === "error")?.[1] as
      | ((error: Error) => void)
      | undefined;
    expect(errorHandler).toBeDefined();

    errorHandler?.(new Error("connect ECONNREFUSED"));

    expect(errorSpy).toHaveBeenCalledWith("[postgres] Unexpected pool error:", "connect ECONNREFUSED");
    errorSpy.mockRestore();
  });
});
