import { CommsGateway } from "./gateway";
import { commsSendStore } from "./commsSendStore";
import { commsSpendStore } from "./commsSpendStore";
import { estimateCommsCostUsd } from "./pricing";
import { CommsChannel, CommsTransport, TransportMessage, TransportResult } from "./types";

const WS = "11111111-1111-1111-1111-111111111111";

class FakeTransport implements CommsTransport {
  constructor(
    readonly id: string,
    readonly channel: CommsChannel,
  ) {}
  async send(_message: TransportMessage): Promise<TransportResult> {
    return { providerMessageId: "m1" };
  }
}

beforeEach(async () => {
  await commsSendStore.clear();
  await commsSpendStore.clear();
});

describe("estimateCommsCostUsd", () => {
  it("uses the per-provider rate, falling back to the channel default", () => {
    expect(estimateCommsCostUsd("sms", "telnyx", 1)).toBeCloseTo(0.0055, 6);
    expect(estimateCommsCostUsd("sms", "twilio", 1)).toBeCloseTo(0.0083, 6);
    expect(estimateCommsCostUsd("sms", "unknown-provider", 1)).toBeCloseTo(0.0075, 6);
    expect(estimateCommsCostUsd("email", undefined, 1)).toBeCloseTo(0.0002, 6);
  });

  it("scales by units (voice minutes)", () => {
    expect(estimateCommsCostUsd("voice", "telnyx", 4)).toBeCloseTo(0.012, 6);
  });
});

describe("commsSpendStore", () => {
  it("records and summarizes per channel/provider/agent", async () => {
    await commsSpendStore.recordSpend({ workspaceId: WS, channel: "sms", provider: "telnyx", costUsd: 0.0055, agentId: "agent-1" });
    await commsSpendStore.recordSpend({ workspaceId: WS, channel: "email", provider: "ses", costUsd: 0.0001 });

    const summary = await commsSpendStore.summarize(WS);
    expect(summary.count).toBe(2);
    expect(summary.totalUsd).toBeCloseTo(0.0056, 6);
    expect(summary.byChannel.sms).toBeCloseTo(0.0055, 6);
    expect(summary.byProvider.ses).toBeCloseTo(0.0001, 6);
    expect(summary.byAgent["agent-1"]).toBeCloseTo(0.0055, 6);
  });

  it("is idempotent per commsSendId", async () => {
    await commsSpendStore.recordSpend({ workspaceId: WS, channel: "sms", provider: "telnyx", costUsd: 0.0055, commsSendId: "send-1" });
    await commsSpendStore.recordSpend({ workspaceId: WS, channel: "sms", provider: "telnyx", costUsd: 0.0055, commsSendId: "send-1" });
    const summary = await commsSpendStore.summarize(WS);
    expect(summary.count).toBe(1);
  });
});

describe("gateway records spend on a successful send", () => {
  it("writes a comms_spend_entry tagged with channel/provider", async () => {
    const gateway = new CommsGateway().registerTransport("sms", new FakeTransport("telnyx", "sms"), "customer");
    await gateway.send({
      workspaceId: WS,
      kind: "customer",
      channel: "sms",
      to: "+15555550123",
      idempotencyKey: "spend-send-1",
      text: "hi",
      agentId: "agent-9",
    });

    const summary = await commsSpendStore.summarize(WS);
    expect(summary.count).toBe(1);
    expect(summary.byChannel.sms).toBeCloseTo(0.0055, 6);
    expect(summary.byProvider.telnyx).toBeCloseTo(0.0055, 6);
    expect(summary.byAgent["agent-9"]).toBeCloseTo(0.0055, 6);
  });

  it("records workspace spend even for a system send with no agent", async () => {
    const gateway = new CommsGateway().registerTransport("email", new FakeTransport("ses", "email"), "system");
    await gateway.send({
      workspaceId: WS,
      kind: "system",
      channel: "email",
      to: "user@example.com",
      idempotencyKey: "spend-send-2",
    });
    const summary = await commsSpendStore.summarize(WS);
    expect(summary.count).toBe(1);
    expect(summary.byChannel.email).toBeCloseTo(0.0001, 6);
    expect(Object.keys(summary.byAgent)).toHaveLength(0);
  });
});
