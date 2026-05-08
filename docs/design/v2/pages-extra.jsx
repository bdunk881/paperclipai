// Activity, Budget, Library, Settings pages.

const AF2_Activity = () => {
  const D = window.AF2_DATA;
  const Av = window.AF2_Avatar;
  const events = [
    { t: "14:32", who: "ag-1", verb: "drafted", obj: "outreach for 38 enterprise leads", tone: "ink" },
    { t: "14:30", who: "ag-2", verb: "filed approval", obj: "Postgres 16 migration window", tone: "clay" },
    { t: "14:28", who: "ag-5", verb: "blocked on", obj: "Apollo credits exhausted", tone: "mustard" },
    { t: "14:22", who: "ag-4", verb: "published", obj: "3 articles to /blog", tone: "sage" },
    { t: "14:15", who: "ag-6", verb: "deployed", obj: "webhook-svc v2.18.0 to staging", tone: "ink" },
    { t: "14:08", who: "ag-3", verb: "reconciled", obj: "Stripe payouts for April", tone: "sage" },
    { t: "14:01", who: "ag-1", verb: "scheduled", obj: "5 demos via HubSpot sequences", tone: "ink" },
    { t: "13:54", who: "ag-7", verb: "ran QA suite on", obj: "auth-svc · 142 tests passed", tone: "sage" },
    { t: "13:47", who: "ag-4", verb: "researched", obj: "Q2 SEO keyword gaps · 14 pages", tone: "ink" },
    { t: "13:40", who: "ag-2", verb: "code-reviewed", obj: "PR #482 · approved with 2 nits", tone: "ink" },
  ];
  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Run · Live</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Activity</h1>
          <div className="af2-page-head-meta">Every move your team makes — searchable, exportable, with receipts.</div>
        </div>
        <div className="af2-page-actions">
          <button className="af2-btn">Export CSV</button>
          <button className="af2-btn">Filter</button>
        </div>
      </div>

      <div className="af2-tabs">{["Live (live)", "Today", "This week", "All"].map((t,i) => <button key={t} className={`af2-tab${i===0?" active":""}`}>{t}</button>)}</div>

      <div className="af2-card" style={{ padding: 0 }}>
        {events.map((e, i) => {
          const a = D.agents.find(x => x.id === e.who);
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 36px 1fr 80px", gap: 14, padding: "11px 18px", borderBottom: i < events.length-1 ? "1px solid var(--af2-line)" : 0, alignItems: "center" }}>
              <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>{e.t}</span>
              <Av a={a} size="sm"/>
              <div style={{ fontSize: 13 }}>
                <strong>{a.name.split(" ")[0]}</strong>
                <span className="af2-muted"> {e.verb} </span>
                <span style={{ color: "var(--af2-ink)" }}>{e.obj}</span>
              </div>
              <button className="af2-btn af2-btn-ghost af2-btn-sm" style={{ justifySelf: "end" }}>Details →</button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const AF2_Budget = () => {
  const D = window.AF2_DATA;
  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Spend</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Budget</h1>
          <div className="af2-page-head-meta">$1,207 of $2,000 cap used · 60% · 17 days left in cycle.</div>
        </div>
        <div className="af2-page-actions">
          <button className="af2-btn">Forecast</button>
          <button className="af2-btn af2-btn-primary">Adjust caps</button>
        </div>
      </div>

      <div className="af2-stats" style={{ marginBottom: 22 }}>
        <div className="af2-stat"><div className="af2-stat-label">Spent · MTD</div><div className="af2-stat-value">$1,207</div></div>
        <div className="af2-stat"><div className="af2-stat-label">Forecast · EoM</div><div className="af2-stat-value">$1,840</div><div className="af2-stat-delta up">8% under cap</div></div>
        <div className="af2-stat"><div className="af2-stat-label">Top spender</div><div className="af2-stat-value af2-serif" style={{fontSize: 22}}>Devon</div><div className="af2-stat-delta">CTO · $510</div></div>
        <div className="af2-stat"><div className="af2-stat-label">Cost per hour saved</div><div className="af2-stat-value">$8.50</div></div>
      </div>

      <h3 className="af2-h3" style={{ marginBottom: 10 }}>By agent</h3>
      <div className="af2-list">
        <div className="af2-list-head" style={{ gridTemplateColumns: "200px 1fr 110px 110px 90px" }}>
          <div>Agent</div><div>Usage</div><div>Spent</div><div>Cap</div><div></div>
        </div>
        {D.agents.map(a => {
          const pct = (a.spent / a.budget) * 100;
          return (
            <div key={a.id} className="af2-list-row" style={{ gridTemplateColumns: "200px 1fr 110px 110px 90px" }}>
              <div className="af2-row">
                <div className={`af2-avatar sm af2-tone-${a.tone}`}>{a.name.split(" ").map(n=>n[0]).join("")}</div>
                <div><div style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</div><div className="af2-muted" style={{ fontSize: 11.5 }}>{a.role}</div></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: 6, background: "var(--af2-paper-2)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: pct > 80 ? "var(--af2-clay)" : "var(--af2-ink-2)" }}/>
                </div>
                <span className="af2-mono af2-muted" style={{ fontSize: 11 }}>{Math.round(pct)}%</span>
              </div>
              <div className="af2-mono" style={{ fontSize: 12 }}>${a.spent}</div>
              <div className="af2-mono af2-muted" style={{ fontSize: 12 }}>${a.budget}</div>
              <div style={{ textAlign: "right" }}><button className="af2-btn af2-btn-sm">Edit</button></div>
            </div>
          );
        })}
      </div>

      <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>By model · last 30 days</h3>
      <div className="af2-card" style={{ padding: 18 }}>
        {[
          { m: "claude-opus-4-5", t: 652, c: "$782" },
          { m: "claude-sonnet-4-5", t: 318, c: "$281" },
          { m: "claude-haiku-4-5", t: 84,  c: "$48" },
          { m: "gpt-4o", t: 96, c: "$96" },
        ].map((row, i) => (
          <div key={row.m} style={{ display: "grid", gridTemplateColumns: "1fr 220px 80px", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: i < 3 ? "1px solid var(--af2-line)" : 0 }}>
            <span className="af2-mono" style={{ fontSize: 12.5 }}>{row.m}</span>
            <div style={{ height: 6, background: "var(--af2-paper-2)", borderRadius: 3 }}>
              <div style={{ width: `${row.t / 8}%`, height: "100%", background: "var(--af2-ink)", borderRadius: 3 }}/>
            </div>
            <span className="af2-mono" style={{ fontSize: 12.5, textAlign: "right" }}>{row.c}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const AF2_Library = () => {
  const items = [
    { name: "Lead enrichment", uses: 142, owner: "ag-1", desc: "Webhook → Apollo enrich → HubSpot upsert → Slack notify", live: true },
    { name: "Inbox triage",     uses: 88,  owner: "ag-3", desc: "Read Gmail → classify → label → reply if low-stakes",   live: true },
    { name: "PR auto-review",   uses: 67,  owner: "ag-2", desc: "GitHub webhook → diff analysis → suggest changes",      live: true },
    { name: "Weekly digest",    uses: 4,   owner: "ag-1", desc: "Schedule Mon 9a → roll up Slack/Linear → email leaders", live: true },
    { name: "Quote-to-cash",    uses: 31,  owner: "ag-3", desc: "Stripe sub → DocuSign envelope → HubSpot deal close",    live: false },
    { name: "Bug triage",       uses: 124, owner: "ag-7", desc: "Sentry issue → reproduce → file Linear → assign owner",  live: true },
  ];
  const D = window.AF2_DATA;
  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Build · Routines</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Library</h1>
          <div className="af2-page-head-meta">Reusable workflows your agents call as routines. Like functions, but with judgment.</div>
        </div>
        <div className="af2-page-actions">
          <button className="af2-btn">Browse templates</button>
          <button className="af2-btn af2-btn-clay">＋ New routine</button>
        </div>
      </div>

      <div className="af2-tabs">{["All (24)", "Mine", "Shared", "Templates"].map((t,i) => <button key={t} className={`af2-tab${i===0?" active":""}`}>{t}</button>)}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
        {items.map(r => {
          const a = D.agents.find(x => x.id === r.owner);
          return (
            <div key={r.name} className="af2-card" style={{ padding: 18 }}>
              <div className="af2-row">
                <div className="af2-h3" style={{ fontSize: 17 }}>{r.name}</div>
                <span className="af2-spacer"/>
                <span className={`af2-pill ${r.live ? "af2-pill-live" : ""}`}><span className="af2-dot"/>{r.live ? "live" : "draft"}</span>
              </div>
              <div className="af2-muted" style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>{r.desc}</div>
              <div className="af2-row" style={{ marginTop: 14, gap: 10 }}>
                <div className={`af2-avatar sm af2-tone-${a.tone}`}>{a.name.split(" ").map(n=>n[0]).join("")}</div>
                <span className="af2-muted" style={{ fontSize: 12 }}>{a.name.split(" ")[0]}</span>
                <span className="af2-spacer"/>
                <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>{r.uses} runs · 30d</span>
                <button className="af2-btn af2-btn-sm">Open in Studio</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const AF2_Settings = () => {
  return (
    <div className="af2-page" style={{ maxWidth: 920 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Connect · Workspace</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Settings</h1>
          <div className="af2-page-head-meta">Acme Robotics · Studio plan · 12 seats · created 14 March 2026.</div>
        </div>
      </div>

      <div className="af2-tabs">{["General","Members","Policies","Security","Billing","API"].map((t,i) => <button key={t} className={`af2-tab${i===0?" active":""}`}>{t}</button>)}</div>

      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 28, alignItems: "start" }}>
        <div className="af2-eyebrow" style={{ paddingTop: 8 }}>Workspace</div>
        <div>
          <label style={{ fontSize: 12.5, color: "var(--af2-ink-3)" }}>Name</label>
          <input className="af2-input" defaultValue="Acme Robotics" style={{ display: "block", width: "100%", marginTop: 6 }}/>
          <label style={{ fontSize: 12.5, color: "var(--af2-ink-3)", marginTop: 14, display: "block" }}>Mission statement</label>
          <textarea className="af2-input" rows={3} defaultValue="Become the leader in industrial robotics for North America." style={{ width: "100%", marginTop: 6, fontFamily: "var(--af2-serif)", fontSize: 15 }}/>
          <label style={{ fontSize: 12.5, color: "var(--af2-ink-3)", marginTop: 14, display: "block" }}>Default timezone</label>
          <input className="af2-input" defaultValue="America/Los_Angeles" style={{ display: "block", width: "100%", marginTop: 6 }}/>
        </div>

        <div className="af2-eyebrow" style={{ paddingTop: 8 }}>Approvals</div>
        <div className="af2-card" style={{ padding: 16 }}>
          {[
            { k: "Spend over $500", v: "Always require human" },
            { k: "Production deploys", v: "Require human, auto-approve after 24h on green" },
            { k: "Send external email", v: "Auto-approve if drafted by Power-tier model" },
            { k: "Delete records", v: "Always require human" },
          ].map((p, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 260px 60px", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: i < 3 ? "1px solid var(--af2-line)" : 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{p.k}</span>
              <span className="af2-muted" style={{ fontSize: 12 }}>{p.v}</span>
              <button className="af2-btn af2-btn-sm">Edit</button>
            </div>
          ))}
        </div>

        <div className="af2-eyebrow" style={{ paddingTop: 8 }}>Danger zone</div>
        <div className="af2-card" style={{ padding: 16, borderColor: "rgba(194,80,43,0.3)" }}>
          <div className="af2-row">
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>Pause all agents</div>
              <div className="af2-muted" style={{ fontSize: 12, marginTop: 2 }}>Stops every agent and routine in this workspace immediately.</div>
            </div>
            <span className="af2-spacer"/>
            <button className="af2-btn af2-btn-sm" style={{ color: "var(--af2-clay)", borderColor: "rgba(194,80,43,0.3)" }}>Pause all</button>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { AF2_Activity, AF2_Budget, AF2_Library, AF2_Settings });
