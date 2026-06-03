/**
 * Regression test for HEL-401.
 *
 * `getDefaultStripeFacade` used to call a non-existent `getStripeClient`
 * export, so the resolved client was ALWAYS undefined and every admin
 * refund returned 503 even when Stripe was configured. These tests pin the
 * facade to the real `getStripe()` export and assert both the configured
 * (non-null facade) and unconfigured (null → 503) paths.
 */

import * as stripeClient from "../billing/stripeClient";
import { getDefaultStripeFacade } from "./billingRoutes";

jest.mock("../billing/stripeClient");

const mockGetStripe = stripeClient.getStripe as jest.MockedFunction<
  typeof stripeClient.getStripe
>;

describe("getDefaultStripeFacade (HEL-401)", () => {
  beforeEach(() => {
    mockGetStripe.mockReset();
  });

  it("resolves a non-null facade when Stripe is configured", async () => {
    mockGetStripe.mockReturnValue({
      refunds: { create: jest.fn() },
      subscriptions: { update: jest.fn(), cancel: jest.fn() },
    } as unknown as ReturnType<typeof stripeClient.getStripe>);

    const facade = await getDefaultStripeFacade();

    expect(facade).not.toBeNull();
    expect(typeof facade?.refundCharge).toBe("function");
    expect(typeof facade?.cancelSubscription).toBe("function");
    expect(mockGetStripe).toHaveBeenCalledTimes(1);
  });

  it("returns null when Stripe is not configured (getStripe throws)", async () => {
    mockGetStripe.mockImplementation(() => {
      throw new Error("Stripe secret key environment variable is not set");
    });

    const facade = await getDefaultStripeFacade();

    expect(facade).toBeNull();
  });
});
