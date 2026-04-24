import { LinearClient } from "../linear/linearClient";
import { buildMirroredCommentBody, buildTrackerIdempotencyKey, shouldSuppressEcho } from "./metadata";
import { GitHubIssuesAdapter } from "./githubIssuesAdapter";
import { JiraAdapter } from "./jiraAdapter";
import { LinearAdapter } from "./linearAdapter";

function mockJsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  });
}

describe("tracker sync helpers", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("embeds mirrored authorship and idempotency metadata", () => {
    const key = buildTrackerIdempotencyKey({
      provider: "github",
      workspaceId: "ws-1",
      entityType: "comment",
      entityId: "123",
      fingerprint: "body-v1",
    });

    const body = buildMirroredCommentBody({
      agentName: "Integrations Engineer",
      body: "Synced from AutoFlow",
      metadata: {
        source: "autoflow",
        idempotencyKey: key,
      },
    });

    expect(body).toContain("[AutoFlow · Integrations Engineer] Synced from AutoFlow");
    expect(shouldSuppressEcho(body, key)).toBe(true);
    expect(shouldSuppressEcho(body, "other-key")).toBe(false);
  });

  it("lists GitHub issues across pages and skips pull requests", async () => {
    const adapter = new GitHubIssuesAdapter({
      owner: "autoflow",
      repo: "paperclipai",
      token: "ghp_test",
    });

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse(
          [
            {
              id: 1,
              number: 7,
              title: "Issue one",
              body: "body",
              state: "open",
              labels: [{ name: "autoflow" }],
              updated_at: "2026-04-23T00:00:00Z",
            },
            {
              id: 2,
              number: 8,
              title: "PR should be skipped",
              pull_request: {},
            },
          ],
          200,
          {
            Link: '<https://api.github.com/repos/autoflow/paperclipai/issues?page=2>; rel="next"',
          }
        )
      )
      .mockResolvedValueOnce(
        mockJsonResponse([
          {
            id: 3,
            number: 9,
            title: "Issue two",
            state: "closed",
            labels: ["bug"],
          },
        ])
      );

    const issues = await adapter.listIssues(10);

    expect(issues).toHaveLength(2);
    expect(issues[0].key).toBe("autoflow/paperclipai#7");
    expect(issues[1].labels).toEqual(["bug"]);
  });

  it("paginates Jira search results", async () => {
    const adapter = new JiraAdapter({
      site: "https://autoflow.atlassian.net",
      email: "ops@autoflow.test",
      apiToken: "jira_token",
      defaultProjectKey: "ALT",
    });

    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        mockJsonResponse({
          issues: [
            {
              id: "100",
              key: "ALT-100",
              fields: { summary: "First", labels: ["autoflow"] },
            },
          ],
          total: 2,
          maxResults: 1,
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          issues: [
            {
              id: "101",
              key: "ALT-101",
              fields: { summary: "Second", status: { name: "Done" } },
            },
          ],
          total: 2,
          maxResults: 1,
        })
      );

    const issues = await adapter.listIssues(2);

    expect(issues).toHaveLength(2);
    expect(issues[0].labels).toEqual(["autoflow"]);
    expect(issues[1].status).toBe("Done");
  });

  it("maps Linear comment operations through the shared adapter", async () => {
    const listCommentsSpy = jest.spyOn(LinearClient.prototype, "listComments").mockResolvedValue([
      {
        id: "comment-1",
        body: "hello",
        author: "brad",
        createdAt: "2026-04-23T00:00:00Z",
      },
    ]);
    const createCommentSpy = jest.spyOn(LinearClient.prototype, "createComment").mockResolvedValue({
      id: "comment-2",
      body: "mirrored",
      author: "autoflow",
      createdAt: "2026-04-23T00:00:00Z",
    });

    const adapter = new LinearAdapter({ token: "lin_token" });

    const listed = await adapter.listComments("issue-1");
    const created = await adapter.createComment("issue-1", { body: "mirrored" });

    expect(listCommentsSpy).toHaveBeenCalledWith("issue-1", 100);
    expect(createCommentSpy).toHaveBeenCalledWith("issue-1", "mirrored");
    expect(listed[0].body).toBe("hello");
    expect(created.id).toBe("comment-2");
  });
});
