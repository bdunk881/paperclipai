import { generateKeyPairSync, createSign } from "node:crypto";
import { verifySnsMessage, isSnsUrl, SnsMessage } from "./snsSignature";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const certFetcher = async () => PUB_PEM;

function sign(stringToSign: string, algo: "RSA-SHA1" | "RSA-SHA256"): string {
  const signer = createSign(algo);
  signer.update(stringToSign, "utf8");
  return signer.sign(privateKey, "base64");
}

// Mirrors the Notification field order in snsSignature.ts.
function notificationStringToSign(fields: Record<string, string>): string {
  let out = "";
  for (const key of ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]) {
    if (fields[key] === undefined) {
      continue;
    }
    out += `${key}\n${fields[key]}\n`;
  }
  return out;
}

describe("isSnsUrl", () => {
  it("accepts SNS hosts over https and rejects everything else", () => {
    expect(isSnsUrl("https://sns.us-east-1.amazonaws.com/cert.pem")).toBe(true);
    expect(isSnsUrl("http://sns.us-east-1.amazonaws.com/cert.pem")).toBe(false);
    expect(isSnsUrl("https://evil.example.com/cert.pem")).toBe(false);
    expect(isSnsUrl("https://sns.us-east-1.amazonaws.com.evil.com/x")).toBe(false);
    expect(isSnsUrl("not a url")).toBe(false);
  });
});

describe("verifySnsMessage", () => {
  const base = {
    Type: "Notification",
    MessageId: "mid-1",
    Message: "hello world",
    Timestamp: "2026-01-01T00:00:00.000Z",
    TopicArn: "arn:aws:sns:us-east-1:123456789012:ses-notifications",
  };

  it("accepts a correctly signed Notification (SignatureVersion 1 / SHA1)", async () => {
    const msg: SnsMessage = {
      ...base,
      SignatureVersion: "1",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
      Signature: sign(notificationStringToSign(base), "RSA-SHA1"),
    };
    expect(await verifySnsMessage(msg, { certFetcher })).toBe(true);
  });

  it("accepts SignatureVersion 2 (SHA256)", async () => {
    const msg: SnsMessage = {
      ...base,
      SignatureVersion: "2",
      SigningCertURL: "https://sns.eu-west-1.amazonaws.com/cert.pem",
      Signature: sign(notificationStringToSign(base), "RSA-SHA256"),
    };
    expect(await verifySnsMessage(msg, { certFetcher })).toBe(true);
  });

  it("rejects a tampered message", async () => {
    const signature = sign(notificationStringToSign(base), "RSA-SHA1");
    const msg: SnsMessage = {
      ...base,
      Message: "TAMPERED",
      SignatureVersion: "1",
      SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
      Signature: signature,
    };
    expect(await verifySnsMessage(msg, { certFetcher })).toBe(false);
  });

  it("rejects a non-SNS signing cert URL without fetching it (SSRF guard)", async () => {
    let fetched = false;
    const msg: SnsMessage = {
      ...base,
      SignatureVersion: "1",
      SigningCertURL: "https://evil.example.com/cert.pem",
      Signature: sign(notificationStringToSign(base), "RSA-SHA1"),
    };
    expect(
      await verifySnsMessage(msg, {
        certFetcher: async () => {
          fetched = true;
          return PUB_PEM;
        },
      }),
    ).toBe(false);
    expect(fetched).toBe(false);
  });

  it("rejects when Signature or SigningCertURL is missing", async () => {
    expect(await verifySnsMessage({ Type: "Notification", Message: "x" } as SnsMessage, { certFetcher })).toBe(
      false,
    );
  });
});
