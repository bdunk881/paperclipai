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

export { HealthCheckDO };

export interface WorkerEnv {
  HEALTH_CHECK: DurableObjectNamespace;
  ENVIRONMENT: string;
  API_BASE_URL: string;
  CF_WORKER_INTERNAL_JWT_AUDIENCE: string;
  /** Shared secret for minting JWTs back to the API. Set via `wrangler secret put`. */
  CF_WORKER_SHARED_SECRET?: string;
}

async function route(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/__health" && request.method === "GET") {
    const id = env.HEALTH_CHECK.idFromName("singleton");
    const stub = env.HEALTH_CHECK.get(id);
    return stub.fetch(request);
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
