// Run history view — table + timeline + selected-run detail.
const { useState: uSR, useMemo: uMR } = React;

const AF_RUNS = (() => {
  const templates = ["tpl-lead-enrich", "tpl-content-gen", "tpl-support-bot"];
  const tplName = { "tpl-lead-enrich":"Lead Enrichment", "tpl-content-gen":"Content Generator", "tpl-support-bot":"Customer Support Bot" };
  const tplColor = { "tpl-lead-enrich":"indigo", "tpl-content-gen":"teal", "tpl-support-bot":"orange" };
  const statuses = ["succeeded", "succeeded", "succeeded", "succeeded", "running", "failed", "succeeded"];
  const triggers = ["webhook", "schedule", "api", "manual", "webhook", "webhook"];
  const out = [];
  for (let i = 0; i < 48; i++) {
    const t = templates[i % 3];
    const s = statuses[i % statuses.length];
    out.push({
      id: "run_" + Math.random().toString(36).slice(2, 10),
      tpl: t,
      tplName: tplName[t],
      tplColor: tplColor[t],
      status: s,
      trigger: triggers[i % triggers.length],
      startedAt: Date.now() - i * 1000 * 60 * (3 + (i % 7)),
      duration: (0.4 + Math.random() * 6).toFixed(2) + "s",
      cost: "$" + (Math.random() * 0.012 + 0.0001).toFixed(5),
      tokens: 120 + Math.floor(Math.random() * 1800),
      steps: 6 + (i % 3),
    });
  }
  return out;
})();

function timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return d + "s ago";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
}

function StatusPill({ s }) {
  const cls = `af-rh-status af-rh-status-${s}`;
  return <span className={cls}><span className="af-dot" />{s}</span>;
}

function RunHistory() {
  const [filter, setFilter] = uSR("all");
  const [selected, setSelected] = uSR(AF_RUNS[0].id);
  const filtered = uMR(() => filter === "all" ? AF_RUNS : AF_RUNS.filter(r => r.status === filter), [filter]);
  const sel = AF_RUNS.find(r => r.id === selected);

  // Bucket runs by hour for the timeline
  const buckets = uMR(() => {
    const arr = new Array(48).fill(0).map(() => ({ ok: 0, fail: 0, run: 0 }));
    AF_RUNS.forEach(r => {
      const h = Math.min(47, Math.floor((Date.now() - r.startedAt) / (1000 * 60 * 30)));
      const b = arr[47 - h];
      if (r.status === "succeeded") b.ok++;
      else if (r.status === "failed") b.fail++;
      else b.run++;
    });
    return arr;
  }, []);
  const maxBucket = Math.max(1, ...buckets.map(b => b.ok + b.fail + b.run));

  const stats = uMR(() => {
    const total = AF_RUNS.length;
    const ok = AF_RUNS.filter(r => r.status === "succeeded").length;
    const fail = AF_RUNS.filter(r => r.status === "failed").length;
    return { total, ok, fail, success: Math.round(ok / total * 100) };
  }, []);

  return (
    <div className="af-rh">
      <header className="af-rh-head">
        <div>
          <div className="af-rh-eyebrow af-mono">RUNS · LAST 24 HOURS</div>
          <h1 className="af-rh-title">Execution history</h1>
        </div>
        <div className="af-rh-stats">
          <div><div className="af-rh-statv">{stats.total}</div><div className="af-rh-statl af-mono">TOTAL</div></div>
          <div><div className="af-rh-statv af-tealc">{stats.success}%</div><div className="af-rh-statl af-mono">SUCCESS</div></div>
          <div><div className="af-rh-statv af-redc">{stats.fail}</div><div className="af-rh-statl af-mono">FAILED</div></div>
          <div><div className="af-rh-statv">$0.18</div><div className="af-rh-statl af-mono">SPEND</div></div>
        </div>
      </header>

      <div className="af-rh-timeline">
        <div className="af-rh-tl-bars">
          {buckets.map((b, i) => {
            const total = b.ok + b.fail + b.run;
            const h = total === 0 ? 4 : (total / maxBucket * 60) + 6;
            return (
              <div key={i} className="af-rh-tl-bar" style={{ height: h }}>
                {b.fail > 0 && <span className="af-rh-tl-fail" style={{ height: `${b.fail / total * 100}%` }} />}
                {b.run > 0 && <span className="af-rh-tl-run"  style={{ height: `${b.run / total * 100}%` }} />}
              </div>
            );
          })}
        </div>
        <div className="af-rh-tl-axis af-mono"><span>24h ago</span><span>12h</span><span>6h</span><span>now</span></div>
      </div>

      <div className="af-rh-toolbar">
        <div className="af-rh-tabs">
          {["all", "succeeded", "running", "failed"].map(f => (
            <button key={f} className={`af-rh-tab ${filter === f ? "af-rh-tab-active" : ""}`} onClick={() => setFilter(f)}>
              {f}<span className="af-rh-tab-n af-mono">{f === "all" ? AF_RUNS.length : AF_RUNS.filter(r => r.status === f).length}</span>
            </button>
          ))}
        </div>
        <div className="af-rh-search">
          <input className="af-input af-mono" placeholder="run_… or template" />
        </div>
      </div>

      <div className="af-rh-body">
        <div className="af-rh-table">
          <div className="af-rh-trh af-mono">
            <span>RUN</span><span>TEMPLATE</span><span>STATUS</span><span>TRIGGER</span><span>DURATION</span><span>COST</span><span>STARTED</span>
          </div>
          {filtered.map(r => (
            <button key={r.id} className={`af-rh-tr ${selected === r.id ? "af-rh-tr-active" : ""}`} onClick={() => setSelected(r.id)}>
              <span className="af-mono af-fg-2">{r.id}</span>
              <span><span className={`af-tpl-cat-${r.tplColor} af-tpl-cat`}>{r.tplName}</span></span>
              <StatusPill s={r.status} />
              <span className="af-mono af-fg-3">{r.trigger}</span>
              <span className="af-mono">{r.duration}</span>
              <span className="af-mono">{r.cost}</span>
              <span className="af-mono af-fg-3">{timeAgo(r.startedAt)}</span>
            </button>
          ))}
        </div>

        <aside className="af-rh-detail">
          {sel && (
            <>
              <div className="af-rh-d-head">
                <div className="af-mono af-fg-3 af-rh-eyebrow">{sel.id}</div>
                <div className="af-rh-d-title">{sel.tplName}</div>
                <div className="af-rh-d-meta"><StatusPill s={sel.status} /><span className="af-mono af-fg-3">{sel.duration} · {sel.tokens.toLocaleString()} tokens</span></div>
              </div>
              <div className="af-rh-d-section">
                <div className="af-rh-d-label af-mono">STEP TIMELINE</div>
                <div className="af-rh-d-steps">
                  {Array.from({length: sel.steps}, (_, i) => {
                    const w = 30 + Math.random() * 70;
                    const left = i * 14;
                    const ok = sel.status !== "failed" || i < sel.steps - 1;
                    return (
                      <div key={i} className={`af-rh-d-step ${ok ? "" : "af-rh-d-step-fail"}`}>
                        <span className="af-rh-d-step-name">step_{i+1}</span>
                        <div className="af-rh-d-step-track">
                          <span className="af-rh-d-step-bar" style={{ left: `${left}%`, width: `${w * 0.7}%` }} />
                        </div>
                        <span className="af-rh-d-step-dur af-mono">{Math.floor(80 + Math.random() * 600)}ms</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="af-rh-d-section">
                <div className="af-rh-d-label af-mono">COST BREAKDOWN</div>
                <div className="af-rh-d-cost">
                  <div className="af-rh-d-cost-bar">
                    <span style={{ width: "22%", background: "var(--af-teal)" }} title="lite" />
                    <span style={{ width: "55%", background: "var(--af-brand-500)" }} title="standard" />
                    <span style={{ width: "23%", background: "var(--af-orange)" }} title="power" />
                  </div>
                  <div className="af-rh-d-cost-leg af-mono">
                    <span><span className="af-mini-dot" style={{background:"var(--af-teal)"}} />lite 22%</span>
                    <span><span className="af-mini-dot" style={{background:"var(--af-brand-500)"}} />standard 55%</span>
                    <span><span className="af-mini-dot" style={{background:"var(--af-orange)"}} />power 23%</span>
                  </div>
                </div>
              </div>
              <div className="af-rh-d-section">
                <div className="af-rh-d-label af-mono">PAYLOAD</div>
                <pre className="af-code af-mono">{JSON.stringify({ runId: sel.id, templateId: sel.tpl, status: sel.status, durationSec: sel.duration, costUsd: sel.cost }, null, 2)}</pre>
              </div>
              <div className="af-rh-d-actions">
                <button className="af-ghost-btn">Replay</button>
                <button className="af-ghost-btn">Open in canvas</button>
                <button className="af-ghost-btn">Download logs</button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

window.AF_RunHistory = RunHistory;
