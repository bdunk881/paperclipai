import jwt, { JwtPayload } from "jsonwebtoken";
import { signAppUserToken } from "./appAuthTokens";

describe("signAppUserToken", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      APP_JWT_SECRET: "test-app-jwt-secret-with-sufficient-length",
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("includes a numeric exp claim on locally issued app tokens", () => {
    const token = signAppUserToken({
      id: "local-user-123",
      email: "local@example.com",
      displayName: "Local User",
      provider: "google",
    });

    const decoded = jwt.decode(token) as JwtPayload | null;

    expect(decoded).not.toBeNull();
    expect(typeof decoded?.exp).toBe("number");
    expect(typeof decoded?.iat).toBe("number");
    expect((decoded?.exp ?? 0)).toBeGreaterThan(decoded?.iat ?? 0);
  });
});
