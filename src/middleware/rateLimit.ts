import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import type { WorkspaceAwareRequest } from "./workspaceResolver";
import {
  rateLimit,
  refundRateLimit,
  type RateLimitDecision,
  type RateLimitOptions,
} from "../lib/cfWorker/rateLimiter";

type ValueOrFactory<T> = T | ((req: Request) => T);

export interface DurableObjectRateLimitMiddlewareOptions {
  scope: string;
  limit: ValueOrFactory<number>;
  windowMs: ValueOrFactory<number>;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
  skipFailedRequests?: boolean;
  onFailure?: RateLimitOptions["onFailure"];
}

function getAuthenticatedUserId(req: Request): string | null {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function getHeaderUserId(req: Request): string | null {
  const userId = req.headers["x-user-id"];
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function getBearerTokenSubject(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token || null;
}

function getWorkspaceId(req: Request): string | null {
  const workspaceReq = req as WorkspaceAwareRequest;
  return typeof workspaceReq.workspace?.id === "string" && workspaceReq.workspace.id.trim()
    ? workspaceReq.workspace.id.trim()
    : null;
}

export function getRateLimitKey(req: Request): string {
  const workspaceId = getWorkspaceId(req);
  if (workspaceId) {
    return `workspace:${workspaceId}`;
  }

  const userId =
    getAuthenticatedUserId(req) ?? getHeaderUserId(req) ?? getBearerTokenSubject(req);
  if (userId) {
    return `user:${userId}`;
  }
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

export function getIpRateLimitKey(req: Request): string {
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

function resolveValue<T>(req: Request, value: ValueOrFactory<T>): T {
  return typeof value === "function" ? (value as (req: Request) => T)(req) : value;
}

function retryAfterSeconds(retryAfterMs: number, windowMs: number): number {
  const retryMs = retryAfterMs > 0 ? retryAfterMs : windowMs;
  return Math.max(1, Math.ceil(retryMs / 1000));
}

function setRateLimitHeaders(
  res: Response,
  limit: number,
  windowMs: number,
  decision: RateLimitDecision,
): void {
  const windowSeconds = Math.ceil(windowMs / 1000);
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, decision.remaining)));
  res.setHeader("RateLimit-Reset", String(retryAfterSeconds(decision.retryAfterMs, windowMs)));
  res.setHeader("RateLimit-Policy", `${limit};w=${windowSeconds}`);
}

function attachFailureRefund(
  res: Response,
  options: RateLimitOptions,
  skipFailedRequests: boolean | undefined,
): void {
  if (!skipFailedRequests) {
    return;
  }

  res.once("finish", () => {
    if (res.statusCode >= 400) {
      void refundRateLimit(options).catch(() => undefined);
    }
  });
}

export function createRateLimitHandler(windowMs: number) {
  return (_req: Request, res: Response, decision?: RateLimitDecision) => {
    res.setHeader("Retry-After", String(retryAfterSeconds(decision?.retryAfterMs ?? 0, windowMs)));
    res.status(429).json({ error: "Too Many Requests" });
  };
}

export function createDurableObjectRateLimiter(
  options: DurableObjectRateLimitMiddlewareOptions,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (options.skip?.(req)) {
      next();
      return;
    }

    const limit = resolveValue(req, options.limit);
    const windowMs = resolveValue(req, options.windowMs);
    const key = (options.keyGenerator ?? getRateLimitKey)(req);
    const rateLimitOptions: RateLimitOptions = {
      scope: options.scope,
      key,
      limit,
      windowMs,
      onFailure: options.onFailure,
    };

    const decision = await rateLimit(rateLimitOptions);
    setRateLimitHeaders(res, limit, windowMs, decision);

    if (!decision.allowed) {
      createRateLimitHandler(windowMs)(req, res, decision);
      return;
    }

    if (decision.source === "durable-object") {
      attachFailureRefund(res, rateLimitOptions, options.skipFailedRequests);
    }

    next();
  };
}
