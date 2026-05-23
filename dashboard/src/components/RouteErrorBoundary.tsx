import { useEffect, useState } from "react";
import { Link, isRouteErrorResponse, useNavigate, useRouteError } from "react-router-dom";
import { AlertCircle, Clock, Home, RefreshCw } from "lucide-react";
import { getRateLimitCooldownSeconds } from "../api/trackedFetch";

type ClassifiedError =
  | { kind: "rate_limit"; message: string }
  | { kind: "unauthorized"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "server"; status: number; message: string }
  | { kind: "unknown"; message: string };

function classifyError(error: unknown): ClassifiedError {
  if (isRouteErrorResponse(error)) {
    const message =
      typeof error.data === "string" && error.data.trim()
        ? error.data
        : error.statusText || `HTTP ${error.status}`;
    if (error.status === 429) return { kind: "rate_limit", message };
    if (error.status === 401 || error.status === 403) {
      return { kind: "unauthorized", message };
    }
    if (error.status === 404) return { kind: "not_found", message };
    if (error.status >= 500) return { kind: "server", status: error.status, message };
    return { kind: "unknown", message };
  }

  if (error instanceof Error) {
    const message = error.message || "Unexpected error";
    if (/rate.?limit|too many requests|\b429\b/i.test(message)) {
      return { kind: "rate_limit", message };
    }
    if (/\b401\b|unauthori[sz]ed/i.test(message)) {
      return { kind: "unauthorized", message };
    }
    if (/\b404\b|not found/i.test(message)) {
      return { kind: "not_found", message };
    }
    return { kind: "unknown", message };
  }

  return { kind: "unknown", message: "Unexpected error" };
}

function RateLimitView({ message }: { message: string }) {
  const [seconds, setSeconds] = useState(() => getRateLimitCooldownSeconds());
  const navigate = useNavigate();

  useEffect(() => {
    if (seconds <= 0) return;
    const id = window.setInterval(() => {
      setSeconds(getRateLimitCooldownSeconds());
    }, 1000);
    return () => window.clearInterval(id);
  }, [seconds]);

  const ready = seconds <= 0;

  return (
    <ErrorShell
      icon={<Clock size={20} className="text-af2-clay" aria-hidden="true" />}
      title="You're going a little too fast"
      subtitle={
        ready
          ? "The cooldown has cleared. Try again now."
          : `We paused requests for a moment to keep things stable. Try again in ${seconds}s.`
      }
      detail={message}
    >
      <button
        type="button"
        onClick={() => navigate(0)}
        disabled={!ready}
        className="inline-flex items-center gap-1.5 rounded-md border border-af2-clay bg-af2-clay px-3 py-1.5 text-xs font-medium text-white transition hover:bg-af2-clay-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw size={14} aria-hidden="true" />
        {ready ? "Try again" : `Try again in ${seconds}s`}
      </button>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 rounded-md border border-af2-line bg-af2-card px-3 py-1.5 text-xs font-medium text-af2-ink-2 transition hover:bg-af2-paper-2 hover:text-af2-ink"
      >
        <Home size={14} aria-hidden="true" />
        Go home
      </Link>
    </ErrorShell>
  );
}

function GenericErrorView({
  title,
  subtitle,
  detail,
}: {
  title: string;
  subtitle: string;
  detail: string;
}) {
  const navigate = useNavigate();
  return (
    <ErrorShell
      icon={<AlertCircle size={20} className="text-af2-clay" aria-hidden="true" />}
      title={title}
      subtitle={subtitle}
      detail={detail}
    >
      <button
        type="button"
        onClick={() => navigate(0)}
        className="inline-flex items-center gap-1.5 rounded-md border border-af2-clay bg-af2-clay px-3 py-1.5 text-xs font-medium text-white transition hover:bg-af2-clay-2"
      >
        <RefreshCw size={14} aria-hidden="true" />
        Reload
      </button>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 rounded-md border border-af2-line bg-af2-card px-3 py-1.5 text-xs font-medium text-af2-ink-2 transition hover:bg-af2-paper-2 hover:text-af2-ink"
      >
        <Home size={14} aria-hidden="true" />
        Go home
      </Link>
    </ErrorShell>
  );
}

function ErrorShell({
  icon,
  title,
  subtitle,
  detail,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-af2-paper px-6 py-12 text-af2-ink">
      <div className="w-full max-w-md rounded-md border border-af2-line bg-af2-card p-6 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          {icon}
          <h1 className="font-af2-serif text-lg font-medium text-af2-ink">{title}</h1>
        </div>
        <p className="text-sm text-af2-ink-2">{subtitle}</p>
        {detail && detail !== subtitle && (
          <p className="mt-3 rounded border border-af2-line bg-af2-paper p-2 font-mono text-[11px] leading-snug text-af2-ink-3">
            {detail}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">{children}</div>
      </div>
    </div>
  );
}

export default function RouteErrorBoundary() {
  const error = useRouteError();
  const classified = classifyError(error);

  switch (classified.kind) {
    case "rate_limit":
      return <RateLimitView message={classified.message} />;
    case "unauthorized":
      return (
        <GenericErrorView
          title="Sign in to continue"
          subtitle="Your session may have expired. Sign in again to keep going."
          detail={classified.message}
        />
      );
    case "not_found":
      return (
        <GenericErrorView
          title="We couldn't find that"
          subtitle="The page or resource you're looking for isn't here."
          detail={classified.message}
        />
      );
    case "server":
      return (
        <GenericErrorView
          title="The server hit a snag"
          subtitle="Something went wrong on our end. Try again in a moment."
          detail={classified.message}
        />
      );
    default:
      return (
        <GenericErrorView
          title="Something went wrong"
          subtitle="The page failed to load. Try reloading or head back to the dashboard."
          detail={classified.message}
        />
      );
  }
}
