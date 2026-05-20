/**
 * Tests for `asyncHandler` (HEL-183).
 *
 * Covers the contract the wrapper provides over a bare async handler:
 *   - resolved promise: handler runs normally, `next` not called
 *   - rejected promise: forwards to `next(err)`, no unhandled rejection
 *   - synchronous throw inside async fn: also forwards to `next(err)`
 *   - generic Req type narrows correctly without runtime cast
 */

import express from "express";
import request from "supertest";
import type { Request, Response, NextFunction } from "express";
import { asyncHandler } from "./asyncHandler";

function makeMocks(): {
  req: Request;
  res: Response;
  next: jest.Mock;
} {
  return {
    req: {} as Request,
    res: {} as Response,
    next: jest.fn(),
  };
}

describe("asyncHandler", () => {
  it("invokes the handler with (req, res, next)", async () => {
    const { req, res, next } = makeMocks();
    const fn = jest.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(fn);

    await wrapped(req, res, next);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(req, res, next);
  });

  it("does NOT call next() when the handler resolves normally", async () => {
    const { req, res, next } = makeMocks();
    const wrapped = asyncHandler(async () => {
      // Successful no-op handler — nothing throws.
    });

    await wrapped(req, res, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("forwards a rejected promise to next(err)", async () => {
    const { req, res, next } = makeMocks();
    const boom = new Error("downstream failure");
    const wrapped = asyncHandler(async () => {
      throw boom;
    });

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(boom);
  });

  it("forwards a synchronous throw inside an async handler to next(err)", async () => {
    // Even though the handler is `async`, a synchronous throw inside it
    // results in a rejected Promise — Promise.resolve(fn(...)).catch
    // still routes it through next(err) correctly.
    const { req, res, next } = makeMocks();
    const boom = new Error("sync throw");
    const wrapped = asyncHandler(async () => {
      throw boom;
    });

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });

  it("forwards non-Error rejections (e.g. plain string) to next as-is", async () => {
    // Some libraries reject with strings. Express's default error handler
    // tolerates this, and our error middleware (`src/app.ts:1843`) checks
    // `err instanceof Error`. The wrapper itself must NOT swallow the
    // non-Error value.
    const { req, res, next } = makeMocks();
    const wrapped = asyncHandler(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "bad string";
    });

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledWith("bad string");
  });

  it("narrows the request type at the call site without runtime cast", () => {
    interface CustomReq extends Request {
      workspace?: { id: string };
    }

    // The handler body sees `req.workspace.id` typed correctly without
    // an in-body cast. Compile-time check; no runtime assertion.
    const handler = asyncHandler<CustomReq>(async (req, res) => {
      const id = req.workspace?.id ?? "fallback";
      void id;
      void res;
    });

    expect(typeof handler).toBe("function");
  });

  // ---------------------------------------------------------------------
  // Integration: real Express app, real HTTP request, error middleware
  // ---------------------------------------------------------------------
  // The unit cases above mock `req/res/next`. These cases prove the
  // primitive actually wires async rejections through Express's error
  // pipeline end-to-end — which is the whole point of the wrapper.

  describe("integration with a real Express app", () => {
    function makeApp(): {
      app: express.Express;
      errorSpy: jest.Mock;
    } {
      const app = express();
      const errorSpy = jest.fn();

      app.get(
        "/resolves",
        asyncHandler(async (_req, res) => {
          res.status(200).json({ ok: true });
        }),
      );

      app.get(
        "/rejects",
        asyncHandler(async () => {
          throw new Error("downstream failure");
        }),
      );

      app.get(
        "/rejects-with-status",
        asyncHandler(async () => {
          const err = new Error("custom typed error") as Error & {
            statusCode?: number;
          };
          err.statusCode = 418;
          throw err;
        }),
      );

      // Final error handler — proves the rejection reached the
      // standard error-middleware position.
      app.use((err: Error & { statusCode?: number }, _req: Request, res: Response, next: NextFunction) => {
        errorSpy(err);
        if (res.headersSent) {
          next(err);
          return;
        }
        res.status(err.statusCode ?? 500).json({ error: err.message });
      });

      return { app, errorSpy };
    }

    it("routes a successful async handler to a 200 response", async () => {
      const { app, errorSpy } = makeApp();
      const response = await request(app).get("/resolves");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("forwards a rejected promise into the error middleware (no unhandled rejection)", async () => {
      const { app, errorSpy } = makeApp();
      const response = await request(app).get("/rejects");
      // The error middleware caught + serialized the error.
      expect(response.status).toBe(500);
      expect(response.body.error).toBe("downstream failure");
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]![0]).toBeInstanceOf(Error);
    });

    it("preserves error metadata (e.g. statusCode) through the pipeline", async () => {
      const { app } = makeApp();
      const response = await request(app).get("/rejects-with-status");
      // The error's `statusCode` field is honored by the test's error
      // middleware — proving the original Error reference survived the
      // round-trip through `next(err)`.
      expect(response.status).toBe(418);
      expect(response.body.error).toBe("custom typed error");
    });
  });

  it("a Promise.resolve handler that resolves never calls next", async () => {
    // Sanity: `Promise.resolve(undefined).catch(next)` only invokes
    // `.catch` if the Promise rejects. This locks that contract in via
    // an explicit assertion separate from the no-op-handler test above.
    const { req, res, next } = makeMocks();
    const wrapped = asyncHandler(async () => Promise.resolve("done"));

    await wrapped(req, res, next);
    // Microtask flush — make sure no late-fired next() lands.
    await new Promise((r) => setImmediate(r));

    expect(next).not.toHaveBeenCalled();
  });
});
