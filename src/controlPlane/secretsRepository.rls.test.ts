import { randomBytes, randomUUID } from "crypto";
import type { Pool } from "pg";

const PRIMARY_KEY_HEX = randomBytes(32).toString("hex");
const ROTATED_KEY_HEX = randomBytes(32).toString("hex");

describe("secretsRepository RLS integration", () => {
  const originalEnv = { ...process.env };
  const userId = "secrets-rls-user";
  const workspaceA = "44444444-4444-4444-8444-444444444444";
  const workspaceB = "55555555-5555-4555-8555-555555555555";
  const companyA = randomUUID();
  const companyB = randomUUID();
  let canRunIntegration = false;

  async function loadModules() {
    jest.resetModules();
    const postgres = await import("../db/postgres");
    const migrations = await import("../db/sqlMigrations");
    const workspaceContext = await import("../middleware/workspaceContext");
    const secrets = await import("./secretsRepository");
    const encryption = await import("./secretEncryption");
    return { postgres, migrations, workspaceContext, secrets, encryption };
  }

  async function seedCompany(
    pool: Pool,
    withWorkspaceContext: typeof import("../middleware/workspaceContext").withWorkspaceContext,
    workspaceId: string,
    companyId: string,
    label: string
  ): Promise<void> {
    const teamId = randomUUID();
    const provisionedWorkspaceId = randomUUID();
    await withWorkspaceContext(pool, { workspaceId, userId }, async (client) => {
      await client.query(
        `INSERT INTO provisioned_companies (
           id, workspace_id, user_id, name,
           provisioned_workspace_id, provisioned_workspace_name, provisioned_workspace_slug,
           team_id, idempotency_key
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7,
           $8, $9
         )`,
        [
          companyId,
          workspaceId,
          userId,
          label,
          provisionedWorkspaceId,
          `${label} Workspace`,
          label.toLowerCase().replace(/\s+/g, "-"),
          teamId,
          `idempotency-${companyId}`,
        ]
      );
    });
  }

  beforeAll(async () => {
    delete process.env.JEST_WORKER_ID;
    process.env.CONTROL_PLANE_SECRET_KEY = PRIMARY_KEY_HEX;
    delete process.env.CONTROL_PLANE_SECRET_KEYS;
    delete process.env.CONTROL_PLANE_SECRET_KEY_VERSION;

    if (!process.env.DATABASE_URL?.trim()) {
      return;
    }

    const { postgres } = await loadModules();
    canRunIntegration = await postgres.checkPostgresConnection();
  });

  afterAll(() => {
    Object.assign(process.env, originalEnv);
  });

  afterEach(async () => {
    if (!canRunIntegration) {
      return;
    }
    const { postgres } = await loadModules();
    await postgres.queryPostgres(
      "DELETE FROM control_plane_secret_audit WHERE company_id = ANY($1::uuid[])",
      [[companyA, companyB]]
    );
    await postgres.queryPostgres(
      "DELETE FROM provisioned_company_secrets WHERE company_id = ANY($1::uuid[])",
      [[companyA, companyB]]
    );
    await postgres.queryPostgres(
      "DELETE FROM provisioned_companies WHERE id = ANY($1::uuid[])",
      [[companyA, companyB]]
    );
    await postgres.queryPostgres("DELETE FROM workspace_members WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM workspaces WHERE owner_user_id = $1", [userId]);
    await postgres.closePostgresPoolForTests();
  });

  it("isolates secrets between workspaces, audits accesses, and supports key rotation", async () => {
    if (!canRunIntegration) {
      return;
    }

    const { postgres, migrations, workspaceContext, secrets, encryption } = await loadModules();
    await migrations.ensureSqlMigrationsApplied();
    encryption.resetSecretEncryptionForTests();

    await postgres.queryPostgres(
      `INSERT INTO workspaces (id, name, owner_user_id)
       VALUES ($1, $2, $3), ($4, $5, $3)`,
      [workspaceA, "Workspace A", userId, workspaceB, "Workspace B"]
    );
    await seedCompany(postgres.getPostgresPool(), workspaceContext.withWorkspaceContext, workspaceA, companyA, "Company A");
    await seedCompany(postgres.getPostgresPool(), workspaceContext.withWorkspaceContext, workspaceB, companyB, "Company B");

    const ctxA = { workspaceId: workspaceA, userId, actor: userId };
    const ctxB = { workspaceId: workspaceB, userId, actor: userId };

    await secrets.secretsRepository.setSecret(ctxA, companyA, "OPENAI_API_KEY", "sk-tenant-a-1234");
    await secrets.secretsRepository.setSecret(ctxB, companyB, "OPENAI_API_KEY", "sk-tenant-b-9999");

    expect(await secrets.secretsRepository.getSecret(ctxA, companyA, "OPENAI_API_KEY")).toBe(
      "sk-tenant-a-1234"
    );
    expect(await secrets.secretsRepository.getSecret(ctxB, companyB, "OPENAI_API_KEY")).toBe(
      "sk-tenant-b-9999"
    );

    // Cross-tenant read MUST return null because RLS hides company A's row from workspace B context.
    expect(await secrets.secretsRepository.getSecret(ctxB, companyA, "OPENAI_API_KEY")).toBeNull();

    // Verify ciphertext at rest contains no plaintext fragment.
    const pool = postgres.getPostgresPool();
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      const result = await client.query<{
        ciphertext: Buffer;
        iv: Buffer;
        auth_tag: Buffer;
      }>(
        `SELECT ciphertext, iv, auth_tag FROM provisioned_company_secrets
          WHERE company_id = $1 AND key = $2`,
        [companyA, "OPENAI_API_KEY"]
      );
      expect(result.rowCount).toBe(1);
      const { ciphertext, iv, auth_tag } = result.rows[0];
      expect(iv.length).toBe(12);
      expect(auth_tag.length).toBe(16);
      expect(ciphertext.toString("utf8").includes("sk-tenant-a")).toBe(false);
      expect(ciphertext.toString("hex").includes(Buffer.from("sk-tenant-a", "utf8").toString("hex"))).toBe(false);
    });

    // Cross-tenant SELECT through SQL must be hidden by RLS too (defence in depth).
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      const result = await client.query(
        `SELECT id FROM provisioned_company_secrets WHERE company_id = $1`,
        [companyA]
      );
      expect(result.rowCount ?? result.rows.length).toBe(0);
    });

    // Audit log: at least one write + one read recorded for tenant A, scoped to workspace A.
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      const result = await client.query<{ action: string; actor: string; key_version: number }>(
        `SELECT action, actor, key_version FROM control_plane_secret_audit
          WHERE company_id = $1 AND key = $2 ORDER BY at ASC`,
        [companyA, "OPENAI_API_KEY"]
      );
      const actions = result.rows.map((row) => row.action);
      expect(actions).toEqual(expect.arrayContaining(["write", "read"]));
      expect(result.rows.every((row) => row.actor === userId)).toBe(true);
    });

    // Audit log under workspace B context must NOT see workspace A audit rows.
    await workspaceContext.withWorkspaceContext(pool, ctxB, async (client) => {
      const result = await client.query(
        `SELECT id FROM control_plane_secret_audit WHERE company_id = $1`,
        [companyA]
      );
      expect(result.rowCount ?? result.rows.length).toBe(0);
    });

    // Audit log is append-only: UPDATE and DELETE are denied even within the owning tenant.
    await expect(
      workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
        await client.query(
          `UPDATE control_plane_secret_audit SET actor = 'tampered' WHERE company_id = $1`,
          [companyA]
        );
      })
    ).rejects.toThrow();

    await expect(
      workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
        await client.query(
          `DELETE FROM control_plane_secret_audit WHERE company_id = $1`,
          [companyA]
        );
      })
    ).rejects.toThrow();

    // Key rotation dry-run: introduce a v2 key, rotate tenant A, confirm decrypts under v2 only.
    process.env.CONTROL_PLANE_SECRET_KEY = ROTATED_KEY_HEX;
    process.env.CONTROL_PLANE_SECRET_KEY_VERSION = "2";
    process.env.CONTROL_PLANE_SECRET_KEYS = `1:${PRIMARY_KEY_HEX}`;
    encryption.resetSecretEncryptionForTests();
    expect(encryption.getActiveKeyVersion()).toBe(2);

    const { rotated } = await secrets.secretsRepository.rotateCompanySecrets(ctxA, companyA, 2);
    expect(rotated).toBeGreaterThanOrEqual(1);

    // After rotation, the row's key_version is 2 and decrypt still yields the original plaintext.
    expect(await secrets.secretsRepository.getSecret(ctxA, companyA, "OPENAI_API_KEY")).toBe(
      "sk-tenant-a-1234"
    );

    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      const result = await client.query<{ key_version: number }>(
        `SELECT key_version FROM provisioned_company_secrets
          WHERE company_id = $1 AND key = $2`,
        [companyA, "OPENAI_API_KEY"]
      );
      expect(result.rows[0]?.key_version).toBe(2);
    });

    // Rotation emitted an audit row.
    await workspaceContext.withWorkspaceContext(pool, ctxA, async (client) => {
      const result = await client.query<{ action: string; metadata: Record<string, unknown> | null }>(
        `SELECT action, metadata FROM control_plane_secret_audit
          WHERE company_id = $1 AND action = 'rotate'`,
        [companyA]
      );
      expect(result.rowCount).toBe(1);
      expect((result.rows[0]?.metadata as { previousKeyVersion?: number })?.previousKeyVersion).toBe(1);
    });
  });
});
