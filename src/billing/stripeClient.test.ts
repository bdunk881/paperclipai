/**
 * Tests for stripeClient.ts.
 *
 *  - Exercise the singleton + missing-key + fallback branches of `getStripe`.
 *  - Exercise the env-var lookup branches of `resolveStripePriceId`.
 *  - Never make a real HTTP request — `stripe` is mocked.
 */

const stripeCtorCalls: string[] = [];

jest.mock("stripe", () => {
  const ctor = jest.fn(function MockStripe(this: { apiKey: string }, apiKey: string) {
    stripeCtorCalls.push(apiKey);
    this.apiKey = apiKey;
  }) as unknown as jest.Mock & { default: unknown };
  return ctor;
});

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_API_KEY",
  "STRIPE_FLOW_PRICE_ID",
  "STRIPE_AUTOMATE_PRICE_ID",
  "STRIPE_SCALE_PRICE_ID",
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) {
    ORIGINAL_ENV[key] = process.env[key];
  }
});

beforeEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  stripeCtorCalls.length = 0;
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
});

/**
 * Reload stripeClient.ts inside an isolated module registry so the singleton
 * `getStripe` cache resets between tests.
 */
function loadFresh(): typeof import("./stripeClient") {
  let mod!: typeof import("./stripeClient");
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("./stripeClient");
  });
  return mod;
}

describe("getStripe", () => {
  it("throws when neither STRIPE_SECRET_KEY nor STRIPE_API_KEY is set", () => {
    const mod = loadFresh();
    expect(() => mod.getStripe()).toThrow(/Stripe secret key/);
  });

  it("throws when keys are present but only whitespace", () => {
    process.env.STRIPE_SECRET_KEY = "   ";
    process.env.STRIPE_API_KEY = "\t\n";
    const mod = loadFresh();
    expect(() => mod.getStripe()).toThrow(/Stripe secret key/);
  });

  it("uses STRIPE_SECRET_KEY when set", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_primary";
    const mod = loadFresh();
    const client = mod.getStripe() as unknown as { apiKey: string };
    expect(client.apiKey).toBe("sk_test_primary");
    expect(stripeCtorCalls).toEqual(["sk_test_primary"]);
  });

  it("falls back to STRIPE_API_KEY when STRIPE_SECRET_KEY is empty", () => {
    process.env.STRIPE_SECRET_KEY = "";
    process.env.STRIPE_API_KEY = "sk_test_fallback";
    const mod = loadFresh();
    const client = mod.getStripe() as unknown as { apiKey: string };
    expect(client.apiKey).toBe("sk_test_fallback");
    expect(stripeCtorCalls).toEqual(["sk_test_fallback"]);
  });

  it("trims whitespace around the key before passing it to Stripe", () => {
    process.env.STRIPE_SECRET_KEY = "  sk_test_padded  ";
    const mod = loadFresh();
    const client = mod.getStripe() as unknown as { apiKey: string };
    expect(client.apiKey).toBe("sk_test_padded");
  });

  it("memoises the Stripe instance across multiple getStripe() calls", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_singleton";
    const mod = loadFresh();
    const a = mod.getStripe();
    const b = mod.getStripe();
    expect(a).toBe(b);
    expect(stripeCtorCalls).toEqual(["sk_test_singleton"]);
  });
});

describe("resolveStripePriceId", () => {
  it("returns empty string when envName is null (free tier)", () => {
    const { resolveStripePriceId } = loadFresh();
    expect(resolveStripePriceId(null)).toBe("");
  });

  it("returns empty string when the env var is unset", () => {
    const { resolveStripePriceId } = loadFresh();
    expect(resolveStripePriceId("STRIPE_FLOW_PRICE_ID")).toBe("");
  });

  it("returns the env var value when set", () => {
    process.env.STRIPE_FLOW_PRICE_ID = "price_flow_live";
    const { resolveStripePriceId } = loadFresh();
    expect(resolveStripePriceId("STRIPE_FLOW_PRICE_ID")).toBe("price_flow_live");
  });

  it("trims whitespace around the env var value", () => {
    process.env.STRIPE_AUTOMATE_PRICE_ID = "  price_automate_padded  ";
    const { resolveStripePriceId } = loadFresh();
    expect(resolveStripePriceId("STRIPE_AUTOMATE_PRICE_ID")).toBe("price_automate_padded");
  });

  it("returns empty string when the env var is only whitespace", () => {
    process.env.STRIPE_SCALE_PRICE_ID = "   ";
    const { resolveStripePriceId } = loadFresh();
    expect(resolveStripePriceId("STRIPE_SCALE_PRICE_ID")).toBe("");
  });

  it("does NOT fall back through legacy aliases — only the canonical name is honored", () => {
    // Sanity check that the legacy alias contract was deliberately dropped:
    // setting only an old alias should yield "" for the canonical lookup.
    process.env.STRIPE_PRICE_FLOW = "price_legacy_alias_should_be_ignored";
    const { resolveStripePriceId } = loadFresh();
    expect(resolveStripePriceId("STRIPE_FLOW_PRICE_ID")).toBe("");
  });
});
