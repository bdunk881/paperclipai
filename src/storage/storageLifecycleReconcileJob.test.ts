jest.mock("./index", () => ({
  getStorageAdapter: jest.fn(),
  isLifecycleCapable: jest.fn(),
}));

import { diffLifecycle, runStorageLifecycleReconcile } from "./storageLifecycleReconcileJob";
import { getStorageAdapter, isLifecycleCapable } from "./index";
import { buildLifecycleConfiguration } from "./retentionPolicy";
import type { LifecycleConfiguration } from "./storageAdapter";

const mockGetAdapter = getStorageAdapter as jest.Mock;
const mockIsLifecycleCapable = isLifecycleCapable as unknown as jest.Mock;

describe("diffLifecycle (HEL-358)", () => {
  const expected = buildLifecycleConfiguration();

  it("reports no drift when actual matches expected", () => {
    expect(diffLifecycle(expected, expected)).toEqual([]);
  });

  it("flags a completely missing configuration", () => {
    const drift = diffLifecycle(expected, null);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatch(/no lifecycle configuration/);
  });

  it("flags a missing rule", () => {
    const actual: LifecycleConfiguration = {
      rules: expected.rules.filter((r) => r.id !== "retention-short"),
    };
    expect(diffLifecycle(expected, actual).join("\n")).toMatch(/missing rule 'retention-short'/);
  });

  it("flags a mismatched expiration", () => {
    const actual: LifecycleConfiguration = {
      rules: expected.rules.map((r) => (r.id === "retention-short" ? { ...r, expirationDays: 7 } : r)),
    };
    expect(diffLifecycle(expected, actual).join("\n")).toMatch(/expirationDays 7 != expected 30/);
  });

  it("flags a disabled rule", () => {
    const actual: LifecycleConfiguration = {
      rules: expected.rules.map((r) =>
        r.id === "retention-standard" ? { ...r, status: "Disabled" as const } : r,
      ),
    };
    expect(diffLifecycle(expected, actual).join("\n")).toMatch(/is Disabled, expected Enabled/);
  });
});

describe("runStorageLifecycleReconcile (HEL-358)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("skips when storage is unconfigured", async () => {
    mockGetAdapter.mockImplementation(() => {
      throw new Error("unconfigured");
    });
    const res = await runStorageLifecycleReconcile();
    expect(res).toMatchObject({ outcome: "skipped", reason: "storage_unconfigured", driftCount: 0 });
  });

  it("skips when the adapter is not lifecycle-capable (in-memory dev)", async () => {
    mockGetAdapter.mockReturnValue({ provider: "memory", bucket: "memory" });
    mockIsLifecycleCapable.mockReturnValue(false);
    const res = await runStorageLifecycleReconcile();
    expect(res.outcome).toBe("skipped");
    expect(res.reason).toContain("memory");
  });

  it("reports zero drift when the bucket matches the expected config", async () => {
    const adapter = {
      provider: "s3",
      bucket: "autoflow-storage-dev",
      getBucketLifecycle: jest.fn().mockResolvedValue(buildLifecycleConfiguration()),
    };
    mockGetAdapter.mockReturnValue(adapter);
    mockIsLifecycleCapable.mockReturnValue(true);
    const res = await runStorageLifecycleReconcile();
    expect(res).toMatchObject({ outcome: "success", driftCount: 0, provider: "s3", bucket: "autoflow-storage-dev" });
  });

  it("reports drift when the bucket has no lifecycle config (e.g. apply step not yet run)", async () => {
    const adapter = {
      provider: "r2",
      bucket: "autoflow-storage-dev",
      getBucketLifecycle: jest.fn().mockResolvedValue(null),
    };
    mockGetAdapter.mockReturnValue(adapter);
    mockIsLifecycleCapable.mockReturnValue(true);
    const res = await runStorageLifecycleReconcile();
    expect(res.outcome).toBe("success");
    expect(res.driftCount).toBeGreaterThan(0);
  });
});
