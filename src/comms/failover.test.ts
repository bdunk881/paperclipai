import { CommsGateway, type CommsGatewayDeps } from "./gateway";
import { TransportError, type CommsTransport, type TransportResult } from "./types";

interface StoreCalls {
  sent: string[];
  failed: string[];
}

function fakeStore(calls: StoreCalls): CommsGatewayDeps["store"] {
  return {
    findByIdempotencyKey: async () => null,
    insertQueued: async (input: { provider?: string }) => ({
      record: { id: "row-1", status: "queued", provider: input.provider },
      created: true,
    }),
    markSent: async (_ws: string, _id: string, fields: { provider?: string }) => {
      calls.sent.push(fields.provider ?? "");
    },
    markFailed: async (_ws: string, _id: string, err: string) => {
      calls.failed.push(err);
    },
  } as unknown as CommsGatewayDeps["store"];
}

function emailTransport(
  id: string,
  send: () => Promise<TransportResult>,
): CommsTransport {
  return { id, channel: "email", send };
}

const INPUT = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  kind: "customer" as const,
  channel: "email" as const,
  to: "lead@example.com",
  idempotencyKey: "k1",
};

describe("CommsGateway failover (HEL-617)", () => {
  it("fails over to the secondary on a retryable (5xx) primary failure", async () => {
    const calls: StoreCalls = { sent: [], failed: [] };
    const gateway = new CommsGateway({ store: fakeStore(calls) });
    gateway.registerTransport(
      "email",
      emailTransport("primary", async () => {
        throw new TransportError("503", { status: 503 });
      }),
      "customer",
    );
    gateway.registerTransport(
      "email",
      emailTransport("secondary", async () => ({ providerMessageId: "ok-1" })),
      "customer",
    );

    const res = await gateway.send(INPUT);
    expect(res.status).toBe("sent");
    expect(res.provider).toBe("secondary");
    expect(res.providerMessageId).toBe("ok-1");
    expect(calls.sent).toEqual(["secondary"]);
    expect(calls.failed).toHaveLength(0);
  });

  it("does NOT fail over on a non-retryable (4xx) primary failure", async () => {
    const calls: StoreCalls = { sent: [], failed: [] };
    let secondaryCalled = false;
    const gateway = new CommsGateway({ store: fakeStore(calls) });
    gateway.registerTransport(
      "email",
      emailTransport("primary", async () => {
        throw new TransportError("400", { status: 400 });
      }),
      "customer",
    );
    gateway.registerTransport(
      "email",
      emailTransport("secondary", async () => {
        secondaryCalled = true;
        return { providerMessageId: "ok" };
      }),
      "customer",
    );

    const res = await gateway.send(INPUT);
    expect(res.status).toBe("failed");
    expect(secondaryCalled).toBe(false);
    expect(calls.sent).toHaveLength(0);
    expect(calls.failed).toHaveLength(1);
  });

  it("marks failed when every provider fails with a retryable error", async () => {
    const calls: StoreCalls = { sent: [], failed: [] };
    const gateway = new CommsGateway({ store: fakeStore(calls) });
    gateway.registerTransport(
      "email",
      emailTransport("primary", async () => {
        throw new TransportError("503", { status: 503 });
      }),
      "customer",
    );
    gateway.registerTransport(
      "email",
      emailTransport("secondary", async () => {
        throw new TransportError("502", { status: 502 });
      }),
      "customer",
    );

    const res = await gateway.send(INPUT);
    expect(res.status).toBe("failed");
    expect(calls.sent).toHaveLength(0);
    expect(calls.failed).toHaveLength(1);
  });

  it("falls back from a kind-specific provider to the channel default", async () => {
    const calls: StoreCalls = { sent: [], failed: [] };
    const gateway = new CommsGateway({ store: fakeStore(calls) });
    gateway.registerTransport(
      "email",
      emailTransport("customer-primary", async () => {
        throw new TransportError("503", { status: 503 });
      }),
      "customer",
    );
    // No kind → channel-wide default (*:email), tried after the kind-specific one.
    gateway.registerTransport(
      "email",
      emailTransport("channel-default", async () => ({ providerMessageId: "ok" })),
    );

    const res = await gateway.send(INPUT);
    expect(res.status).toBe("sent");
    expect(res.provider).toBe("channel-default");
    expect(calls.sent).toEqual(["channel-default"]);
  });
});
