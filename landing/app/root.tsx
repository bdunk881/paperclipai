import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import "./globals.css";
import "./tokens.css";
import "./v2.css";

export function meta() {
  return [
    {
      title: "AutoFlow — Hire your first team of agents",
    },
    {
      name: "description",
      content:
        "Write a mission. AutoFlow drafts a hiring plan, an org, a budget, and the first week of work. Approve what matters. Watch the rest run.",
    },
  ];
}

export function Layout({ children }: { children: React.ReactNode }) {
  const plausibleDomain =
    process.env.PLAUSIBLE_DOMAIN ?? process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "";

  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
        <Meta />
        <Links />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        {plausibleDomain ? (
          <script
            defer
            data-domain={plausibleDomain}
            src="https://plausible.io/js/script.js"
          />
        ) : null}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  let code = "500";
  let title = "Something interrupted the request.";
  let description = "The AutoFlow landing surface hit an unexpected error while rendering this route.";

  if (isRouteErrorResponse(error)) {
    code = String(error.status);
    if (error.status === 404) {
      title = "This route is offline.";
      description = "The page you requested does not exist in the current AutoFlow surface.";
    } else if (error.statusText) {
      description = error.statusText;
    }
  } else if (error instanceof Error && error.message) {
    description = error.message;
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--af2-paper)",
        color: "var(--af2-ink)",
        padding: "96px 24px",
        fontFamily: "var(--af2-sans)",
      }}
    >
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: 40,
          background: "var(--af2-card)",
          border: "1px solid var(--af2-line)",
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <span className="af2-eyebrow">Error {code}</span>
        <h1 style={{ font: "400 36px/1.05 var(--af2-serif)", letterSpacing: "-0.02em", margin: 0 }}>
          {title}
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: "var(--af2-ink-2)", margin: 0 }}>
          {description}
        </p>
        <div>
          <a href="/" className="af2-btn af2-btn-clay">
            Return home
          </a>
        </div>
      </div>
    </main>
  );
}
