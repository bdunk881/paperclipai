/**
 * ToolCallSandbox — HEL-214 Pro reveal mounted on the Team / Agent drawer
 * surfaces (OrgStructure).
 *
 * Pro users can pick a tool from an agent's allowlist, paste a synthetic
 * input JSON, and fire it via
 * `POST /api/agents/:agentId/tools/:toolId/sandbox`. The scaffold returns
 * a sample response so the wiring renders end-to-end.
 */
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { proPost } from "./proApi";

interface ToolCallSandboxProps {
  agentId?: string | null;
  /** Tool ids the agent is allowed to call — usually from the agent record. */
  allowlist?: string[];
}

const DEFAULT_ALLOWLIST = [
  "gmail.send",
  "slack.post_message",
  "linear.create_issue",
  "calendar.create_event",
];

export function ToolCallSandbox({
  agentId,
  allowlist,
}: ToolCallSandboxProps) {
  const { getAccessToken } = useAuth();
  const tools = allowlist && allowlist.length > 0 ? allowlist : DEFAULT_ALLOWLIST;
  const [agent, setAgent] = useState(agentId ?? "");
  const [toolId, setToolId] = useState(tools[0]!);
  const [input, setInput] = useState(JSON.stringify({ subject: "Hello" }, null, 2));
  const [output, setOutput] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFire() {
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      if (!agent.trim()) throw new Error("Agent id is required.");
      let parsedInput: unknown;
      try {
        parsedInput = JSON.parse(input);
      } catch {
        throw new Error("Input must be valid JSON.");
      }
      const token = await getAccessToken();
      const data = await proPost<{ result: unknown }>(
        `/agents/${encodeURIComponent(agent.trim())}/tools/${encodeURIComponent(
          toolId,
        )}/sandbox`,
        { input: parsedInput },
        token,
      );
      setOutput(data?.result ?? data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tool sandbox failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>Agent id</span>
        <input
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          placeholder="ag_..."
          className="af2-input"
          style={{
            padding: "6px 8px",
            fontSize: 13,
            fontFamily: "var(--af2-font-mono, ui-monospace, monospace)",
          }}
        />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>Tool</span>
        <select
          value={toolId}
          onChange={(e) => setToolId(e.target.value)}
          className="af2-input"
          style={{ padding: "6px 8px", fontSize: 13 }}
        >
          {tools.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
          Input (JSON)
        </span>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={6}
          spellCheck={false}
          style={{
            fontFamily: "var(--af2-font-mono, ui-monospace, monospace)",
            fontSize: 12,
            padding: 8,
            border: "1px solid var(--af2-line)",
            borderRadius: 6,
            background: "var(--af2-paper)",
          }}
        />
      </label>
      <div>
        <button
          type="button"
          onClick={() => void handleFire()}
          disabled={busy}
          className="af2-btn af2-btn-sm af2-btn-primary"
        >
          {busy ? "Firing..." : "Fire"}
        </button>
      </div>
      {error ? (
        <div style={{ color: "var(--af2-clay-2)", fontSize: 12 }}>{error}</div>
      ) : null}
      {output ? (
        <pre
          style={{
            fontSize: 12,
            background: "var(--af2-paper)",
            border: "1px solid var(--af2-line)",
            borderRadius: 6,
            padding: 10,
            overflow: "auto",
            maxHeight: 280,
          }}
        >
          {JSON.stringify(output, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export default ToolCallSandbox;
