import crypto from "crypto";
import express from "express";
import request from "supertest";
import ticketRoutes from "../tickets/ticketRoutes";
import { ticketStore } from "../tickets/ticketStore";
import { TrackerAdapter, TrackerComment, TrackerHealth, TrackerIssue } from "../integrations/tracker-sync";
import { ticketSyncConnectionStore } from "./connectionStore";
import ticketSyncRoutes from "./routes";
import { ticketSyncService } from "./service";
import ticketSyncWebhookRoutes from "./webhookRoutes";

class FakeTrackerAdapter implements TrackerAdapter {
  readonly provider: "github" | "jira" | "linear";
  createdIssues: Array<{ title: string; description?: string; labels?: string[] }> = [];
  createdComments: Array<{ issueId: string; body: string }> = [];

  constructor(provider: "github" | "jira" | "linear") {
    this.provider = provider;
  }

  async health(): Promise<TrackerHealth> {
    return {
      status: "ok",
      provider: this.provider,
      checkedAt: new Date().toISOString(),
      details: {
        auth: true,
        apiReachable: true,
        rateLimited: false,
      },
    };
  }

  async listIssues(): Promise<TrackerIssue[]> {
    return [];
  }

  async createIssue(input: { title: string; description?: string; labels?: string[] }): Promise<TrackerIssue> {
    this.createdIssues.push(input);
    return {
      id: "remote-1",
      key: `${this.provider.toUpperCase()}-1`,
      title: input.title,
      description: input.description,
      labels: input.labels ?? [],
      url: `https://example.test/${this.provider}/remote-1`,
    };
  }

  async updateIssue(issueId: string, input: { title?: string }): Promise<TrackerIssue> {
    return {
      id: issueId,
      key: `${this.provider.toUpperCase()}-1`,
      title: input.title ?? "updated",
      labels: [],
    };
  }

  async listComments(): Promise<TrackerComment[]> {
    return [];
  }

  async createComment(issueId: string, input: { body: string }): Promise<TrackerComment> {
    this.createdComments.push({ issueId, body: input.body });
    return {
      id: "comment-1",
      body: input.body,
    };
  }
}

function auth(userId: string) {
  return { Authorization: `Bearer ${userId}` };
}

function buildApp() {
  const app = express();
  app.use("/api/webhooks/ticket-sync", ticketSyncWebhookRoutes);
  app.use(express.json());
  app.use((req: any, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: authHeader.slice(7), email: "test@example.com" };
    next();
  });
  app.use("/api/ticket-sync", ticketSyncRoutes);
  app.use("/api/tickets", ticketRoutes);
  return app;
}

describe("ticket sync routes", () => {
  const adapters = new Map<string, FakeTrackerAdapter>();

  beforeEach(async () => {
    await ticketStore.clear();
    ticketSyncConnectionStore.clear();
    adapters.clear();
    ticketSyncService.setAdapterFactoryForTests(({ connectionId, provider }) => {
      const adapter = new FakeTrackerAdapter(provider);
      adapters.set(connectionId, adapter);
      return adapter;
    });
  });

  afterAll(() => {
    ticketSyncService.setAdapterFactoryForTests(null);
  });

  it("creates a tracker connection and exposes health", async () => {
    const app = buildApp();
    const created = await request(app)
      .post("/api/ticket-sync/connections")
      .set(auth("user-1"))
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        provider: "github",
        authMethod: "api_key",
        label: "GitHub board",
        config: { owner: "autoflow", repo: "paperclipai", webhookSecret: "secret" },
        secrets: { token: "ghp_test" },
      });

    expect(created.status).toBe(201);
    expect(created.body.provider).toBe("github");
    expect(created.body.config.hasWebhookSecret).toBe(true);

    const tested = await request(app)
      .post(`/api/ticket-sync/connections/${created.body.id}/test`)
      .set(auth("user-1"));

    expect(tested.status).toBe(200);
    expect(tested.body.health.status).toBe("ok");
  });

  it("creates an external issue and link when a local ticket is created", async () => {
    const app = buildApp();
    const connection = await request(app)
      .post("/api/ticket-sync/connections")
      .set(auth("user-1"))
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        provider: "github",
        authMethod: "api_key",
        label: "GitHub board",
        config: { owner: "autoflow", repo: "paperclipai" },
        secrets: { token: "ghp_test" },
      });

    const created = await request(app)
      .post("/api/tickets")
      .set(auth("user-1"))
      .set("X-Paperclip-Run-Id", "run-sync-create")
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title: "External sync",
        description: "Ship provider sync",
        tags: ["autoflow"],
        assignees: [{ type: "user", id: "user-1", role: "primary" }],
      });

    expect(created.status).toBe(201);

    const links = await request(app)
      .get(`/api/ticket-sync/tickets/${created.body.ticket.id}/links`)
      .set(auth("user-1"));

    expect(links.status).toBe(200);
    expect(links.body.total).toBe(1);
    expect(links.body.links[0].connectionId).toBe(connection.body.id);
    expect(adapters.get(connection.body.id)?.createdIssues).toHaveLength(1);
  });

  it("mirrors local comments outward with AutoFlow metadata", async () => {
    const app = buildApp();
    const connection = await request(app)
      .post("/api/ticket-sync/connections")
      .set(auth("user-1"))
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        provider: "github",
        authMethod: "api_key",
        label: "GitHub board",
        config: { owner: "autoflow", repo: "paperclipai" },
        secrets: { token: "ghp_test" },
      });

    const created = await request(app)
      .post("/api/tickets")
      .set(auth("user-1"))
      .set("X-Paperclip-Run-Id", "run-sync-ticket")
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title: "Mirror comments",
        assignees: [{ type: "user", id: "user-1", role: "primary" }],
      });

    const comment = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/updates`)
      .set(auth("user-1"))
      .set("X-Paperclip-Run-Id", "run-sync-comment")
      .send({
        type: "comment",
        content: "Please mirror this comment.",
        actorType: "user",
      });

    expect(comment.status).toBe(201);
    const mirrored = adapters.get(connection.body.id)?.createdComments[0];
    if (!mirrored) {
      throw new Error("Expected mirrored outbound comment");
    }
    expect(mirrored.body).toContain("[AutoFlow · user-1] Please mirror this comment.");
    expect(mirrored.body).toContain("autoflow");
  });

  it("imports labeled GitHub issues from webhooks and suppresses echoed comments", async () => {
    const app = buildApp();
    const connection = await request(app)
      .post("/api/ticket-sync/connections")
      .set(auth("user-1"))
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        provider: "github",
        authMethod: "api_key",
        label: "GitHub board",
        config: {
          owner: "autoflow",
          repo: "paperclipai",
          webhookSecret: "secret",
        },
        secrets: { token: "ghp_test" },
      });

    const issuePayload = JSON.stringify({
      action: "opened",
      issue: {
        id: 42,
        number: 42,
        title: "Imported external issue",
        body: "Created from GitHub",
        state: "open",
        labels: [{ name: "autoflow" }],
        html_url: "https://github.test/issues/42",
      },
    });
    const issueSignature = `sha256=${crypto.createHmac("sha256", "secret").update(issuePayload).digest("hex")}`;

    const webhook = await request(app)
      .post(`/api/webhooks/ticket-sync/github/${connection.body.id}`)
      .set("X-GitHub-Event", "issues")
      .set("X-Hub-Signature-256", issueSignature)
      .set("Content-Type", "application/json")
      .send(issuePayload);

    expect(webhook.status).toBe(202);
    expect(webhook.body.ticketId).toBeTruthy();

    const ticket = await request(app)
      .get(`/api/tickets/${webhook.body.ticketId}`)
      .set(auth("user-1"));

    expect(ticket.status).toBe(200);
    expect(ticket.body.ticket.title).toBe("Imported external issue");

    const commentPayload = JSON.stringify({
      action: "created",
      issue: {
        id: 42,
        number: 42,
        labels: [{ name: "autoflow" }],
      },
      comment: {
        id: 77,
        body: "<!--autoflow:source=autoflow;idempotency=abc-->\n[AutoFlow · user-1] echo",
      },
    });
    const commentSignature = `sha256=${crypto.createHmac("sha256", "secret").update(commentPayload).digest("hex")}`;

    const echoed = await request(app)
      .post(`/api/webhooks/ticket-sync/github/${connection.body.id}`)
      .set("X-GitHub-Event", "issue_comment")
      .set("X-Hub-Signature-256", commentSignature)
      .set("Content-Type", "application/json")
      .send(commentPayload);

    expect(echoed.status).toBe(202);

    const activity = await request(app)
      .get(`/api/tickets/${webhook.body.ticketId}/activity`)
      .set(auth("user-1"));

    expect(activity.status).toBe(200);
    expect(activity.body.total).toBe(2);
  });
});
