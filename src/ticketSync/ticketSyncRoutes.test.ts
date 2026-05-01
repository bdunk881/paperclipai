import crypto from "crypto";
import express from "express";
import request from "supertest";
import ticketRoutes from "../tickets/ticketRoutes";
import { ticketStore } from "../tickets/ticketStore";
import { TrackerAdapter, TrackerComment, TrackerHealth, TrackerIssue } from "../integrations/tracker-sync";
import { integrationCredentialStore } from "../integrations/integrationCredentialStore";
import { linearCredentialStore } from "../integrations/linear/credentialStore";
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
      status: "healthy",
      provider: this.provider,
      checkedAt: new Date().toISOString(),
      recommendedNextAction: "No action required.",
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

function hmac(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
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
    integrationCredentialStore.clear();
    linearCredentialStore.clear();
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
    expect(tested.body.health.status).toBe("healthy");
  });

  it("updates and revokes tracker connections from the dashboard routes", async () => {
    const app = buildApp();
    const created = await request(app)
      .post("/api/ticket-sync/connections")
      .set(auth("user-1"))
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        provider: "linear",
        authMethod: "api_key",
        label: "Linear workspace",
        config: { defaultTeamId: "team-1", webhookSecret: "linear-secret" },
        secrets: { token: "lin_token" },
      });

    expect(created.status).toBe(201);

    const updated = await request(app)
      .patch(`/api/ticket-sync/connections/${created.body.id}`)
      .set(auth("user-1"))
      .send({
        label: "Linear production workspace",
        enabled: false,
        syncDirection: "inbound",
        config: { defaultProjectId: "project-1" },
      });

    expect(updated.status).toBe(200);
    expect(updated.body.label).toBe("Linear production workspace");
    expect(updated.body.enabled).toBe(false);
    expect(updated.body.syncDirection).toBe("inbound");
    expect(updated.body.config.defaultProjectId).toBe("project-1");
    expect(updated.body.config.hasWebhookSecret).toBe(true);

    const listed = await request(app)
      .get("/api/ticket-sync/connections?workspaceId=11111111-1111-4111-8111-111111111111")
      .set(auth("user-1"));

    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);

    const revoked = await request(app)
      .delete(`/api/ticket-sync/connections/${created.body.id}`)
      .set(auth("user-1"));

    expect(revoked.status).toBe(204);

    const missing = await request(app)
      .get(`/api/ticket-sync/connections/${created.body.id}`)
      .set(auth("user-1"));

    expect(missing.status).toBe(404);

    const listedAfterRevoke = await request(app)
      .get("/api/ticket-sync/connections?workspaceId=11111111-1111-4111-8111-111111111111")
      .set(auth("user-1"));

    expect(listedAfterRevoke.status).toBe(200);
    expect(listedAfterRevoke.body.total).toBe(0);
  });

  it("scopes dashboard connection routes to the authenticated credential owner", async () => {
    const app = buildApp();
    const created = await request(app)
      .post("/api/ticket-sync/connections")
      .set(auth("user-1"))
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        provider: "github",
        authMethod: "api_key",
        label: "Private GitHub board",
        config: { owner: "autoflow", repo: "paperclipai" },
        secrets: { token: "ghp_private" },
      });

    expect(created.status).toBe(201);

    const foreignList = await request(app)
      .get("/api/ticket-sync/connections?workspaceId=11111111-1111-4111-8111-111111111111")
      .set(auth("user-2"));

    expect(foreignList.status).toBe(200);
    expect(foreignList.body.total).toBe(0);

    const foreignGet = await request(app)
      .get(`/api/ticket-sync/connections/${created.body.id}`)
      .set(auth("user-2"));

    expect(foreignGet.status).toBe(404);

    const foreignHealth = await request(app)
      .post(`/api/ticket-sync/connections/${created.body.id}/test`)
      .set(auth("user-2"));

    expect(foreignHealth.status).toBe(404);
  });

  it("bootstraps a GitHub tracker connection from an existing integration credential", async () => {
    const app = buildApp();
    const integration = integrationCredentialStore.create({
      userId: "user-1",
      integrationSlug: "github",
      label: "GitHub PAT",
      credentials: { token: "ghp_bootstrap" },
    });

    const created = await request(app)
      .post("/api/ticket-sync/connections/bootstrap")
      .set(auth("user-1"))
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        provider: "github",
        label: "GitHub bootstrap",
        config: { owner: "autoflow", repo: "paperclipai" },
        source: {
          type: "integration_connection",
          connectionId: integration.id,
        },
      });

    expect(created.status).toBe(201);
    expect(created.body.provider).toBe("github");
    expect(created.body.authMethod).toBe("api_key");
  });

  it("bootstraps a Linear tracker connection from the active Linear connector credential", async () => {
    const app = buildApp();
    linearCredentialStore.saveOAuth({
      userId: "user-1",
      accessToken: "lin_oauth_bootstrap",
      refreshToken: "lin_refresh_bootstrap",
      scopes: ["read", "write"],
      organizationId: "org-1",
      organizationName: "AutoFlow",
    });

    const connection = await request(app)
      .post("/api/ticket-sync/connections/bootstrap")
      .set(auth("user-1"))
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        provider: "linear",
        label: "Linear bootstrap",
        config: { defaultTeamId: "team-1" },
        source: {
          type: "linear_connector",
        },
      });

    expect(connection.status).toBe(201);
    expect(connection.body.authMethod).toBe("oauth2_pkce");

    const created = await request(app)
      .post("/api/tickets")
      .set(auth("user-1"))
      .set("X-Paperclip-Run-Id", "run-linear-bootstrap-ticket")
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title: "Bootstrapped Linear sync target",
        assignees: [{ type: "user", id: "user-1", role: "primary" }],
      });

    expect(created.status).toBe(201);

    const links = await request(app)
      .get(`/api/ticket-sync/tickets/${created.body.ticket.id}/links`)
      .set(auth("user-1"));

    expect(links.status).toBe(200);
    expect(links.body.total).toBe(1);
    expect(adapters.get(connection.body.id)?.createdIssues).toHaveLength(1);
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
    const issueSignature = `sha256=${hmac("secret", issuePayload)}`;

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
    const commentSignature = `sha256=${hmac("secret", commentPayload)}`;

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

  it("imports Jira issues and comments through the ticket-sync webhook", async () => {
    const app = buildApp();
    const connection = await request(app)
      .post("/api/ticket-sync/connections")
      .set(auth("user-1"))
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        provider: "jira",
        authMethod: "basic",
        label: "Jira project",
        config: {
          site: "https://autoflow.atlassian.net",
          defaultProjectKey: "ALT",
          webhookSecret: "jira-secret",
        },
        secrets: { email: "ops@autoflow.test", apiToken: "jira_token" },
      });

    const issuePayload = JSON.stringify({
      webhookEvent: "jira:issue_created",
      issue: {
        id: "jira-1",
        key: "ALT-1",
        self: "https://autoflow.atlassian.net/rest/api/3/issue/jira-1",
        fields: {
          summary: "Imported Jira issue",
          description: "Created from Jira",
          labels: ["autoflow"],
          status: { name: "To Do" },
          priority: { name: "High" },
        },
      },
    });

    const webhook = await request(app)
      .post(`/api/webhooks/ticket-sync/jira/${connection.body.id}`)
      .set("X-Atlassian-Webhook-Signature", hmac("jira-secret", issuePayload))
      .set("Content-Type", "application/json")
      .send(issuePayload);

    expect(webhook.status).toBe(202);
    expect(webhook.body.ticketId).toBeTruthy();

    const commentPayload = JSON.stringify({
      webhookEvent: "comment_created",
      issue: {
        id: "jira-1",
        key: "ALT-1",
        fields: { labels: ["autoflow"] },
      },
      comment: {
        id: "comment-1",
        body: "Inbound Jira comment",
        author: { displayName: "Jira User" },
      },
    });

    const comment = await request(app)
      .post(`/api/webhooks/ticket-sync/jira/${connection.body.id}`)
      .set("X-Atlassian-Webhook-Signature", hmac("jira-secret", commentPayload))
      .set("Content-Type", "application/json")
      .send(commentPayload);

    expect(comment.status).toBe(202);

    const activity = await request(app)
      .get(`/api/tickets/${webhook.body.ticketId}/activity`)
      .set(auth("user-1"));

    expect(activity.status).toBe(200);
    expect(activity.body.updates.some((update: any) => update.content === "Inbound Jira comment")).toBe(true);
  });

  it("updates linked tickets from Linear webhooks and suppresses echoed comments", async () => {
    const app = buildApp();
    const connection = await request(app)
      .post("/api/ticket-sync/connections")
      .set(auth("user-1"))
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        provider: "linear",
        authMethod: "api_key",
        label: "Linear workspace",
        config: {
          defaultTeamId: "team-1",
          webhookSecret: "linear-secret",
        },
        fieldMapping: {
          assignee: {
            "user-2": "lin-user-2",
          },
        },
        secrets: { token: "lin_token" },
      });

    const created = await request(app)
      .post("/api/tickets")
      .set(auth("user-1"))
      .set("X-Paperclip-Run-Id", "run-linear-ticket")
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        title: "Linear sync target",
        assignees: [{ type: "user", id: "user-1", role: "primary" }],
      });

    const updatePayload = JSON.stringify({
      action: "update",
      type: "Issue",
      data: {
        id: "remote-1",
        identifier: "LINEAR-1",
        title: "Linear updated title",
        description: "Updated from Linear",
        state: { name: "In Progress" },
        assignee: { id: "lin-user-2" },
        labels: [{ name: "autoflow" }],
      },
    });

    const linearSignature = hmac("linear-secret", updatePayload);
    const update = await request(app)
      .post(`/api/webhooks/ticket-sync/linear/${connection.body.id}`)
      .set("Linear-Signature", linearSignature)
      .set("Linear-Delivery", "delivery-1")
      .set("Content-Type", "application/json")
      .send(updatePayload);

    expect(update.status).toBe(202);

    const ticket = await request(app)
      .get(`/api/tickets/${created.body.ticket.id}`)
      .set(auth("user-1"));

    expect(ticket.status).toBe(200);
    expect(ticket.body.ticket.title).toBe("Linear updated title");
    expect(ticket.body.ticket.assignees).toEqual([{ type: "user", id: "user-2", role: "primary" }]);

    const commentPayload = JSON.stringify({
      action: "create",
      type: "Comment",
      data: {
        id: "comment-1",
        issueId: "remote-1",
        issueIdentifier: "LINEAR-1",
        body: "<!--autoflow:source=autoflow;idempotency=linear-echo-->\n[AutoFlow · user-1] echo",
      },
    });

    const echoed = await request(app)
      .post(`/api/webhooks/ticket-sync/linear/${connection.body.id}`)
      .set("Linear-Signature", hmac("linear-secret", commentPayload))
      .set("Linear-Delivery", "delivery-2")
      .set("Content-Type", "application/json")
      .send(commentPayload);

    expect(echoed.status).toBe(202);

    const activity = await request(app)
      .get(`/api/tickets/${created.body.ticket.id}/activity`)
      .set(auth("user-1"));

    expect(activity.status).toBe(200);
    expect(activity.body.updates.some((update: any) => String(update.content).includes("echo"))).toBe(false);
  });
});
