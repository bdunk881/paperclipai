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

function createApp(auth: { sub: string; name?: string } = { sub: "user-123", name: "Fallback Name" }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { auth?: { sub: string; name?: string } }).auth = auth;
    next();
  });
  app.use("/api/user", profileRoutes);
  return app;
}

describe("user profile routes", () => {
  beforeEach(() => {
    mockedGetUserProfile.mockReset();
    mockedUpsertUserProfile.mockReset();
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
});
