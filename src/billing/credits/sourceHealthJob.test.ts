/**
 * sourceHealthJob (HEL-601) — the generalized watchdog. `decideHealthFlip` is
 * pure so the flip logic is tested directly; `runSourceHealthCheck` is driven
 * with stub rows + balances (the DB selectors no-op to [] in-memory, so the
 * loop is exercised by injecting `selectRows`). The OpenRouter no-op path keeps
 * its coverage in openrouterHealthJob.test.ts (which imports through the shim).
 */
import { decideHealthFlip, runSourceHealthCheck } from "./sourceHealthJob";
import {
  __resetInMemoryStateForTests,
  insertKeySource,
  listKeySources,
  setStatus,
} from "./keySourceStore";

beforeEach(() => {
  __resetInMemoryStateForTests();
});

describe("decideHealthFlip", () => {
  it("flips active → low_balance when the balance can't cover trailing spend", () => {
    expect(decideHealthFlip({ status: "active", balanceUsd: 50, trailingSpendUsd: 100 })).toBe("to_low_balance");
  });

  it("keeps active when the balance covers trailing spend", () => {
    expect(decideHealthFlip({ status: "active", balanceUsd: 150, trailingSpendUsd: 100 })).toBe("none");
  });

  it("flips low_balance → active once the balance clears the recovery hysteresis (3×)", () => {
    expect(decideHealthFlip({ status: "low_balance", balanceUsd: 350, trailingSpendUsd: 100 })).toBe("to_active");
  });

  it("keeps low_balance until the balance clears the recovery hysteresis", () => {
    expect(decideHealthFlip({ status: "low_balance", balanceUsd: 150, trailingSpendUsd: 100 })).toBe("none");
  });

  it("never flips when there is no trailing spend to compare against (fresh source)", () => {
    expect(decideHealthFlip({ status: "active", balanceUsd: 0, trailingSpendUsd: 0 })).toBe("none");
  });
});

describe("runSourceHealthCheck", () => {
  it("flips an underfunded direct row to low_balance and fires the underfund alert", async () => {
    const id = await insertKeySource({
      sourceKind: "direct",
      provider: "anthropic",
      label: "anthropic-direct",
      apiKey: "sk-ant",
      priority: 10,
    });
    const onUnderfund = jest.fn(async () => undefined);

    const result = await runSourceHealthCheck({
      jobName: "test_direct",
      selectRows: async () => [{ id, status: "active", apiKey: "sk-ant" }],
      readBalance: async () => 5, // $5 Issuing balance
      trailingSpendUsd: async () => 100, // $100 trailing anthropic spend → underfunded
      onUnderfund,
    });

    expect(result.flippedToLowBalance).toBe(1);
    expect(result.balanceUsd).toBe(5);
    expect(onUnderfund).toHaveBeenCalledTimes(1);
    expect(onUnderfund).toHaveBeenCalledWith({ balanceUsd: 5, trailingSpendUsd: 100 }, expect.anything());

    const row = (await listKeySources()).find((r) => r.id === id);
    expect(row?.status).toBe("low_balance");
  });

  it("recovers a low_balance row to active when the balance clears the hysteresis", async () => {
    const id = await insertKeySource({
      sourceKind: "direct",
      provider: "openai",
      label: "openai-direct",
      apiKey: "sk-oai",
      priority: 10,
    });
    await setStatus(id, "low_balance");

    const result = await runSourceHealthCheck({
      jobName: "test_direct",
      selectRows: async () => [{ id, status: "low_balance", apiKey: "sk-oai" }],
      readBalance: async () => 400, // well above 3 × 100
      trailingSpendUsd: async () => 100,
    });

    expect(result.flippedToActive).toBe(1);
    const row = (await listKeySources()).find((r) => r.id === id);
    expect(row?.status).toBe("active");
  });

  it("skips a row whose balance read returns null (transient) without flipping or alerting", async () => {
    const id = await insertKeySource({
      sourceKind: "openrouter",
      provider: "openrouter",
      label: "or-prod",
      apiKey: "sk-or",
    });
    const onUnderfund = jest.fn();

    const result = await runSourceHealthCheck({
      jobName: "test",
      selectRows: async () => [{ id, status: "active", apiKey: "sk-or" }],
      readBalance: async () => null,
      trailingSpendUsd: async () => 100,
      onUnderfund,
    });

    expect(result.flippedToLowBalance).toBe(0);
    expect(result.balanceUsd).toBeNull();
    expect(onUnderfund).not.toHaveBeenCalled();
  });

  it("no-ops with the original result shape when there are no rows", async () => {
    const result = await runSourceHealthCheck({
      jobName: "test",
      selectRows: async () => [],
      readBalance: async () => 1,
      trailingSpendUsd: async () => 1,
    });
    expect(result).toEqual({
      sourcesChecked: 0,
      balanceUsd: null,
      trailing24hUsd: 0,
      flippedToLowBalance: 0,
      flippedToActive: 0,
    });
  });
});
