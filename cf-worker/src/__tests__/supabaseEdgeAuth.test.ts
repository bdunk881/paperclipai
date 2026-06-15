/**
 * HEL-801 (B4) — edge Supabase JWT config derivation + verification. The verify
 * tests use a real ES256 keypair + a local JWKS (injected), so they exercise the
 * actual jose verification path with no network. The derivation must stay
 * identical to the API's src/auth/supabaseAuth.ts.
 */
import { describe, it, expect } from "vitest";
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from "jose";
import { deriveSupabaseJwtConfig, verifySupabaseAccessToken } from "../supabaseEdgeAuth";

const PROJECT = "https://abc.supabase.co";

describe("deriveSupabaseJwtConfig", () => {
  it("derives issuer/jwksUri/default audience from the project URL", () => {
    expect(deriveSupabaseJwtConfig(PROJECT)).toEqual({
      issuer: "https://abc.supabase.co/auth/v1",
      audiences: ["authenticated"],
      jwksUri: "https://abc.supabase.co/auth/v1/.well-known/jwks.json",
    });
  });

  it("strips a trailing slash before deriving", () => {
    expect(deriveSupabaseJwtConfig("https://abc.supabase.co/")?.issuer).toBe(
      "https://abc.supabase.co/auth/v1",
    );
  });

  it("honours a custom audience CSV", () => {
    expect(deriveSupabaseJwtConfig(PROJECT, "authenticated, service_role")?.audiences).toEqual([
      "authenticated",
      "service_role",
    ]);
  });

  it("returns null for missing / non-https / malformed URLs", () => {
    expect(deriveSupabaseJwtConfig(undefined)).toBeNull();
    expect(deriveSupabaseJwtConfig("")).toBeNull();
    expect(deriveSupabaseJwtConfig("http://abc.supabase.co")).toBeNull();
    expect(deriveSupabaseJwtConfig("not a url")).toBeNull();
  });
});

describe("verifySupabaseAccessToken", () => {
  const config = deriveSupabaseJwtConfig(PROJECT)!;

  async function newKeyset(): Promise<{ privateKey: CryptoKey; jwks: JWTVerifyGetKey }> {
    const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    jwk.alg = "ES256";
    return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
  }

  function base() {
    return new SignJWT({}).setProtectedHeader({ alg: "ES256" }).setIssuedAt();
  }

  it("accepts a valid token and returns the sub", async () => {
    const { privateKey, jwks } = await newKeyset();
    const token = await base()
      .setIssuer(config.issuer)
      .setAudience("authenticated")
      .setSubject("user-123")
      .setExpirationTime("5m")
      .sign(privateKey);
    expect(await verifySupabaseAccessToken(token, config, jwks)).toEqual({ userId: "user-123" });
  });

  it("rejects a wrong issuer", async () => {
    const { privateKey, jwks } = await newKeyset();
    const token = await base()
      .setIssuer("https://evil.supabase.co/auth/v1")
      .setAudience("authenticated")
      .setSubject("user-123")
      .setExpirationTime("5m")
      .sign(privateKey);
    expect(await verifySupabaseAccessToken(token, config, jwks)).toBeNull();
  });

  it("rejects a wrong audience", async () => {
    const { privateKey, jwks } = await newKeyset();
    const token = await base()
      .setIssuer(config.issuer)
      .setAudience("anon")
      .setSubject("user-123")
      .setExpirationTime("5m")
      .sign(privateKey);
    expect(await verifySupabaseAccessToken(token, config, jwks)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwks } = await newKeyset();
    const token = await base()
      .setIssuer(config.issuer)
      .setAudience("authenticated")
      .setSubject("user-123")
      .setExpirationTime("-1m")
      .sign(privateKey);
    expect(await verifySupabaseAccessToken(token, config, jwks)).toBeNull();
  });

  it("rejects a token signed by a different key", async () => {
    const a = await newKeyset();
    const b = await newKeyset();
    const token = await base()
      .setIssuer(config.issuer)
      .setAudience("authenticated")
      .setSubject("user-123")
      .setExpirationTime("5m")
      .sign(a.privateKey);
    // Verify against B's JWKS — signature won't match.
    expect(await verifySupabaseAccessToken(token, config, b.jwks)).toBeNull();
  });

  it("rejects a token with no sub", async () => {
    const { privateKey, jwks } = await newKeyset();
    const token = await base()
      .setIssuer(config.issuer)
      .setAudience("authenticated")
      .setExpirationTime("5m")
      .sign(privateKey);
    expect(await verifySupabaseAccessToken(token, config, jwks)).toBeNull();
  });

  it("rejects a garbage string without touching the network", async () => {
    const { jwks } = await newKeyset();
    expect(await verifySupabaseAccessToken("not-a-jwt", config, jwks)).toBeNull();
  });
});
