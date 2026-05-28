import { Router, type Request, type Response } from "express";
import * as Sentry from "@sentry/node";

// 404s in production so this stays a dev/staging-only event-injection
// surface — it deliberately fires a captureMessage and a captureException
// to confirm the running app's DSN routes to the expected Sentry project.
const sentryTestRoutes = Router();

sentryTestRoutes.get("/", async (_req: Request, res: Response) => {
  const environment =
    process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development";
  if (environment === "production") {
    res.status(404).end();
    return;
  }

  const marker = `sentry-routing-verification ${new Date().toISOString()}`;
  let messageEventId: string | undefined;
  let errorEventId: string | undefined;
  Sentry.withScope((scope) => {
    scope.setTag("debug_test", "true");
    scope.setTag("test_marker", marker);
    messageEventId = Sentry.captureMessage(marker, "info");
    errorEventId = Sentry.captureException(
      new Error(`sentry-test-error: ${marker}`),
    );
  });

  // Force a flush so the caller can correlate the response with the
  // events actually leaving the SDK, rather than waiting on the batch.
  await Sentry.flush(2_000);

  res.json({
    ok: true,
    environment,
    marker,
    messageEventId,
    errorEventId,
  });
});

export default sentryTestRoutes;
