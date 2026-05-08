// Sidebar — left rail. Templates gallery + nav.

function Sidebar({ templates, activeId, onSelect, onPromptToFlow }) {
  const [prompt, setPrompt] = React.useState("");
  const [thinking, setThinking] = React.useState(false);

  const submit = () => {
    if (!prompt.trim()) return;
    setThinking(true);
    onPromptToFlow(prompt, () => setThinking(false));
  };

  return (
    <aside className="af-sidebar">
      <div className="af-brand">
        <div className="af-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 12 L9 4 L14 12 L9 20 Z" fill="url(#bg1)" />
            <path d="M10 12 L15 4 L20 12 L15 20 Z" fill="url(#bg2)" opacity="0.85" />
            <defs>
              <linearGradient id="bg1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#818cf8" /><stop offset="1" stopColor="#6366f1" />
              </linearGradient>
              <linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#2dd4bf" /><stop offset="1" stopColor="#14b8a6" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div className="af-brand-text">
          <div className="af-brand-name">AutoFlow</div>
          <div className="af-brand-tag af-mono">v0.1 · staging</div>
        </div>
      </div>

      <div className="af-prompt-block">
        <div className="af-prompt-eyebrow af-mono">
          <span className="af-spark" /> PROMPT-TO-FLOW
        </div>
        <div className={`af-prompt-input ${thinking ? "af-prompt-thinking" : ""}`}>
          <textarea
            placeholder="Describe a workflow…&#10;e.g. 'When a Stripe payment fails, draft a recovery email and post to Slack'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
          />
          <button className="af-prompt-go" onClick={submit} disabled={thinking}>
            {thinking ? <span className="af-prompt-pulse">thinking</span> : "Generate ⌘↵"}
          </button>
        </div>
      </div>

      <div className="af-section-head">
        <span className="af-mono">TEMPLATES</span>
        <span className="af-section-count af-mono">{templates.length}</span>
      </div>

      <div className="af-tpl-list">
        {templates.map(t => (
          <button
            key={t.id}
            className={`af-tpl ${activeId === t.id ? "af-tpl-active" : ""} af-tpl-${t.color}`}
            onClick={() => onSelect(t.id)}
          >
            <div className="af-tpl-row">
              <span className={`af-tpl-cat af-tpl-cat-${t.color}`}>{t.category}</span>
              <span className="af-tpl-runs af-mono">{t.runs7d.toLocaleString()} runs/wk</span>
            </div>
            <div className="af-tpl-name">{t.name}</div>
            <div className="af-tpl-blurb">{t.blurb}</div>
            <div className="af-tpl-foot">
              <span className="af-mono">{t.avgCost}/run</span>
              <span className="af-tpl-dot">·</span>
              <span className="af-mono">{t.avgLatency}</span>
              {activeId === t.id && <span className="af-tpl-badge af-mono">DEPLOYED</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="af-section-head">
        <span className="af-mono">CONNECTIONS</span>
        <span className="af-section-count af-mono">6</span>
      </div>

      <div className="af-conn-grid">
        {[
          { name: "GitHub", file: "github" },
          { name: "Slack", file: "slack" },
          { name: "Linear", file: "linear" },
          { name: "Notion", file: "notion" },
          { name: "Postgres", file: "postgresql" },
          { name: "Stripe", file: "stripe" },
        ].map(c => (
          <div key={c.name} className="af-conn">
            <div className="af-conn-tile">
              <img src={`autoflow-brand/public/integrations/${c.file}.svg`} alt={c.name} />
            </div>
            <div className="af-conn-name">{c.name}</div>
            <span className="af-conn-status" />
          </div>
        ))}
      </div>

      <div className="af-sidebar-foot">
        <div className="af-mcp-pill">
          <span className="af-mcp-dot" />
          <span className="af-mono">MCP</span>
          <span className="af-mcp-sep">·</span>
          <span className="af-mono">BYOLLM</span>
        </div>
      </div>
    </aside>
  );
}

window.AF_Sidebar = Sidebar;
