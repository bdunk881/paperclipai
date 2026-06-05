/**
 * HEL-490: runs-dlq depth monitor.
 */

jest.mock("./queues", () => ({ getDlqQueue: jest.fn() }));
jest.mock("@sentry/node", () => ({ captureMessage: jest.fn() }));

import * as Sentry from "@sentry/node";
import { getDlqQueue } from "./queues";
import {
  shouldAlertOnDlqDepth,
  resolveDlqAlertThreshold,
  checkDlqDepthOnce,
} from "./dlqMonitor";

const mockGetDlq = getDlqQueue as jest.MockedFunction<typeof getDlqQueue>;
const mockCapture = Sentry.captureMessage as jest.MockedFunction<typeof Sentry.captureMessage>;

const logger = { log: jest.fn(), warn: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("shouldAlertOnDlqDepth", () => {
  it("alerts at or above the threshold, not below", () => {
    const base = { waiting: 0, delayed: 0, failed: 0 };
    expect(shouldAlertOnDlqDepth({ ...base, total: 50 }, 50)).toBe(true);
    expect(shouldAlertOnDlqDepth({ ...base, total: 51 }, 50)).toBe(true);
    expect(shouldAlertOnDlqDepth({ ...base, total: 49 }, 50)).toBe(false);
  });

  it("a non-positive threshold disables alerting", () => {
    expect(shouldAlertOnDlqDepth({ waiting: 0, delayed: 0, failed: 0, total: 999 }, 0)).toBe(false);
  });
});

describe("resolveDlqAlertThreshold", () => {
  it("defaults to 50", () => {
    expect(resolveDlqAlertThreshold({})).toBe(50);
  });
  it("honors RUNS_DLQ_ALERT_DEPTH", () => {
    expect(resolveDlqAlertThreshold({ RUNS_DLQ_ALERT_DEPTH: "10" })).toBe(10);
  });
  it("falls back to 50 on a garbage value", () => {
    expect(resolveDlqAlertThreshold({ RUNS_DLQ_ALERT_DEPTH: "nope" })).toBe(50);
  });
});

describe("checkDlqDepthOnce", () => {
  it("returns null and does nothing when the DLQ/Redis is not configured", async () => {
    mockGetDlq.mockReturnValue(null);
    expect(await checkDlqDepthOnce(logger, {})).toBeNull();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("logs depth without alerting below the threshold", async () => {
    mockGetDlq.mockReturnValue({
      getJobCounts: jest.fn().mockResolvedValue({ waiting: 1, delayed: 0, failed: 2 }),
    } as never);

    const snap = await checkDlqDepthOnce(logger, { RUNS_DLQ_ALERT_DEPTH: "50" });

    expect(snap).toEqual({ waiting: 1, delayed: 0, failed: 2, total: 3 });
    expect(logger.log).toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("warns + raises a Sentry alert at/above the threshold", async () => {
    mockGetDlq.mockReturnValue({
      getJobCounts: jest.fn().mockResolvedValue({ waiting: 60, delayed: 0, failed: 0 }),
    } as never);

    await checkDlqDepthOnce(logger, { RUNS_DLQ_ALERT_DEPTH: "50" });

    expect(logger.warn).toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledWith(
      "runs_dlq_depth_high",
      expect.objectContaining({ level: "warning" }),
    );
  });
});
