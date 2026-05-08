// Enriched Studio — node palette, canvas, inspector, mini-map, run history, version history, Pro mode.

const NODES = [
  { id: "n1", x: 60,  y: 120, w: 180, type: "trigger",  label: "Webhook",          sub: "POST /lead",                icon: "⚡", tone: "ink"     },
  { id: "n2", x: 320, y: 100, w: 200, type: "tool",     label: "Apollo · enrich",  sub: "company + contact",         logo: "Apollo" },
  { id: "n3", x: 320, y: 220, w: 200, type: "code",     label: "Code · normalize", sub: "JS · 24 lines",             icon: "{}", tone: "blue"   },
  { id: "n4", x: 600, y: 80,  w: 200, type: "logic",    label: "Branch",           sub: "if score ≥ 80",             icon: "◆", tone: "mustard" },
  { id: "n5", x: 600, y: 260, w: 200, type: "tool",     label: "HubSpot · upsert", sub: "create deal",               logo: "HubSpot" },
  { id: "n6", x: 880, y: 60,  w: 200, type: "approval", label: "Approval",         sub: "if budget > $500",          icon: "✓", tone: "mustard" },
  { id: "n7", x: 880, y: 180, w: 200, type: "tool",     label: "Slack · notify",   sub: "#sales-pipe",               logo: "Slack" },
  { id: "n8", x: 880, y: 300, w: 200, type: "tool",     label: "Gmail · email",    sub: "to AE owner",               logo: "Gmail" },
  { id: "n9", x: 1160,y: 130, w: 180, type: "end",      label: "Done",             sub: "log result",                icon: "■", tone: "sage"   },
];
const EDGES = [
  ["n1","n2"], ["n1","n3"],
  ["n2","n4"], ["n3","n4"],
  ["n2","n5"],
  ["n4","n6"], ["n4","n7"],
  ["n5","n8"],
  ["n6","n9"], ["n7","n9"], ["n8","n9"],
];

const NodeCard = ({ n, selected, onClick }) => {
  const L = window.AF2_LOGOS;
  return (
    <div onClick={onClick} className="af2-card" style={{
      position: "absolute", left: n.x, top: n.y, width: n.w,
      padding: 12, cursor: "pointer",
      boxShadow: selected ? "0 0 0 2px var(--af2-clay), var(--af2-shadow-lg)" : "var(--af2-shadow)",
      borderColor: selected ? "var(--af2-clay)" : "var(--af2-line)",
      transform: "translate3d(0,0,0)",
    }}>
      <div className="af2-row" style={{ gap: 8 }}>
        {n.logo
          ? <span style={{ display: "grid", placeItems: "center" }}>{L[n.logo]}</span>
          : <div className={`af2-avatar sm af2-tone-${n.tone}`} style={{ width: 22, height: 22, fontSize: 11 }}>{n.icon}</div>}
        <div style={{ fontWeight: 600, fontSize: 13 }}>{n.label}</div>
        <span className="af2-spacer"/>
        <span className="af2-mono af2-muted-2" style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".1em" }}>{n.type}</span>
      </div>
      <div className="af2-muted" style={{ fontSize: 11.5, marginTop: 4 }}>{n.sub}</div>
    </div>
  );
};

const NodeEdges = () => {
  const lookup = Object.fromEntries(NODES.map(n => [n.id, n]));
  return (
    <svg width="1400" height="450" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {EDGES.map(([a, b], i) => {
        const A = lookup[a], B = lookup[b];
        const x1 = A.x + A.w, y1 = A.y + 28;
        const x2 = B.x,        y2 = B.y + 28;
        const mx = (x1 + x2) / 2;
        return (
          <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
            stroke="var(--af2-ink-3)" strokeWidth="1.4" fill="none" strokeDasharray="4 4" opacity="0.55"/>
        );
      })}
    </svg>
  );
};

const RunHistoryStrip = () => (
  <div className="af2-card" style={{ padding: "10px 14px", marginTop: 12 }}>
    <div className="af2-row" style={{ gap: 14 }}>
      <span className="af2-eyebrow">Last 30 runs</span>
      <span className="af2-spacer"/>
      <span className="af2-mono af2-muted" style={{ fontSize: 11 }}>p50 1.2s · p99 4.8s · 96% ok</span>
    </div>
    <div style={{ display: "flex", gap: 3, marginTop: 8, alignItems: "flex-end", height: 32 }}>
      {Array.from({ length: 30 }).map((_, i) => {
        const ok = ![5, 18].includes(i);
        const h = 6 + Math.abs(Math.sin(i * 1.3)) * 22;
        return <div key={i} style={{ width: 8, height: h, background: ok ? "var(--af2-sage)" : "var(--af2-clay)", borderRadius: 1, opacity: 0.85 }} title={`run ${i + 1}`}/>;
      })}
    </div>
  </div>
);

const VersionPanel = () => (
  <div>
    <div className="af2-eyebrow" style={{ marginBottom: 8 }}>Versions</div>
    {[
      { v: "v12", ts: "Today 14:02", by: "Maya", live: true,  note: "Branch on score ≥ 80" },
      { v: "v11", ts: "Yesterday",   by: "Devon", live: false, note: "Add Slack notify" },
      { v: "v10", ts: "2d ago",      by: "Maya", live: false, note: "Initial publish" },
    ].map(v => (
      <div key={v.v} className="af2-card" style={{ padding: 10, marginBottom: 6, display: "flex", alignItems: "center", gap: 10 }}>
        <span className="af2-mono" style={{ fontSize: 12, fontWeight: 600 }}>{v.v}</span>
        {v.live && <span className="af2-pill af2-pill-live"><span className="af2-dot"/>live</span>}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5 }}>{v.note}</div>
          <div className="af2-muted" style={{ fontSize: 11 }}>{v.by} · {v.ts}</div>
        </div>
        <button className="af2-btn af2-btn-sm">Diff</button>
      </div>
    ))}
  </div>
);

const ProEnvPanel = () => (
  <div>
    <div className="af2-eyebrow">Environment</div>
    <div className="af2-card af2-mono" style={{ padding: 12, marginTop: 6, fontSize: 11.5, lineHeight: 1.6, background: "var(--af2-paper-2)", whiteSpace: "pre" }}>
{`HUBSPOT_PORTAL_ID = 8439221
APOLLO_API_KEY    = sk-•••• 4f8a
SLACK_BOT_TOKEN   = xoxb-•••• d2c9
DEFAULT_MODEL     = claude-sonnet-4-5
MAX_RETRIES       = 3
TIMEOUT_MS        = 12000`}
    </div>
    <div className="af2-eyebrow" style={{ marginTop: 14 }}>Secrets · vault</div>
    <div className="af2-card" style={{ padding: 0, marginTop: 6 }}>
      {["APOLLO_API_KEY","HUBSPOT_TOKEN","SLACK_BOT_TOKEN","SENTRY_DSN"].map((s, i) => (
        <div key={s} style={{ padding: "8px 12px", borderBottom: i < 3 ? "1px solid var(--af2-line)" : 0, fontSize: 12, display: "flex", alignItems: "center" }}>
          <span className="af2-mono" style={{ flex: 1 }}>{s}</span>
          <span className="af2-muted-2" style={{ fontSize: 11 }}>rotated 4d ago</span>
        </div>
      ))}
    </div>
    <div className="af2-eyebrow" style={{ marginTop: 14 }}>Triggers</div>
    <div className="af2-card af2-mono" style={{ padding: 10, marginTop: 6, fontSize: 11.5 }}>
      POST /v1/hooks/lead-enrich · auth: hmac-sha256
    </div>
  </div>
);

const ProObservabilityPanel = () => (
  <div>
    <div className="af2-eyebrow">Latency · p99</div>
    <svg width="100%" height="64" viewBox="0 0 280 64" style={{ marginTop: 6 }}>
      <polyline points="0,40 20,38 40,32 60,42 80,30 100,28 120,36 140,22 160,26 180,18 200,30 220,16 240,24 260,14 280,20" fill="none" stroke="var(--af2-clay)" strokeWidth="1.6"/>
      <line x1="0" y1="48" x2="280" y2="48" stroke="var(--af2-line)"/>
    </svg>
    <div className="af2-eyebrow" style={{ marginTop: 14 }}>Cost · per run</div>
    <div className="af2-card" style={{ padding: 10, marginTop: 6, display: "flex", gap: 12 }}>
      <div><div style={{ fontFamily: "var(--af2-serif)", fontSize: 22 }}>$0.083</div><div className="af2-muted-2" style={{ fontSize: 11 }}>median</div></div>
      <div><div style={{ fontFamily: "var(--af2-serif)", fontSize: 22 }}>$0.412</div><div className="af2-muted-2" style={{ fontSize: 11 }}>p99</div></div>
    </div>
    <div className="af2-eyebrow" style={{ marginTop: 14 }}>Recent errors</div>
    <div className="af2-card" style={{ padding: 0, marginTop: 6 }}>
      {[
        { t: "13:48", n: "Apollo 429 · rate limited", c: 3 },
        { t: "11:22", n: "HubSpot 401 · token expired", c: 1 },
      ].map((e, i) => (
        <div key={i} style={{ padding: "8px 12px", borderBottom: i === 0 ? "1px solid var(--af2-line)" : 0, fontSize: 12 }}>
          <span className="af2-mono af2-muted" style={{ fontSize: 11, marginRight: 8 }}>{e.t}</span>
          <span style={{ color: "var(--af2-clay)" }}>{e.n}</span>
          <span className="af2-spacer"/>
          <span className="af2-pill af2-pill-clay" style={{ float: "right" }}>{e.c}×</span>
        </div>
      ))}
    </div>
  </div>
);

const InspectorBasic = ({ node }) => (
  <div>
    <div className="af2-eyebrow">Selected node</div>
    <div className="af2-h3" style={{ marginTop: 6 }}>{node.label}</div>
    <div className="af2-muted" style={{ fontSize: 12.5, marginTop: 4 }}>{node.sub}</div>

    <div className="af2-eyebrow" style={{ marginTop: 14 }}>Input</div>
    <div className="af2-input af2-mono" style={{ fontSize: 11.5, padding: 10, lineHeight: 1.5, background: "var(--af2-paper-2)" }}>{`{ "email": "{{trigger.body.email}}",
  "domain": "{{trigger.body.domain}}" }`}</div>

    <div className="af2-eyebrow" style={{ marginTop: 14 }}>Run by</div>
    <div className="af2-card" style={{ padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
      <div className="af2-avatar sm af2-tone-clay">SR</div>
      <div style={{ fontSize: 13 }}>Sana Reyes <span className="af2-muted">· SDR</span></div>
    </div>

    <div className="af2-eyebrow" style={{ marginTop: 14 }}>Cost cap</div>
    <input className="af2-input af2-mono" defaultValue="$0.20 / run" style={{ width: "100%" }}/>

    <div className="af2-eyebrow" style={{ marginTop: 14 }}>Retry</div>
    <input className="af2-input" defaultValue="3 attempts · backoff 2s" style={{ width: "100%" }}/>
  </div>
);

const InspectorPro = ({ node }) => (
  <div>
    <div className="af2-eyebrow">Selected node · Pro</div>
    <div className="af2-h3" style={{ marginTop: 6 }}>{node.label}</div>

    <div className="af2-tabs" style={{ marginTop: 12, marginBottom: 12 }}>
      {["Code","I/O","Schema","Tests","Logs"].map((t,i) => <button key={t} className={`af2-tab${i===0?" active":""}`} style={{ padding: "8px 10px", fontSize: 11.5 }}>{t}</button>)}
    </div>

    <div className="af2-card af2-mono" style={{ padding: 12, fontSize: 11.5, lineHeight: 1.55, background: "var(--af2-ink)", color: "var(--af2-paper)", borderColor: "var(--af2-ink)", whiteSpace: "pre", overflowX: "auto" }}>
{`export async function run(ctx, input) {
  const { email, domain } = input;
  const lead = await ctx.tools.apollo.enrich({
    email, domain,
    fields: ["company","title","seniority"],
  });
  ctx.log.info("enriched", { id: lead.id });
  return {
    score: scoreLead(lead),
    payload: lead,
  };
}`}
    </div>

    <div className="af2-eyebrow" style={{ marginTop: 14 }}>Output schema</div>
    <div className="af2-card af2-mono" style={{ padding: 10, fontSize: 11, lineHeight: 1.5 }}>
      {`{ score: number, payload: { id: string, company: string, title: string, seniority: string } }`}
    </div>

    <div className="af2-eyebrow" style={{ marginTop: 14 }}>Recent invocations</div>
    {[1,2,3,4].map(i => (
      <div key={i} style={{ display: "flex", alignItems: "center", padding: "5px 0", fontSize: 11.5, borderBottom: i < 4 ? "1px solid var(--af2-line)" : 0 }}>
        <span className="af2-mono af2-muted-2">trace_a8{i}c3</span>
        <span className="af2-spacer"/>
        <span className="af2-mono" style={{ color: "var(--af2-sage)" }}>● 1.{i}s</span>
        <span className="af2-mono af2-muted" style={{ marginLeft: 8 }}>$0.0{8 - i}</span>
      </div>
    ))}
  </div>
);

const AF2_Studio = () => {
  const [pro, setPro] = React.useState(false);
  const [sel, setSel] = React.useState("n2");
  const [tab, setTab] = React.useState("inspector");
  const node = NODES.find(n => n.id === sel) || NODES[0];

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%" }}>
      {/* Studio header */}
      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--af2-line)", display: "flex", alignItems: "center", gap: 14, background: pro ? "var(--af2-ink)" : "var(--af2-paper)", color: pro ? "var(--af2-paper)" : "var(--af2-ink)", transition: "background .2s" }}>
        <div>
          <div className="af2-eyebrow" style={{ color: pro ? "var(--af2-clay-2)" : "var(--af2-ink-3)" }}>Build · Studio {pro && "· Pro"}</div>
          <div style={{ fontFamily: "var(--af2-serif)", fontSize: 22, marginTop: 2, letterSpacing: "-0.015em" }}>Lead enrichment routine</div>
        </div>
        <span className="af2-pill af2-pill-live"><span className="af2-dot"/>live · v12</span>
        <span className="af2-spacer"/>

        {/* Pro toggle */}
        <div onClick={() => setPro(!pro)} title="Toggle Pro mode" style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "5px 12px 5px 6px", borderRadius: 999, cursor: "pointer",
          background: pro ? "var(--af2-clay)" : "rgba(26,20,16,0.06)",
          color: pro ? "#fff" : "var(--af2-ink-2)",
          border: pro ? "1px solid var(--af2-clay)" : "1px solid var(--af2-line-2)",
          fontSize: 12, fontWeight: 500,
        }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: pro ? "#fff" : "var(--af2-card)", color: pro ? "var(--af2-clay)" : "var(--af2-ink)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>P</span>
          Pro mode {pro ? "ON" : "OFF"}
        </div>

        <button className="af2-btn af2-btn-sm" style={pro ? { background: "rgba(246,241,231,0.08)", borderColor: "rgba(246,241,231,0.2)", color: "var(--af2-paper)" } : {}}>History</button>
        <button className="af2-btn af2-btn-sm" style={pro ? { background: "rgba(246,241,231,0.08)", borderColor: "rgba(246,241,231,0.2)", color: "var(--af2-paper)" } : {}}>Test run</button>
        <button className="af2-btn af2-btn-sm af2-btn-clay">Publish</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: pro ? "260px 1fr 360px" : "240px 1fr 320px", minHeight: 0 }}>
        {/* LEFT — palette / pro env */}
        <div style={{ borderRight: "1px solid var(--af2-line)", overflowY: "auto", padding: 16 }}>
          {pro ? <ProEnvPanel/> : (
            <div>
              <div className="af2-eyebrow" style={{ marginBottom: 8 }}>Triggers</div>
              {["Webhook","Schedule","Form submission","Email received","Slack mention"].map(n => (
                <div key={n} className="af2-card" style={{ padding: "8px 10px", marginBottom: 6, fontSize: 13, cursor: "grab" }}>{n}</div>
              ))}
              <div className="af2-eyebrow" style={{ marginTop: 16, marginBottom: 8 }}>Tools · 16</div>
              {["HubSpot","Apollo","Slack","Gmail","GitHub","Linear","Notion","Stripe","Sentry"].map(n => (
                <div key={n} className="af2-card" style={{ padding: "7px 10px", marginBottom: 5, fontSize: 12.5, cursor: "grab", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-grid", placeItems: "center" }}>{window.AF2_LOGOS[n]}</span>{n}
                </div>
              ))}
              <div className="af2-eyebrow" style={{ marginTop: 16, marginBottom: 8 }}>Logic</div>
              {["Branch","Approval","Loop","Code","Wait","Subroutine"].map(n => (
                <div key={n} className="af2-card" style={{ padding: "8px 10px", marginBottom: 6, fontSize: 13, cursor: "grab" }}>{n}</div>
              ))}
            </div>
          )}
        </div>

        {/* CANVAS */}
        <div style={{ background: "var(--af2-paper-2)", position: "relative", overflow: "auto", backgroundImage: "radial-gradient(rgba(26,20,16,0.10) 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
          <div style={{ position: "relative", width: 1400, height: 450 }}>
            <NodeEdges/>
            {NODES.map(n => <NodeCard key={n.id} n={n} selected={sel === n.id} onClick={() => setSel(n.id)}/>)}
          </div>

          {/* Mini-map */}
          <div style={{ position: "sticky", bottom: 14, marginLeft: "calc(100% - 200px)", width: 184, height: 100, background: "var(--af2-card)", border: "1px solid var(--af2-line)", borderRadius: 8, padding: 6, boxShadow: "var(--af2-shadow)", float: "right" }}>
            <div className="af2-eyebrow" style={{ fontSize: 9 }}>Map</div>
            <svg viewBox="0 0 1400 450" style={{ width: "100%", height: 70, marginTop: 2 }}>
              {EDGES.map(([a,b],i) => {
                const A = NODES.find(n => n.id === a), B = NODES.find(n => n.id === b);
                return <line key={i} x1={A.x + A.w/2} y1={A.y + 28} x2={B.x + B.w/2} y2={B.y + 28} stroke="var(--af2-ink-3)" strokeWidth="3"/>;
              })}
              {NODES.map(n => <rect key={n.id} x={n.x} y={n.y} width={n.w} height={56} rx="8" fill={sel === n.id ? "var(--af2-clay)" : "var(--af2-ink-2)"}/>)}
            </svg>
          </div>

          {/* Run history strip — bottom */}
          <div style={{ position: "absolute", left: 16, right: 220, bottom: 14 }}>
            <RunHistoryStrip/>
          </div>
        </div>

        {/* RIGHT — inspector */}
        <div style={{ borderLeft: "1px solid var(--af2-line)", overflowY: "auto", padding: 16 }}>
          {pro && (
            <div className="af2-tabs" style={{ marginTop: -4, marginBottom: 12 }}>
              {[["inspector","Inspector"],["versions","Versions"],["obs","Observability"]].map(([k,l]) => (
                <button key={k} className={`af2-tab${tab===k?" active":""}`} onClick={() => setTab(k)} style={{ padding: "8px 10px", fontSize: 12 }}>{l}</button>
              ))}
            </div>
          )}
          {tab === "versions" && pro    ? <VersionPanel/> :
           tab === "obs"      && pro    ? <ProObservabilityPanel/> :
           pro                          ? <InspectorPro node={node}/> :
                                          <InspectorBasic node={node}/>}
        </div>
      </div>
    </div>
  );
};

window.AF2_Studio = AF2_Studio;
