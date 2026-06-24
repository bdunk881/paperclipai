import { deploymentStore, isDeploymentEnvironment } from "./deploymentStore";

const WS = "11111111-1111-4111-8111-111111111111";
const WF = "22222222-2222-4222-8222-222222222222";

const deploy = (environment: "dev" | "staging" | "prod", version: number, note?: string) =>
  deploymentStore.deployVersion({
    workflowId: WF,
    workspaceId: WS,
    environment,
    versionId: `ver-${version}`,
    version,
    note,
  });

beforeEach(async () => {
  await deploymentStore.__resetForTests();
});

describe("isDeploymentEnvironment", () => {
  it("accepts the three envs, rejects others", () => {
    expect(isDeploymentEnvironment("dev")).toBe(true);
    expect(isDeploymentEnvironment("staging")).toBe(true);
    expect(isDeploymentEnvironment("prod")).toBe(true);
    expect(isDeploymentEnvironment("preview")).toBe(false);
    expect(isDeploymentEnvironment(undefined)).toBe(false);
  });
});

describe("deploymentStore (HEL-819)", () => {
  it("deploy → getCurrentDeployment reflects the latest version", async () => {
    await deploy("prod", 1);
    await deploy("prod", 2);
    const current = await deploymentStore.getCurrentDeployment(WF, "prod");
    expect(current?.version).toBe(2);
    expect(current?.versionId).toBe("ver-2");
  });

  it("rollback (deploy an older version) flips current but keeps history", async () => {
    await deploy("prod", 1);
    await deploy("prod", 2);
    await deploy("prod", 1, "rollback to v1");
    const current = await deploymentStore.getCurrentDeployment(WF, "prod");
    expect(current?.version).toBe(1);
    expect(current?.note).toBe("rollback to v1");
    const history = await deploymentStore.listDeployments(WF, "prod");
    expect(history.map((d) => d.version)).toEqual([1, 2, 1]); // newest first
  });

  it("isolates current deployment per environment", async () => {
    await deploy("dev", 5);
    await deploy("prod", 2);
    expect((await deploymentStore.getCurrentDeployment(WF, "dev"))?.version).toBe(5);
    expect((await deploymentStore.getCurrentDeployment(WF, "prod"))?.version).toBe(2);
    expect(await deploymentStore.getCurrentDeployment(WF, "staging")).toBeUndefined();
  });

  it("listDeployments returns history newest-first, honors env filter + limit", async () => {
    await deploy("dev", 1);
    await deploy("prod", 1);
    await deploy("dev", 2);
    const all = await deploymentStore.listDeployments(WF);
    expect(all).toHaveLength(3);
    const devOnly = await deploymentStore.listDeployments(WF, "dev");
    expect(devOnly.map((d) => d.version)).toEqual([2, 1]);
    const limited = await deploymentStore.listDeployments(WF, undefined, 2);
    expect(limited).toHaveLength(2);
  });

  it("getCurrentDeployment is undefined for an undeployed workflow", async () => {
    expect(await deploymentStore.getCurrentDeployment("no-such-wf", "dev")).toBeUndefined();
  });
});
