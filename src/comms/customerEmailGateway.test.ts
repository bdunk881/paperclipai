import { CommsGateway, type CommsGatewayDeps } from "./gateway";
import type { CommsTransport } from "./types";

/**
 * HEL-615: a transport that returns `{suppressed}` (opt-out / suppressed
 * recipient) must be ledgered `status:'suppressed'`, not sent — and spend is
 * not recorded. Exercised PG-free via an injected fake store.
 */
describe("CommsGateway suppressed-result handling (HEL-615)", () => {
  it("ledgers a suppressed transport result as status 'suppressed'", async () => {
    const calls = { suppressed: [] as Array<{ id: string; reason: string }>, sent: 0 };
    const fakeStore = {
      findByIdempotencyKey: async () => null,
      insertQueued: async () => ({ record: { id: "row-1", status: "queued" }, created: true }),
      markSuppressed: async (_ws: string, id: string, reason: string) => {
        calls.suppressed.push({ id, reason });
      },
      markSent: async () => {
        calls.sent += 1;
      },
      markFailed: async () => undefined,
    } as unknown as CommsGatewayDeps["store"];

    const gateway = new CommsGateway({ store: fakeStore });
    const transport: CommsTransport = {
      id: "ses",
      channel: "email",
      send: async () => ({ suppressed: true, suppressedReason: "managed_email_opt_out" }),
    };
    gateway.registerTransport("email", transport, "customer");

    const result = await gateway.send({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      kind: "customer",
      channel: "email",
      to: "lead@example.com",
      idempotencyKey: "k1",
    });

    expect(result.status).toBe("suppressed");
    expect(result.provider).toBe("ses");
    expect(calls.suppressed).toEqual([{ id: "row-1", reason: "managed_email_opt_out" }]);
    expect(calls.sent).toBe(0);
  });
});
