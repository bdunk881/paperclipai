import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { fetchGithubProvenance } from "./githubProvenance";

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("fetchGithubProvenance", () => {
  it("returns the trusted-origin hint without a fetch when the org is on the allowlist", async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(
      fakeResponse({
        stargazers_count: 200,
        pushed_at: "2026-04-01T00:00:00Z",
        default_branch: "main",
        license: { spdx_id: "MIT" },
      }),
    );
    // second call (head commit) returns nothing useful
    fetchImpl.mockResolvedValueOnce(
      fakeResponse({
        stargazers_count: 200,
        pushed_at: "2026-04-01T00:00:00Z",
        default_branch: "main",
        license: { spdx_id: "MIT" },
      }),
    );
    fetchImpl.mockResolvedValueOnce(
      fakeResponse({ commit: { committer: { date: "2026-05-01T00:00:00Z" } } }),
    );

    const result = await fetchGithubProvenance("anthropics", "skills", { fetchImpl });
    expect(result.trustedOrigin).toBe(true);
    expect(result.sourceRepo).toBe("github.com/anthropics/skills");
    expect(result.stars).toBe(200);
    expect(result.lastCommitAt).toBe("2026-05-01T00:00:00Z");
    expect(result.license).toBe("MIT");
  });

  it("marks an untrusted origin and still enriches with stars + license", async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(
      fakeResponse({
        stargazers_count: 42,
        pushed_at: "2026-03-01T00:00:00Z",
        default_branch: "main",
        license: { spdx_id: "Apache-2.0" },
      }),
    );
    fetchImpl.mockResolvedValueOnce(
      fakeResponse({ commit: { committer: { date: "2026-03-15T00:00:00Z" } } }),
    );

    const result = await fetchGithubProvenance("random-user", "neat-skill", { fetchImpl });
    expect(result.trustedOrigin).toBe(false);
    expect(result.stars).toBe(42);
    expect(result.license).toBe("Apache-2.0");
  });

  it("surfaces archived=true when GitHub reports the repo as archived", async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(
      fakeResponse({
        stargazers_count: 10,
        pushed_at: "2024-01-01T00:00:00Z",
        archived: true,
        default_branch: "main",
      }),
    );
    fetchImpl.mockResolvedValueOnce(
      fakeResponse({ commit: { committer: { date: "2024-01-02T00:00:00Z" } } }),
    );

    const result = await fetchGithubProvenance("u", "r", { fetchImpl });
    expect(result.archived).toBe(true);
  });

  it("forwards the Authorization header when a token is provided", async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    fetchImpl.mockResolvedValue(
      fakeResponse({ stargazers_count: 1, default_branch: "main" }),
    );

    await fetchGithubProvenance("u", "r", { fetchImpl, token: "tok-xyz" });

    const callArgs = fetchImpl.mock.calls[0]!;
    const init = callArgs[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-xyz");
    expect(headers.Accept).toBe("application/vnd.github+json");
  });

  it("collapses to a fetchError when the API returns non-OK", async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    fetchImpl.mockResolvedValueOnce(fakeResponse({ message: "rate limit" }, false, 403));

    const result = await fetchGithubProvenance("u", "r", { fetchImpl });
    expect(result.fetchError).toMatch(/GitHub 403/);
    expect(result.stars).toBeUndefined();
    // trusted-origin still resolves so the caller can fall back to the
    // org-allowlist-only path
    expect(result.trustedOrigin).toBe(false);
  });

  it("returns a fetchError when fetch throws (network down)", async () => {
    const fetchImpl = jest.fn<typeof fetch>();
    fetchImpl.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND") as never);

    const result = await fetchGithubProvenance("anthropics", "skills", { fetchImpl });
    expect(result.fetchError).toMatch(/ENOTFOUND/);
    expect(result.trustedOrigin).toBe(true);
  });
});
