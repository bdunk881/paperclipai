/**
 * Integration tests for /api/llm-configs endpoints.
 * Verifies secret masking, provider-specific validation, and backward compatibility.
 */

jest.mock("../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));
jest.mock("../auth/authMiddleware", () => ({
  requireAuth: (
    req: { headers: { authorization?: string }; auth?: { sub: string } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: auth.slice(7) };
    next();
  },
}));

import request from "supertest";
import app from "../app";
import { llmConfigStore } from "./llmConfigStore";

const USER_A = "user-alice";
const USER_B = "user-bob";

function asAuth(userId: string) {
  return { Authorization: `Bearer ${userId}` };
}

beforeEach(() => {
  llmConfigStore.clear();
});

describe("POST /api/llm-configs", () => {
  it("creates an API-key config and returns masked fields only", async () => {
    const res = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({
        provider: "openai",
        label: "My GPT-4o key",
        model: "gpt-4o",
        apiKey: "sk-test-abc1234",
      });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe("openai");
    expect(res.body.apiKeyMasked).toBe("****1234");
    expect(res.body.credentialSummary).toEqual({ apiKeyMasked: "****1234" });
    expect(res.body.apiKey).toBeUndefined();
    expect(res.body.credentialsEncrypted).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("abc1234");
  });

  it("accepts azure-openai config with provider options", async () => {
    const res = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({
        provider: "azure-openai",
        label: "Azure prod",
        model: "gpt-4o",
        apiKey: "azure-secret-1234",
        providerOptions: {
          endpoint: "https://example-resource.openai.azure.com",
          deployment: "gpt4o-prod",
          apiVersion: "2025-01-01-preview",
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.providerOptions).toEqual({
      endpoint: "https://example-resource.openai.azure.com",
      deployment: "gpt4o-prod",
      apiVersion: "2025-01-01-preview",
    });
    expect(res.body.apiKeyMasked).toBe("****1234");
  });

  it("accepts bedrock config with AWS credentials", async () => {
    const res = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({
        provider: "bedrock",
        label: "Bedrock prod",
        model: "amazon.nova-pro-v1:0",
        credentials: {
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
          sessionToken: "bedrock-session-token-9999",
        },
        providerOptions: {
          region: "us-east-1",
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe("bedrock");
    expect(res.body.providerOptions).toEqual({
      region: "us-east-1",
    });
    expect(res.body.credentialSummary.accessKeyIdMasked).toBe("****MPLE");
    expect(res.body.credentialSummary.secretAccessKeyMasked).toBe("****EKEY");
    expect(res.body.credentialSummary.sessionTokenMasked).toBe("****9999");
  });

  it("accepts vertex-ai config with service-account credentials", async () => {
    const serviceAccountJson = JSON.stringify({
      type: "service_account",
      client_email: "vertex@example.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----abcd",
    });

    const res = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({
        provider: "vertex-ai",
        label: "Vertex prod",
        model: "gemini-1.5-pro-002",
        credentials: {
          serviceAccountJson,
        },
        providerOptions: {
          projectId: "autoflow-prod",
          location: "us-central1",
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.providerOptions).toEqual({
      projectId: "autoflow-prod",
      location: "us-central1",
    });
    expect(res.body.credentialSummary.serviceAccountJsonMasked).toMatch(/^\*\*\*\*/);
    expect(JSON.stringify(res.body)).not.toContain("vertex@example");
  });

  it("returns 400 for missing provider-specific requirements", async () => {
    const azure = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({
        provider: "azure-openai",
        label: "Azure",
        model: "gpt-4o",
        apiKey: "azure-secret-1234",
      });
    expect(azure.status).toBe(400);
    expect(azure.body.error).toMatch(/deployment|endpoint/i);

    const bedrock = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({
        provider: "bedrock",
        label: "Bedrock",
        model: "amazon.nova-lite-v1:0",
        providerOptions: { region: "us-east-1" },
      });
    expect(bedrock.status).toBe(400);
    expect(bedrock.body.error).toMatch(/accessKeyId|secretAccessKey/);

    const vertex = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({
        provider: "vertex-ai",
        label: "Vertex",
        model: "gemini-1.5-pro-002",
        providerOptions: { projectId: "autoflow-prod", location: "us-central1" },
      });
    expect(vertex.status).toBe(400);
    expect(vertex.body.error).toMatch(/serviceAccountJson|oauthAccessToken/);
  });

  it("returns 400 for an invalid provider", async () => {
    const res = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({ provider: "llama", label: "key", model: "llama-3", apiKey: "sk-test-1234" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/provider/i);
  });
});

describe("GET /api/llm-configs", () => {
  it("returns only the requesting user's configs", async () => {
    await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({ provider: "openai", label: "Alice key", model: "gpt-4o", apiKey: "sk-test-alice1" });

    await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_B))
      .send({ provider: "anthropic", label: "Bob key", model: "claude-3-haiku", apiKey: "sk-test-bob12" });

    const resA = await request(app).get("/api/llm-configs").set(asAuth(USER_A));
    expect(resA.status).toBe(200);
    expect(resA.body.configs).toHaveLength(1);
    expect(resA.body.configs[0].userId).toBe(USER_A);
    expect(resA.body.configs[0].credentialSummary).toEqual({ apiKeyMasked: "****ice1" });

    const resB = await request(app).get("/api/llm-configs").set(asAuth(USER_B));
    expect(resB.body.configs).toHaveLength(1);
    expect(resB.body.configs[0].userId).toBe(USER_B);
  });

  it("never returns raw secrets in list responses", async () => {
    await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({
        provider: "bedrock",
        label: "Bedrock key",
        model: "amazon.nova-pro-v1:0",
        credentials: {
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "bedrock-secret-key-123456",
        },
        providerOptions: { region: "us-east-1" },
      });

    const res = await request(app).get("/api/llm-configs").set(asAuth(USER_A));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("bedrock-secret-key-123456");
    expect(JSON.stringify(res.body)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});

describe("PATCH /api/llm-configs/:id", () => {
  it("updates label, model, credentials, and providerOptions", async () => {
    const created = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({
        provider: "azure-openai",
        label: "Azure old",
        model: "gpt-4o",
        apiKey: "azure-old-1234",
        providerOptions: {
          endpoint: "https://old-resource.openai.azure.com",
          deployment: "old-deployment",
        },
      });

    const res = await request(app)
      .patch(`/api/llm-configs/${created.body.id}`)
      .set(asAuth(USER_A))
      .send({
        label: "Azure new",
        providerOptions: {
          endpoint: "https://new-resource.openai.azure.com",
          deployment: "new-deployment",
          apiVersion: "2025-01-01-preview",
        },
        apiKey: "azure-new-9999",
      });

    expect(res.status).toBe(200);
    expect(res.body.label).toBe("Azure new");
    expect(res.body.providerOptions).toEqual({
      endpoint: "https://new-resource.openai.azure.com",
      deployment: "new-deployment",
      apiVersion: "2025-01-01-preview",
    });
    expect(res.body.apiKeyMasked).toBe("****9999");
    expect(res.body.apiKey).toBeUndefined();
  });

  it("returns 404 when accessing another user's config", async () => {
    const created = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({ provider: "openai", label: "Alice key", model: "gpt-4o", apiKey: "sk-test-aaaaaaaa" });

    const res = await request(app)
      .patch(`/api/llm-configs/${created.body.id}`)
      .set(asAuth(USER_B))
      .send({ label: "Stolen" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/llm-configs/:id", () => {
  it("deletes a config", async () => {
    const created = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({ provider: "openai", label: "To delete", model: "gpt-4o", apiKey: "sk-test-todelete" });

    const del = await request(app)
      .delete(`/api/llm-configs/${created.body.id}`)
      .set(asAuth(USER_A));

    expect(del.status).toBe(204);
  });
});

describe("PATCH /api/llm-configs/:id/default", () => {
  it("sets a config as default and clears any previous default", async () => {
    const first = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({ provider: "openai", label: "First", model: "gpt-4o", apiKey: "sk-test-first123" });

    const second = await request(app)
      .post("/api/llm-configs")
      .set(asAuth(USER_A))
      .send({ provider: "anthropic", label: "Second", model: "claude-3-5-sonnet-20241022", apiKey: "sk-test-second12" });

    await request(app)
      .patch(`/api/llm-configs/${first.body.id}/default`)
      .set(asAuth(USER_A));

    const res = await request(app)
      .patch(`/api/llm-configs/${second.body.id}/default`)
      .set(asAuth(USER_A));

    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);

    const list = await request(app).get("/api/llm-configs").set(asAuth(USER_A));
    const firstCfg = list.body.configs.find((cfg: { id: string }) => cfg.id === first.body.id);
    const secondCfg = list.body.configs.find((cfg: { id: string }) => cfg.id === second.body.id);
    expect(firstCfg.isDefault).toBe(false);
    expect(secondCfg.isDefault).toBe(true);
  });
});
