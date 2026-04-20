import { ConnectorError } from "./types";
import { ShopifyTokenSet } from "./types";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new ConnectorError("auth", `${name} is not configured`, 503);
  }
  return value;
}

function parseScope(scope?: string): string[] {
  if (!scope) return [];
  return scope
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeShopDomain(shopDomain: string): string {
  return shopDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

function validateShopDomain(shopDomain: string): string {
  const normalized = normalizeShopDomain(shopDomain);
  if (!normalized.endsWith(".myshopify.com") || normalized.split(".").length < 3) {
    throw new ConnectorError("schema", "shopDomain must be a valid *.myshopify.com domain", 400);
  }
  return normalized;
}

export function buildShopifyOAuthUrl(params: {
  state: string;
  codeChallenge: string;
  shopDomain: string;
}): string {
  const clientId = requiredEnv("SHOPIFY_CLIENT_ID");
  const redirectUri = requiredEnv("SHOPIFY_REDIRECT_URI");
  const scopes = process.env.SHOPIFY_SCOPES
    ?? "read_products,write_products,read_orders,write_orders,read_customers,write_customers,read_inventory,write_inventory";
  const shop = validateShopDomain(params.shopDomain);

  const query = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    state: params.state,
    redirect_uri: redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  });

  return `https://${shop}/admin/oauth/authorize?${query.toString()}`;
}

export async function exchangeCodeForTokens(params: {
  code: string;
  codeVerifier: string;
  shopDomain: string;
}): Promise<ShopifyTokenSet> {
  const clientId = requiredEnv("SHOPIFY_CLIENT_ID");
  const clientSecret = requiredEnv("SHOPIFY_CLIENT_SECRET");
  const shop = validateShopDomain(params.shopDomain);

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
      code_verifier: params.codeVerifier,
    }),
  });

  const body = await response.json() as any;
  if (!response.ok || !body.access_token) {
    throw new ConnectorError(
      "auth",
      `Shopify OAuth exchange failed: ${body.error_description ?? body.error ?? response.statusText}`,
      401
    );
  }

  return {
    accessToken: body.access_token,
    scope: body.scope,
    shopDomain: shop,
  };
}

export function parseScopes(scope?: string): string[] {
  return parseScope(scope);
}

export function normalizeAndValidateShopDomain(shopDomain: string): string {
  return validateShopDomain(shopDomain);
}
