jest.mock("./engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

import request from "supertest";
import app from "./app";
import { knowledgeStore } from "./knowledge/knowledgeStore";

describe("QA E2E bearer auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      QA_E2E_BEARER_TOKEN: "qa-e2e-secret",
      QA_E2E_USER_ID: "usr-qa-preview",
      QA_E2E_USER_EMAIL: "qa-preview@autoflow.local",
      QA_E2E_USER_NAME: "QA Preview User",
    };
    knowledgeStore.clear();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("returns the configured QA identity from /api/me", async () => {
    const res = await request(app)
      .get("/api/me")
      .set("Authorization", "Bearer qa-e2e-secret");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      user: {
        sub: "usr-qa-preview",
        email: "qa-preview@autoflow.local",
        name: "QA Preview User",
      },
    });
  });

  it("allows the QA bearer token to create and list knowledge bases", async () => {
    const createRes = await request(app)
      .post("/api/knowledge/bases")
      .set("Authorization", "Bearer qa-e2e-secret")
      .send({ name: "QA KB" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.userId).toBe("usr-qa-preview");

    const listRes = await request(app)
      .get("/api/knowledge/bases")
      .set("Authorization", "Bearer qa-e2e-secret");

    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(1);
    expect(listRes.body.bases[0]).toMatchObject({
      name: "QA KB",
      userId: "usr-qa-preview",
    });
  });
});
