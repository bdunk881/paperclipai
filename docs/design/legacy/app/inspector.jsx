// Inspector — right rail. Configures selected node + shows sample I/O.

const { useState: useStateI } = React;

function Field({ field, value, onChange }) {
  if (field.type === "select") {
    return (
      <label className="af-field">
        <span className="af-field-label">{field.label}{field.required && <em>*</em>}</span>
        <div className="af-select-wrap">
          <select className="af-input af-select" value={value} onChange={(e) => onChange(e.target.value)}>
            {field.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <span className="af-select-chev">▾</span>
        </div>
      </label>
    );
  }
  if (field.type === "textarea") {
    return (
      <label className="af-field">
        <span className="af-field-label">{field.label}{field.required && <em>*</em>}</span>
        <textarea className="af-input af-textarea" value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
      </label>
    );
  }
  return (
    <label className="af-field">
      <span className="af-field-label">{field.label}{field.required && <em>*</em>}</span>
      <input className="af-input" type={field.type === "number" ? "number" : "text"}
        value={value} onChange={(e) => onChange(field.type === "number" ? Number(e.target.value) : e.target.value)} />
    </label>
  );
}

function TabBtn({ active, children, onClick }) {
  return <button className={`af-tab ${active ? "af-tab-active" : ""}`} onClick={onClick}>{children}</button>;
}

function Inspector({ template, selectedNode, configValues, onConfigChange, onTierChange }) {
  const [tab, setTab] = useStateI("config");
  const KINDS = window.AF_DATA.NODE_KINDS;
  const TIERS = window.AF_DATA.TIER_INFO;

  if (!selectedNode) {
    // Template-level inspector
    return (
      <aside className="af-inspector">
        <div className="af-insp-head">
          <div className="af-insp-eyebrow af-mono">TEMPLATE</div>
          <div className="af-insp-title">{template.name}</div>
          <div className="af-insp-blurb">{template.blurb}</div>
        </div>
        <div className="af-insp-tabs">
          <TabBtn active={tab === "config"} onClick={() => setTab("config")}>Config</TabBtn>
          <TabBtn active={tab === "sample"} onClick={() => setTab("sample")}>Sample I/O</TabBtn>
          <TabBtn active={tab === "schema"} onClick={() => setTab("schema")}>Schema</TabBtn>
        </div>
        <div className="af-insp-body">
          {tab === "config" && (
            <div className="af-fields">
              {template.config.map(f => (
                <Field key={f.key} field={f} value={configValues[f.key] ?? f.value}
                  onChange={(v) => onConfigChange(f.key, v)} />
              ))}
            </div>
          )}
          {tab === "sample" && (
            <div className="af-io">
              <div className="af-io-section">
                <div className="af-io-label af-mono">SAMPLE INPUT</div>
                <pre className="af-code af-mono">{JSON.stringify(template.sample, null, 2)}</pre>
              </div>
              <div className="af-io-section">
                <div className="af-io-label af-mono">EXPECTED OUTPUT</div>
                <pre className="af-code af-mono">{JSON.stringify(template.expected, null, 2)}</pre>
              </div>
            </div>
          )}
          {tab === "schema" && (
            <div className="af-io">
              <div className="af-io-label af-mono">PORTABLE WORKFLOW · v2026-04-19</div>
              <pre className="af-code af-mono">{JSON.stringify({
                format: "autoflow.workflow-template",
                schemaVersion: "2026-04-19",
                template: {
                  id: template.id, name: template.name,
                  steps: template.nodes.map(n => ({ id: n.id, kind: n.kind, name: n.name })),
                },
              }, null, 2)}</pre>
            </div>
          )}
        </div>
      </aside>
    );
  }

  const kind = KINDS[selectedNode.kind];
  return (
    <aside className="af-inspector">
      <div className="af-insp-head">
        <div className="af-insp-eyebrow af-mono">
          <span className={`af-tone-dot af-tone-${kind.tone}`} />
          STEP · {kind.label.toUpperCase()}
        </div>
        <div className="af-insp-title">{selectedNode.name}</div>
        <div className="af-insp-id af-mono">{selectedNode.id}</div>
      </div>
      <div className="af-insp-tabs">
        <TabBtn active={tab === "config"} onClick={() => setTab("config")}>Config</TabBtn>
        {selectedNode.kind === "llm" && <TabBtn active={tab === "prompt"} onClick={() => setTab("prompt")}>Prompt</TabBtn>}
        <TabBtn active={tab === "io"} onClick={() => setTab("io")}>I/O</TabBtn>
      </div>
      <div className="af-insp-body">
        {tab === "config" && (
          <div className="af-fields">
            <label className="af-field">
              <span className="af-field-label">Step Name</span>
              <input className="af-input" defaultValue={selectedNode.name} />
            </label>
            {selectedNode.action && (
              <label className="af-field">
                <span className="af-field-label">Action Handler</span>
                <input className="af-input af-mono" defaultValue={selectedNode.action} readOnly />
              </label>
            )}
            {selectedNode.condition && (
              <label className="af-field">
                <span className="af-field-label">Condition</span>
                <input className="af-input af-mono" defaultValue={selectedNode.condition} />
              </label>
            )}
            {selectedNode.kind === "llm" && (
              <>
                <div className="af-field">
                  <span className="af-field-label">LLM Tier <span className="af-hint af-mono">auto-routed</span></span>
                  <div className="af-tier-picker">
                    {Object.keys(TIERS).map(t => (
                      <button key={t}
                        className={`af-tier-btn af-tier-${t} ${selectedNode.tier === t ? "af-tier-active" : ""}`}
                        onClick={() => onTierChange(selectedNode.id, t)}>
                        <span className="af-tier-name">{t}</span>
                        <span className="af-tier-model af-mono">{TIERS[t].model}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="af-cost-est">
                  <div className="af-cost-est-label af-mono">EST. COST / RUN</div>
                  <div className="af-cost-est-value">${(TIERS[selectedNode.tier || "standard"].inCost * 0.21 + TIERS[selectedNode.tier || "standard"].outCost * 0.055).toFixed(5)}</div>
                  <div className="af-cost-est-tokens af-mono">~210 in · ~55 out</div>
                </div>
              </>
            )}
          </div>
        )}
        {tab === "prompt" && selectedNode.kind === "llm" && (
          <div className="af-io">
            <div className="af-io-label af-mono">PROMPT TEMPLATE</div>
            <pre className="af-code af-prompt af-mono">{selectedNode.prompt}</pre>
            <div className="af-io-label af-mono" style={{marginTop: 12}}>OUTPUT KEYS</div>
            <div className="af-pill-row">
              {(selectedNode.outputKeys || []).map(k => <span key={k} className="af-pill af-mono">{k}</span>)}
            </div>
          </div>
        )}
        {tab === "io" && (
          <div className="af-io">
            <div className="af-io-label af-mono">INPUT KEYS</div>
            <div className="af-pill-row">
              {["leadId","email","companyName","jobTitle"].map(k => <span key={k} className="af-pill af-mono">{k}</span>)}
            </div>
            <div className="af-io-label af-mono" style={{marginTop: 12}}>OUTPUT KEYS</div>
            <div className="af-pill-row">
              {(selectedNode.outputKeys || ["result"]).map(k => <span key={k} className="af-pill af-mono">{k}</span>)}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

window.AF_Inspector = Inspector;
