import { KeyRound, ShieldAlert } from "lucide-react";

export default function ApiKeys() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
        <p className="text-gray-500 mt-1">Generate and manage API keys for programmatic access.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
          <ShieldAlert size={12} />
          Coming soon
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <KeyRound size={18} className="text-amber-700 mt-0.5" />
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
            className="px-4 py-2 rounded-lg bg-gray-100 text-gray-500 border border-gray-200 cursor-not-allowed text-sm font-medium"
          >
            Generate key (coming soon)
          </button>
          <p className="text-xs text-gray-500">
            This page intentionally does not simulate keys to avoid false-success UX.
          </p>
        </div>
      </div>
    </div>
  );
}
