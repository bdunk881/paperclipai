// Runtime drawer — run controls, step log, cost log per step.

const { useState: useStateR, useEffect: useEffectR } = React;

function Runtime({ template, runStates, costLog, isRunning, onRun, onClear, lastRun, mood }) {
  const [tab, setTab] = useStateR("steps");
  const totalCost = costLog.reduce((s, c) => s + c.estimatedCostUsd, 0);
  const totalTokens = costLog.reduce((s, c) => s + c.promptTokens + c.completionTokens, 0);
  const completedCount = Object.values(runStates).filter(s => s === "done").length;

  return (
    <div className="af-runtime">
      <div className="af-rt-head">
        <button className="af-run-btn" onClick={onRun} disabled={isRunning}>
          {isRunning ? (
            <><span className="af-run-spinner" /> Running…</>
          ) : (
            <><span className="af-run-tri">▶</span> Run sample</>
          )}
        </button>

        <div className="af-rt-stats">
          <div className="af-rt-stat">
            <span className="af-rt-stat-val">{completedCount}<span className="af-rt-stat-tot">/{template.nodes.length}</span></span>
            <span className="af-rt-stat-lbl af-mono">STEPS</span>
          </div>
          <div className="af-rt-stat">
            <span className="af-rt-stat-val">${totalCost.toFixed(5)}</span>
            <span className="af-rt-stat-lbl af-mono">COST</span>
          </div>
          <div className="af-rt-stat">
            <span className="af-rt-stat-val">{totalTokens.toLocaleString()}</span>
            <span className="af-rt-stat-lbl af-mono">TOKENS</span>
          </div>
          <div className="af-rt-stat">
            <span className="af-rt-stat-val">{lastRun?.duration || "—"}</span>
            <span className="af-rt-stat-lbl af-mono">LATENCY</span>
          </div>
        </div>

        <div className="af-rt-tabs">
          <button className={`af-rt-tab ${tab === "steps" ? "af-rt-tab-active" : ""}`} onClick={() => setTab("steps")}>Steps</button>
          <button className={`af-rt-tab ${tab === "cost" ? "af-rt-tab-active" : ""}`} onClick={() => setTab("cost")}>Cost log</button>
          <button className={`af-rt-tab ${tab === "json" ? "af-rt-tab-active" : ""}`} onClick={() => setTab("json")}>Output</button>
        </div>

        <button className="af-rt-clear" onClick={onClear}>Clear</button>
      </div>

      <div className="af-rt-body">
        {tab === "steps" && (
          <div className="af-step-rows">
            {template.nodes.map((n, i) => {
              const state = runStates[n.id] || "idle";
              const cost = costLog.find(c => c.stepId === n.id);
              return (
                <div key={n.id} className={`af-step-row af-step-${state}`}>
                  <span className="af-step-idx af-mono">{String(i + 1).padStart(2, "0")}</span>
                  <span className={`af-dot af-dot-${state}`} />
                  <span className="af-step-kind af-mono">{n.kind}</span>
                  <span className="af-step-name">{n.name}</span>
                  {cost && (
                    <>
                      <span className={`af-tier af-tier-${cost.modelTier}`}>{cost.modelTier}</span>
                      <span className="af-step-tok af-mono">{cost.promptTokens}↑ {cost.completionTokens}↓</span>
                      <span className="af-step-cost af-mono">${cost.estimatedCostUsd.toFixed(5)}</span>
                    </>
                  )}
                  {!cost && state === "done" && (
                    <span className="af-step-tok af-mono" style={{opacity:0.5}}>no llm cost</span>
                  )}
                  <span className="af-step-dur af-mono">
                    {state === "done" ? `${(80 + i * 30 + Math.random() * 200) | 0}ms` : state === "running" ? "···" : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {tab === "cost" && (
          <div className="af-cost-tab">
            <div className="af-cost-bars">
              {template.nodes.filter(n => n.kind === "llm").map((n, i) => {
                const c = costLog.find(x => x.stepId === n.id);
                const w = c ? Math.max(8, (c.estimatedCostUsd / 0.0008) * 100) : 0;
                return (
                  <div key={n.id} className="af-cost-bar-row">
                    <span className="af-cost-bar-name">{n.name}</span>
                    <div className="af-cost-bar-track">
                      <div className={`af-cost-bar-fill af-tier-${c?.modelTier || n.tier}`} style={{ width: `${Math.min(100, w)}%` }}>
                        <span className="af-mono">{c ? `$${c.estimatedCostUsd.toFixed(5)}` : "—"}</span>
                      </div>
                    </div>
                    <span className={`af-tier af-tier-${c?.modelTier || n.tier}`}>{c?.modelTier || n.tier}</span>
                  </div>
                );
              })}
            </div>
            <div className="af-cost-summary">
              <div>
                <div className="af-cost-summary-lbl af-mono">TIER ROUTING SAVED</div>
                <div className="af-cost-summary-val">42%</div>
              </div>
              <div>
                <div className="af-cost-summary-lbl af-mono">VS. POWER-ONLY</div>
                <div className="af-cost-summary-val af-mono">$0.00073 → $0.00126</div>
              </div>
            </div>
          </div>
        )}

        {tab === "json" && (
          <pre className="af-code af-mono af-rt-json">{JSON.stringify({
            runId: "run_" + Math.random().toString(36).slice(2, 10),
            templateId: template.id,
            status: completedCount === template.nodes.length ? "succeeded" : isRunning ? "running" : "pending",
            steps: template.nodes.map(n => ({
              stepId: n.id,
              status: runStates[n.id] || "pending",
              ...(costLog.find(c => c.stepId === n.id) ? { costLog: costLog.find(c => c.stepId === n.id) } : {}),
            })),
            output: completedCount === template.nodes.length ? template.expected : null,
          }, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

window.AF_Runtime = Runtime;
