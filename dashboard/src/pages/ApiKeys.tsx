import { KeyRound, ShieldAlert } from "lucide-react";

export default function ApiKeys() {
  return (
    <div className="af2-page" style={{ maxWidth: 920 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Settings · API</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>API Keys</h1>
          <div className="af2-page-head-meta">
            Generate and manage API keys for programmatic access.
          </div>
        </div>
      </div>

      <div className="bg-af2-card rounded-xl border border-af2-line p-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-af2-mustard/15 text-amber-800 text-xs font-medium">
          <ShieldAlert size={12} />
          Coming soon
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-lg border border-af2-mustard/30 bg-af2-mustard/10 p-4">
          <KeyRound size={18} className="text-af2-mustard mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-900">API key lifecycle is not enabled yet</p>
            <p className="text-sm text-amber-800 mt-1">
              Key generation, rotation, and revocation are disabled until the backend endpoints are available.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <button
            type="button"
            disabled
            title="API key management is not available yet."
            className="px-4 py-2 rounded-lg bg-af2-paper-2 text-af2-ink-3 border border-af2-line cursor-not-allowed text-sm font-medium"
          >
            Generate key (coming soon)
          </button>
          <p className="text-xs text-af2-ink-3">
            This page intentionally does not simulate keys to avoid false-success UX.
          </p>
        </div>
      </div>
    </div>
  );
}
