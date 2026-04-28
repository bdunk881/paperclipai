const mockReaddir = jest.fn();
const mockReadFile = jest.fn();
const mockIsPostgresConfigured = jest.fn();
const mockQueryPostgres = jest.fn();

jest.mock("fs/promises", () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

jest.mock("./postgres", () => ({
  isPostgresConfigured: () => mockIsPostgresConfigured(),
  queryPostgres: (...args: unknown[]) => mockQueryPostgres(...args),
}));

import {
  applySqlMigrations,
  ensureSqlMigrationsApplied,
  resetSqlMigrationStateForTests,
} from "./sqlMigrations";

describe("sql migrations", () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockReadFile.mockReset();
    mockIsPostgresConfigured.mockReset();
    mockQueryPostgres.mockReset();
    resetSqlMigrationStateForTests();
  });

  it("applies SQL files in lexical order and ignores non-SQL entries", async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const log = jest.fn();

    mockReaddir.mockResolvedValue([
      { name: "010_ticket_sla_notifications.sql", isFile: () => true },
      { name: "002_workflow_runtime_persistence.sql", isFile: () => true },
      { name: "README.md", isFile: () => true },
      { name: "nested", isFile: () => false },
    ]);
    mockReadFile.mockImplementation(async (filePath: string) => `-- ${filePath}`);

    await expect(
      applySqlMigrations({
        migrationsDir: "/tmp/migrations",
        execute,
        log,
      })
    ).resolves.toBe(2);

    expect(mockReadFile.mock.calls.map(([filePath]) => filePath)).toEqual([
      "/tmp/migrations/002_workflow_runtime_persistence.sql",
      "/tmp/migrations/010_ticket_sla_notifications.sql",
    ]);
    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      "-- /tmp/migrations/002_workflow_runtime_persistence.sql",
      "-- /tmp/migrations/010_ticket_sla_notifications.sql",
    ]);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      "[postgres] Applying migration 002_workflow_runtime_persistence.sql",
      "[postgres] Applying migration 010_ticket_sla_notifications.sql",
    ]);
  });

  it("runs migrations only once per process when postgres is configured", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockResolvedValue({ rows: [], rowCount: 0 });

    mockReaddir.mockResolvedValue([{ name: "001_autoflow_schema.sql", isFile: () => true }]);
    mockReadFile.mockResolvedValue("SELECT 1;");

    await expect(ensureSqlMigrationsApplied()).resolves.toBe(1);
    await expect(ensureSqlMigrationsApplied()).resolves.toBe(1);

    expect(mockReaddir).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(mockQueryPostgres).toHaveBeenCalledTimes(1);
  });
});
