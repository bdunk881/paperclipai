import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

const OAUTH_CALLBACK_EVENT = "autoflow:agent-catalog-oauth-callback";

export default function AgentOAuthCallback() {
  const [searchParams] = useSearchParams();

  const provider = searchParams.get("provider") ?? "";
  const status = searchParams.get("status") ?? "error";
  const message = searchParams.get("message") ?? "";

  useEffect(() => {
    if (!window.opener) return;

    window.opener.postMessage(
      {
        type: OAUTH_CALLBACK_EVENT,
        provider,
        status,
        message,
      },
      window.location.origin
    );

    window.close();
  }, [message, provider, status]);

  return (
    <div className="min-h-full bg-af2-paper p-8 text-af2-ink">
      <div className="mx-auto max-w-md rounded-md border border-af2-line bg-af2-card p-6 text-center">
        <h1 className="font-af2-serif text-2xl font-medium tracking-[-0.015em] text-af2-ink">
          {status === "success" ? "Connection complete" : "Connection failed"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-af2-ink-2">
          {status === "success"
            ? `Finishing ${provider || "provider"} verification. You can close this window.`
            : message || "OAuth callback failed. Return to the deploy screen and retry."}
        </p>
      </div>
    </div>
  );
}
