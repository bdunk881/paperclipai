/**
 * HEL-676: public form ingress — route tests (supertest).
 *
 * Stubs the pool to return a form workflow DAG and mocks the engine's startRun,
 * so the route's load → validate → start logic is exercised in isolation.
 */

import express from "express";
import request from "supertest";
import type { Pool } from "pg";

jest.mock("../engine/WorkflowEngine", () => ({
  workflowEngine: { startRun: jest.fn(async () => ({ id: "run-123" })) },
}));

import { createFormRoutes } from "./formRoutes";
import { workflowEngine } from "../engine/WorkflowEngine";

const mockStartRun = workflowEngine.startRun as jest.Mock;
const FORM_WORKFLOW_ID = "11111111-1111-1111-1111-111111111111";

function dagWithForm() {
  return {
    id: "tpl-form",
    name: "Contact form",
    description: "d",
    category: "custom",
    version: "1",
    configFields: [],
    sampleInput: {},
    expectedOutput: {},
    steps: [
      {
        id: "ft",
        name: "Form",
        kind: "form_trigger",
        description: "",
        inputKeys: [],
        outputKeys: [],
        config: {
          formTitle: "Contact us",
          formFields: [
            { key: "name", label: "Name", type: "text", required: true },
            { key: "email", label: "Email", type: "email", required: true },
          ],
        },
      },
      { id: "o", name: "Out", kind: "output", description: "", inputKeys: [], outputKeys: [] },
    ],
  };
}

function appWith(rows: unknown[]) {
  const pool = { query: jest.fn(async () => ({ rows })) } as unknown as Pool;
  const app = express();
  app.use(express.json());
  app.use("/api/forms", createFormRoutes(pool));
  return app;
}

beforeEach(() => mockStartRun.mockClear());

describe("form ingress (HEL-676)", () => {
  it("GET returns the form definition", async () => {
    const app = appWith([{ workspace_id: "ws1", dag: dagWithForm() }]);
    const res = await request(app).get(`/api/forms/${FORM_WORKFLOW_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Contact us");
    expect(res.body.fields).toHaveLength(2);
  });

  it("GET 404 when the workflow has no form_trigger", async () => {
    const dag = dagWithForm();
    dag.steps[0].kind = "trigger";
    const app = appWith([{ workspace_id: "ws1", dag }]);
    const res = await request(app).get(`/api/forms/${FORM_WORKFLOW_ID}`);
    expect(res.status).toBe(404);
  });

  it("GET 404 on an unknown workflow id", async () => {
    const app = appWith([]);
    const res = await request(app).get(`/api/forms/${FORM_WORKFLOW_ID}`);
    expect(res.status).toBe(404);
  });

  it("POST 400 on validation failure (missing required)", async () => {
    const app = appWith([{ workspace_id: "ws1", dag: dagWithForm() }]);
    const res = await request(app).post(`/api/forms/${FORM_WORKFLOW_ID}`).send({ name: "Ada" });
    expect(res.status).toBe(400);
    expect(res.body.fields).toHaveProperty("email");
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it("POST 202 starts a run with the validated form values", async () => {
    const app = appWith([{ workspace_id: "ws1", dag: dagWithForm() }]);
    const res = await request(app)
      .post(`/api/forms/${FORM_WORKFLOW_ID}`)
      .send({ name: "Ada", email: "ada@x.io" });
    expect(res.status).toBe(202);
    expect(res.body.runId).toBe("run-123");
    expect(mockStartRun).toHaveBeenCalledTimes(1);
    const input = mockStartRun.mock.calls[0][1];
    expect(input).toMatchObject({ workspaceId: "ws1", form: { name: "Ada", email: "ada@x.io" } });
  });
});
