/**
 * Edge/Workers-compatible server entry. The default React Router entry uses
 * Node's `renderToPipeableStream`, which doesn't exist in the Workers runtime
 * (`react-dom/server.edge` only exposes `renderToReadableStream`). This entry
 * is required once the app SSRs in workerd via the Cloudflare Vite plugin.
 */
import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log only after the shell has rendered (avoids double-logging the
        // streaming error that already surfaces to the client).
        if (shellRendered) {
          console.error(error);
        }
      },
    },
  );
  shellRendered = true;

  // Bots (and SPA-mode renders) should receive fully-buffered HTML.
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    status: responseStatusCode,
    headers: responseHeaders,
  });
}
