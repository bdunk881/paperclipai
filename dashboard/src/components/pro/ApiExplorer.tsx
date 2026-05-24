/**
 * ApiExplorer — HEL-214 Pro reveal mounted on the Account / API keys
 * surface.
 *
 * Pro users pick a scope, click Generate, and get a fresh token plus
 * ready-to-paste `curl` and JS examples. Token issuance reuses the
 * existing `/api-keys` route family — generation is client-side mock for
 * the scaffold; the real wiring is the same shape so swapping in the
 * actual call is trivial.
 */
import { useMemo, useState } from "react";

const SCOPES = [
  { id: "read:missions", label: "read:missions" },
  { id: "write:missions", label: "write:missions" },
  { id: "read:memory", label: "read:memory" },
  { id: "admin:all", label: "admin:all (dangerous)" },
];

function randomToken(): string {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function ApiExplorer() {
  const [scope, setScope] = useState(SCOPES[0]!.id);
  const [token, setToken] = useState<string | null>(null);

  const curl = useMemo(() => {
    if (!token) return "";
    return `curl https://api.autoflow.dev/api/missions \\
  -H "Authorization: Bearer ${token}"`;
  }, [token]);

  const js = useMemo(() => {
    if (!token) return "";
    return `const res = await fetch("https://api.autoflow.dev/api/missions", {
  headers: { Authorization: "Bearer ${token}" },
});
const data = await res.json();`;
  }, [token]);

  function handleGenerate() {
    // TODO: HEL-214 wire to real /api/api-keys/generate with scope.
    setToken(`af_${scope.replace(/[^a-z0-9]/gi, "")}_${randomToken()}`);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>Scope</span>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="af2-input"
          style={{ padding: "6px 8px", fontSize: 13 }}
        >
          {SCOPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button
          type="button"
          onClick={handleGenerate}
          className="af2-btn af2-btn-sm af2-btn-primary"
        >
          {token ? "Regenerate" : "Generate"}
        </button>
      </div>
      {token ? (
        <>
          <div style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>Token</div>
          <code
            style={{
              fontSize: 12,
              padding: "6px 8px",
              border: "1px solid var(--af2-line)",
              borderRadius: 6,
              background: "var(--af2-paper)",
              wordBreak: "break-all",
            }}
          >
            {token}
          </code>
          <div style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>curl</div>
          <pre
            style={{
              fontSize: 12,
              padding: 10,
              background: "var(--af2-paper)",
              border: "1px solid var(--af2-line)",
              borderRadius: 6,
              overflow: "auto",
            }}
          >
            {curl}
          </pre>
          <div style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>JS</div>
          <pre
            style={{
              fontSize: 12,
              padding: 10,
              background: "var(--af2-paper)",
              border: "1px solid var(--af2-line)",
              borderRadius: 6,
              overflow: "auto",
            }}
          >
            {js}
          </pre>
        </>
      ) : null}
    </div>
  );
}

export default ApiExplorer;
