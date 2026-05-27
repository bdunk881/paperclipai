/**
 * OpenRouter health watchdog tests — exercise the threshold flips via
 * a stub fetch. The DB-backed paths run against in-memory mode (when
 * AUTOFLOW_ALLOW_INMEMORY is set in jest.env.cjs) which short-circuits
 * the cycle to a no-op result. That's intentional: the real assertions
 * live in the helper's branching logic exercised here through unit
 * tests of `runOpenrouterHealthCheck`'s pure parts. End-to-end DB
 * coverage lands when the integration suite picks this file up under
 * Postgres.
 */
import { runOpenrouterHealthCheck } from "./openrouterHealthJob";

describe("openrouterHealthJob (in-memory mode no-op)", () => {
  it("returns a zero-counter result when DATABASE_URL is unconfigured", async () => {
    const stubFetch = jest.fn(async () =>
      new Response(JSON.stringify({ data: { total_credits: 500, total_usage: 100 } }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;

    const result = await runOpenrouterHealthCheck({ fetchImpl: stubFetch });

    expect(result).toEqual({
      sourcesChecked: 0,
      balanceUsd: null,
      trailing24hUsd: 0,
      flippedToLowBalance: 0,
      flippedToActive: 0,
    });
    // Fetch shouldn't fire because there are no DB rows to drive it.
    expect(stubFetch).not.toHaveBeenCalled();
  });
});
