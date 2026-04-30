/**
 * API contract tests for AutoFlow Express endpoints.
 *
 * These tests verify the HTTP contract (status codes, response shapes, and
 * error handling) without requiring a live LLM or external service.
 */

// Prevent transitive import of ESM-only @mistralai/mistralai package
jest.mock("./engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));
jest.mock("./auth/authMiddleware", () => ({
  requireAuth: (
    req: { headers: { authorization?: string }; auth?: { sub: string; email?: string } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: auth.slice(7), email: "test@example.com" };
    next();
  },
}));

jest.mock("./auth/authMiddleware", () => ({
  requireAuth: (
    req: { headers: { authorization?: string }; auth?: { sub: string; email?: string } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: auth.slice(7), email: "test@example.com" };
    next();
  },
  requireAuthOrQaBypass: (
    req: {
      headers: { authorization?: string; "x-user-id"?: string };
      auth?: { sub: string; email?: string };
    },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      req.auth = { sub: auth.slice(7), email: "test@example.com" };
      next();
      return;
    }

    const qaBypassEnabled = process.env.QA_AUTH_BYPASS_ENABLED === "true";
    const qaBypassUserIds = new Set(
      (process.env.QA_AUTH_BYPASS_USER_IDS ?? "qa-smoke-user")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    );
    const bypassUserId = req.headers["x-user-id"]?.trim();

    if (qaBypassEnabled && bypassUserId && qaBypassUserIds.has(bypassUserId)) {
      req.auth = { sub: bypassUserId, email: "qa@example.com" };
      next();
      return;
    }

    res.status(401).json({ error: "Missing or malformed Authorization header." });
  },
}));

import request from "supertest";
import app from "./app";
import { listConnectorHealth } from "./connectors/health";
import { integrationCredentialStore } from "./integrations/integrationCredentialStore";
import { WORKFLOW_TEMPLATES } from "./templates";
import type { WorkflowStep } from "./types/workflow";
import {
  clearClassificationDecisionsForTests,
  logClassificationDecision,
} from "./engine/classificationLog";
import { extractPromptFeatures } from "./engine/promptFeatures";
import { controlPlaneStore } from "./controlPlane/controlPlaneStore";
import { approvalStore } from "./engine/approvalStore";
import { approvalNotificationStore } from "./engine/approvalNotificationStore";
import { approvalPolicyStore } from "./approvals/policyStore";
import { runStore } from "./engine/runStore";
import { knowledgeStore } from "./knowledge/knowledgeStore";
import { resetImportedTemplatesForTests } from "./templates/importedTemplateStore";
import { observabilityStore } from "./observability/store";
import {
  PORTABLE_WORKFLOW_FORMAT,
  PORTABLE_WORKFLOW_SCHEMA_VERSION,
} from "./workflows/portableSchema";

function asAuth(userId = "test-user") {
  return { Authorization: `Bearer ${userId}` };
}

beforeEach(() => {
  controlPlaneStore.clear();
  approvalStore.clear();
  approvalNotificationStore.clear();
  approvalPolicyStore.clear();
  runStore.clear();
  knowledgeStore.clear();
  observabilityStore.clear();
  integrationCredentialStore.clear();
  resetImportedTemplatesForTests();
});

function withQaBypass(userIds = "qa-smoke-user") {
  process.env.QA_AUTH_BYPASS_ENABLED = "true";
  process.env.QA_AUTH_BYPASS_USER_IDS = userIds;
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("returns the correct template count", async () => {
    const res = await request(app).get("/health");
    expect(res.body.templates).toBe(WORKFLOW_TEMPLATES.length);
  });
});

describe("GET /api/connectors/health", () => {
  it("returns connector health records and summary", async () => {
    const res = await request(app).get("/api/connectors/health").set(asAuth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.connectors)).toBe(true);
    expect(typeof res.body.summary).toBe("object");
  });

  it("returns the caller's connected integrations", async () => {
    integrationCredentialStore.create({
      userId: "test-user",
      integrationSlug: "slack",
      label: "Slack Workspace",
      credentials: { accessToken: "xoxb-token" },
    });

    const res = await request(app).get("/api/connectors/health").set(asAuth());
    expect(res.body.connectors).toHaveLength(listConnectorHealth("test-user").length);
  });

  it("includes required fields on each connector", async () => {
    integrationCredentialStore.create({
      userId: "test-user",
      integrationSlug: "slack",
      label: "Slack Workspace",
      credentials: { accessToken: "xoxb-token" },
    });

    const res = await request(app).get("/api/connectors/health").set(asAuth());
    for (const connector of res.body.connectors) {
      expect(typeof connector.connectorKey).toBe("string");
      expect(typeof connector.connectorName).toBe("string");
      expect(typeof connector.state).toBe("string");
      expect(typeof connector.successRate24h).toBe("number");
      expect(Array.isArray(connector.transitions)).toBe(true);
      expect(connector.source).toBe("api");
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/templates
// ---------------------------------------------------------------------------

describe("GET /api/templates", () => {
  it("returns 200 with a templates array", async () => {
    const res = await request(app).get("/api/templates");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
  });

  it("returns all 13 templates when no category filter is applied", async () => {
    const res = await request(app).get("/api/templates");
    expect(res.body.total).toBe(13);
    expect(res.body.templates).toHaveLength(13);
  });

  it("each template summary has required shape fields", async () => {
    const res = await request(app).get("/api/templates");
    for (const t of res.body.templates) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(typeof t.category).toBe("string");
      expect(typeof t.version).toBe("string");
      expect(typeof t.stepCount).toBe("number");
      expect(typeof t.configFieldCount).toBe("number");
      // Summary should NOT include the full steps / configFields arrays
      expect(t.steps).toBeUndefined();
      expect(t.configFields).toBeUndefined();
    }
  });

  it("filters by category=support", async () => {
    const res = await request(app).get("/api/templates?category=support");
    expect(res.status).toBe(200);
    expect(res.body.templates.every((t: { category: string }) => t.category === "support")).toBe(true);
    expect(res.body.total).toBe(res.body.templates.length);
  });

  it("filters by category=sales", async () => {
    const res = await request(app).get("/api/templates?category=sales");
    expect(res.status).toBe(200);
    expect(res.body.templates.every((t: { category: string }) => t.category === "sales")).toBe(true);
  });

  it("filters by category=content", async () => {
    const res = await request(app).get("/api/templates?category=content");
    expect(res.status).toBe(200);
    expect(res.body.templates.every((t: { category: string }) => t.category === "content")).toBe(true);
  });

  it("returns empty templates array for unknown category", async () => {
    const res = await request(app).get("/api/templates?category=unknown");
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it("total matches templates array length", async () => {
    const res = await request(app).get("/api/templates");
    expect(res.body.total).toBe(res.body.templates.length);
  });
});

// ---------------------------------------------------------------------------
// GET /api/templates/:id
// ---------------------------------------------------------------------------

describe("GET /api/templates/:id", () => {
  it("returns 200 with full template for a known id", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("tpl-support-bot");
  });

  it("returns full steps and configFields arrays", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot");
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.steps.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.configFields)).toBe(true);
    expect(res.body.configFields.length).toBeGreaterThan(0);
  });

  it("returns full template for lead enrichment", async () => {
    const res = await request(app).get("/api/templates/tpl-lead-enrich");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("tpl-lead-enrich");
    expect(res.body.category).toBe("sales");
  });

  it("returns full template for content generator", async () => {
    const res = await request(app).get("/api/templates/tpl-content-gen");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("tpl-content-gen");
    expect(res.body.category).toBe("content");
  });

  it("returns 404 with error message for unknown id", async () => {
    const res = await request(app).get("/api/templates/tpl-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("each step in full template has required fields", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot");
    for (const step of res.body.steps) {
      expect(typeof step.id).toBe("string");
      expect(typeof step.name).toBe("string");
      expect(typeof step.kind).toBe("string");
      expect(typeof step.description).toBe("string");
      expect(Array.isArray(step.inputKeys)).toBe(true);
      expect(Array.isArray(step.outputKeys)).toBe(true);
    }
  });

  it("full template includes sampleInput and expectedOutput", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot");
    expect(res.body.sampleInput).toBeDefined();
    expect(typeof res.body.sampleInput).toBe("object");
    expect(res.body.expectedOutput).toBeDefined();
    expect(typeof res.body.expectedOutput).toBe("object");
  });
});

describe("Approval tier policy API", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";

  it("lists default approval tier policies for a workspace", async () => {
    const res = await request(app)
      .get(`/api/approval-policies?workspaceId=${workspaceId}`)
      .set(asAuth());

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.policies.every((policy: { mode: string }) => policy.mode === "require_approval")).toBe(true);
  });

  it("updates a workspace approval tier policy", async () => {
    const res = await request(app)
      .put("/api/approval-policies/public_posts")
      .set(asAuth())
      .send({
        workspaceId,
        mode: "notify_only",
      });

    expect(res.status).toBe(200);
    expect(res.body.policy.actionType).toBe("public_posts");
    expect(res.body.policy.mode).toBe("notify_only");
  });

  it("rejects invalid spend thresholds", async () => {
    const res = await request(app)
      .put("/api/approval-policies/spend_above_threshold")
      .set(asAuth())
      .send({
        workspaceId,
        mode: "require_approval",
        spendThresholdCents: -1,
      });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/templates/:id/sample
// ---------------------------------------------------------------------------

describe("GET /api/templates/:id/sample", () => {
  it("returns 200 with sampleInput and expectedOutput", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot/sample");
    expect(res.status).toBe(200);
    expect(res.body.sampleInput).toBeDefined();
    expect(res.body.expectedOutput).toBeDefined();
  });

  it("sampleInput is a non-empty object", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot/sample");
    expect(Object.keys(res.body.sampleInput).length).toBeGreaterThan(0);
  });

  it("expectedOutput is a non-empty object", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot/sample");
    expect(Object.keys(res.body.expectedOutput).length).toBeGreaterThan(0);
  });

  it("sample endpoint works for all built-in templates", async () => {
    const ids = WORKFLOW_TEMPLATES.map((template) => template.id);
    for (const id of ids) {
      const res = await request(app).get(`/api/templates/${id}/sample`);
      expect(res.status).toBe(200);
      expect(res.body.sampleInput).toBeDefined();
      expect(res.body.expectedOutput).toBeDefined();
    }
  });

  it("returns 404 for unknown template id", async () => {
    const res = await request(app).get("/api/templates/tpl-unknown/sample");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

describe("Knowledge base routes", () => {
  it("creates a knowledge base, ingests a document, and searches it", async () => {
    const createRes = await request(app)
      .post("/api/knowledge/bases")
      .set(asAuth())
      .send({
        name: "Support KB",
        description: "Customer support content",
        tags: ["support"],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe("Support KB");

    const baseId = createRes.body.id as string;
    const ingestRes = await request(app)
      .post(`/api/knowledge/bases/${baseId}/documents`)
      .set(asAuth())
      .send({
        filename: "refunds.txt",
        mimeType: "text/plain",
        content:
          "Customers may request a refund within 30 days. Billing escalations go to finance.",
      });

    expect(ingestRes.status).toBe(201);
    expect(ingestRes.body.document.status).toBe("ready");
    expect(ingestRes.body.chunks.length).toBeGreaterThan(0);

    const searchRes = await request(app)
      .post("/api/knowledge/search")
      .set(asAuth())
      .send({
        query: "refund policy",
        knowledgeBaseIds: [baseId],
      });

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.total).toBeGreaterThan(0);
    expect(searchRes.body.results[0].document.filename).toBe("refunds.txt");
  });

  it("supports chunk edits after ingestion", async () => {
    const createRes = await request(app)
      .post("/api/knowledge/bases")
      .set(asAuth("knowledge-editor"))
      .send({ name: "Ops KB" });
    const baseId = createRes.body.id as string;

    const ingestRes = await request(app)
      .post(`/api/knowledge/bases/${baseId}/documents`)
      .set(asAuth("knowledge-editor"))
      .send({
        filename: "runbook.txt",
        mimeType: "text/plain",
        content:
          "Restart the service after deploy. Verify the health endpoint. Page support if recovery fails.",
      });
    const chunkId = ingestRes.body.chunks[0].id as string;

    const patchRes = await request(app)
      .patch(`/api/knowledge/chunks/${chunkId}`)
      .set(asAuth("knowledge-editor"))
      .send({
        text: "Restart the service after deploy and verify the health endpoint before paging support.",
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.text).toMatch(/verify the health endpoint/i);
  });
});

describe("Observability routes", () => {
  it("returns the live feed contract with issue, run, heartbeat, budget, and alert events", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-observability-deploy")
      .send({ templateId: "tpl-support-bot" });

    const teamId = deployRes.body.team.id as string;
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );
    const step = WORKFLOW_TEMPLATES.find((template) => template.id === "tpl-support-bot")!.steps.find(
      (candidate) => candidate.kind === "llm"
    )!;

    const started = await controlPlaneStore.startAgentExecution({
      userId: "test-user",
      actor: "run-observability-seed",
      teamId,
      step,
      sourceRunId: "workflow-run-observability-1",
      taskTitle: "Investigate signal drift",
    });

    await request(app)
      .patch(`/api/control-plane/tasks/${started.task!.id}/status`)
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-observability-task-done")
      .send({ status: "done" });

    controlPlaneStore.finalizeAgentExecution({
      executionId: started.execution.id,
      userId: "test-user",
      status: "failed",
      summary: "Run failed after upstream timeout",
      costUsd: 1.75,
    });

    const feedRes = await request(app)
      .get("/api/observability/events?limit=20")
      .set(asAuth());

    expect(feedRes.status).toBe(200);
    expect(Array.isArray(feedRes.body.events)).toBe(true);
    expect(feedRes.body.events.length).toBeGreaterThan(0);
    expect(feedRes.body.nextCursor).toEqual(feedRes.body.events.at(-1)?.sequence ?? null);

    const categories = new Set(feedRes.body.events.map((event: { category: string }) => event.category));
    expect(categories.has("issue")).toBe(true);
    expect(categories.has("run")).toBe(true);
    expect(categories.has("heartbeat")).toBe(true);
    expect(categories.has("budget")).toBe(true);
    expect(categories.has("alert")).toBe(true);

    const runStartedEvent = feedRes.body.events.find((event: { type: string }) => event.type === "run.started");
    expect(runStartedEvent).toMatchObject({
      category: "run",
      subject: expect.objectContaining({ type: "execution", id: started.execution.id }),
      payload: expect.objectContaining({
        sourceRunId: "workflow-run-observability-1",
        workflowStepId: step.id,
        workflowStepName: step.name,
      }),
    });
  });

  it("supports cursor-based polling fallback and throughput aggregates", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-observability-fallback-deploy")
      .send({ templateId: "tpl-support-bot" });

    const teamId = deployRes.body.team.id as string;
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );
    const step = WORKFLOW_TEMPLATES.find((template) => template.id === "tpl-support-bot")!.steps.find(
      (candidate) => candidate.kind === "llm"
    )!;

    const started = await controlPlaneStore.startAgentExecution({
      userId: "test-user",
      actor: "run-observability-fallback-seed",
      teamId,
      step,
      sourceRunId: "workflow-run-observability-2",
      taskTitle: "Resolve retry backlog",
      requestedAgentId: workerAgent.id,
    });

    const firstPage = await request(app)
      .get("/api/observability/events?categories=issue&limit=1")
      .set(asAuth());

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.events).toHaveLength(1);

    await request(app)
      .patch(`/api/control-plane/tasks/${started.task!.id}/status`)
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-observability-fallback-block")
      .send({ status: "blocked" });

    await request(app)
      .patch(`/api/control-plane/tasks/${started.task!.id}/status`)
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-observability-fallback-done")
      .send({ status: "done" });

    const secondPage = await request(app)
      .get(`/api/observability/events?categories=issue&after=${firstPage.body.nextCursor}&limit=10`)
      .set(asAuth());

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.events.length).toBeGreaterThanOrEqual(2);
    expect(
      secondPage.body.events.every((event: { category: string; sequence: string }) => {
        return event.category === "issue" && Number(event.sequence) > Number(firstPage.body.nextCursor);
      })
    ).toBe(true);

    const throughputRes = await request(app)
      .get("/api/observability/throughput?windowHours=24")
      .set(asAuth());

    expect(throughputRes.status).toBe(200);
    expect(throughputRes.body.summary.createdCount).toBeGreaterThanOrEqual(1);
    expect(throughputRes.body.summary.completedCount).toBeGreaterThanOrEqual(1);
    expect(throughputRes.body.summary.blockedCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(throughputRes.body.buckets)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Portable workflow schema + import/export endpoints
// ---------------------------------------------------------------------------

describe("Portable workflow APIs", () => {
  it("returns the portable schema descriptor", async () => {
    const res = await request(app).get("/api/workflows/schema");
    expect(res.status).toBe(200);
    expect(res.body.format).toBe(PORTABLE_WORKFLOW_FORMAT);
    expect(res.body.schemaVersion).toBe(PORTABLE_WORKFLOW_SCHEMA_VERSION);
    expect(res.body.supportedStepKinds).toContain("cron_trigger");
    expect(res.body.supportedStepKinds).toContain("interval_trigger");
    expect(res.body.supportedStepKinds).toContain("llm");
  });

  it("exports a built-in template in portable format", async () => {
    const res = await request(app).get("/api/templates/tpl-support-bot/export");
    expect(res.status).toBe(200);
    expect(res.body.format).toBe(PORTABLE_WORKFLOW_FORMAT);
    expect(res.body.schemaVersion).toBe(PORTABLE_WORKFLOW_SCHEMA_VERSION);
    expect(res.body.template.id).toBe("tpl-support-bot");
  });

  it("imports a portable template and exposes it through the templates API", async () => {
    const exportRes = await request(app).get("/api/templates/tpl-support-bot/export");
    const importedTemplate = {
      ...exportRes.body.template,
      id: "tpl-support-bot-clone",
      name: "Customer Support Bot Clone",
      category: "custom",
    };

    const importRes = await request(app)
      .post("/api/templates/import")
      .set(asAuth())
      .send({
        ...exportRes.body,
        template: importedTemplate,
      });

    expect(importRes.status).toBe(201);
    expect(importRes.body.imported).toBe(true);
    expect(importRes.body.template.id).toBe("tpl-support-bot-clone");

    const getRes = await request(app).get("/api/templates/tpl-support-bot-clone");
    expect(getRes.status).toBe(200);
    expect(getRes.body.name).toBe("Customer Support Bot Clone");

    const listRes = await request(app).get("/api/templates");
    expect(listRes.body.total).toBe(14);
  });

  it("rejects invalid portable payloads", async () => {
    const res = await request(app)
      .post("/api/templates/import")
      .set(asAuth())
      .send({ nope: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/format|schemaVersion|template/i);
  });

  it("rejects interval_trigger templates without intervalMinutes", async () => {
    const exportRes = await request(app).get("/api/templates/tpl-support-bot/export");
    const importedTemplate = {
      ...exportRes.body.template,
      id: "tpl-invalid-interval-trigger",
      name: "Invalid Interval Trigger",
      category: "custom",
      steps: [
        {
          id: "step_interval",
          name: "Interval Trigger",
          kind: "interval_trigger",
          description: "Runs every interval",
          inputKeys: [],
          outputKeys: ["scheduledAt"],
        },
        {
          id: "step_output",
          name: "Output",
          kind: "output",
          description: "Collect output",
          inputKeys: ["scheduledAt"],
          outputKeys: ["scheduledAt"],
        },
        {
          id: "step_output_2",
          name: "Output Copy",
          kind: "output",
          description: "Keep schema length above minimum",
          inputKeys: ["scheduledAt"],
          outputKeys: ["scheduledAt"],
        },
        {
          id: "step_output_3",
          name: "Output Copy 2",
          kind: "output",
          description: "Keep schema length above minimum",
          inputKeys: ["scheduledAt"],
          outputKeys: ["scheduledAt"],
        },
      ],
    };

    const res = await request(app)
      .post("/api/templates/import")
      .set(asAuth())
      .send({
        ...exportRes.body,
        template: importedTemplate,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/intervalMinutes/);
  });

  it("rejects importing a template id that already exists", async () => {
    const exportRes = await request(app).get("/api/templates/tpl-support-bot/export");
    const res = await request(app)
      .post("/api/templates/import")
      .set(asAuth())
      .send(exportRes.body);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

// ---------------------------------------------------------------------------
// Company provisioning APIs
// ---------------------------------------------------------------------------

describe("Company provisioning APIs", () => {
  it("lists supported role templates and the approval payload contract", async () => {
    const res = await request(app)
      .get("/api/companies/role-templates")
      .set(asAuth());

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(3);
    expect(res.body.provisioningContract).toMatchObject({
      schemaVersion: "2026-04-28",
      endpoint: "/api/companies",
      requiredHeaders: ["X-Paperclip-Run-Id"],
      companyFields: {
        required: ["name", "idempotencyKey", "budgetMonthlyUsd", "secretBindings", "agents"],
      },
      agentFields: {
        identifierFields: ["roleTemplateId", "roleKey"],
        requiredOneOf: ["roleTemplateId", "roleKey"],
      },
    });
    expect(
      res.body.roleTemplates.some((template: { id: string; name: string }) => template.id === "ceo" && template.name === "CEO")
    ).toBe(true);
    expect(
      res.body.roleTemplates.some(
        (template: { id: string; name: string }) => template.id === "backend-engineer" && template.name === "Backend Engineer"
      )
    ).toBe(true);
  });

  it("requires X-Paperclip-Run-Id on mutating requests", async () => {
    const res = await request(app)
      .post("/api/companies")
      .set(asAuth())
      .send({
        name: "Acme AI",
        idempotencyKey: "acme-1",
        budgetMonthlyUsd: 300,
        secretBindings: { OPENAI_API_KEY: "sk-test-1234" },
        agents: [{ roleTemplateId: "workspace-manager" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/X-Paperclip-Run-Id/i);
  });

  it("provisions a customer company workspace with role-library agents and masked secrets", async () => {
    const res = await request(app)
      .post("/api/companies")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-provision-company")
      .send({
        name: "Acme AI",
        workspaceName: "Acme AI Workspace",
        externalCompanyId: "crm-acme-42",
        idempotencyKey: "acme-1",
        budgetMonthlyUsd: 300,
        secretBindings: {
          OPENAI_API_KEY: "sk-live-openai-1234",
          HUBSPOT_CLIENT_SECRET: "hubspot-secret-9876",
        },
        agents: [
          { roleTemplateId: "workspace-manager", budgetMonthlyUsd: 60 },
          { roleTemplateId: "backend-engineer", budgetMonthlyUsd: 140, skills: ["gh-cli"] },
          { roleTemplateId: "integration-engineer" },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.idempotentReplay).toBe(false);
    expect(res.body.company.name).toBe("Acme AI");
    expect(res.body.company.externalCompanyId).toBe("crm-acme-42");
    expect(res.body.workspace.name).toBe("Acme AI Workspace");
    expect(res.body.workspace.slug).toBe("acme-ai");
    expect(res.body.company.teamId).toBe(res.body.team.id);
    expect(res.body.team.name).toBe("Acme AI Workspace");
    expect(res.body.company.allocatedBudgetMonthlyUsd).toBe(300);
    expect(res.body.company.remainingBudgetMonthlyUsd).toBe(0);
    expect(res.body.secretBindings).toEqual([
      expect.objectContaining({ key: "HUBSPOT_CLIENT_SECRET" }),
      expect.objectContaining({ key: "OPENAI_API_KEY" }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain("sk-live-openai-1234");
    expect(JSON.stringify(res.body)).not.toContain("hubspot-secret-9876");

    expect(res.body.agents).toHaveLength(3);
    const backendAgent = res.body.agents.find((agent: { roleKey: string }) => agent.roleKey === "backend-engineer");
    expect(backendAgent).toBeTruthy();
    expect(backendAgent.skills).toEqual(["gh-cli", "paperclip", "security-review"]);
    expect(backendAgent.budgetMonthlyUsd).toBe(140);

    const integrationAgent = res.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey === "integration-engineer"
    );
    expect(integrationAgent.budgetMonthlyUsd).toBe(100);
    expect(integrationAgent.skills).toEqual(["openai-docs", "paperclip"]);
  });

  it("accepts team-assembly role keys as provisioning identifiers", async () => {
    const res = await request(app)
      .post("/api/companies")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-provision-team-assembly-role-keys")
      .send({
        name: "Role Key Co",
        idempotencyKey: "role-key-1",
        budgetMonthlyUsd: 240,
        secretBindings: { OPENAI_API_KEY: "sk-role-key-1234" },
        agents: [
          { roleKey: "ceo", budgetMonthlyUsd: 80 },
          { roleKey: "frontend-engineer", budgetMonthlyUsd: 80 },
          { roleKey: "qa-engineer", budgetMonthlyUsd: 80 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.agents.map((agent: { roleKey: string }) => agent.roleKey)).toEqual([
      "ceo",
      "frontend-engineer",
      "qa-engineer",
    ]);
    expect(
      res.body.agents.find((agent: { roleKey: string; skills: string[] }) => agent.roleKey === "frontend-engineer")
        .skills
    ).toEqual(["frontend-design", "paperclip"]);
  });

  it("replays idempotent retries and keeps tenant state isolated across companies", async () => {
    const firstRes = await request(app)
      .post("/api/companies")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-first")
      .send({
        name: "Acme AI",
        idempotencyKey: "acme-2",
        budgetMonthlyUsd: 200,
        secretBindings: { OPENAI_API_KEY: "sk-acme-1234" },
        agents: [
          { roleTemplateId: "workspace-manager", budgetMonthlyUsd: 50 },
          { roleTemplateId: "backend-engineer", budgetMonthlyUsd: 150 },
        ],
      });

    const retryRes = await request(app)
      .post("/api/companies")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-retry")
      .send({
        name: "Acme AI",
        idempotencyKey: "acme-2",
        budgetMonthlyUsd: 200,
        secretBindings: { OPENAI_API_KEY: "sk-acme-1234" },
        agents: [
          { roleTemplateId: "workspace-manager", budgetMonthlyUsd: 50 },
          { roleTemplateId: "backend-engineer", budgetMonthlyUsd: 150 },
        ],
      });

    const secondRes = await request(app)
      .post("/api/companies")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-second")
      .send({
        name: "Beta Labs",
        idempotencyKey: "beta-1",
        budgetMonthlyUsd: 180,
        secretBindings: { OPENAI_API_KEY: "sk-beta-5678" },
        agents: [
          { roleTemplateId: "workspace-manager", budgetMonthlyUsd: 40 },
          { roleTemplateId: "integration-engineer", budgetMonthlyUsd: 140 },
        ],
      });

    expect(firstRes.status).toBe(201);
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.idempotentReplay).toBe(true);
    expect(retryRes.body.company.id).toBe(firstRes.body.company.id);
    expect(retryRes.body.workspace.id).toBe(firstRes.body.workspace.id);
    expect(retryRes.body.team.id).toBe(firstRes.body.team.id);

    expect(secondRes.status).toBe(201);
    expect(secondRes.body.company.id).not.toBe(firstRes.body.company.id);
    expect(secondRes.body.workspace.id).not.toBe(firstRes.body.workspace.id);
    expect(secondRes.body.team.id).not.toBe(firstRes.body.team.id);
    expect(secondRes.body.agents.map((agent: { id: string }) => agent.id)).not.toEqual(
      firstRes.body.agents.map((agent: { id: string }) => agent.id)
    );
  });

  it("rejects budget overflow, unknown role templates, and conflicting idempotency reuse", async () => {
    const overflowRes = await request(app)
      .post("/api/companies")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-overflow")
      .send({
        name: "Gamma Co",
        idempotencyKey: "gamma-1",
        budgetMonthlyUsd: 100,
        secretBindings: { OPENAI_API_KEY: "sk-gamma-1234" },
        agents: [
          { roleTemplateId: "workspace-manager", budgetMonthlyUsd: 60 },
          { roleTemplateId: "backend-engineer", budgetMonthlyUsd: 60 },
        ],
      });

    expect(overflowRes.status).toBe(400);
    expect(overflowRes.body.error).toMatch(/budget/i);
    expect(controlPlaneStore.listTeams("test-user")).toHaveLength(0);
    expect(controlPlaneStore.listAllAgents("test-user")).toHaveLength(0);

    const unknownRoleRes = await request(app)
      .post("/api/companies")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-role-error")
      .send({
        name: "Gamma Co",
        idempotencyKey: "gamma-2",
        budgetMonthlyUsd: 100,
        secretBindings: { OPENAI_API_KEY: "sk-gamma-1234" },
        agents: [{ roleTemplateId: "non-existent-role" }],
      });

    expect(unknownRoleRes.status).toBe(400);
    expect(unknownRoleRes.body.error).toMatch(/Unknown role template/i);

    const initialProvisionRes = await request(app)
      .post("/api/companies")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-initial")
      .send({
        name: "Delta Co",
        idempotencyKey: "delta-1",
        budgetMonthlyUsd: 100,
        secretBindings: { OPENAI_API_KEY: "sk-delta-1234" },
        agents: [{ roleTemplateId: "workspace-manager", budgetMonthlyUsd: 100 }],
      });

    expect(initialProvisionRes.status).toBe(201);

    const conflictingReplayRes = await request(app)
      .post("/api/companies")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-conflict")
      .send({
        name: "Delta Co",
        idempotencyKey: "delta-1",
        budgetMonthlyUsd: 120,
        secretBindings: { OPENAI_API_KEY: "sk-delta-1234" },
        agents: [{ roleTemplateId: "workspace-manager", budgetMonthlyUsd: 120 }],
      });

    expect(conflictingReplayRes.status).toBe(409);
    expect(conflictingReplayRes.body.error).toMatch(/idempotencyKey/i);
  });

  it("rejects conflicting roleTemplateId and roleKey identifiers", async () => {
    const res = await request(app)
      .post("/api/companies")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-mismatched-identifiers")
      .send({
        name: "Mismatch Co",
        idempotencyKey: "mismatch-1",
        budgetMonthlyUsd: 100,
        secretBindings: { OPENAI_API_KEY: "sk-mismatch-1234" },
        agents: [{ roleTemplateId: "backend-engineer", roleKey: "frontend-engineer" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must match/i);
  });
});

// ---------------------------------------------------------------------------
// Team assembly approval provisioning
// ---------------------------------------------------------------------------

describe("Team assembly approval provisioning", () => {
  function buildApprovedPlan() {
    return {
      schemaVersion: "2026-04-27",
      company: {
        name: "Acme AI",
        goal: "Launch an AI operations product",
        targetCustomer: "Technical founders",
        budget: "$400/mo",
        timeHorizon: "90 days",
      },
      summary: "Lean engineering team for launch.",
      rationale: "Bias toward shipping the first version quickly.",
      orgChart: {
        executives: [],
        operators: [
          {
            roleKey: "backend-engineer",
            title: "Backend Engineer",
            roleType: "operator",
            department: "engineering",
            headcount: 2,
            reportsToRoleKey: "cto",
            mandate: "Build APIs and business logic.",
            justification: "Two backend contributors are needed for the API backlog.",
            kpis: ["Ship provisioning API", "Maintain test coverage"],
            skills: ["paperclip", "nodejs-backend-patterns"],
            tools: ["github", "vercel"],
            modelTier: "standard",
            budgetMonthlyUsd: 200,
            provisioningInstructions: "Implement APIs, workflows, and persistence.",
          },
          {
            roleKey: "frontend-engineer",
            title: "Frontend Engineer",
            roleType: "operator",
            department: "engineering",
            headcount: 1,
            reportsToRoleKey: "cto",
            mandate: "Build review and approval flows.",
            justification: "One frontend contributor is needed for the approval UI.",
            kpis: ["Ship review flow"],
            skills: ["paperclip", "frontend-design"],
            tools: ["github", "vercel"],
            modelTier: "standard",
            budgetMonthlyUsd: 150,
            provisioningInstructions: "Deliver the team assembly approval UI.",
          },
        ],
        reportingLines: [
          { managerRoleKey: "cto", reportRoleKey: "backend-engineer" },
          { managerRoleKey: "cto", reportRoleKey: "frontend-engineer" },
        ],
      },
      provisioningPlan: {
        teamName: "Acme Launch Team",
        deploymentMode: "continuous_agents",
        agents: [
          {
            roleKey: "backend-engineer",
            title: "Backend Engineer",
            roleType: "operator",
            department: "engineering",
            headcount: 2,
            reportsToRoleKey: "cto",
            mandate: "Build APIs and business logic.",
            justification: "Two backend contributors are needed for the API backlog.",
            kpis: ["Ship provisioning API", "Maintain test coverage"],
            skills: ["paperclip", "nodejs-backend-patterns"],
            tools: ["github", "vercel"],
            modelTier: "standard",
            budgetMonthlyUsd: 200,
            provisioningInstructions: "Implement APIs, workflows, and persistence.",
          },
          {
            roleKey: "frontend-engineer",
            title: "Frontend Engineer",
            roleType: "operator",
            department: "engineering",
            headcount: 1,
            reportsToRoleKey: "cto",
            mandate: "Build review and approval flows.",
            justification: "One frontend contributor is needed for the approval UI.",
            kpis: ["Ship review flow"],
            skills: ["paperclip", "frontend-design"],
            tools: ["github", "vercel"],
            modelTier: "standard",
            budgetMonthlyUsd: 150,
            provisioningInstructions: "Deliver the team assembly approval UI.",
          },
        ],
      },
      roadmap306090: {
        day30: {
          objectives: ["Stand up the first team"],
          deliverables: ["Provisioned engineering pod"],
          ownerRoleKeys: ["backend-engineer"],
        },
        day60: {
          objectives: ["Ship review loops"],
          deliverables: ["Approval workflow"],
          ownerRoleKeys: ["frontend-engineer"],
        },
        day90: {
          objectives: ["Launch publicly"],
          deliverables: ["Customer-ready release"],
          ownerRoleKeys: ["backend-engineer", "frontend-engineer"],
        },
      },
    };
  }

  it("provisions approved staffing plans and returns frontend-ready status", async () => {
    const res = await request(app)
      .post("/api/goals/team-assembly/approve")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-team-assembly-approve")
      .send({
        approvedPlan: buildApprovedPlan(),
        idempotencyKey: "team-assembly-acme-1",
        budgetMonthlyUsd: 400,
        secretBindings: { OPENAI_API_KEY: "sk-acme-1234" },
      });

    expect(res.status).toBe(201);
    expect(res.body.provisioningStatus).toEqual({
      status: "provisioned",
      idempotentReplay: false,
      allocatedBudgetMonthlyUsd: 350,
      remainingBudgetMonthlyUsd: 50,
    });
    expect(res.body.team.name).toBe("Acme Launch Team");
    expect(res.body.agents).toHaveLength(3);
    expect(
      res.body.agents.filter((agent: { roleKey: string }) => agent.roleKey.startsWith("backend-engineer"))
    ).toHaveLength(2);
    expect(
      res.body.agents
        .filter((agent: { roleKey: string }) => agent.roleKey.startsWith("backend-engineer"))
        .every((agent: { budgetMonthlyUsd: number }) => agent.budgetMonthlyUsd === 100)
    ).toBe(true);
    expect(
      res.body.agents.find((agent: { roleKey: string }) => agent.roleKey === "frontend-engineer")
        .budgetMonthlyUsd
    ).toBe(150);
  });

  it("rejects approved plans that are missing finalized budget numbers", async () => {
    const approvedPlan = buildApprovedPlan();
    (
      approvedPlan.provisioningPlan.agents[0] as { budgetMonthlyUsd: number | null }
    ).budgetMonthlyUsd = null;

    const res = await request(app)
      .post("/api/goals/team-assembly/approve")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-team-assembly-missing-budget")
      .send({
        approvedPlan,
        idempotencyKey: "team-assembly-acme-2",
        budgetMonthlyUsd: 400,
        secretBindings: { OPENAI_API_KEY: "sk-acme-1234" },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing budgetMonthlyUsd/i);
    expect(controlPlaneStore.listTeams("test-user")).toHaveLength(0);
    expect(controlPlaneStore.listAllAgents("test-user")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Control plane APIs
// ---------------------------------------------------------------------------

describe("Control plane APIs", () => {
  it("requires X-Paperclip-Run-Id on mutating requests", async () => {
    const res = await request(app)
      .post("/api/control-plane/teams")
      .set(asAuth())
      .send({ name: "Growth Ops" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/X-Paperclip-Run-Id/i);
  });

  it("creates a team and lists it back", async () => {
    const createRes = await request(app)
      .post("/api/control-plane/teams")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-create-team")
      .send({
        name: "Revenue Automation",
        budgetMonthlyUsd: 250,
        deploymentMode: "continuous_agents",
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe("Revenue Automation");
    expect(createRes.body.deploymentMode).toBe("continuous_agents");

    const listRes = await request(app)
      .get("/api/control-plane/teams")
      .set(asAuth());

    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(1);
    expect(listRes.body.teams[0].id).toBe(createRes.body.id);
  });

  it("deploys a workflow template as an agent team", async () => {
    const res = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-team")
      .send({
        templateId: "tpl-support-bot",
        budgetMonthlyUsd: 120,
        defaultIntervalMinutes: 30,
      });

    expect(res.status).toBe(201);
    expect(res.body.team.workflowTemplateId).toBe("tpl-support-bot");
    expect(res.body.workflow.name).toBe("Customer Support Bot");
    expect(Array.isArray(res.body.agents)).toBe(true);
    expect(res.body.agents.length).toBeGreaterThan(1);
    expect(
      res.body.agents.some((agent: { roleKey: string }) => agent.roleKey === "workflow-manager")
    ).toBe(true);
    expect(
      res.body.agents
        .filter((agent: { roleKey: string }) => agent.roleKey !== "workflow-manager")
        .every(
          (agent: { schedule: { type: string; intervalMinutes?: number } }) =>
            agent.schedule.type === "interval" && agent.schedule.intervalMinutes === 30
        )
    ).toBe(true);
  });

  it("sanitizes generated role keys without the polynomial trim regex", async () => {
    const step = {
      id: "step-weird-kind",
      name: "Weird Runtime Step",
      kind: "---LLM---" as unknown as WorkflowStep["kind"],
      description: "Regression fixture for slugify role-key generation",
      inputKeys: [],
      outputKeys: [],
    };

    const { agent } = await controlPlaneStore.ensureRuntimeTeamForStep({
      userId: "test-user",
      actor: "run-runtime-team-rolekey",
      step,
    });

    expect(agent.roleKey).toBe("llm");
  });

  it("creates a bridged task and enforces atomic checkout", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-for-task")
      .send({ templateId: "tpl-support-bot" });

    const teamId = deployRes.body.team.id;
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );

    const createTaskRes = await request(app)
      .post("/api/control-plane/tasks")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-create-task")
      .send({
        teamId,
        title: "Handle escalated refund",
        sourceRunId: "run_123",
        sourceWorkflowStepId: workerAgent.workflowStepId,
        assignedAgentId: workerAgent.id,
      });

    expect(createTaskRes.status).toBe(201);
    expect(createTaskRes.body.status).toBe("todo");
    expect(createTaskRes.body.auditTrail).toHaveLength(1);

    const checkoutRes = await request(app)
      .post(`/api/control-plane/tasks/${createTaskRes.body.id}/checkout`)
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-checkout-1");

    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.status).toBe("in_progress");
    expect(checkoutRes.body.checkedOutBy).toBe("run-checkout-1");

    const conflictRes = await request(app)
      .post(`/api/control-plane/tasks/${createTaskRes.body.id}/checkout`)
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-checkout-2");

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error).toMatch(/already checked out/i);
  });

  it("records heartbeats for deployed agents", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-heartbeat")
      .send({ templateId: "tpl-support-bot" });

    const teamId = deployRes.body.team.id;
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );

    const heartbeatRes = await request(app)
      .post("/api/control-plane/heartbeats")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-heartbeat-1")
      .send({
        teamId,
        agentId: workerAgent.id,
        status: "completed",
        summary: "Processed the daily support queue",
        costUsd: 1.42,
        createdTaskIds: ["task-a", "task-b"],
      });

    expect(heartbeatRes.status).toBe(201);
    expect(heartbeatRes.body.status).toBe("completed");
    expect(heartbeatRes.body.createdTaskIds).toEqual(["task-a", "task-b"]);

    const listRes = await request(app)
      .get(`/api/control-plane/teams/${teamId}`)
      .set(asAuth());

    expect(listRes.status).toBe(200);
    expect(listRes.body.heartbeats).toHaveLength(1);
    expect(listRes.body.heartbeats[0].summary).toBe("Processed the daily support queue");
  });

  it("exposes deployed agents and budget snapshots for dashboard workspace pages", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-agent-dashboard")
      .send({ templateId: "tpl-support-bot", budgetMonthlyUsd: 120 });

    const teamId = deployRes.body.team.id;
    const managerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey === "workflow-manager"
    );
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );

    await request(app)
      .post("/api/control-plane/heartbeats")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-budget-heartbeat")
      .send({
        teamId,
        agentId: workerAgent.id,
        status: "completed",
        summary: "Processed queue",
        costUsd: 1.42,
      });

    const agentsRes = await request(app)
      .get("/api/agents")
      .set(asAuth());

    expect(agentsRes.status).toBe(200);
    expect(agentsRes.body.total).toBeGreaterThan(1);
    const listedWorker = agentsRes.body.agents.find((agent: { id: string }) => agent.id === workerAgent.id);
    expect(listedWorker).toBeTruthy();
    expect(listedWorker.metadata.reportingToAgentId).toBe(managerAgent.id);
    expect(listedWorker.status).toBe("idle");

    const budgetRes = await request(app)
      .get(`/api/agents/${workerAgent.id}/budget`)
      .set(asAuth());

    expect(budgetRes.status).toBe(200);
    expect(budgetRes.body.monthlyUsd).toBe(workerAgent.budgetMonthlyUsd);
    expect(budgetRes.body.spentUsd).toBe(1.42);
    expect(budgetRes.body.remainingUsd).toBeCloseTo(workerAgent.budgetMonthlyUsd - 1.42, 2);
  });

  it("records real-time spend events and exposes threshold alerts in team spend snapshots", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-spend-snapshot")
      .send({
        budgetMonthlyUsd: 20,
        toolBudgetCeilings: { "slack.send": 5 },
        template: {
          id: "tpl-spend-snapshot",
          name: "Spend Snapshot Template",
          description: "Exercises spend snapshots",
          category: "support",
          version: "1.0.0",
          configFields: [],
          sampleInput: {},
          expectedOutput: {},
          steps: [
            { id: "step-only", name: "Only Agent", kind: "llm", description: "Only", inputKeys: [], outputKeys: [], agentBudgetMonthlyUsd: 10 },
          ],
        },
      });

    const teamId = deployRes.body.team.id;
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );

    const llmSpendRes = await request(app)
      .post("/api/control-plane/spend-events")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-spend-llm")
      .send({
        teamId,
        agentId: workerAgent.id,
        category: "llm",
        costUsd: 7,
        model: "gpt-5.4-mini",
        provider: "openai",
      });

    expect(llmSpendRes.status).toBe(201);

    const toolSpendRes = await request(app)
      .post("/api/control-plane/spend-events")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-spend-tool")
      .send({
        teamId,
        agentId: workerAgent.id,
        category: "tool",
        costUsd: 1,
        toolName: "slack.send",
      });

    expect(toolSpendRes.status).toBe(201);

    const spendRes = await request(app)
      .get(`/api/control-plane/teams/${teamId}/spend`)
      .set(asAuth());

    expect(spendRes.status).toBe(200);
    expect(spendRes.body.team.spentUsd).toBe(8);
    expect(spendRes.body.totalsByCategory.llm).toBe(7);
    expect(spendRes.body.totalsByCategory.tool).toBe(1);
    expect(
      spendRes.body.agents.some(
        (agent: { agentId: string; alertThresholdsTriggered: number[] }) =>
          agent.agentId === workerAgent.id && agent.alertThresholdsTriggered.includes(0.8)
      )
    ).toBe(true);
    expect(
      spendRes.body.tools.some(
        (tool: { toolName: string; spentUsd: number }) => tool.toolName === "slack.send" && tool.spentUsd === 1
      )
    ).toBe(true);
    expect(spendRes.body.alerts.some((alert: { scope: string }) => alert.scope === "agent")).toBe(true);

    const budgetRes = await request(app)
      .get(`/api/agents/${workerAgent.id}/budget`)
      .set(asAuth());

    expect(budgetRes.status).toBe(200);
    expect(budgetRes.body.thresholdState).toBe("warning");
    expect(budgetRes.body.alertThresholdsTriggered).toContain(0.8);
  });

  it("halts new executions when the company budget cap is reached across agents", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-team-cap")
      .send({
        budgetMonthlyUsd: 5,
        template: {
          id: "tpl-team-cap",
          name: "Team Cap Template",
          description: "Exercises the team hard cap",
          category: "support",
          version: "1.0.0",
          configFields: [],
          sampleInput: {},
          expectedOutput: {},
          steps: [
            { id: "step-a", name: "Agent A", kind: "llm", description: "A", inputKeys: [], outputKeys: [], agentBudgetMonthlyUsd: 10 },
            { id: "step-b", name: "Agent B", kind: "llm", description: "B", inputKeys: [], outputKeys: [], agentBudgetMonthlyUsd: 10 },
          ],
        },
      });

    expect(deployRes.status).toBe(201);
    const teamId = deployRes.body.team.id;
    const workerAgents = deployRes.body.agents.filter(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );
    expect(workerAgents).toHaveLength(2);

    const firstSpendRes = await request(app)
      .post("/api/control-plane/spend-events")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-team-cap-spend-1")
      .send({
        teamId,
        agentId: workerAgents[0].id,
        category: "llm",
        costUsd: 4,
        model: "gpt-5.4-mini",
      });

    expect(firstSpendRes.status).toBe(201);

    const secondSpendRes = await request(app)
      .post("/api/control-plane/spend-events")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-team-cap-spend-2")
      .send({
        teamId,
        agentId: workerAgents[1].id,
        category: "llm",
        costUsd: 1,
        model: "gpt-5.4-mini",
      });

    expect(secondSpendRes.status).toBe(201);

    const spendRes = await request(app)
      .get(`/api/control-plane/teams/${teamId}/spend`)
      .set(asAuth());

    expect(spendRes.body.team.spentUsd).toBe(5);
    expect(spendRes.body.team.autoPaused).toBe(true);

    const step = {
      id: "step-b",
      name: "Agent B",
      kind: "llm" as const,
      description: "B",
      inputKeys: [],
      outputKeys: [],
    };

    await expect(
      controlPlaneStore.startAgentExecution({
        userId: "test-user",
        actor: "run-start-after-team-cap",
        teamId,
        step,
        sourceRunId: "workflow-run-after-team-cap",
        requestedAgentId: workerAgents[1].id,
      })
    ).rejects.toThrow("team_budget_exceeded");
  });

  it("enforces per-tool ceilings and per-agent caps in real time", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-tool-cap")
      .send({
        budgetMonthlyUsd: 20,
        toolBudgetCeilings: { "slack.send": 1 },
        template: {
          id: "tpl-agent-cap",
          name: "Agent Cap Template",
          description: "Exercises tool and agent caps",
          category: "support",
          version: "1.0.0",
          configFields: [],
          sampleInput: {},
          expectedOutput: {},
          steps: [
            { id: "step-only", name: "Only Agent", kind: "llm", description: "Only", inputKeys: [], outputKeys: [], agentBudgetMonthlyUsd: 2 },
          ],
        },
      });

    expect(deployRes.status).toBe(201);
    const teamId = deployRes.body.team.id;
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );

    const toolSpendRes = await request(app)
      .post("/api/control-plane/spend-events")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-tool-cap-1")
      .send({
        teamId,
        agentId: workerAgent.id,
        category: "tool",
        costUsd: 1,
        toolName: "slack.send",
      });

    expect(toolSpendRes.status).toBe(201);

    const blockedToolSpendRes = await request(app)
      .post("/api/control-plane/spend-events")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-tool-cap-2")
      .send({
        teamId,
        agentId: workerAgent.id,
        category: "tool",
        costUsd: 0.1,
        toolName: "slack.send",
      });

    expect(blockedToolSpendRes.status).toBe(409);
    expect(blockedToolSpendRes.body.error).toBe("tool_budget_exceeded");

    const agentBudgetSpendRes = await request(app)
      .post("/api/control-plane/spend-events")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-agent-cap-1")
      .send({
        teamId,
        agentId: workerAgent.id,
        category: "llm",
        costUsd: 1,
        model: "gpt-5.4-mini",
      });

    expect(agentBudgetSpendRes.status).toBe(201);

    const blockedAgentSpendRes = await request(app)
      .post("/api/control-plane/spend-events")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-agent-cap-2")
      .send({
        teamId,
        agentId: workerAgent.id,
        category: "llm",
        costUsd: 0.1,
        model: "gpt-5.4-mini",
      });

    expect(blockedAgentSpendRes.status).toBe(409);
    expect(blockedAgentSpendRes.body.error).toBe("agent_budget_exceeded");

    const budgetRes = await request(app)
      .get(`/api/agents/${workerAgent.id}/budget`)
      .set(asAuth());

    expect(budgetRes.status).toBe(200);
    expect(budgetRes.body.spentUsd).toBe(2);
    expect(budgetRes.body.autoPaused).toBe(true);
    expect(budgetRes.body.thresholdState).toBe("limit_reached");
  });

  it("returns agent heartbeat and run history for dashboard activity views", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-agent-activity")
      .send({ templateId: "tpl-support-bot" });

    const teamId = deployRes.body.team.id;
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );
    const step = WORKFLOW_TEMPLATES.find((template) => template.id === "tpl-support-bot")!.steps.find(
      (candidate) => candidate.kind === "llm"
    )!;

    const execution = (
      await controlPlaneStore.startAgentExecution({
      userId: "test-user",
      actor: "run-agent-activity-seed",
      teamId,
      step,
      sourceRunId: "workflow-run-agent-1",
      requestedAgentId: workerAgent.id,
      })
    ).execution;

    await controlPlaneStore.finalizeAgentExecution({
      executionId: execution.id,
      userId: "test-user",
      status: "completed",
      summary: "Completed the support step",
      costUsd: 2.25,
    });

    await request(app)
      .post("/api/control-plane/heartbeats")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-agent-heartbeat")
      .send({
        teamId,
        agentId: workerAgent.id,
        executionId: execution.id,
        status: "running",
        summary: "Investigating ticket backlog",
        costUsd: 0.5,
      });

    const heartbeatRes = await request(app)
      .get(`/api/agents/${workerAgent.id}/heartbeat`)
      .set(asAuth());

    expect(heartbeatRes.status).toBe(200);
    expect(heartbeatRes.body.status).toBe("running");
    expect(heartbeatRes.body.summary).toBe("Investigating ticket backlog");

    const runsRes = await request(app)
      .get(`/api/agents/${workerAgent.id}/runs`)
      .set(asAuth());

    expect(runsRes.status).toBe(200);
    expect(runsRes.body.total).toBe(1);
    expect(runsRes.body.runs[0].status).toBe("completed");
    expect(runsRes.body.runs[0].summary).toBe("Completed the support step");
  });

  it("lists available skills and applies runtime skill injection to agents", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-skills")
      .send({ templateId: "tpl-support-bot" });

    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );

    const skillsRes = await request(app)
      .get("/api/control-plane/skills")
      .set(asAuth());

    expect(skillsRes.status).toBe(200);
    expect(skillsRes.body.skills.some((skill: { id: string }) => skill.id === "security-review")).toBe(true);

    const assignRes = await request(app)
      .post(`/api/control-plane/agents/${workerAgent.id}/skills`)
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-assign-skills")
      .send({ operation: "assign", skills: ["security-review"] });

    expect(assignRes.status).toBe(200);
    expect(assignRes.body.skills).toContain("security-review");
  });

  it("supports team lifecycle updates and exposes execution history", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-lifecycle")
      .send({ templateId: "tpl-support-bot" });

    const teamId = deployRes.body.team.id;
    const step = WORKFLOW_TEMPLATES.find((template) => template.id === "tpl-support-bot")!.steps.find(
      (candidate) => candidate.kind === "llm"
    )!;
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );

    const started = await controlPlaneStore.startAgentExecution({
      userId: "test-user",
      actor: "run-execution-seed",
      teamId,
      step,
      sourceRunId: "workflow-run-1",
      requestedAgentId: workerAgent.id,
      taskTitle: "Process queued ticket",
    });

    const teamRes = await request(app)
      .get(`/api/control-plane/teams/${teamId}`)
      .set(asAuth());

    expect(teamRes.status).toBe(200);
    expect(teamRes.body.executions).toHaveLength(1);
    expect(teamRes.body.executions[0].id).toBe(started.execution.id);

    const pauseRes = await request(app)
      .post(`/api/control-plane/teams/${teamId}/lifecycle`)
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-pause-team")
      .send({ action: "pause" });

    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.status).toBe("paused");

    const executionRes = await request(app)
      .post(`/api/control-plane/executions/${started.execution.id}/lifecycle`)
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-restart-execution")
      .send({ action: "restart" });

    expect(executionRes.status).toBe(200);
    expect(executionRes.body.status).toBe("queued");
    expect(executionRes.body.restartCount).toBe(1);
  });

  it("supports company-wide pause and resume with lifecycle audit entries", async () => {
    const firstDeployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-company-1")
      .send({ templateId: "tpl-support-bot" });
    const secondDeployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-company-2")
      .send({ templateId: "tpl-support-bot" });

    const activeTeamId = firstDeployRes.body.team.id;
    const manuallyPausedTeamId = secondDeployRes.body.team.id;
    const activeWorkerAgent = firstDeployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );
    const step = WORKFLOW_TEMPLATES.find((template) => template.id === "tpl-support-bot")!.steps.find(
      (candidate) => candidate.kind === "llm"
    )!;

    await request(app)
      .post(`/api/control-plane/teams/${manuallyPausedTeamId}/lifecycle`)
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-manual-pause")
      .send({ action: "pause" });

    const stateBeforeRes = await request(app)
      .get("/api/control-plane/company/lifecycle")
      .set(asAuth());

    expect(stateBeforeRes.status).toBe(200);
    expect(stateBeforeRes.body.status).toBe("active");

    const startedBeforePause = await controlPlaneStore.startAgentExecution({
      userId: "test-user",
      actor: "run-before-pause",
      teamId: activeTeamId,
      step,
      requestedAgentId: activeWorkerAgent.id,
      sourceRunId: "workflow-run-before-pause",
    });

    const pauseRes = await request(app)
      .post("/api/control-plane/company/lifecycle")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-pause")
      .send({ action: "pause", reason: "Emergency stop" });

    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.state.status).toBe("paused");
    expect(pauseRes.body.state.pauseReason).toBe("Emergency stop");
    expect(pauseRes.body.affectedTeamIds).toContain(activeTeamId);
    expect(pauseRes.body.affectedTeamIds).not.toContain(manuallyPausedTeamId);

    await expect(
      controlPlaneStore.startAgentExecution({
        userId: "test-user",
        actor: "run-company-paused-start",
        teamId: activeTeamId,
        step: WORKFLOW_TEMPLATES.find((template) => template.id === "tpl-support-bot")!.steps.find(
          (candidate) => candidate.kind === "llm"
        )!,
        sourceRunId: "workflow-run-paused",
        requestedAgentId: activeWorkerAgent.id,
      })
    ).rejects.toThrow("company_paused");

    const blockedHeartbeatRes = await request(app)
      .post("/api/control-plane/heartbeats")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-paused-heartbeat")
      .send({
        teamId: activeTeamId,
        agentId: activeWorkerAgent.id,
        status: "completed",
        summary: "Should be blocked",
      });

    expect(blockedHeartbeatRes.status).toBe(409);
    expect(blockedHeartbeatRes.body.error).toMatch(/company is paused/i);

    const allowedHeartbeatRes = await request(app)
      .post("/api/control-plane/heartbeats")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-paused-existing-execution")
      .send({
        teamId: activeTeamId,
        agentId: activeWorkerAgent.id,
        executionId: startedBeforePause.execution.id,
        status: "completed",
        summary: "In-flight execution completed",
      });

    expect(allowedHeartbeatRes.status).toBe(201);

    const resumeRes = await request(app)
      .post("/api/control-plane/company/lifecycle")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-company-resume")
      .send({ action: "resume", reason: "Recovered" });

    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.state.status).toBe("active");
    expect(resumeRes.body.affectedTeamIds).toContain(activeTeamId);
    expect(resumeRes.body.affectedTeamIds).not.toContain(manuallyPausedTeamId);

    const auditRes = await request(app)
      .get("/api/control-plane/company/lifecycle/audit")
      .set(asAuth());

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.total).toBe(2);
    expect(auditRes.body.auditTrail.some((entry: { action: string; runId: string }) => (
      entry.action === "pause" && entry.runId === "run-company-pause"
    ))).toBe(true);
    expect(auditRes.body.auditTrail.some((entry: { action: string; runId: string }) => (
      entry.action === "resume" && entry.runId === "run-company-resume"
    ))).toBe(true);
  });
});

describe("Approvals API", () => {
  it("lists only approvals assigned to the authenticated user", async () => {
    await approvalStore.create({
      runId: "run-1",
      templateId: "tpl-1",
      templateName: "Template 1",
      stepId: "step-1",
      stepName: "Approval",
      assignee: "approver-1",
      message: "Approve this",
      timeoutMinutes: 30,
    });
    await approvalStore.create({
      runId: "run-2",
      templateId: "tpl-1",
      templateName: "Template 1",
      stepId: "step-2",
      stepName: "Approval",
      assignee: "approver-2",
      message: "Do not leak this",
      timeoutMinutes: 30,
    });

    const res = await request(app)
      .get("/api/approvals")
      .set(asAuth("approver-1"));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.approvals).toHaveLength(1);
    expect(res.body.approvals[0].assignee).toBe("approver-1");
  });

  it("forbids reading another user's approval", async () => {
    const { id } = await approvalStore.create({
      runId: "run-1",
      templateId: "tpl-1",
      templateName: "Template 1",
      stepId: "step-1",
      stepName: "Approval",
      assignee: "approver-1",
      message: "Approve this",
      timeoutMinutes: 30,
    });

    const res = await request(app)
      .get(`/api/approvals/${id}`)
      .set(asAuth("approver-2"));

    expect(res.status).toBe(403);
  });

  it("allows the assignee to resolve their approval", async () => {
    const { id } = await approvalStore.create({
      runId: "run-1",
      templateId: "tpl-1",
      templateName: "Template 1",
      stepId: "step-1",
      stepName: "Approval",
      assignee: "approver-1",
      message: "Approve this",
      timeoutMinutes: 30,
    });

    const res = await request(app)
      .post(`/api/approvals/${id}/resolve`)
      .set(asAuth("approver-1"))
      .send({ decision: "approved", comment: "Looks good" });

    expect(res.status).toBe(200);
    const resolved = await approvalStore.get(id);
    expect(resolved?.status).toBe("approved");
    expect(resolved?.comment).toBe("Looks good");
  });

  it("forbids resolving another user's approval", async () => {
    const { id } = await approvalStore.create({
      runId: "run-1",
      templateId: "tpl-1",
      templateName: "Template 1",
      stepId: "step-1",
      stepName: "Approval",
      assignee: "approver-1",
      message: "Approve this",
      timeoutMinutes: 30,
    });

    const res = await request(app)
      .post(`/api/approvals/${id}/resolve`)
      .set(asAuth("approver-2"))
      .send({ decision: "approved" });

    expect(res.status).toBe(403);
  });

  it("lists in-app approval notifications for the current approver only", async () => {
    await approvalStore.create({
      runId: "run-1",
      templateId: "tpl-1",
      templateName: "Template 1",
      stepId: "step-1",
      stepName: "Approval",
      assignee: "approver-1",
      message: "Approve this",
      timeoutMinutes: 30,
    });
    await approvalStore.create({
      runId: "run-2",
      templateId: "tpl-2",
      templateName: "Template 2",
      stepId: "step-2",
      stepName: "Approval",
      assignee: "approver-2",
      message: "Hidden",
      timeoutMinutes: 30,
    });

    const res = await request(app)
      .get("/api/approvals/notifications")
      .set(asAuth("approver-1"));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].assignee).toBe("approver-1");
  });
});


// ---------------------------------------------------------------------------
// Control plane APIs
// ---------------------------------------------------------------------------

describe("Control plane APIs", () => {
  it("requires X-Paperclip-Run-Id on mutating requests", async () => {
    const res = await request(app)
      .post("/api/control-plane/teams")
      .set(asAuth())
      .send({ name: "Growth Ops" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/X-Paperclip-Run-Id/i);
  });

  it("creates a team and lists it back", async () => {
    const createRes = await request(app)
      .post("/api/control-plane/teams")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-create-team")
      .send({
        name: "Revenue Automation",
        budgetMonthlyUsd: 250,
        deploymentMode: "continuous_agents",
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe("Revenue Automation");
    expect(createRes.body.deploymentMode).toBe("continuous_agents");

    const listRes = await request(app)
      .get("/api/control-plane/teams")
      .set(asAuth());

    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(1);
    expect(listRes.body.teams[0].id).toBe(createRes.body.id);
  });

  it("deploys a workflow template as an agent team", async () => {
    const res = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-team")
      .send({
        templateId: "tpl-support-bot",
        budgetMonthlyUsd: 120,
        defaultIntervalMinutes: 30,
      });

    expect(res.status).toBe(201);
    expect(res.body.team.workflowTemplateId).toBe("tpl-support-bot");
    expect(res.body.workflow.name).toBe("Customer Support Bot");
    expect(Array.isArray(res.body.agents)).toBe(true);
    expect(res.body.agents.length).toBeGreaterThan(1);
    expect(
      res.body.agents.some((agent: { roleKey: string }) => agent.roleKey === "workflow-manager")
    ).toBe(true);
    expect(
      res.body.agents
        .filter((agent: { roleKey: string }) => agent.roleKey !== "workflow-manager")
        .every(
          (agent: { schedule: { type: string; intervalMinutes?: number } }) =>
            agent.schedule.type === "interval" && agent.schedule.intervalMinutes === 30
        )
    ).toBe(true);
  });

  it("creates a bridged task and enforces atomic checkout", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-for-task")
      .send({ templateId: "tpl-support-bot" });

    const teamId = deployRes.body.team.id;
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );

    const createTaskRes = await request(app)
      .post("/api/control-plane/tasks")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-create-task")
      .send({
        teamId,
        title: "Handle escalated refund",
        sourceRunId: "run_123",
        sourceWorkflowStepId: workerAgent.workflowStepId,
        assignedAgentId: workerAgent.id,
      });

    expect(createTaskRes.status).toBe(201);
    expect(createTaskRes.body.status).toBe("todo");
    expect(createTaskRes.body.auditTrail).toHaveLength(1);

    const checkoutRes = await request(app)
      .post(`/api/control-plane/tasks/${createTaskRes.body.id}/checkout`)
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-checkout-1");

    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.status).toBe("in_progress");
    expect(checkoutRes.body.checkedOutBy).toBe("run-checkout-1");

    const conflictRes = await request(app)
      .post(`/api/control-plane/tasks/${createTaskRes.body.id}/checkout`)
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-checkout-2");

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error).toMatch(/already checked out/i);
  });

  it("records heartbeats for deployed agents", async () => {
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-deploy-heartbeat")
      .send({ templateId: "tpl-support-bot" });

    const teamId = deployRes.body.team.id;
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );

    const heartbeatRes = await request(app)
      .post("/api/control-plane/heartbeats")
      .set(asAuth())
      .set("X-Paperclip-Run-Id", "run-heartbeat-1")
      .send({
        teamId,
        agentId: workerAgent.id,
        status: "completed",
        summary: "Processed the daily support queue",
        costUsd: 1.42,
        createdTaskIds: ["task-a", "task-b"],
      });

    expect(heartbeatRes.status).toBe(201);
    expect(heartbeatRes.body.status).toBe("completed");
    expect(heartbeatRes.body.createdTaskIds).toEqual(["task-a", "task-b"]);

    const listRes = await request(app)
      .get(`/api/control-plane/teams/${teamId}`)
      .set(asAuth());

    expect(listRes.status).toBe(200);
    expect(listRes.body.heartbeats).toHaveLength(1);
    expect(listRes.body.heartbeats[0].summary).toBe("Processed the daily support queue");
  });
});

// ---------------------------------------------------------------------------
// POST /api/runs
// ---------------------------------------------------------------------------

describe("POST /api/runs", () => {
  afterEach(() => {
    delete process.env.QA_AUTH_BYPASS_ENABLED;
    delete process.env.QA_AUTH_BYPASS_USER_IDS;
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(app)
      .post("/api/runs")
      .send({ templateId: "tpl-support-bot", input: {} });
    expect(res.status).toBe(401);
  });

  it("accepts the staging QA bypass header when explicitly enabled", async () => {
    withQaBypass();

    const res = await request(app)
      .post("/api/runs")
      .set("X-User-Id", "qa-smoke-user")
      .send({ templateId: "tpl-support-bot", input: { ticketId: "TKT-QA-001" } });

    expect(res.status).toBe(202);
    expect(res.body.id).toBeDefined();
  });

  it("rejects the QA bypass header when the user is not allowlisted", async () => {
    withQaBypass("qa-smoke-user");

    const res = await request(app)
      .post("/api/runs")
      .set("X-User-Id", "not-allowed")
      .send({ templateId: "tpl-support-bot", input: {} });

    expect(res.status).toBe(401);
  });

  it("returns 202 with a pending run for a valid templateId", async () => {
    const res = await request(app)
      .post("/api/runs")
      .set(asAuth())
      .send({ templateId: "tpl-support-bot", input: { ticketId: "TKT-001", subject: "Help", body: "I need help", customerEmail: "test@example.com", channel: "email" } });
    expect(res.status).toBe(202);
    expect(res.body.id).toBeDefined();
    expect(res.body.templateId).toBe("tpl-support-bot");
    expect(["pending", "running", "completed"]).toContain(res.body.status);
  });

  it("returns 400 when templateId is missing", async () => {
    const res = await request(app)
      .post("/api/runs")
      .set(asAuth())
      .send({ input: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/templateId/i);
  });

  it("returns 404 for an unknown templateId", async () => {
    const res = await request(app)
      .post("/api/runs")
      .set(asAuth())
      .send({ templateId: "tpl-nonexistent", input: {} });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns a run with startedAt timestamp", async () => {
    const res = await request(app)
      .post("/api/runs")
      .set(asAuth("runs-started-at-user"))
      .send({ templateId: "tpl-support-bot", input: {} });
    expect(res.status).toBe(202);
    expect(typeof res.body.startedAt).toBe("string");
    expect(new Date(res.body.startedAt).getTime()).not.toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// GET /api/runs
// ---------------------------------------------------------------------------

describe("GET /api/runs", () => {
  afterEach(() => {
    delete process.env.QA_AUTH_BYPASS_ENABLED;
    delete process.env.QA_AUTH_BYPASS_USER_IDS;
  });

  it("returns 200 with a runs array", async () => {
    const res = await request(app).get("/api/runs").set(asAuth("runs-list-user"));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
    expect(typeof res.body.total).toBe("number");
  });

  it("total matches runs array length", async () => {
    const res = await request(app).get("/api/runs").set(asAuth("runs-list-user"));
    expect(res.body.total).toBe(res.body.runs.length);
  });

  it("lists runs with the staging QA bypass header when enabled", async () => {
    withQaBypass();

    const res = await request(app).get("/api/runs").set("X-User-Id", "qa-smoke-user");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/runs/:id
// ---------------------------------------------------------------------------

describe("GET /api/runs/:id", () => {
  afterEach(() => {
    delete process.env.QA_AUTH_BYPASS_ENABLED;
    delete process.env.QA_AUTH_BYPASS_USER_IDS;
  });

  it("returns 202 run and then retrieves it by id", async () => {
    const runReadbackUserId = "runs-readback-user";
    const startRes = await request(app)
      .post("/api/runs")
      .set(asAuth(runReadbackUserId))
      .send({ templateId: "tpl-support-bot", input: { ticketId: "TKT-002", subject: "Issue", body: "Problem", customerEmail: "b@example.com", channel: "email" } });
    expect(startRes.status).toBe(202);
    const runId = startRes.body.id;

    const getRes = await request(app).get(`/api/runs/${runId}`).set(asAuth(runReadbackUserId));
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(runId);
  });

  it("returns 404 for an unknown run id", async () => {
    const res = await request(app)
      .get("/api/runs/run-does-not-exist")
      .set(asAuth("runs-unknown-id-user"));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("retrieves a run by id with the staging QA bypass header when enabled", async () => {
    withQaBypass();

    const startRes = await request(app)
      .post("/api/runs")
      .set("X-User-Id", "qa-smoke-user")
      .send({ templateId: "tpl-support-bot", input: { ticketId: "TKT-QA-002" } });
    expect(startRes.status).toBe(202);

    const getRes = await request(app)
      .get(`/api/runs/${startRes.body.id}`)
      .set("X-User-Id", "qa-smoke-user");

    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(startRes.body.id);
  });
});

// ---------------------------------------------------------------------------
// GET /api/analytics/routing-decisions
// ---------------------------------------------------------------------------

describe("GET /api/analytics/routing-decisions", () => {
  beforeEach(() => {
    clearClassificationDecisionsForTests();
  });

  afterEach(() => {
    clearClassificationDecisionsForTests();
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/analytics/routing-decisions");
    expect(res.status).toBe(401);
  });

  it("returns logged routing decisions for dashboard consumption", async () => {
    const routingUserId = "routing-analytics-user";
    logClassificationDecision({
      promptHash: "hash-1",
      features: extractPromptFeatures("Classify this ticket", 120, 1),
      selectedTier: "lite",
      confidenceScore: 0.9,
      modelId: "gpt-4o-mini",
    });

    const res = await request(app)
      .get("/api/analytics/routing-decisions")
      .set(asAuth(routingUserId));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.decisions)).toBe(true);
    expect(res.body.total).toBe(1);
    expect(typeof res.body.capacity).toBe("number");
    expect(res.body.decisions[0]).toEqual(
      expect.objectContaining({
        promptHash: "hash-1",
        selectedTier: "lite",
        confidenceScore: 0.9,
        modelId: "gpt-4o-mini",
      })
    );
    expect(res.body.decisions[0].features).toBeDefined();
    expect(typeof res.body.decisions[0].timestamp).toBe("string");
  });
});

describe("GET /api/observability", () => {
  it("returns searchable trace records and supports CSV export", async () => {
    const observabilityUserId = "observability-contract-user";
    const deployRes = await request(app)
      .post("/api/control-plane/deployments/workflow")
      .set(asAuth(observabilityUserId))
      .set("X-Paperclip-Run-Id", "run-deploy-observability")
      .send({ templateId: "tpl-support-bot" });

    const teamId = deployRes.body.team.id;
    const workerAgent = deployRes.body.agents.find(
      (agent: { roleKey: string }) => agent.roleKey !== "workflow-manager"
    );
    const step = WORKFLOW_TEMPLATES.find((template) => template.id === "tpl-support-bot")!.steps.find(
      (candidate) => candidate.kind === "llm"
    )!;

    const started = await controlPlaneStore.startAgentExecution({
      userId: observabilityUserId,
      actor: "run-observability-seed",
      teamId,
      step,
      sourceRunId: "obs-run-1",
      requestedAgentId: workerAgent.id,
      taskTitle: "Handle observability trace",
    });

    await controlPlaneStore.finalizeAgentExecution({
      executionId: started.execution.id,
      userId: observabilityUserId,
      status: "completed",
      summary: "Completed the traceable step",
      costUsd: 1.25,
    });

    await runStore.create({
      id: "obs-run-1",
      templateId: "tpl-support-bot",
      templateName: "Support Bot",
      status: "completed",
      startedAt: "2026-04-28T03:00:00.000Z",
      completedAt: "2026-04-28T03:00:05.000Z",
      input: {},
      output: {},
      userId: observabilityUserId,
      stepResults: [
        {
          stepId: step.id,
          stepName: step.name,
          status: "success",
          durationMs: 1500,
          output: {
            _observability: {
              stepKind: step.kind,
              startedAt: "2026-04-28T03:00:00.000Z",
              completedAt: "2026-04-28T03:00:01.500Z",
              reasoningTrace: "Reasoned about customer routing and escalation policy.",
              toolCalls: [
                {
                  timestamp: "2026-04-28T03:00:01.000Z",
                  toolType: "mcp",
                  toolName: "crm.lookup",
                  input: { ticketId: "T-1" },
                  output: { accountName: "Acme" },
                },
              ],
              agentExecution: {
                executionId: started.execution.id,
                teamId,
                agentId: workerAgent.id,
                taskId: started.task?.id ?? null,
                skills: started.execution.appliedSkills,
              },
            },
          },
          costLog: {
            modelTier: "power",
            modelId: "gpt-4o",
            promptTokens: 100,
            completionTokens: 50,
            estimatedCostUsd: 1.25,
          },
        },
      ],
    });

    const res = await request(app)
      .get(`/api/observability?agentId=${encodeURIComponent(workerAgent.id)}&search=crm.lookup`)
      .set(asAuth(observabilityUserId));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.records[0]).toMatchObject({
      templateName: "Support Bot",
      stepName: step.name,
      stepKind: "llm",
      agentName: workerAgent.name,
      taskTitle: "Handle observability trace",
      costUsd: 1.25,
      reasoningTrace: expect.stringContaining("customer routing"),
    });
    expect(res.body.records[0].toolCalls[0].toolName).toBe("crm.lookup");

    const csvRes = await request(app)
      .get(`/api/observability?format=csv&agentId=${encodeURIComponent(workerAgent.id)}`)
      .set(asAuth(observabilityUserId));

    expect(csvRes.status).toBe(200);
    expect(csvRes.headers["content-type"]).toMatch(/text\/csv/);
    expect(csvRes.text).toContain("crm.lookup");
    expect(csvRes.text).toContain("Handle observability trace");
  });
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/:templateId
// ---------------------------------------------------------------------------

describe("POST /api/webhooks/:templateId", () => {
  it("returns 202 with runId and status for a valid templateId", async () => {
    const res = await request(app)
      .post("/api/webhooks/tpl-support-bot")
      .send({ ticketId: "WH-001", subject: "Webhook test", body: "Hello", customerEmail: "wh@example.com", channel: "webhook" });
    expect(res.status).toBe(202);
    expect(typeof res.body.runId).toBe("string");
    expect(["pending", "running", "completed"]).toContain(res.body.status);
  });

  it("returns 404 for an unknown templateId", async () => {
    const res = await request(app)
      .post("/api/webhooks/tpl-nonexistent")
      .send({ data: "test" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 400 when body is not a JSON object", async () => {
    const res = await request(app)
      .post("/api/webhooks/tpl-support-bot")
      .set("Content-Type", "application/json")
      .send("not-an-object");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON object/i);
  });

  it("returns 400 when body is an array", async () => {
    const res = await request(app)
      .post("/api/webhooks/tpl-support-bot")
      .send([{ ticketId: "T-1" }]);
    expect(res.status).toBe(400);
  });

  it("webhook response only contains runId and status (not full run object)", async () => {
    const res = await request(app)
      .post("/api/webhooks/tpl-support-bot")
      .send({ ticketId: "WH-002" });
    expect(res.status).toBe(202);
    expect(res.body.runId).toBeDefined();
    expect(res.body.status).toBeDefined();
    // Should NOT return the full run body
    expect(res.body.templateId).toBeUndefined();
    expect(res.body.stepResults).toBeUndefined();
  });

  it("run created by webhook is retrievable via GET /api/runs/:id", async () => {
    const webhookUserId = "webhook-readback-user";
    const webhookRes = await request(app)
      .post("/api/webhooks/tpl-support-bot")
      .send({ ticketId: "WH-003", subject: "Test" });
    expect(webhookRes.status).toBe(202);

    const runId = webhookRes.body.runId;
    const getRes = await request(app).get(`/api/runs/${runId}`).set(asAuth(webhookUserId));
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(runId);
  });

  it("all 3 template webhooks accept valid input", async () => {
    const cases = [
      { id: "tpl-support-bot", body: { ticketId: "T1" } },
      { id: "tpl-lead-enrich", body: { leadId: "L1", email: "lead@test.com" } },
      { id: "tpl-content-gen", body: { topic: "AI", keywords: [], audience: "all", format: "blog", wordCount: 500 } },
    ];
    for (const { id, body } of cases) {
      const res = await request(app).post(`/api/webhooks/${id}`).send(body);
      expect(res.status).toBe(202);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /health — enhanced (now returns run stats)
// ---------------------------------------------------------------------------

describe("GET /health — run stats", () => {
  it("counts running, completed, and failed runs", async () => {
    await runStore.create({
      id: "health-running",
      templateId: "tpl-support-bot",
      templateName: "Support Bot",
      status: "running",
      startedAt: new Date().toISOString(),
      input: {},
      stepResults: [],
    });
    await runStore.create({
      id: "health-completed",
      templateId: "tpl-support-bot",
      templateName: "Support Bot",
      status: "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      input: {},
      output: {},
      stepResults: [],
    });
    await runStore.create({
      id: "health-failed",
      templateId: "tpl-support-bot",
      templateName: "Support Bot",
      status: "failed",
      startedAt: new Date().toISOString(),
      input: {},
      error: "boom",
      stepResults: [],
    });

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.runs).toMatchObject({
      total: 3,
      running: 1,
      completed: 1,
      failed: 1,
      error: null,
    });
  });

  it("returns runs object with total, running, completed, failed counts", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.runs).toBeDefined();
    expect(typeof res.body.runs.total).toBe("number");
    expect(typeof res.body.runs.running).toBe("number");
    expect(typeof res.body.runs.completed).toBe("number");
    expect(typeof res.body.runs.failed).toBe("number");
  });

  it("run counts are non-negative integers", async () => {
    const res = await request(app).get("/health");
    const { total, running, completed, failed } = res.body.runs;
    expect(total).toBeGreaterThanOrEqual(0);
    expect(running).toBeGreaterThanOrEqual(0);
    expect(completed).toBeGreaterThanOrEqual(0);
    expect(failed).toBeGreaterThanOrEqual(0);
  });

  it("degrades gracefully when listing runs fails", async () => {
    jest.spyOn(runStore, "list").mockRejectedValueOnce(new Error("run store unavailable"));

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.runs).toEqual({
      total: 0,
      running: 0,
      completed: 0,
      failed: 0,
      error: "run store unavailable",
    });
  });

  it("stringifies non-Error run store failures", async () => {
    jest.spyOn(runStore, "list").mockRejectedValueOnce("run store unavailable");

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.runs.error).toBe("run store unavailable");
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("Rate limiting", () => {
  it("enforces LLM endpoint limits per authenticated user and returns Retry-After", async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .post("/api/runs")
        .set(asAuth("rate-limit-llm-user"))
        .send({ templateId: "tpl-support-bot", input: { ticketId: `RL-${i}` } });
      expect(res.status).toBe(202);
    }

    const blocked = await request(app)
      .post("/api/runs")
      .set(asAuth("rate-limit-llm-user"))
      .send({ templateId: "tpl-support-bot", input: { ticketId: "RL-over" } });

    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("enforces general API limits and returns Retry-After", async () => {
    const generalRateLimitUserId = "rate-limit-general-user";
    for (let i = 0; i < 100; i += 1) {
      const res = await request(app).get("/api/templates").set(asAuth(generalRateLimitUserId));
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).get("/api/templates").set(asAuth(generalRateLimitUserId));
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Content-type and error handling
// ---------------------------------------------------------------------------

describe("Content-Type and error handling", () => {
  it("all successful responses use application/json", async () => {
    const endpoints = [
      "/health",
      "/api/templates",
      "/api/templates/tpl-support-bot",
      "/api/templates/tpl-support-bot/sample",
      "/api/runs",
    ];
    for (const ep of endpoints) {
      const res = await request(app).get(ep);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    }
  });

  it("404 responses use application/json", async () => {
    const res = await request(app).get("/api/templates/tpl-nope");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});
