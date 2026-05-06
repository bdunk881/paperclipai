import express from "express";
import request from "supertest";
import { getUserProfile, upsertUserProfile } from "./profileStore";
import profileRoutes from "./profileRoutes";

jest.mock("./profileStore", () => ({
  getUserProfile: jest.fn(),
  upsertUserProfile: jest.fn(),
}));

const mockedGetUserProfile = jest.mocked(getUserProfile);
const mockedUpsertUserProfile = jest.mocked(upsertUserProfile);
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
};

function createApp(
  auth: { sub: string; name?: string; email?: string } = {
    sub: "user-123",
    name: "Fallback Name",
    email: "user@example.com",
  }
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { auth?: { sub: string; name?: string; email?: string } }).auth = auth;
    next();
  });
  app.use("/api/user", profileRoutes);
  return app;
}

describe("user profile routes", () => {
  beforeEach(() => {
    mockedGetUserProfile.mockReset();
    mockedUpsertUserProfile.mockReset();
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
    process.env.SUPABASE_ANON_KEY = originalEnv.SUPABASE_ANON_KEY;
    global.fetch = jest.fn();
  });

  afterAll(() => {
    process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
    process.env.SUPABASE_ANON_KEY = originalEnv.SUPABASE_ANON_KEY;
  });

  it("returns stored profile values when present", async () => {
    mockedGetUserProfile.mockResolvedValueOnce({
      userId: "user-123",
      displayName: "Alice Example",
      timezone: "America/New_York",
    });

    const res = await request(createApp()).get("/api/user/profile");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profile: {
        displayName: "Alice Example",
        timezone: "America/New_York",
      },
    });
    expect(mockedGetUserProfile).toHaveBeenCalledWith("user-123");
  });

  it("falls back to auth claims when no stored profile exists", async () => {
    mockedGetUserProfile.mockResolvedValueOnce(null);

    const res = await request(createApp()).get("/api/user/profile");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profile: {
        displayName: "Fallback Name",
        timezone: "UTC",
      },
    });
  });

  it("upserts profile updates", async () => {
    mockedUpsertUserProfile.mockResolvedValueOnce({
      userId: "user-123",
      displayName: "Updated Name",
      timezone: "Europe/London",
    });

    const res = await request(createApp())
      .patch("/api/user/profile")
      .send({
        displayName: "Updated Name",
        timezone: "Europe/London",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      profile: {
        displayName: "Updated Name",
        timezone: "Europe/London",
      },
    });
    expect(mockedUpsertUserProfile).toHaveBeenCalledWith({
      userId: "user-123",
      displayName: "Updated Name",
      timezone: "Europe/London",
    });
  });

  it("rejects invalid update payloads", async () => {
    const res = await request(createApp())
      .patch("/api/user/profile")
      .send({
        displayName: "Name",
        timezone: "",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 1 character|required/i);
    expect(mockedUpsertUserProfile).not.toHaveBeenCalled();
  });

  it("updates the authenticated user's password through Supabase Auth", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    const mockedFetch = jest.mocked(global.fetch);
    mockedFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "reauth-token" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: "user-123" } }),
      } as Response);

    const res = await request(createApp())
      .patch("/api/user/password")
      .set("Authorization", "Bearer access-token")
      .send({
        currentPassword: "old-password",
        newPassword: "new-password-123",
        confirmPassword: "new-password-123",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockedFetch).toHaveBeenNthCalledWith(
      1,
      "https://example.supabase.co/auth/v1/token?grant_type=password",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "anon-key",
          "Content-Type": "application/json",
        }),
      })
    );
    expect(mockedFetch).toHaveBeenNthCalledWith(
      2,
      "https://example.supabase.co/auth/v1/user",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          apikey: "anon-key",
          Authorization: "Bearer access-token",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("rejects password updates when current password verification fails", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    const mockedFetch = jest.mocked(global.fetch);
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: "Invalid login credentials" }),
    } as Response);

    const res = await request(createApp())
      .patch("/api/user/password")
      .set("Authorization", "Bearer access-token")
      .send({
        currentPassword: "wrong-password",
        newPassword: "new-password-123",
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Current password is incorrect." });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when Supabase password update config is missing", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;

    const res = await request(createApp())
      .patch("/api/user/password")
      .set("Authorization", "Bearer access-token")
      .send({
        currentPassword: "old-password",
        newPassword: "new-password-123",
      });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
