import { CommsGateway } from "./gateway";
import { commsSendStore } from "./commsSendStore";
import { enqueueCommsSend } from "./commsQueue";
import { processCommsSendJob } from "./commsWorker";
import {
  CommsChannel,
  CommsKind,
  CommsTransport,
  TransportError,
  TransportMessage,
  TransportResult,
} from "./types";

const WS = "11111111-1111-1111-1111-111111111111";

class FakeTransport implements CommsTransport {
  calls = 0;
  constructor(
    readonly id: string,
    readonly channel: CommsChannel,
    private readonly behavior: "ok" | "permanent" | "transient" = "ok",
  ) {}

  async send(_message: TransportMessage): Promise<TransportResult> {
    this.calls += 1;
    if (this.behavior === "permanent") {
      throw new TransportError("bad request", { status: 422 });
    }
    if (this.behavior === "transient") {
      throw new TransportError("upstream unavailable", { status: 503 });
    }
    return { providerMessageId: `m${this.calls}` };
  }
}

function gatewayWith(transport: CommsTransport, kind?: CommsKind): CommsGateway {
  return new CommsGateway().registerTransport(transport.channel, transport, kind);
}

beforeEach(async () => {
  await commsSendStore.clear();
});

describe("TransportError classification", () => {
  it("treats 5xx as retryable and 4xx as permanent", () => {
    expect(new TransportError("x", { status: 503 }).retryable).toBe(true);
    expect(new TransportError("x", { status: 422 }).retryable).toBe(false);
    expect(new TransportError("x").retryable).toBe(true);
    expect(new TransportError("x", { retryable: false, status: 500 }).retryable).toBe(false);
  });
});

describe("enqueueCommsSend (no Redis → inline fallback)", () => {
  it("delivers synchronously and records the row sent", async () => {
    const gateway = gatewayWith(new FakeTransport("fake-sms", "sms"), "customer");
    const result = await enqueueCommsSend(
      { workspaceId: WS, kind: "customer", channel: "sms", to: "+15555550123", idempotencyKey: "k1", text: "hi" },
      { gateway },
    );
    expect(result.status).toBe("sent");
    expect((await commsSendStore.findByIdempotencyKey(WS, "k1"))?.status).toBe("sent");
  });

  it("dedups a repeated idempotency key (transport called once)", async () => {
    const transport = new FakeTransport("fake-sms", "sms");
    const gateway = gatewayWith(transport, "customer");
    const input = {
      workspaceId: WS,
      kind: "customer" as const,
      channel: "sms" as const,
      to: "+1",
      idempotencyKey: "k2",
      text: "hi",
    };
    await enqueueCommsSend(input, { gateway });
    const second = await enqueueCommsSend(input, { gateway });
    expect(transport.calls).toBe(1);
    expect(second.deduped).toBe(true);
  });
});

describe("processCommsSendJob", () => {
  async function queueRow(idempotencyKey: string): Promise<string> {
    const { record } = await commsSendStore.insertQueued({
      workspaceId: WS,
      kind: "customer",
      channel: "sms",
      to: "+1",
      idempotencyKey,
    });
    return record.id;
  }
  const payloadFor = (id: string) => ({
    commsSendId: id,
    workspaceId: WS,
    kind: "customer" as const,
    channel: "sms" as const,
    message: { to: "+1", text: "hi" },
  });

  it("delivers and marks the row sent", async () => {
    const id = await queueRow("p1");
    await processCommsSendJob(payloadFor(id), gatewayWith(new FakeTransport("fake-sms", "sms"), "customer"));
    expect((await commsSendStore.findById(WS, id))?.status).toBe("sent");
  });

  it("records a permanent (4xx) failure and does NOT throw", async () => {
    const id = await queueRow("p2");
    const gateway = gatewayWith(new FakeTransport("fake-sms", "sms", "permanent"), "customer");
    await expect(processCommsSendJob(payloadFor(id), gateway)).resolves.toBeUndefined();
    expect((await commsSendStore.findById(WS, id))?.status).toBe("failed");
  });

  it("rethrows on a transient (5xx) failure so BullMQ retries (row left queued)", async () => {
    const id = await queueRow("p3");
    const gateway = gatewayWith(new FakeTransport("fake-sms", "sms", "transient"), "customer");
    await expect(processCommsSendJob(payloadFor(id), gateway)).rejects.toThrow(/upstream/);
    expect((await commsSendStore.findById(WS, id))?.status).toBe("queued");
  });

  it("is a no-op when the row is already sent (idempotent retry)", async () => {
    const id = await queueRow("p4");
    const transport = new FakeTransport("fake-sms", "sms");
    const gateway = gatewayWith(transport, "customer");
    await processCommsSendJob(payloadFor(id), gateway);
    await processCommsSendJob(payloadFor(id), gateway);
    expect(transport.calls).toBe(1);
  });

  it("permanently fails (no retry) when no transport is registered", async () => {
    const id = await queueRow("p5");
    await expect(processCommsSendJob(payloadFor(id), new CommsGateway())).resolves.toBeUndefined();
    expect((await commsSendStore.findById(WS, id))?.status).toBe("failed");
  });
});
