import { TelnyxSmsTransport, isTelnyxConfigured } from "./telnyxSms";
import { registerCommsTransports } from "./registerTransports";
import { CommsGateway } from "../gateway";
import { commsSendStore } from "../commsSendStore";
import { getIntegrationBySlug } from "../../integrations/integrationCatalog";

const ENV_KEYS = [
  "TELNYX_API_KEY",
  "TELNYX_SMS_FROM",
  "TELNYX_MESSAGING_PROFILE_ID",
  "TELNYX_API_BASE_URL",
];
const saved: Record<string, string | undefined> = {};

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(async () => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  await commsSendStore.clear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = saved[k];
    }
  }
  jest.restoreAllMocks();
});

describe("TelnyxSmsTransport", () => {
  it("posts to the Telnyx messages API and returns the provider message id", async () => {
    process.env.TELNYX_API_KEY = "KEY123";
    process.env.TELNYX_SMS_FROM = "+15555550100";
    const spy = jest
      .spyOn(global, "fetch")
      .mockImplementation(async () => fakeResponse(200, { data: { id: "tlnx_1" } }));

    const result = await new TelnyxSmsTransport().send({ to: "+15555550123", text: "hello" });

    expect(result.providerMessageId).toBe("tlnx_1");
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/v2/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer KEY123");
    expect(JSON.parse(init.body as string)).toMatchObject({
      to: "+15555550123",
      text: "hello",
      from: "+15555550100",
    });
  });

  it("throws when TELNYX_API_KEY is missing", async () => {
    process.env.TELNYX_SMS_FROM = "+15555550100";
    await expect(new TelnyxSmsTransport().send({ to: "+1", text: "x" })).rejects.toThrow(
      /TELNYX_API_KEY/,
    );
  });

  it("throws when no sender (from / messaging profile) is configured", async () => {
    process.env.TELNYX_API_KEY = "KEY123";
    await expect(new TelnyxSmsTransport().send({ to: "+1", text: "x" })).rejects.toThrow(
      /TELNYX_SMS_FROM|TELNYX_MESSAGING_PROFILE_ID/,
    );
  });

  it("throws on a non-2xx Telnyx response", async () => {
    process.env.TELNYX_API_KEY = "KEY123";
    process.env.TELNYX_SMS_FROM = "+15555550100";
    jest.spyOn(global, "fetch").mockImplementation(async () => fakeResponse(422, "bad number"));
    await expect(new TelnyxSmsTransport().send({ to: "+1", text: "x" })).rejects.toThrow(/422/);
  });
});

describe("registerCommsTransports", () => {
  it("registers Telnyx as the SMS default and the gateway sends through it", async () => {
    process.env.TELNYX_API_KEY = "KEY123";
    process.env.TELNYX_SMS_FROM = "+15555550100";
    const spy = jest
      .spyOn(global, "fetch")
      .mockImplementation(async () => fakeResponse(200, { data: { id: "tlnx_42" } }));

    const gateway = new CommsGateway();
    expect(registerCommsTransports(gateway)).toContain("telnyx");

    const result = await gateway.send({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      kind: "customer",
      channel: "sms",
      to: "+15555550123",
      idempotencyKey: "sms-1",
      text: "hi",
    });

    expect(result.status).toBe("sent");
    expect(result.provider).toBe("telnyx");
    expect(result.providerMessageId).toBe("tlnx_42");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not register Telnyx when unconfigured", () => {
    expect(isTelnyxConfigured()).toBe(false);
    const gateway = new CommsGateway();
    expect(registerCommsTransports(gateway)).toEqual([]);
  });
});

describe("integration catalog (BYOC parity)", () => {
  it("exposes Telnyx as a communication integration with an sms.send action", () => {
    const telnyx = getIntegrationBySlug("telnyx");
    expect(telnyx).toBeDefined();
    expect(telnyx?.category).toBe("communication");
    expect(telnyx?.actions.some((a) => a.id === "sms.send")).toBe(true);
  });
});
