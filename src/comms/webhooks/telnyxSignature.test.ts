import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { verifyTelnyxSignature } from "./telnyxSignature";

/** Telnyx publishes a base64 raw 32-byte Ed25519 key; derive it from the SPKI DER. */
function makeKeypair(): { privateKey: KeyObject; publicKeyB64: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const rawPub = spki.subarray(spki.length - 32);
  return { privateKey, publicKeyB64: rawPub.toString("base64") };
}

function signTelnyx(privateKey: KeyObject, timestamp: string, payload: string): string {
  return cryptoSign(null, Buffer.from(`${timestamp}|${payload}`, "utf8"), privateKey).toString("base64");
}

describe("verifyTelnyxSignature (HEL-613)", () => {
  const { privateKey, publicKeyB64 } = makeKeypair();
  const payload = JSON.stringify({ data: { event_type: "message.received" } });
  const timestamp = String(Math.floor(Date.now() / 1000));

  it("accepts a valid signature", () => {
    const signature = signTelnyx(privateKey, timestamp, payload);
    expect(
      verifyTelnyxSignature({ payload, signature, timestamp, publicKey: publicKeyB64 }),
    ).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const signature = signTelnyx(privateKey, timestamp, payload);
    expect(
      verifyTelnyxSignature({ payload: `${payload} `, signature, timestamp, publicKey: publicKeyB64 }),
    ).toBe(false);
  });

  it("rejects a stale timestamp outside the replay window", () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 10_000);
    const signature = signTelnyx(privateKey, staleTs, payload);
    expect(
      verifyTelnyxSignature({ payload, signature, timestamp: staleTs, publicKey: publicKeyB64 }),
    ).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const other = makeKeypair();
    const signature = signTelnyx(other.privateKey, timestamp, payload);
    expect(
      verifyTelnyxSignature({ payload, signature, timestamp, publicKey: publicKeyB64 }),
    ).toBe(false);
  });

  it("rejects when no public key is configured", () => {
    const signature = signTelnyx(privateKey, timestamp, payload);
    expect(verifyTelnyxSignature({ payload, signature, timestamp, publicKey: "" })).toBe(false);
  });
});
