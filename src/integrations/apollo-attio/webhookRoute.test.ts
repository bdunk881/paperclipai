// Prevent transitive import of ESM-only @mistralai/mistralai package
jest.mock("../../engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

// Mock the AttioClient so no real HTTP calls are made
jest.mock("./attio-client", () => {
  const assertPerson = jest.fn().mockResolvedValue({ id: { record_id: "person-001" } });
  const assertCompany = jest.fn().mockResolvedValue({ id: { record_id: "company-001" } });
  const addToList = jest.fn().mockResolvedValue({ id: { entry_id: "entry-001" } });

  return {
    AttioClient: jest.fn().mockImplementation(() => ({
      assertPerson,
      assertCompany,
      addToList,
    })),
    mapApolloPersonToAttio: jest.fn(),
    __mocks: { assertPerson, assertCompany, addToList },
  };
});

import request from "supertest";
import app from "../../app";

const { __mocks } = jest.requireMock("./attio-client") as {
  __mocks: {
    assertPerson: jest.Mock;
    assertCompany: jest.Mock;
    addToList: jest.Mock;
  };
};

const WEBHOOK_SECRET = "test-webhook-secret-123";

const validPayload = {
  event: "email_reply",
  data: {
    contact: {
      id: "apollo-contact-1",
      email: "jane@acme.com",
      first_name: "Jane",
      last_name: "Doe",
      title: "VP Operations",
      linkedin_url: "https://linkedin.com/in/janedoe",
      phone_numbers: [{ raw_number: "+15551234567" }],
      organization: {
        name: "Acme Corp",
        primary_domain: "acme.com",
        short_description: "Enterprise automation",
        linkedin_url: "https://linkedin.com/company/acme",
        estimated_num_employees: 150,
      },
    },
  },
};

describe("POST /api/webhooks/apollo", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      APOLLO_WEBHOOK_SECRET: WEBHOOK_SECRET,
      ATTIO_API_KEY: "attio-test-key",
    };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // --- Auth ---

  it("returns 503 when APOLLO_WEBHOOK_SECRET is not set", async () => {
    delete process.env.APOLLO_WEBHOOK_SECRET;
    const res = await request(app)
      .post("/api/webhooks/apollo")
      .set("x-apollo-secret", "anything")
      .send(validPayload);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it("returns 401 when secret header is missing", async () => {
    const res = await request(app)
      .post("/api/webhooks/apollo")
      .send(validPayload);
    expect(res.status).toBe(401);
  });

  it("returns 401 when secret header is wrong", async () => {
    const res = await request(app)
      .post("/api/webhooks/apollo")
      .set("x-apollo-secret", "wrong-secret")
      .send(validPayload);
    expect(res.status).toBe(401);
  });

  // --- Event filtering ---

  it("skips non-email_reply events gracefully", async () => {
    const res = await request(app)
      .post("/api/webhooks/apollo")
      .set("x-apollo-secret", WEBHOOK_SECRET)
      .send({ event: "email_opened", data: {} });
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(true);
    expect(__mocks.assertPerson).not.toHaveBeenCalled();
  });

  it("returns 422 when contact email is missing", async () => {
    const res = await request(app)
      .post("/api/webhooks/apollo")
      .set("x-apollo-secret", WEBHOOK_SECRET)
      .send({ event: "email_reply", data: { contact: { first_name: "No Email" } } });
    expect(res.status).toBe(422);
  });

  // --- Happy path ---

  it("upserts person and company in Attio for a valid email_reply", async () => {
    const res = await request(app)
      .post("/api/webhooks/apollo")
      .set("x-apollo-secret", WEBHOOK_SECRET)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.personId).toBe("person-001");
    expect(res.body.companyId).toBe("company-001");

    // Company upserted
    expect(__mocks.assertCompany).toHaveBeenCalledWith("acme.com", expect.objectContaining({
      name: "Acme Corp",
      source: "May5Launch",
      entity: "AutoFlow",
    }));

    // Person upserted
    expect(__mocks.assertPerson).toHaveBeenCalledWith("jane@acme.com", expect.objectContaining({
      firstName: "Jane",
      lastName: "Doe",
      jobTitle: "VP Operations",
      source: "May5Launch",
      entity: "AutoFlow",
    }));

    // Added to lists (company list + leads list)
    expect(__mocks.addToList).toHaveBeenCalledTimes(2);
    expect(__mocks.addToList).toHaveBeenCalledWith("sales", "companies", "company-001");
    expect(__mocks.addToList).toHaveBeenCalledWith("autoflow_leads", "people", "person-001");
  });

  it("handles contact without organization gracefully", async () => {
    const payload = {
      event: "email_reply",
      data: {
        contact: {
          email: "solo@example.com",
          first_name: "Solo",
          last_name: "Dev",
        },
      },
    };

    const res = await request(app)
      .post("/api/webhooks/apollo")
      .set("x-apollo-secret", WEBHOOK_SECRET)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.companyId).toBeNull();
    expect(__mocks.assertCompany).not.toHaveBeenCalled();
    expect(__mocks.assertPerson).toHaveBeenCalledWith("solo@example.com", expect.objectContaining({
      firstName: "Solo",
      source: "May5Launch",
    }));
  });

  it("supports entity override via query parameter", async () => {
    const res = await request(app)
      .post("/api/webhooks/apollo?entity=threat_warriors")
      .set("x-apollo-secret", WEBHOOK_SECRET)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(__mocks.assertPerson).toHaveBeenCalledWith("jane@acme.com", expect.objectContaining({
      entity: "Threat Warriors",
    }));
  });

  it("returns 400 for unknown entity", async () => {
    const res = await request(app)
      .post("/api/webhooks/apollo?entity=nonexistent")
      .set("x-apollo-secret", WEBHOOK_SECRET)
      .send(validPayload);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown entity/);
  });

  // --- Error handling ---

  it("returns 502 when Attio API fails", async () => {
    __mocks.assertPerson.mockRejectedValueOnce(new Error("Attio API error 500: internal"));
    const res = await request(app)
      .post("/api/webhooks/apollo")
      .set("x-apollo-secret", WEBHOOK_SECRET)
      .send(validPayload);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Attio sync failed/);
  });

  it("tolerates duplicate list entry errors (idempotent)", async () => {
    __mocks.addToList.mockRejectedValue(new Error("Attio API error 409: already exists"));
    const res = await request(app)
      .post("/api/webhooks/apollo")
      .set("x-apollo-secret", WEBHOOK_SECRET)
      .send(validPayload);

    // Should still succeed — duplicate list adds are swallowed
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it("returns 503 when ATTIO_API_KEY is not set", async () => {
    delete process.env.ATTIO_API_KEY;
    const res = await request(app)
      .post("/api/webhooks/apollo")
      .set("x-apollo-secret", WEBHOOK_SECRET)
      .send(validPayload);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});
