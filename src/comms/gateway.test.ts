import { CommsGateway } from "./gateway";
import { commsSendStore } from "./commsSendStore";
import { CommsChannel, CommsTransport, TransportMessage, TransportResult } from "./types";

const WS = "11111111-1111-1111-1111-111111111111";

class FakeTransport implements CommsTransport {
  readonly calls: TransportMessage[] = [];
  constructor(
    readonly id: string,
    readonly channel: CommsChannel,
    private readonly behavior: "ok" | "throw" = "ok",
  ) {}

  async send(message: TransportMessage): Promise<TransportResult> {
    this.calls.push(message);
    if (this.behavior === "throw") {
      throw new Error("provider exploded");
    }
    return { providerMessageId: `msg_${this.calls.length}` };
  }
}

beforeEach(async () => {
  await commsSendStore.clear();
});

describe("CommsGateway", () => {
  it("routes to the registered transport and records a sent row", async () => {
    const transport = new FakeTransport("fake-email", "email");
    const gateway = new CommsGateway().registerTransport("email", transport, "system");

    const result = await gateway.send({
      workspaceId: WS,
      kind: "system",
      channel: "email",
      to: "user@example.com",
      idempotencyKey: "invite-1",
    });

    expect(result.status).toBe("sent");
    expect(result.deduped).toBe(false);
    expect(result.provider).toBe("fake-email");
    expect(result.providerMessageId).toBe("msg_1");
    expect(transport.calls).toHaveLength(1);

    const ledger = await commsSendStore.findByIdempotencyKey(WS, "invite-1");
    expect(ledger?.status).toBe("sent");
    expect(ledger?.to).toBe("user@example.com");
    expect(ledger?.provider).toBe("fake-email");
  });

  it("dedups a repeated idempotencyKey without calling the transport twice", async () => {
    const transport = new FakeTransport("fake-email", "email");
    const gateway = new CommsGateway().registerTransport("email", transport, "system");
    const input = {
      workspaceId: WS,
      kind: "system" as const,
      channel: "email" as const,
      to: "u@e.com",
      idempotencyKey: "k1",
    };

    const first = await gateway.send(input);
    const second = await gateway.send(input);

    expect(transport.calls).toHaveLength(1);
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("sent");
  });

  it("records a failed row and returns (does not throw) when the transport throws", async () => {
    const transport = new FakeTransport("fake-email", "email", "throw");
    const gateway = new CommsGateway().registerTransport("email", transport, "system");

    const result = await gateway.send({
      workspaceId: WS,
      kind: "system",
      channel: "email",
      to: "u@e.com",
      idempotencyKey: "k-fail",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("provider exploded");

    const ledger = await commsSendStore.findByIdempotencyKey(WS, "k-fail");
    expect(ledger?.status).toBe("failed");
    expect(ledger?.error).toContain("provider exploded");
  });

  it("prefers a kind-specific transport over the channel default", async () => {
    const fallback = new FakeTransport("default-email", "email");
    const authTransport = new FakeTransport("auth-email", "email");
    const gateway = new CommsGateway()
      .registerTransport("email", fallback)
      .registerTransport("email", authTransport, "auth");

    const result = await gateway.send({
      workspaceId: WS,
      kind: "auth",
      channel: "email",
      to: "u@e.com",
      idempotencyKey: "k-auth",
    });

    expect(result.provider).toBe("auth-email");
    expect(authTransport.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0);
  });

  it("falls back to the channel default when no kind-specific transport exists", async () => {
    const fallback = new FakeTransport("default-sms", "sms");
    const gateway = new CommsGateway().registerTransport("sms", fallback);

    const result = await gateway.send({
      workspaceId: WS,
      kind: "customer",
      channel: "sms",
      to: "+15555550123",
      idempotencyKey: "k-sms",
    });

    expect(result.status).toBe("sent");
    expect(result.provider).toBe("default-sms");
  });

  it("throws when no transport is registered for the channel", async () => {
    const gateway = new CommsGateway();
    await expect(
      gateway.send({
        workspaceId: WS,
        kind: "system",
        channel: "email",
        to: "u@e.com",
        idempotencyKey: "k-x",
      }),
    ).rejects.toThrow(/no transport/i);
  });

  it("rejects a registration whose transport channel does not match", () => {
    const gateway = new CommsGateway();
    const smsTransport = new FakeTransport("oops", "sms");
    expect(() => gateway.registerTransport("email", smsTransport)).toThrow(/handles 'sms'/);
  });

  it("rejects invalid input (workspaceId, idempotencyKey, recipient)", async () => {
    const gateway = new CommsGateway().registerTransport(
      "email",
      new FakeTransport("f", "email"),
      "system",
    );
    await expect(
      gateway.send({
        workspaceId: "not-a-uuid",
        kind: "system",
        channel: "email",
        to: "u@e.com",
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/workspaceId/);
    await expect(
      gateway.send({
        workspaceId: WS,
        kind: "system",
        channel: "email",
        to: "u@e.com",
        idempotencyKey: "  ",
      }),
    ).rejects.toThrow(/idempotencyKey/);
    await expect(
      gateway.send({
        workspaceId: WS,
        kind: "system",
        channel: "email",
        to: "",
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/recipient/);
  });
});
