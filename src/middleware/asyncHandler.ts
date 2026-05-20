/**
 * `asyncHandler(fn)` — Express 4 async-rejection safety wrapper (HEL-183).
 *
 * ## Why this exists
 *
 * The repo is on Express 4 (`"express": "^4.18.2"`). In Express 4, when an
 * async route handler throws or returns a rejected Promise, the rejection
 * is NOT automatically routed through the error middleware — it becomes
 * an unhandled promise rejection. The visible symptoms:
 *
 *   * The structured connector-error response is skipped (caller hangs
 *     until the HTTP timeout fires)
 *   * Sentry's `setupExpressErrorHandler` only fires for errors that
 *     reach `next(err)` — so an unhandled rejection escapes capture
 *   * Bug reproduces ONLY when the awaited code rejects (transient DB
 *     outage, Redis failure, etc.) — usually undetected in unit tests
 *
 * The Codex review on PR #926 caught 5 distinct cases of this pattern
 * across 3 review rounds. `asyncHandler` fixes the entire class at the
 * boundary so future async handlers can't reintroduce it.
 *
 * ## Why not `express-async-errors`?
 *
 * That package monkey-patches Express globally. This wrapper is explicit
 * at every call site — easier to audit, easier to type, and the
 * "this handler is async" intent stays visible in the route table.
 *
 * ## Usage
 *
 * ```ts
 * router.get(
 *   "/connections",
 *   requireAuth,
 *   asyncHandler(async (req, res) => {
 *     // throws inside this block route to `next(err)` automatically.
 *     const data = await someAsyncCall();
 *     res.json(data);
 *   }),
 * );
 * ```
 *
 * After Express 4 → Express 5 migration this primitive becomes a no-op
 * (Express 5 catches async rejections natively). Keep the wrapper anyway
 * so the call-site shape stays stable.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async Express route/middleware handler so that any thrown
 * error or rejected promise is forwarded to `next(err)` instead of
 * becoming an unhandled rejection.
 *
 * The generic `Req` lets call sites narrow the request type
 * (e.g. `AuthenticatedRequest`, `WorkspaceAwareRequest`) without forcing
 * a cast inside the handler body.
 */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    // Force the return value through `Promise.resolve` so a synchronous
    // throw from a function declared `async` (Babel/TS edge case) still
    // routes through `.catch`.
    Promise.resolve(fn(req as Req, res, next)).catch(next);
  };
}
