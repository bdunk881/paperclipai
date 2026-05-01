import { readFileSync } from "fs";
import path from "path";

function expectDropBeforeCreate(sql: string, policyName: string, tableName: string): void {
  const dropStatement = `DROP POLICY IF EXISTS ${policyName} ON ${tableName};`;
  const createStatement = `CREATE POLICY ${policyName}`;
  const dropIndex = sql.indexOf(dropStatement);
  const createIndex = sql.indexOf(createStatement);

  expect(dropIndex).toBeGreaterThanOrEqual(0);
  expect(createIndex).toBeGreaterThan(dropIndex);
}

describe("014_rls_hardening migration", () => {
  it("drops ticket RLS policies before recreating them", () => {
    const migrationPath = path.resolve(__dirname, "..", "..", "migrations", "014_rls_hardening.sql");
    const sql = readFileSync(migrationPath, "utf8");

    expectDropBeforeCreate(sql, "tickets_tenant_isolation", "tickets");
    expectDropBeforeCreate(
      sql,
      "ticket_sla_policies_tenant_isolation",
      "ticket_sla_policies"
    );
    expectDropBeforeCreate(
      sql,
      "ticket_sla_snapshots_tenant_isolation",
      "ticket_sla_snapshots"
    );
  });
});
