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
    <div className="min-h-full bg-gray-50 p-8">
      <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold text-gray-900">
          {status === "success" ? "Connection complete" : "Connection failed"}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {status === "success"
            ? `Finishing ${provider || "provider"} verification. You can close this window.`
            : message || "OAuth callback failed. Return to the deploy screen and retry."}
        </p>
      </div>
    </div>
  );
}
