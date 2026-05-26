/**
 * Tests for stripeClient.ts.
 *
 * Goals:
 *  - Exercise the `firstNonEmpty` env-var fallback chain across all
 *    PRICING_TIERS entries (each branch of the helper) by reloading the
 *    module under controlled env values with `jest.isolateModules`.
 *  - Exercise the singleton + missing-key error branches of `getStripe`.
 *  - Never make a real HTTP request — `stripe` is mocked.
 */

// Tracks calls to the mocked Stripe constructor so the singleton behaviour
// can be asserted.
const stripeCtorCalls: string[] = [];

jest.mock("stripe", () => {
  // The real SDK exports a default class. Use a callable mock that doubles as
  // a constructor so `new Stripe(key)` works.
  const ctor = jest.fn(function MockStripe(this: { apiKey: string }, apiKey: string) {
    stripeCtorCalls.push(apiKey);
    this.apiKey = apiKey;
  }) as unknown as jest.Mock & { default: unknown };
  // The real shape from `import Stripe from "stripe"` with esModuleInterop is
  // a default export, but the SDK is also exported in CJS form. Returning the
  // ctor directly works because esModuleInterop synthesises a default.
  return ctor;
});

// Env keys that this module consults — clear them between tests so leakage
// from the ambient shell does not cause false branches to be taken.
const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_API_KEY",
  "STRIPE_FLOW_PRICE_ID",
  "STRIPE_PRICE_FLOW",
  "STRIPE_PRICE_STARTER",
  "STRIPE_AUTOMATE_PRICE_ID",
  "STRIPE_PRICE_AUTOMATE",
  "STRIPE_PRICE_PROFESSIONAL",
  "STRIPE_PRICE_PRO",
  "STRIPE_SCALE_PRICE_ID",
  "STRIPE_PRICE_SCALE",
  "STRIPE_PRICE_ENTERPRISE",
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) {
    ORIGINAL_ENV[key] = process.env[key];
  }
});

beforeEach(() => {
  // Always start each test from a clean slate so reloaded modules see the
  // env we set inside the test, not values from previous runs.
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
 * Reload stripeClient.ts inside an isolated module registry so module-level
 * `PRICING_TIERS` evaluation picks up the env we just set.
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

  it("throws when keys are present but only whitespace (firstNonEmpty trim path)", () => {
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
    // Constructor invoked exactly once despite two getStripe() calls.
    expect(stripeCtorCalls).toEqual(["sk_test_singleton"]);
  });

  it("ignores undefined env vars in the fallback chain (typeof guard)", () => {
    // Neither STRIPE_SECRET_KEY nor STRIPE_API_KEY defined; explicitly assert
    // the first defined fallback still wins when only STRIPE_API_KEY is set.
    process.env.STRIPE_API_KEY = "sk_test_only_api";
    const mod = loadFresh();
    const client = mod.getStripe() as unknown as { apiKey: string };
    expect(client.apiKey).toBe("sk_test_only_api");
  });
});

describe("PRICING_TIERS", () => {
  it("uses defaults (null priceId for explore, empty string elsewhere) when no env vars are set", () => {
    const { PRICING_TIERS } = loadFresh();

    expect(PRICING_TIERS.explore).toEqual({
      name: "Explore",
      price: 0,
      priceId: null,
      trialDays: 0,
    });

    expect(PRICING_TIERS.flow.priceId).toBe("");
    expect(PRICING_TIERS.automate.priceId).toBe("");
    expect(PRICING_TIERS.scale.priceId).toBe("");

    // Trial days/prices are static — assert a couple to lock in the literals.
    expect(PRICING_TIERS.flow.price).toBe(19);
    expect(PRICING_TIERS.flow.trialDays).toBe(14);
    expect(PRICING_TIERS.automate.price).toBe(49);
    expect(PRICING_TIERS.automate.trialDays).toBe(14);
    expect(PRICING_TIERS.scale.price).toBe(99);
    expect(PRICING_TIERS.scale.trialDays).toBe(0);
  });

  it("picks the first non-empty Flow price env var (preferred name wins)", () => {
    process.env.STRIPE_FLOW_PRICE_ID = "price_flow_new";
    process.env.STRIPE_PRICE_FLOW = "price_flow_mid";
    process.env.STRIPE_PRICE_STARTER = "price_flow_legacy";
    const { PRICING_TIERS } = loadFresh();
    expect(PRICING_TIERS.flow.priceId).toBe("price_flow_new");
  });

  it("falls through to STRIPE_PRICE_FLOW when STRIPE_FLOW_PRICE_ID is empty", () => {
    process.env.STRIPE_FLOW_PRICE_ID = "";
    process.env.STRIPE_PRICE_FLOW = "price_flow_mid";
    process.env.STRIPE_PRICE_STARTER = "price_flow_legacy";
    const { PRICING_TIERS } = loadFresh();
    expect(PRICING_TIERS.flow.priceId).toBe("price_flow_mid");
  });

  it("falls through to STRIPE_PRICE_STARTER as the final Flow legacy fallback", () => {
    process.env.STRIPE_PRICE_STARTER = "price_flow_legacy";
    const { PRICING_TIERS } = loadFresh();
    expect(PRICING_TIERS.flow.priceId).toBe("price_flow_legacy");
  });

  it("picks the first non-empty Automate price env var across all four aliases", () => {
    process.env.STRIPE_AUTOMATE_PRICE_ID = "price_automate_new";
    process.env.STRIPE_PRICE_AUTOMATE = "price_automate_mid";
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_pro";
    process.env.STRIPE_PRICE_PRO = "price_pro_short";
    const { PRICING_TIERS } = loadFresh();
    expect(PRICING_TIERS.automate.priceId).toBe("price_automate_new");
  });

  it("falls through Automate aliases when earlier ones are empty", () => {
    process.env.STRIPE_AUTOMATE_PRICE_ID = "";
    process.env.STRIPE_PRICE_AUTOMATE = "";
    process.env.STRIPE_PRICE_PROFESSIONAL = "";
    process.env.STRIPE_PRICE_PRO = "price_pro_short";
    const { PRICING_TIERS } = loadFresh();
    expect(PRICING_TIERS.automate.priceId).toBe("price_pro_short");
  });

  it("picks Automate from STRIPE_PRICE_PROFESSIONAL alias", () => {
    process.env.STRIPE_PRICE_PROFESSIONAL = "price_pro";
    const { PRICING_TIERS } = loadFresh();
    expect(PRICING_TIERS.automate.priceId).toBe("price_pro");
  });

  it("picks the first non-empty Scale price env var", () => {
    process.env.STRIPE_SCALE_PRICE_ID = "price_scale_new";
    process.env.STRIPE_PRICE_SCALE = "price_scale_mid";
    process.env.STRIPE_PRICE_ENTERPRISE = "price_enterprise_legacy";
    const { PRICING_TIERS } = loadFresh();
    expect(PRICING_TIERS.scale.priceId).toBe("price_scale_new");
  });

  it("falls through Scale aliases to STRIPE_PRICE_ENTERPRISE", () => {
    process.env.STRIPE_PRICE_ENTERPRISE = "price_enterprise_legacy";
    const { PRICING_TIERS } = loadFresh();
    expect(PRICING_TIERS.scale.priceId).toBe("price_enterprise_legacy");
  });

  it("treats whitespace-only env vars as empty in fallback chains", () => {
    process.env.STRIPE_FLOW_PRICE_ID = "   ";
    process.env.STRIPE_PRICE_FLOW = "price_flow_real";
    const { PRICING_TIERS } = loadFresh();
    expect(PRICING_TIERS.flow.priceId).toBe("price_flow_real");
  });
});
