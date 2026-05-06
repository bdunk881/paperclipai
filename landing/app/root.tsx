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

export function meta() {
  return [
    {
      title: "AutoFlow — Agent-Native Automation | Operating Layer for SMB Operators and Dev Teams",
    },
    {
      name: "description",
      content:
        "AutoFlow is the agent-native automation platform for lean SMB operators and dev teams. BYOLLM, MCP-standard, 22-skill marketplace. Built by Altitude Media.",
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
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap"
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
    <main className="min-h-screen bg-[#020617] px-6 py-24 text-slate-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 rounded-[28px] border border-slate-800 bg-slate-950/80 p-10 shadow-2xl shadow-slate-950/40">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-orange-400">
          Error {code}
        </p>
        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">{title}</h1>
        <p className="max-w-2xl text-base leading-7 text-slate-400">{description}</p>
        <div>
          <a
            href="/"
            className="inline-flex items-center rounded-2xl bg-teal-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-105"
          >
            Return home
          </a>
        </div>
      </div>
    </main>
  );
}
