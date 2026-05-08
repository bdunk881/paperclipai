// Page modules — Home, Missions, Approvals, Team, Hire, Studio, Integrations, Models.

const Spark = ({ data, color = "var(--af2-ink-3)" }) => {
  const w = 120, h = 28, max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(" ");
  return <svg className="af2-stat-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.4"/></svg>;
};

// HOME -------------------------------------------------------
const AF2_Home = ({ openModal }) => {
  const D = window.AF2_DATA;
  const Av = window.AF2_Avatar;
  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Tuesday · May 4</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Good afternoon, Jordan.</h1>
          <div className="af2-page-head-meta">8 agents on the clock · 5 approvals waiting · $312 spent today</div>
        </div>
        <div className="af2-page-actions">
          <button className="af2-btn">Brief an agent</button>
          <button className="af2-btn af2-btn-clay">＋ New mission</button>
        </div>
      </div>

      <div className="af2-stats" style={{ marginBottom: 22 }}>
        <div className="af2-stat">
          <div className="af2-stat-label">Missions in flight</div>
          <div className="af2-stat-value">6</div>
          <Spark data={[3,4,3,5,4,6,6]} color="var(--af2-clay)"/>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Hours saved · 7d</div>
          <div className="af2-stat-value">142</div>
          <div className="af2-stat-delta up">▲ 18% vs prior</div>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Spend · month</div>
          <div className="af2-stat-value">$1,207</div>
          <div className="af2-stat-delta">60% of $2k cap</div>
        </div>
        <div className="af2-stat">
          <div className="af2-stat-label">Approval p50</div>
          <div className="af2-stat-value">3m 12s</div>
          <div className="af2-stat-delta down">▲ 22s vs last wk</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 22 }}>
        <section>
          <div className="af2-row" style={{ marginBottom: 10 }}>
            <h3 className="af2-h3">Active missions</h3>
            <span className="af2-spacer"/>
            <a className="af2-btn af2-btn-ghost af2-btn-sm">All missions →</a>
          </div>
          <div className="af2-list">
            <div className="af2-list-head" style={{ gridTemplateColumns: "1.7fr 130px 110px 90px 90px" }}>
              <div>Mission</div><div>Owner</div><div>Status</div><div>Due</div><div>Approvals</div>
            </div>
            {D.missions.map(m => {
              const owner = D.agents.find(a => a.id === m.owner);
              const pillCls = m.state === "blocked" ? "af2-pill-clay" : m.state === "review" ? "af2-pill-pending" : m.state === "scheduled" ? "" : "af2-pill-live";
              return (
                <div key={m.id} className="af2-list-row" onClick={() => openModal && openModal("mission", m)} style={{ gridTemplateColumns: "1.7fr 130px 110px 90px 90px" }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{m.title}</div>
                    <div style={{ height: 4, background: "var(--af2-paper-2)", borderRadius: 4, marginTop: 6, overflow: "hidden" }}>
                      <div style={{ width: `${m.progress * 100}%`, height: "100%", background: m.state === "blocked" ? "var(--af2-clay)" : "var(--af2-sage)" }}/>
                    </div>
                  </div>
                  <div className="af2-row"><Av a={owner} size="sm"/><span style={{ fontSize: 12.5 }}>{owner.name.split(" ")[0]}</span></div>
                  <div><span className={`af2-pill ${pillCls}`}><span className="af2-dot"/>{m.state}</span></div>
                  <div className="af2-mono" style={{ color: m.due.includes("overdue") ? "var(--af2-clay)" : "var(--af2-ink-3)" }}>{m.due}</div>
                  <div>{m.approvals > 0 ? <span className="af2-pill af2-pill-clay">{m.approvals}</span> : <span className="af2-muted-2">—</span>}</div>
                </div>
              );
            })}
          </div>

          <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>The room right now</h3>
          <div className="af2-card" style={{ padding: 0 }}>
            {D.agents.slice(0,6).map(a => (
              <div key={a.id} className="af2-row" onClick={() => openModal && openModal("agent", a)} style={{ padding: "12px 18px", borderBottom: "1px solid var(--af2-line)", gap: 14, cursor: "pointer" }}>
                <Av a={a}/>
                <div style={{ minWidth: 160 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</div>
                  <div className="af2-muted" style={{ fontSize: 12 }}>{a.role}</div>
                </div>
                <div style={{ flex: 1, fontSize: 13, color: "var(--af2-ink-2)" }}>
                  {a.status === "working" && <em className="af2-serif" style={{ color: "var(--af2-ink-2)" }}>“Drafting outreach to 38 enterprise leads…”</em>}
                  {a.status === "idle" && <span className="af2-muted">Idle · awaiting next mission</span>}
                  {a.status === "blocked" && <span style={{ color: "var(--af2-mustard)" }}>⚠ Blocked on Apollo credit top-up</span>}
                </div>
                <div className="af2-mono af2-muted" style={{ fontSize: 11.5 }}>{a.model}</div>
              </div>
            ))}
          </div>
        </section>

        <aside>
          <h3 className="af2-h3" style={{ marginBottom: 10 }}>Needs your stamp</h3>
          <div className="af2-card" style={{ padding: 0 }}>
            {D.tickets.slice(0,4).map((t, i) => {
              const a = D.agents.find(x => x.id === t.agent);
              const riskColor = t.risk === "high" ? "var(--af2-clay)" : t.risk === "medium" ? "var(--af2-mustard)" : "var(--af2-ink-3)";
              return (
                <div key={t.id} onClick={() => openModal && openModal("ticket", t)} style={{ padding: "14px 16px", borderBottom: i < 3 ? "1px solid var(--af2-line)" : 0, cursor: "pointer" }}>
                  <div className="af2-row">
                    <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>{t.id}</span>
                    <span className="af2-spacer"/>
                    <span className="af2-mono" style={{ fontSize: 11, color: riskColor }}>● {t.risk}</span>
                  </div>
                  <div style={{ fontSize: 13.5, marginTop: 4, lineHeight: 1.35 }}>{t.title}</div>
                  <div className="af2-row" style={{ marginTop: 10, gap: 8 }}>
                    <Av a={a} size="sm"/>
                    <span className="af2-muted" style={{ fontSize: 12 }}>{a.name.split(" ")[0]} · {t.cost}</span>
                    <span className="af2-spacer"/>
                    <button className="af2-btn af2-btn-sm">Open</button>
                    <button className="af2-btn af2-btn-sm af2-btn-primary">Approve</button>
                  </div>
                </div>
              );
            })}
          </div>

          <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>Spend by agent · this week</h3>
          <div className="af2-card">
            {D.agents.slice(0,5).map(a => (
              <div key={a.id} style={{ marginBottom: 12 }}>
                <div className="af2-row" style={{ fontSize: 12, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{a.name.split(" ")[0]}</span>
                  <span className="af2-muted" style={{ marginLeft: 6 }}>· {a.role}</span>
                  <span className="af2-spacer"/>
                  <span className="af2-mono">${a.spent} <span className="af2-muted-2">/ ${a.budget}</span></span>
                </div>
                <div style={{ height: 4, background: "var(--af2-paper-2)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${(a.spent / a.budget) * 100}%`, height: "100%", background: a.spent / a.budget > 0.8 ? "var(--af2-clay)" : "var(--af2-ink-2)" }}/>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
};

// MISSIONS ---------------------------------------------------
const AF2_Missions = ({ openModal }) => {
  const D = window.AF2_DATA;
  const Av = window.AF2_Avatar;
  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Missions</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Missions</h1>
          <div className="af2-page-head-meta">Briefs you give your team. Each becomes a plan, a budget, and a paper trail.</div>
        </div>
        <div className="af2-page-actions">
          <button className="af2-btn">Templates</button>
          <button className="af2-btn af2-btn-clay">＋ New mission</button>
        </div>
      </div>

      <div className="af2-tabs">
        {["In flight (6)", "Review (1)", "Scheduled (3)", "Done (47)", "All"].map((t, i) => (
          <button key={t} className={`af2-tab${i === 0 ? " active" : ""}`}>{t}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {D.missions.map(m => {
          const owner = D.agents.find(a => a.id === m.owner);
          return (
            <div key={m.id} className="af2-card" onClick={() => openModal && openModal("mission", m)} style={{ padding: 20, cursor: "pointer" }}>
              <div className="af2-row">
                <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>{m.id.toUpperCase()}</span>
                <span className="af2-spacer"/>
                <span className={`af2-pill ${m.state === "blocked" ? "af2-pill-clay" : m.state === "review" ? "af2-pill-pending" : "af2-pill-live"}`}><span className="af2-dot"/>{m.state}</span>
              </div>
              <div className="af2-h3" style={{ marginTop: 8, fontSize: 18 }}>{m.title}</div>
              <div className="af2-muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
                Success metric · {["+12% PR signups", "Zero downtime cutover", "p99 < 400ms", "30 demo bookings", "8 articles indexed", "Books closed by EOQ"][parseInt(m.id.slice(-1)) - 1] || "—"}
              </div>
              <div style={{ height: 6, background: "var(--af2-paper-2)", borderRadius: 4, marginTop: 14, overflow: "hidden" }}>
                <div style={{ width: `${m.progress * 100}%`, height: "100%", background: m.state === "blocked" ? "var(--af2-clay)" : "var(--af2-sage)" }}/>
              </div>
              <div className="af2-row" style={{ marginTop: 14 }}>
                <Av a={owner} size="sm"/>
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{owner.name}</span>
                <span className="af2-muted" style={{ fontSize: 12 }}>· {owner.role}</span>
                <span className="af2-spacer"/>
                <span className="af2-mono af2-muted" style={{ fontSize: 11.5 }}>{m.due}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// APPROVALS --------------------------------------------------
const AF2_Approvals = ({ openModal }) => {
  const D = window.AF2_DATA;
  const Av = window.AF2_Avatar;
  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Governance · Board</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Approvals</h1>
          <div className="af2-page-head-meta">Five tickets waiting · median wait 2m 18s · $1,201 in pending action.</div>
        </div>
        <div className="af2-page-actions">
          <button className="af2-btn">Policies</button>
          <button className="af2-btn">Audit log</button>
        </div>
      </div>

      <div className="af2-list">
        <div className="af2-list-head" style={{ gridTemplateColumns: "90px 1.4fr 130px 80px 100px 130px" }}>
          <div>Ticket</div><div>Request</div><div>Agent</div><div>Risk</div><div>Cost</div><div></div>
        </div>
        {D.tickets.map(t => {
          const a = D.agents.find(x => x.id === t.agent);
          const riskColor = t.risk === "high" ? "var(--af2-clay)" : t.risk === "medium" ? "var(--af2-mustard)" : "var(--af2-sage)";
          return (
            <div key={t.id} className="af2-list-row" onClick={() => openModal && openModal("ticket", t)} style={{ gridTemplateColumns: "90px 1.4fr 130px 80px 100px 130px" }}>
              <div className="af2-mono" style={{ fontSize: 11.5, color: "var(--af2-ink-3)" }}>{t.id}</div>
              <div style={{ fontSize: 13.5 }}>{t.title}</div>
              <div className="af2-row"><Av a={a} size="sm"/><span style={{ fontSize: 12.5 }}>{a.name.split(" ")[0]}</span></div>
              <div><span className="af2-mono" style={{ fontSize: 11.5, color: riskColor }}>● {t.risk}</span></div>
              <div className="af2-mono" style={{ fontSize: 12 }}>{t.cost}</div>
              <div className="af2-row" style={{ gap: 6, justifyContent: "flex-end" }}>
                <button className="af2-btn af2-btn-sm">Reject</button>
                <button className="af2-btn af2-btn-sm af2-btn-primary">Approve</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// TEAM (org chart) -------------------------------------------
const AF2_Team = ({ openModal }) => {
  const D = window.AF2_DATA;
  const Av = window.AF2_Avatar;
  // hierarchy: 1 mission/CEO row implicit; 3 leads (ag-1,2,3); each lead has hires
  const leads = D.agents.filter(a => ["ag-1","ag-2","ag-3"].includes(a.id));
  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Team</h1>
          <div className="af2-page-head-meta">Eight agents across three pods. Drag a card to re-org. Click a name to brief.</div>
        </div>
        <div className="af2-page-actions">
          <button className="af2-btn">Org map</button>
          <button className="af2-btn">List view</button>
          <button className="af2-btn af2-btn-primary">＋ Hire</button>
        </div>
      </div>

      {/* CEO */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
        <div className="af2-card" style={{ padding: 14, width: 240, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--af2-ink-3)", letterSpacing: ".1em", textTransform: "uppercase" }}>Mission</div>
          <div className="af2-serif" style={{ fontSize: 17, marginTop: 4 }}>Become the leader<br/>in industrial robotics</div>
        </div>
      </div>
      <svg width="100%" height="40" style={{ display: "block", marginBottom: 6 }}>
        <path d="M50% 0 V20 H16% V40 M50% 0 V20 H50% V40 M50% 0 V20 H84% V40" stroke="var(--af2-line-2)" strokeWidth="1" fill="none"/>
      </svg>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
        {leads.map(lead => (
          <div key={lead.id}>
            <div className="af2-card" onClick={() => openModal && openModal("agent", lead)} style={{ padding: 16, borderTop: `3px solid var(--af2-${lead.tone === "blue" ? "ink-blue" : lead.tone === "plum" ? "plum" : "clay"})`, cursor: "pointer" }}>
              <div className="af2-row" style={{ gap: 12 }}>
                <Av a={lead} size="lg"/>
                <div>
                  <div style={{ fontWeight: 600 }}>{lead.name}</div>
                  <div className="af2-muted" style={{ fontSize: 12 }}>{lead.role}</div>
                  <div className="af2-mono" style={{ fontSize: 11, color: "var(--af2-ink-3)", marginTop: 4 }}>{lead.model}</div>
                </div>
              </div>
              <div className="af2-row" style={{ marginTop: 12, gap: 14, fontSize: 12 }}>
                <div><strong>{lead.missions}</strong> <span className="af2-muted">missions</span></div>
                <div><strong>${lead.spent}</strong> <span className="af2-muted">/ ${lead.budget}</span></div>
              </div>
            </div>
            {/* reports */}
            <div style={{ marginTop: 10, marginLeft: 18, borderLeft: "1px dashed var(--af2-line-2)", paddingLeft: 14 }}>
              {(lead.hires || []).map(hid => {
                const h = D.agents.find(a => a.id === hid);
                if (!h) return null;
                return (
                  <div key={h.id} className="af2-card" onClick={(e) => { e.stopPropagation(); openModal && openModal("agent", h); }} style={{ padding: 10, marginTop: 8, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <Av a={h} size="sm"/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{h.name}</div>
                      <div className="af2-muted" style={{ fontSize: 11.5 }}>{h.role}</div>
                    </div>
                    <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>${h.spent}</span>
                  </div>
                );
              })}
              <button className="af2-btn af2-btn-ghost af2-btn-sm" style={{ marginTop: 8, width: "100%" }}>＋ Add report</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// HIRE (mission → plan) --------------------------------------
const AF2_Hire = () => {
  const Av = window.AF2_Avatar;
  return (
    <div className="af2-page" style={{ maxWidth: 920 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Hiring</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Hire from a mission.</h1>
          <div className="af2-page-head-meta">Tell AutoFlow what you need done. We&rsquo;ll draft an org, a budget, and the first week of work.</div>
        </div>
      </div>

      <div className="af2-card" style={{ padding: 22 }}>
        <div className="af2-eyebrow">Mission statement</div>
        <textarea
          className="af2-input"
          rows={3}
          defaultValue="Launch the Acme R-7 robotic arm to industrial buyers in North America by Q4. $250k budget. Must drive 200 qualified demos and 30 design wins."
          style={{ width: "100%", marginTop: 8, fontSize: 16, fontFamily: "var(--af2-serif)", lineHeight: 1.4, resize: "vertical" }}
        />
        <div className="af2-row" style={{ marginTop: 12 }}>
          <span className="af2-pill"><span className="af2-dot" style={{ background: "var(--af2-sage)" }}/>Readiness 0.86 · ready for plan</span>
          <span className="af2-spacer"/>
          <button className="af2-btn">Save draft</button>
          <button className="af2-btn af2-btn-clay">Generate hiring plan →</button>
        </div>
      </div>

      <h3 className="af2-h3" style={{ marginTop: 28, marginBottom: 10 }}>Suggested org</h3>
      <div className="af2-muted" style={{ fontSize: 12.5, marginBottom: 14 }}>Drafted from your mission. Tweak roles, models and budgets before you confirm.</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {[
          { name: "Maya Chen",  role: "Head of Growth",  tier: "Power · Opus", budget: 480, why: "Owns demand. Drafts campaigns, briefs SDRs, signs off content." },
          { name: "Devon Park", role: "Head of Product", tier: "Power · Opus", budget: 400, why: "Translates buyer feedback into the launch roadmap." },
          { name: "Iris Vega",  role: "Operations Lead", tier: "Standard · Sonnet", budget: 240, why: "Closes the books, manages vendors, owns approvals routing." },
        ].map((p, i) => (
          <div key={p.name} className="af2-card" style={{ padding: 16 }}>
            <div className="af2-row" style={{ gap: 10 }}>
              <div className={`af2-avatar af2-tone-${["clay","blue","plum"][i]}`} style={{ width: 38, height: 38 }}>{p.name.split(" ").map(n => n[0]).join("")}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div className="af2-muted" style={{ fontSize: 12 }}>{p.role}</div>
              </div>
            </div>
            <div className="af2-mono" style={{ fontSize: 11, marginTop: 10, color: "var(--af2-ink-3)" }}>{p.tier} · ${p.budget}/mo</div>
            <div style={{ fontSize: 12.5, marginTop: 8, color: "var(--af2-ink-2)", lineHeight: 1.45 }}>{p.why}</div>
            <div className="af2-row" style={{ marginTop: 12, gap: 6 }}>
              <button className="af2-btn af2-btn-sm">Edit</button>
              <button className="af2-btn af2-btn-sm">Skip</button>
              <span className="af2-spacer"/>
              <button className="af2-btn af2-btn-sm af2-btn-primary">Hire</button>
            </div>
          </div>
        ))}
      </div>

      <div className="af2-card" style={{ marginTop: 18, padding: 18, background: "var(--af2-paper-2)" }}>
        <div className="af2-row">
          <div>
            <div className="af2-eyebrow">Hiring plan summary</div>
            <div style={{ fontSize: 14, marginTop: 6 }}>3 leads · 5 reports · est. <strong>$1,580/mo</strong> · ready to ship in 14 minutes.</div>
          </div>
          <span className="af2-spacer"/>
          <button className="af2-btn">Customize</button>
          <button className="af2-btn af2-btn-clay">Confirm & onboard</button>
        </div>
      </div>
    </div>
  );
};

// INTEGRATIONS -----------------------------------------------
const AF2_Integrations = ({ openModal }) => {
  const D = window.AF2_DATA;
  const cats = [...new Set(D.integrations.map(i => i.cat))];
  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Connect</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Integrations</h1>
          <div className="af2-page-head-meta">Tools your agents can use. OAuth, App tokens, raw API — pick whatever your IT team prefers.</div>
        </div>
        <div className="af2-page-actions">
          <button className="af2-btn">Browse marketplace</button>
          <button className="af2-btn af2-btn-primary">＋ Custom MCP server</button>
        </div>
      </div>

      <div className="af2-cluster" style={{ marginBottom: 18 }}>
        <button className="af2-pill af2-pill-live"><span className="af2-dot"/>All ({D.integrations.length})</button>
        {cats.map(c => <button key={c} className="af2-pill">{c}</button>)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {D.integrations.map(it => (
          <div key={it.name} className="af2-card" onClick={() => openModal && openModal("integration", it)} style={{ padding: 16, cursor: "pointer" }}>
            <div className="af2-row">
              <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--af2-paper-2)", display: "grid", placeItems: "center" }}>
                {window.AF2_LOGOS[it.name] || <span className="af2-serif">{it.name[0]}</span>}
              </div>
              <span className="af2-spacer"/>
              {it.installed
                ? <span className="af2-pill af2-pill-live"><span className="af2-dot"/>connected</span>
                : <span className="af2-pill"><span className="af2-dot"/>available</span>}
            </div>
            <div style={{ fontWeight: 600, marginTop: 12 }}>{it.name}</div>
            <div className="af2-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{it.cat} · {it.auth}</div>
            <div style={{ fontSize: 12.5, color: "var(--af2-ink-2)", marginTop: 10, lineHeight: 1.45, minHeight: 36 }}>{it.desc}</div>
            <button className="af2-btn af2-btn-sm" style={{ marginTop: 12, width: "100%" }}>{it.installed ? "Manage" : "Connect"}</button>
          </div>
        ))}
      </div>
    </div>
  );
};

// MODELS -----------------------------------------------------
const AF2_Models = ({ openModal }) => {
  const D = window.AF2_DATA;
  const tier = D.tiers;
  return (
    <div className="af2-page" style={{ maxWidth: 1080 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Connect</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Models</h1>
          <div className="af2-page-head-meta">Bring your own keys. AutoFlow routes to the right tier so you never pay Opus for a Haiku job.</div>
        </div>
        <div className="af2-page-actions">
          <button className="af2-btn">Routing rules</button>
          <button className="af2-btn af2-btn-primary">＋ Add provider</button>
        </div>
      </div>

      <h3 className="af2-h3" style={{ marginBottom: 10 }}>Default routing</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 28 }}>
        {[
          { tier: "Lite", model: tier.lite, when: "Drafts, lookups, classification.", cost: "$0.005/1k tok" },
          { tier: "Standard", model: tier.standard, when: "Most agent work — research, writing, code review.", cost: "$0.03/1k tok" },
          { tier: "Power", model: tier.power, when: "Long reasoning, planning, multi-step research.", cost: "$0.15/1k tok" },
        ].map((t, i) => (
          <div key={t.tier} className="af2-card" style={{ padding: 18, borderTop: `3px solid var(--af2-${i === 0 ? "sage" : i === 1 ? "ink-blue" : "clay"})` }}>
            <div className="af2-eyebrow">{t.tier} tier</div>
            <div className="af2-h3" style={{ marginTop: 6 }}>{t.model}</div>
            <div style={{ fontSize: 12.5, color: "var(--af2-ink-2)", marginTop: 8 }}>{t.when}</div>
            <div className="af2-mono af2-muted" style={{ fontSize: 11.5, marginTop: 12 }}>{t.cost}</div>
            <button className="af2-btn af2-btn-sm" style={{ marginTop: 12, width: "100%" }}>Change default</button>
          </div>
        ))}
      </div>

      <h3 className="af2-h3" style={{ marginBottom: 10 }}>Providers</h3>
      <div className="af2-list">
        <div className="af2-list-head" style={{ gridTemplateColumns: "200px 1fr 100px 110px 130px" }}>
          <div>Vendor</div><div>Models available</div><div>BYOK</div><div>Status</div><div></div>
        </div>
        {D.llms.map(l => (
          <div key={l.vendor} className="af2-list-row" onClick={() => openModal && openModal("model", l)} style={{ gridTemplateColumns: "200px 1fr 100px 110px 130px" }}>
            <div className="af2-row">
              {window.AF2_LOGOS[l.vendor] || <span className="af2-mark">{l.vendor[0]}</span>}
              <strong style={{ fontSize: 13.5 }}>{l.vendor}</strong>
            </div>
            <div className="af2-cluster">
              {l.models.map(m => <span key={m} className="af2-pill af2-mono" style={{ fontSize: 11 }}>{m}</span>)}
            </div>
            <div className="af2-mono af2-muted" style={{ fontSize: 12 }}>{l.byok ? "yes" : "no"}</div>
            <div>
              {l.status === "primary"   && <span className="af2-pill af2-pill-live"><span className="af2-dot"/>primary</span>}
              {l.status === "secondary" && <span className="af2-pill af2-pill-pending"><span className="af2-dot"/>fallback</span>}
              {l.status === "off"       && <span className="af2-pill"><span className="af2-dot"/>off</span>}
            </div>
            <div style={{ textAlign: "right" }}><button className="af2-btn af2-btn-sm">Configure</button></div>
          </div>
        ))}
      </div>
    </div>
  );
};

Object.assign(window, { AF2_Home, AF2_Missions, AF2_Approvals, AF2_Team, AF2_Hire, AF2_Integrations, AF2_Models });
// AF2_Studio is now defined in studio.jsx
