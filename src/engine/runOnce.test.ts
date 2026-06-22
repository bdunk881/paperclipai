jest.mock("./WorkflowEngine", () => ({
  workflowEngine: { executeQueuedRun: jest.fn() },
}));

import { executeRunOnce } from "./runOnce";
import { workflowEngine } from "./WorkflowEngine";

const mockExec = workflowEngine.executeQueuedRun as jest.Mock;

describe("executeRunOnce (HEL-810)", () => {
  beforeEach(() => mockExec.mockReset());

  it("runs exactly the one run and reports ok", async () => {
    mockExec.mockResolvedValue(undefined);
    const result = await executeRunOnce("run-1", 3);
    expect(result).toEqual({ ok: true });
    expect(mockExec).toHaveBeenCalledWith("run-1", 3);
  });

  it("defaults a non-finite stepIndex to 0", async () => {
    mockExec.mockResolvedValue(undefined);
    await executeRunOnce("run-1", Number.NaN);
    expect(mockExec).toHaveBeenCalledWith("run-1", 0);
  });

  it("reports failure with the error message (never throws)", async () => {
    mockExec.mockRejectedValue(new Error("boom"));
    const result = await executeRunOnce("run-1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});
