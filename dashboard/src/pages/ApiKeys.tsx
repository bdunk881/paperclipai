import { useState } from "react";
import { Plus, Copy, Trash2, X, Check } from "lucide-react";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed: string | null;
}

const INITIAL_KEYS: ApiKey[] = [
  {
    id: "1",
    name: "Production",
    prefix: "sk-...a4f2",
    createdAt: "2026-03-01",
    lastUsed: "2026-03-31",
  },
  {
    id: "2",
    name: "Development",
    prefix: "sk-...b9c1",
    createdAt: "2026-03-15",
    lastUsed: null,
  },
];

function generateKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "sk-";
  for (let i = 0; i < 48; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function keyPrefix(key: string): string {
  return key.slice(0, 6) + "..." + key.slice(-4);
}

interface GenerateModalProps {
  onClose: () => void;
  onGenerated: (key: ApiKey, fullKey: string) => void;
}

function GenerateModal({ onClose, onGenerated }: GenerateModalProps) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError("Name is required.");
      return;
    }
    setNameError("");
    const fullKey = generateKey();
    const newKey: ApiKey = {
      id: String(Date.now()),
      name: name.trim(),
      prefix: keyPrefix(fullKey),
      createdAt: new Date().toISOString().slice(0, 10),
      lastUsed: null,
    };
    setGeneratedKey(fullKey);
    onGenerated(newKey, fullKey);
  }

  function handleCopy() {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Generate API Key</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5">
          {!generatedKey ? (
            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Key Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Production, CI/CD"
                  autoFocus
                  className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary ${
                    nameError ? "border-red-300 bg-red-50" : "border-gray-300"
                  }`}
                />
                {nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-lg bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover transition-colors"
                >
                  Generate
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-sm font-medium text-amber-800 mb-1">Copy your key now</p>
                <p className="text-xs text-amber-700">
                  This key will only be shown once. Store it somewhere safe.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">
                  Your API Key
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs font-mono text-gray-800 break-all">
                    {generatedKey}
                  </code>
                  <button
                    onClick={handleCopy}
                    title="Copy to clipboard"
                    className="flex-shrink-0 p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
                  </button>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-full px-4 py-2 rounded-lg bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>(INITIAL_KEYS);
  const [showModal, setShowModal] = useState(false);

  function handleGenerated(newKey: ApiKey) {
    setKeys((prev) => [newKey, ...prev]);
  }

  function handleRevoke(id: string) {
    setKeys((prev) => prev.filter((k) => k.id !== id));
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
          <p className="text-gray-500 mt-1">Manage keys for programmatic access to Alterflow.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover transition-colors"
        >
          <Plus size={15} />
          Generate new key
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {keys.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-gray-500">No API keys yet</p>
            <p className="text-xs text-gray-400 mt-1">
              Generate a key to access the Alterflow API programmatically.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Key</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Created</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Last used</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {keys.map((key) => (
                <tr key={key.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-gray-900">{key.name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-500">{key.prefix}</td>
                  <td className="px-5 py-3 text-gray-500">{key.createdAt}</td>
                  <td className="px-5 py-3 text-gray-400">{key.lastUsed ?? "Never"}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => handleRevoke(key.id)}
                      title="Revoke key"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <GenerateModal
          onClose={() => setShowModal(false)}
          onGenerated={(newKey) => {
            handleGenerated(newKey);
          }}
        />
      )}
    </div>
  );
}
