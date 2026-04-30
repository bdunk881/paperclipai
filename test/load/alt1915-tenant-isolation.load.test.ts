import { randomBytes, randomUUID } from "crypto";

import type { WorkflowStep } from "../../src/types/workflow";

const PRIMARY_KEY_HEX = randomBytes(32).toString("hex");
const TENANT_COUNT = 10;
const READ_ROUNDS = 3;
const SECRET_KEY = "OPENAI_API_KEY";

interface TenantFixture {
  workspaceId: string;
  companyId: string;
  teamId: string;
  agentId: string;
  executionId: string;
  taskId: string;
  heartbeatId: string;
  secretValue: string;
  maskedSecret: string;
}

function workspaceIdForIndex(index: number): string {
  const suffix = (index + 1).toString().padStart(12, "0");
  return `10000000-0000-4000-8000-${suffix}`;
}

function loadStepForIndex(index: number): WorkflowStep {
  return {
    id: `tenant-load-step-${index + 1}`,
    name: `Tenant Load Step ${index + 1}`,
    kind: "agent",
    description: "AC4 tenant-isolation load test seed step",
    inputKeys: [],
    outputKeys: [],
    agentRoleKey: "backend-engineer",
    agentSkills: ["paperclip"],
  };
}

describe("ALT-1915 AC4 tenant isolation load", () => {
  const originalEnv = { ...process.env };
  const userId = "alt-2117-load-user";
  let canRunIntegration = false;

  async function loadModules() {
    jest.resetModules();
    const postgres = await import("../../src/db/postgres");
    const migrations = await import("../../src/db/sqlMigrations");
    const workspaceContextModule = await import("../../src/middleware/workspaceContext");
    const controlPlaneStoreModule = await import("../../src/controlPlane/controlPlaneStore");
    const controlPlaneRepositoryModule = await import("../../src/controlPlane/controlPlaneRepository");
    const secretsRepositoryModule = await import("../../src/controlPlane/secretsRepository");
    return {
      postgres,
      migrations,
      workspaceContext: workspaceContextModule,
      controlPlaneStore: controlPlaneStoreModule.controlPlaneStore,
      controlPlaneRepository: controlPlaneRepositoryModule.controlPlaneRepository,
      secretsRepository: secretsRepositoryModule.secretsRepository,
    };
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

    const { postgres, controlPlaneStore } = await loadModules();
    await postgres.queryPostgres("DELETE FROM control_plane_audit_log WHERE actor_user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_secret_audit WHERE actor_user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM provisioned_company_secrets WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_user_id = $1)", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_budget_alerts WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_spend_entries WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_heartbeats WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_tasks WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_executions WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_agents WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM provisioned_companies WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM control_plane_teams WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM workspace_members WHERE user_id = $1", [userId]);
    await postgres.queryPostgres("DELETE FROM workspaces WHERE owner_user_id = $1", [userId]);
    controlPlaneStore.clear();
    await postgres.closePostgresPoolForTests();
  });

  it("keeps 10 concurrent workspace callers tenant-isolated across store, repository, and secrets reads", async () => {
    if (!canRunIntegration) {
      return;
    }

    const {
      postgres,
      migrations,
      workspaceContext,
      controlPlaneStore,
      controlPlaneRepository,
      secretsRepository,
    } = await loadModules();
    await migrations.ensureSqlMigrationsApplied();

    const workspaceRows = Array.from({ length: TENANT_COUNT }, (_, index) => ({
      workspaceId: workspaceIdForIndex(index),
      name: `Load Workspace ${index + 1}`,
    }));

    for (const row of workspaceRows) {
      await postgres.queryPostgres(
        `INSERT INTO workspaces (id, name, owner_user_id)
         VALUES ($1, $2, $3)`,
        [row.workspaceId, row.name, userId],
      );
    }

    const fixtures: TenantFixture[] = [];
    for (let index = 0; index < TENANT_COUNT; index += 1) {
      const workspaceId = workspaceRows[index].workspaceId;
      const companyId = randomUUID();
      const secretValue = `sk-tenant-${index + 1}-${(1000 + index).toString()}`;
      const runtime = await controlPlaneStore.ensureRuntimeTeamForStep({
        workspaceId,
        userId,
        actor: userId,
        teamName: `Tenant ${index + 1} Runtime Team`,
        step: loadStepForIndex(index),
      });

      const provisionedWorkspaceId = randomUUID();
      await workspaceContext.withWorkspaceContext(
        postgres.getPostgresPool(),
        { workspaceId, userId },
        async (client) => {
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
              `Tenant ${index + 1}`,
              provisionedWorkspaceId,
              `Tenant ${index + 1} Workspace`,
              `tenant-${index + 1}`,
              runtime.team.id,
              `alt-2117-load-${index + 1}`,
            ],
          );
        },
      );
      await secretsRepository.setSecret(
        { workspaceId, userId, actorUserId: userId },
        companyId,
        SECRET_KEY,
        secretValue,
      );

      const started = await controlPlaneStore.startAgentExecution({
        workspaceId,
        userId,
        actor: userId,
        teamId: runtime.team.id,
        requestedAgentId: runtime.agent.id,
        step: loadStepForIndex(index),
        sourceRunId: `alt-2117-run-${index + 1}`,
        taskTitle: `Tenant ${index + 1} execution task`,
      });

      const heartbeat = await controlPlaneStore.recordHeartbeat({
        workspaceId,
        userId,
        teamId: runtime.team.id,
        agentId: runtime.agent.id,
        executionId: started.execution.id,
        status: "completed",
        summary: `tenant ${index + 1} seed heartbeat`,
      });

      fixtures.push({
        workspaceId,
        companyId,
        teamId: runtime.team.id,
        agentId: runtime.agent.id,
        executionId: started.execution.id,
        taskId: started.task?.id ?? "",
        heartbeatId: heartbeat.id,
        secretValue,
        maskedSecret: `********${secretValue.slice(-4)}`,
      });
    }

    const readChecks = fixtures.flatMap((fixture, index) => {
      const otherFixture = fixtures[(index + 1) % fixtures.length];
      return Array.from({ length: READ_ROUNDS }, async () => {
        const ctx = { workspaceId: fixture.workspaceId, userId };
        const secretCtx = { ...ctx, actorUserId: userId };

        await controlPlaneStore.ensureWorkspaceHydrated(fixture.workspaceId, userId);

        const [
          teams,
          agents,
          executions,
          foreignTeam,
          foreignExecutions,
          repoTasks,
          repoHeartbeats,
          crossTenantTasks,
          crossTenantHeartbeats,
          secretValue,
          foreignSecretValue,
          secretSummaries,
        ] = await Promise.all([
          Promise.resolve(controlPlaneStore.listTeams(userId, fixture.workspaceId)),
          Promise.resolve(controlPlaneStore.listAllAgents(userId, fixture.workspaceId)),
          Promise.resolve(controlPlaneStore.listExecutions(userId, fixture.teamId, fixture.workspaceId)),
          Promise.resolve(controlPlaneStore.getTeam(fixture.teamId, userId, otherFixture.workspaceId)),
          Promise.resolve(controlPlaneStore.listExecutions(userId, fixture.teamId, otherFixture.workspaceId)),
          controlPlaneRepository.listTasks(ctx),
          controlPlaneRepository.listHeartbeats(ctx),
          controlPlaneRepository.listTasks(ctx, { teamId: otherFixture.teamId }),
          controlPlaneRepository.listHeartbeats(ctx, { teamId: otherFixture.teamId }),
          secretsRepository.getSecret(secretCtx, fixture.companyId, SECRET_KEY),
          secretsRepository.getSecret(secretCtx, otherFixture.companyId, SECRET_KEY),
          secretsRepository.listSecretSummaries(secretCtx, fixture.companyId),
        ]);

        expect(teams.map((team) => team.id)).toEqual([fixture.teamId]);
        expect(agents.map((agent) => agent.id)).toEqual([fixture.agentId]);
        expect(executions.map((execution) => execution.id)).toEqual([fixture.executionId]);
        expect(foreignTeam).toBeUndefined();
        expect(foreignExecutions).toEqual([]);
        expect(repoTasks.map((task) => task.id)).toEqual([fixture.taskId]);
        expect(repoHeartbeats.every((heartbeat) => heartbeat.teamId === fixture.teamId)).toBe(true);
        expect(repoHeartbeats.map((heartbeat) => heartbeat.id)).toContain(fixture.heartbeatId);
        expect(crossTenantTasks).toEqual([]);
        expect(crossTenantHeartbeats).toEqual([]);
        expect(secretValue).toBe(fixture.secretValue);
        expect(foreignSecretValue).toBeNull();
        expect(secretSummaries).toEqual([{ key: SECRET_KEY, maskedValue: fixture.maskedSecret }]);
      });
    });

    await Promise.all(readChecks);
  });

  test.todo(
    "ALT-2121 dependency: repository and controlPlaneStore read paths emit workspace-tagged audit rows for every AC4 read",
  );
});
