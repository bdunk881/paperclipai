/**
 * Cloudflare Worker entry point.
 *
 * Routes requests to the appropriate Durable Object. Wraps every
 * request in a structured-JSON access log so downstream observability
 * (Cloudflare tail / Logflare) can index by event + duration.
 *
 * Adding a new DO route: extend the `route()` switch and register the
 * binding in `wrangler.toml`.
 */
import { HealthCheckDO } from "./durable-objects/HealthCheck";
import {
  RateLimiterDO,
  type RateLimiterConsumeRequest,
  type RateLimiterRefundRequest,
} from "./durable-objects/RateLimiter";
import { WorkflowDocDO } from "./durable-objects/WorkflowDoc";
import { callInternalApi } from "./internalApi";

export { HealthCheckDO, RateLimiterDO, WorkflowDocDO };

export interface WorkerEnv {
  HEALTH_CHECK: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace<RateLimiterDO>;
  WORKFLOW_DOC: DurableObjectNamespace<WorkflowDocDO>;
  ENVIRONMENT: string;
  API_BASE_URL: string;
  CF_WORKER_INTERNAL_JWT_AUDIENCE: string;
  /** Shared secret for minting JWTs back to the API. Set via `wrangler secret put`. */
  CF_WORKER_SHARED_SECRET?: string;
}

/** `/workflows/<uuid>/ydoc` — the collaborative-doc WebSocket route. */
const WORKFLOW_DOC_PATH =
  /^\/workflows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/ydoc$/i;

interface RateLimiterHttpRequest {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseRateLimiterBody(body: unknown): RateLimiterHttpRequest | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const candidate = body as Partial<RateLimiterHttpRequest>;
  if (
    typeof candidate.scope !== "string" ||
    !candidate.scope.trim() ||
    typeof candidate.key !== "string" ||
    !candidate.key.trim() ||
    !isPositiveInteger(candidate.limit) ||
    !isPositiveInteger(candidate.windowMs)
  ) {
    return null;
  }

  return {
    scope: candidate.scope.trim(),
    key: candidate.key.trim(),
    limit: candidate.limit,
    windowMs: candidate.windowMs,
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Constant-time string comparison so the bearer-token check doesn't leak the
 * secret via response timing. Workers has no crypto.timingSafeEqual for
 * strings, so XOR equal-length byte encodings.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * HEL-427: the rate-limit routes mutate shared Durable Object counters, so
 * they must be authenticated — otherwise any internet caller can exhaust a
 * key's limit (DoS) or refund-spam to bypass it. Require
 * `Authorization: Bearer <CF_WORKER_SHARED_SECRET>`. Fails CLOSED when the
 * secret isn't configured: an unguarded counter is worse than degraded
 * rate-limiting (the backend caller fails open, so traffic still flows).
 */
export function isWorkerRequestAuthorized(
  authHeader: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !authHeader) return false;
  return constantTimeEqual(authHeader, `Bearer ${secret}`);
}

function denyUnauthorized(env: WorkerEnv): Response {
  if (!env.CF_WORKER_SHARED_SECRET) {
    console.warn(
      JSON.stringify({
        evt: "cf_worker_auth_misconfigured",
        reason: "CF_WORKER_SHARED_SECRET is not set; denying rate-limit requests",
      }),
    );
  }
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

async function handleRateLimitConsume(request: Request, env: WorkerEnv): Promise<Response> {
  if (!isWorkerRequestAuthorized(request.headers.get("Authorization"), env.CF_WORKER_SHARED_SECRET)) {
    return denyUnauthorized(env);
  }
  const body = parseRateLimiterBody(await readJson(request));
  if (!body) {
    return Response.json({ error: "Invalid rate limit request" }, { status: 400 });
  }

  const instanceKey = `${body.scope}::${body.key}`;
  const id = env.RATE_LIMITER.idFromName(instanceKey);
  const stub = env.RATE_LIMITER.get(id);
  const payload: RateLimiterConsumeRequest = {
    key: instanceKey,
    limit: body.limit,
    windowMs: body.windowMs,
  };
  const result = await stub.consume(payload);
  return Response.json(result);
}

async function handleRateLimitRefund(request: Request, env: WorkerEnv): Promise<Response> {
  if (!isWorkerRequestAuthorized(request.headers.get("Authorization"), env.CF_WORKER_SHARED_SECRET)) {
    return denyUnauthorized(env);
  }
  const body = parseRateLimiterBody(await readJson(request));
  if (!body) {
    return Response.json({ error: "Invalid rate limit refund request" }, { status: 400 });
  }

  const instanceKey = `${body.scope}::${body.key}`;
  const id = env.RATE_LIMITER.idFromName(instanceKey);
  const stub = env.RATE_LIMITER.get(id);
  const payload: RateLimiterRefundRequest = {
    key: instanceKey,
    windowMs: body.windowMs,
  };
  const result = await stub.refund(payload);
  return Response.json(result);
}

/**
 * HEL-798: secret-gated self-test of the Worker → API internal JWT round-trip.
 * Mints a token via internalApi and calls the API's /api/internal/__health,
 * reporting whether requireCfWorker accepted it. Gated on the shared secret
 * (same as the rate-limit routes) so it can't be an unauthenticated
 * amplification vector. Used to verify the B1 round-trip on dev:
 *   curl -H "Authorization: Bearer $CF_WORKER_SHARED_SECRET" \
 *     https://autoflow-api-worker-dev.<sub>.workers.dev/__internal-selftest
 */
async function handleInternalSelftest(request: Request, env: WorkerEnv): Promise<Response> {
  if (
    !isWorkerRequestAuthorized(request.headers.get("Authorization"), env.CF_WORKER_SHARED_SECRET)
  ) {
    return denyUnauthorized(env);
  }
  try {
    const apiRes = await callInternalApi(env, "__health");
    const text = await apiRes.text();
    let apiResponse: unknown = text;
    try {
      apiResponse = JSON.parse(text);
    } catch {
      // leave as raw text
    }
    return Response.json(
      { ok: apiRes.ok, status: apiRes.status, apiResponse },
      { status: apiRes.ok ? 200 : 502 },
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * HEL-800 (B3): forward a collaborative-doc WebSocket upgrade to the per-workflow
 * WorkflowDocDO (`workflow::<id>`).
 *
 * ⚠ This route is NOT authenticated yet — edge auth (verify the Supabase token +
 * call /api/internal/ydoc/authorize) lands in B4 (HEL-801), and no client points
 * at it until B6 (HEL-803). Until B4, gate it to non-production so we never expose
 * an unauthenticated doc socket on the prod Worker. Dev has no real customer data
 * and is where the B3 two-client smoke runs.
 */
async function handleWorkflowDoc(
  request: Request,
  env: WorkerEnv,
  workflowId: string,
): Promise<Response> {
  if (env.ENVIRONMENT === "production") {
    return new Response("Not Found", { status: 404 });
  }
  if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  const id = env.WORKFLOW_DOC.idFromName(`workflow::${workflowId}`);
  const stub = env.WORKFLOW_DOC.get(id);
  return stub.fetch(request);
}

async function route(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/__health" && request.method === "GET") {
    const id = env.HEALTH_CHECK.idFromName("singleton");
    const stub = env.HEALTH_CHECK.get(id);
    return stub.fetch(request);
  }

  const ydocMatch = url.pathname.match(WORKFLOW_DOC_PATH);
  if (ydocMatch && request.method === "GET") {
    return handleWorkflowDoc(request, env, ydocMatch[1]);
  }

  if (url.pathname === "/rate-limit/consume" && request.method === "POST") {
    return handleRateLimitConsume(request, env);
  }

  if (url.pathname === "/rate-limit/refund" && request.method === "POST") {
    return handleRateLimitRefund(request, env);
  }

  if (url.pathname === "/__internal-selftest" && request.method === "GET") {
    return handleInternalSelftest(request, env);
  }

  return new Response("Not Found", { status: 404 });
}

export default {
  async fetch(request: Request, env: WorkerEnv, _ctx: ExecutionContext): Promise<Response> {
    const start = Date.now();
    const url = new URL(request.url);
    try {
      const res = await route(request, env);
      console.log(
        JSON.stringify({
          evt: "cf_worker_request",
          method: request.method,
          path: url.pathname,
          status: res.status,
          durationMs: Date.now() - start,
          environment: env.ENVIRONMENT,
        }),
      );
      return res;
    } catch (err) {
      console.error(
        JSON.stringify({
          evt: "cf_worker_error",
          method: request.method,
          path: url.pathname,
          durationMs: Date.now() - start,
          environment: env.ENVIRONMENT,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return new Response("Internal Error", { status: 500 });
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
