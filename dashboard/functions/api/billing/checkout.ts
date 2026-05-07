type Env = {
  BILLING_API_BASE_URL?: string;
  BACKEND_API_BASE_URL?: string;
  VITE_API_BASE_URL?: string;
  VITE_API_URL?: string;
};

export const onRequestPost = async (context: {
  env: Env;
  request: Request;
}): Promise<Response> => {
  const backendBase = resolveBackendApiBase(context.env);
  const upstreamUrl = `${backendBase}/api/billing/checkout`;

  let body: unknown = {};
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": context.request.headers.get("CF-Connecting-IP") ?? "",
        "X-Forwarded-Host": new URL(context.request.url).host,
      },
      body: JSON.stringify(body),
    });

    const responseText = await upstreamRes.text();
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": upstreamRes.headers.get("Content-Type") ?? "application/json",
    });

    return new Response(responseText, {
      status: upstreamRes.status,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Checkout service unavailable";
    return json({ error: message }, 502);
  }
};

function normalizeBackendBase(value?: string): string {
  if (!value) return "";
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

function resolveBackendApiBase(env: Env): string {
  const candidates = [
    env.BILLING_API_BASE_URL,
    env.BACKEND_API_BASE_URL,
    env.VITE_API_BASE_URL,
    env.VITE_API_URL,
    "https://api.helloautoflow.com",
  ];

  for (const value of candidates) {
    const trimmed = normalizeBackendBase(value);
    if (trimmed) return trimmed;
  }

  return "https://api.helloautoflow.com";
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
