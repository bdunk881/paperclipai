// Modals + drawers — agent profile, mission detail, ticket, integration connect, model config.

const AF2_ModalShell = ({ open, onClose, children, width = 720 }) => {
  if (!open) return null;
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,20,16,0.45)", zIndex: 200, display: "grid", placeItems: "center", padding: 32, animation: "af2-fade .12s ease-out" }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--af2-card)", color: "var(--af2-ink)",
        width: "100%", maxWidth: width, maxHeight: "calc(100vh - 64px)",
        borderRadius: 14, boxShadow: "var(--af2-shadow-lg)", overflow: "hidden",
        display: "flex", flexDirection: "column",
        animation: "af2-rise .14s ease-out",
      }}>{children}</div>
    </div>
  );
};

const AF2_ModalHead = ({ eyebrow, title, onClose, right }) => (
  <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--af2-line)", display: "flex", alignItems: "flex-start", gap: 14 }}>
    <div style={{ flex: 1 }}>
      {eyebrow && <div className="af2-eyebrow">{eyebrow}</div>}
      <div className="af2-h3" style={{ marginTop: 4 }}>{title}</div>
    </div>
    {right}
    <button onClick={onClose} className="af2-btn af2-btn-ghost af2-btn-sm" title="Close (Esc)" style={{ width: 28, height: 28, padding: 0, display: "grid", placeItems: "center" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
  </div>
);

const AF2_ModalBody = ({ children, padded = true }) => (
  <div style={{ padding: padded ? "22px 24px" : 0, overflowY: "auto", flex: 1 }}>{children}</div>
);

const AF2_ModalFoot = ({ children }) => (
  <div style={{ padding: "14px 20px", borderTop: "1px solid var(--af2-line)", background: "var(--af2-paper)", display: "flex", alignItems: "center", gap: 8 }}>{children}</div>
);

// AGENT PROFILE ----------------------------------------------
const AF2_AgentModal = ({ agent, onClose }) => {
  if (!agent) return null;
  const D = window.AF2_DATA;
  const Av = window.AF2_Avatar;
  return (
    <AF2_ModalShell open={!!agent} onClose={onClose} width={760}>
      <AF2_ModalHead eyebrow="Agent profile" title={agent.name} onClose={onClose}
        right={<span className={`af2-pill af2-pill-${agent.status === "working" ? "live" : agent.status === "blocked" ? "clay" : ""}`}><span className="af2-dot"/>{agent.status}</span>}
      />
      <AF2_ModalBody>
        <div className="af2-row" style={{ gap: 18, marginBottom: 22 }}>
          <Av a={agent} size="lg"/>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{agent.role}</div>
            <div className="af2-muted" style={{ fontSize: 13 }}>Joined Acme Robotics · 3 weeks ago</div>
            <div className="af2-mono" style={{ fontSize: 11.5, color: "var(--af2-ink-3)", marginTop: 4 }}>{agent.model}</div>
          </div>
          <span className="af2-spacer"/>
          <button className="af2-btn af2-btn-sm">Brief</button>
          <button className="af2-btn af2-btn-sm">Pause</button>
        </div>

        <div className="af2-tabs" style={{ marginBottom: 16 }}>
          <button className="af2-tab active">Overview</button>
          <button className="af2-tab">Activity</button>
          <button className="af2-tab">Tools</button>
          <button className="af2-tab">Settings</button>
        </div>

        <div className="af2-eyebrow">System prompt</div>
        <div className="af2-input af2-mono" style={{ fontSize: 11.5, padding: 12, marginTop: 6, lineHeight: 1.55, background: "var(--af2-paper-2)" }}>
          You are {agent.name}, the {agent.role} at Acme Robotics. Mission: launch the R-7 robotic arm to N. American industrial buyers by Q4. Drive {agent.role.includes("Growth") ? "200 demos and 30 design wins" : "engineering velocity"}. Defer to human approval for any spend over $500 or any production change.
        </div>

        <div className="af2-row" style={{ marginTop: 18, gap: 18, alignItems: "stretch" }}>
          <div style={{ flex: 1 }}>
            <div className="af2-eyebrow">Active missions ({agent.missions})</div>
            <div className="af2-card" style={{ marginTop: 6, padding: 0 }}>
              {D.missions.filter(m => m.owner === agent.id).map(m => (
                <div key={m.id} style={{ padding: "10px 14px", borderBottom: "1px solid var(--af2-line)", fontSize: 13 }}>
                  <div style={{ fontWeight: 500 }}>{m.title}</div>
                  <div className="af2-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{m.due} · {Math.round(m.progress * 100)}% complete</div>
                </div>
              ))}
              {D.missions.filter(m => m.owner === agent.id).length === 0 && <div className="af2-muted" style={{ padding: 14, fontSize: 13 }}>No assigned missions.</div>}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="af2-eyebrow">Budget · this month</div>
            <div className="af2-card" style={{ marginTop: 6, padding: 14 }}>
              <div style={{ fontFamily: "var(--af2-serif)", fontSize: 28 }}>${agent.spent}<span className="af2-muted-2" style={{ fontSize: 16 }}> / ${agent.budget}</span></div>
              <div style={{ height: 5, background: "var(--af2-paper-2)", borderRadius: 3, marginTop: 10, overflow: "hidden" }}>
                <div style={{ width: `${(agent.spent / agent.budget) * 100}%`, height: "100%", background: "var(--af2-clay)" }}/>
              </div>
              <div className="af2-muted" style={{ fontSize: 11.5, marginTop: 8 }}>Avg cost / run · $0.42 · 187 runs</div>
            </div>
          </div>
        </div>

        <div className="af2-eyebrow" style={{ marginTop: 18 }}>Granted tools</div>
        <div className="af2-cluster" style={{ marginTop: 6 }}>
          {["Slack","HubSpot","Apollo","Gmail","Notion"].slice(0, agent.role.includes("SDR") ? 5 : 3).map(n => (
            <span key={n} className="af2-pill" style={{ paddingLeft: 4 }}>
              <span style={{ display: "inline-flex", marginRight: 4 }}>{window.AF2_LOGOS[n]}</span>{n}
            </span>
          ))}
          <button className="af2-pill" style={{ cursor: "pointer" }}>＋ Add tool</button>
        </div>
      </AF2_ModalBody>
      <AF2_ModalFoot>
        <button className="af2-btn af2-btn-sm" style={{ color: "var(--af2-clay)" }}>Fire agent</button>
        <span className="af2-spacer"/>
        <button className="af2-btn af2-btn-sm" onClick={onClose}>Close</button>
        <button className="af2-btn af2-btn-sm af2-btn-primary">Save changes</button>
      </AF2_ModalFoot>
    </AF2_ModalShell>
  );
};

// MISSION DETAIL ---------------------------------------------
const AF2_MissionModal = ({ mission, onClose }) => {
  if (!mission) return null;
  const D = window.AF2_DATA;
  const owner = D.agents.find(a => a.id === mission.owner);
  const Av = window.AF2_Avatar;
  return (
    <AF2_ModalShell open={!!mission} onClose={onClose} width={820}>
      <AF2_ModalHead eyebrow={`Mission · ${mission.id.toUpperCase()}`} title={mission.title} onClose={onClose}
        right={<span className={`af2-pill ${mission.state === "blocked" ? "af2-pill-clay" : mission.state === "review" ? "af2-pill-pending" : "af2-pill-live"}`}><span className="af2-dot"/>{mission.state}</span>}
      />
      <AF2_ModalBody>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 24 }}>
          <div>
            <div className="af2-eyebrow">Brief</div>
            <p className="af2-serif" style={{ fontSize: 17, lineHeight: 1.45, marginTop: 6, color: "var(--af2-ink)" }}>
              {mission.title}. Target: industrial buyers in N. America. Success = qualified demos booked + design-win reports filed.
            </p>

            <div className="af2-eyebrow" style={{ marginTop: 18 }}>Plan · 6 steps</div>
            <ol style={{ paddingLeft: 0, listStyle: "none", margin: 0, marginTop: 8 }}>
              {[
                { t: "Identify top 200 ICPs from Apollo + LinkedIn", d: "done", a: "ag-5" },
                { t: "Personalize outreach in Maya's tone, 4 variants", d: "done", a: "ag-4" },
                { t: "Sequence via HubSpot, 3-touch", d: "running", a: "ag-5" },
                { t: "Book demo slots in Maya's calendar", d: "running", a: "ag-1" },
                { t: "Hand qualified leads to AE for follow-up", d: "queued", a: "ag-1" },
                { t: "File design-win reports in Notion", d: "queued", a: "ag-3" },
              ].map((s, i) => {
                const ag = D.agents.find(x => x.id === s.a);
                return (
                  <li key={i} style={{ display: "grid", gridTemplateColumns: "20px 1fr 110px", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--af2-line)", alignItems: "center" }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", background: s.d === "done" ? "var(--af2-sage)" : s.d === "running" ? "var(--af2-clay)" : "var(--af2-paper-3)", color: "white", display: "grid", placeItems: "center", fontSize: 10 }}>{s.d === "done" ? "✓" : s.d === "running" ? "·" : ""}</span>
                    <div>
                      <div style={{ fontSize: 13.5, color: s.d === "queued" ? "var(--af2-ink-3)" : "var(--af2-ink)" }}>{s.t}</div>
                    </div>
                    <div className="af2-row" style={{ gap: 6 }}>
                      <Av a={ag} size="sm"/>
                      <span className="af2-muted" style={{ fontSize: 11.5 }}>{ag.name.split(" ")[0]}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <aside>
            <div className="af2-eyebrow">Owner</div>
            <div className="af2-card" style={{ marginTop: 6, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <Av a={owner} size="sm"/>
              <div><div style={{ fontWeight: 600, fontSize: 13 }}>{owner.name}</div><div className="af2-muted" style={{ fontSize: 11.5 }}>{owner.role}</div></div>
            </div>
            <div className="af2-eyebrow" style={{ marginTop: 14 }}>Due</div>
            <div className="af2-mono" style={{ fontSize: 13, marginTop: 4, color: mission.due.includes("overdue") ? "var(--af2-clay)" : "var(--af2-ink)" }}>{mission.due}</div>
            <div className="af2-eyebrow" style={{ marginTop: 14 }}>Progress</div>
            <div style={{ fontFamily: "var(--af2-serif)", fontSize: 28, marginTop: 4 }}>{Math.round(mission.progress * 100)}%</div>
            <div className="af2-eyebrow" style={{ marginTop: 14 }}>Budget</div>
            <div style={{ fontFamily: "var(--af2-mono)", fontSize: 13, marginTop: 4 }}>$84 / $500</div>
            <div className="af2-eyebrow" style={{ marginTop: 14 }}>Approvals</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{mission.approvals > 0 ? `${mission.approvals} waiting` : "None pending"}</div>
          </aside>
        </div>
      </AF2_ModalBody>
      <AF2_ModalFoot>
        <button className="af2-btn af2-btn-sm">Pause</button>
        <button className="af2-btn af2-btn-sm">Reassign</button>
        <span className="af2-spacer"/>
        <button className="af2-btn af2-btn-sm" onClick={onClose}>Close</button>
      </AF2_ModalFoot>
    </AF2_ModalShell>
  );
};

// TICKET DETAIL ----------------------------------------------
const AF2_TicketModal = ({ ticket, onClose }) => {
  if (!ticket) return null;
  const D = window.AF2_DATA;
  const a = D.agents.find(x => x.id === ticket.agent);
  const Av = window.AF2_Avatar;
  return (
    <AF2_ModalShell open={!!ticket} onClose={onClose} width={680}>
      <AF2_ModalHead eyebrow={`Approval · ${ticket.id}`} title={ticket.title} onClose={onClose}/>
      <AF2_ModalBody>
        <div className="af2-row" style={{ gap: 14, marginBottom: 18 }}>
          <Av a={a} size="sm"/>
          <div><div style={{ fontWeight: 600, fontSize: 13 }}>{a.name}</div><div className="af2-muted" style={{ fontSize: 11.5 }}>{a.role}</div></div>
          <span className="af2-spacer"/>
          <span className="af2-mono" style={{ fontSize: 12, color: ticket.risk === "high" ? "var(--af2-clay)" : ticket.risk === "medium" ? "var(--af2-mustard)" : "var(--af2-sage)" }}>● {ticket.risk} risk</span>
        </div>

        <div className="af2-eyebrow">Why this needs your stamp</div>
        <p style={{ marginTop: 6, lineHeight: 1.55, fontSize: 13.5 }}>
          Policy <span className="af2-mono">acme/spend.high</span> flagged this action because it crosses the workspace cap of $500 single-spend. {a.name.split(" ")[0]} estimates this is necessary to hit mission milestones.
        </p>

        <div className="af2-eyebrow" style={{ marginTop: 16 }}>Proposed action</div>
        <div className="af2-card af2-mono" style={{ marginTop: 6, padding: 14, fontSize: 11.5, lineHeight: 1.55, background: "var(--af2-paper-2)", whiteSpace: "pre" }}>{`{
  "tool": "apollo.purchase_credits",
  "args": { "credits": 12000, "currency": "USD" },
  "estimated_cost": "${ticket.cost}",
  "tools_required": ["apollo.api"],
  "rollback": "credits expire unused"
}`}</div>

        <div className="af2-eyebrow" style={{ marginTop: 16 }}>Conversation</div>
        <div className="af2-card" style={{ marginTop: 6, padding: 0 }}>
          <div style={{ padding: 12, borderBottom: "1px solid var(--af2-line)", display: "flex", gap: 10 }}>
            <Av a={a} size="sm"/>
            <div><div className="af2-muted" style={{ fontSize: 11 }}>{a.name.split(" ")[0]} · 2m ago</div><div style={{ fontSize: 13, marginTop: 2 }}>I'm out of leads in NA-east. 12k credits unblocks the next two weeks. Cheaper than per-lookup at this volume.</div></div>
          </div>
        </div>
      </AF2_ModalBody>
      <AF2_ModalFoot>
        <button className="af2-btn af2-btn-sm">Reject</button>
        <button className="af2-btn af2-btn-sm">Ask a question</button>
        <span className="af2-spacer"/>
        <button className="af2-btn af2-btn-sm">Approve once</button>
        <button className="af2-btn af2-btn-sm af2-btn-primary">Approve & remember</button>
      </AF2_ModalFoot>
    </AF2_ModalShell>
  );
};

// INTEGRATION CONNECT ----------------------------------------
const AF2_IntegrationModal = ({ integration, onClose }) => {
  if (!integration) return null;
  return (
    <AF2_ModalShell open={!!integration} onClose={onClose} width={620}>
      <AF2_ModalHead eyebrow="Connect tool" title={integration.name} onClose={onClose}/>
      <AF2_ModalBody>
        <div className="af2-row" style={{ gap: 14, marginBottom: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: "var(--af2-paper-2)", display: "grid", placeItems: "center" }}>
            {window.AF2_LOGOS[integration.name]}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{integration.name}</div>
            <div className="af2-muted" style={{ fontSize: 12.5 }}>{integration.cat} · {integration.auth}</div>
          </div>
        </div>

        <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--af2-ink-2)" }}>{integration.desc}</p>

        <div className="af2-eyebrow" style={{ marginTop: 18 }}>Permissions agents will get</div>
        <ul style={{ paddingLeft: 0, listStyle: "none", margin: 0, marginTop: 8 }}>
          {[
            { t: "Read records", on: true },
            { t: "Create records", on: true },
            { t: "Update records", on: true },
            { t: "Delete records", on: false },
            { t: "Read user profile", on: true },
          ].map((p, i) => (
            <li key={i} style={{ padding: "9px 0", borderBottom: "1px solid var(--af2-line)", display: "flex", alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 13 }}>{p.t}</span>
              <span className="af2-pill" style={{ background: p.on ? "rgba(74,107,74,0.10)" : "rgba(26,20,16,0.04)", color: p.on ? "var(--af2-sage)" : "var(--af2-ink-4)" }}>{p.on ? "granted" : "off"}</span>
            </li>
          ))}
        </ul>

        <div className="af2-eyebrow" style={{ marginTop: 18 }}>Method</div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className={`af2-btn af2-btn-sm${integration.auth === "OAuth" ? " af2-btn-primary" : ""}`}>OAuth</button>
          <button className="af2-btn af2-btn-sm">API key</button>
          <button className="af2-btn af2-btn-sm">Self-host (MCP)</button>
        </div>
      </AF2_ModalBody>
      <AF2_ModalFoot>
        <span className="af2-muted" style={{ fontSize: 12 }}>You'll be redirected to {integration.name.toLowerCase()}.com</span>
        <span className="af2-spacer"/>
        <button className="af2-btn af2-btn-sm" onClick={onClose}>Cancel</button>
        <button className="af2-btn af2-btn-sm af2-btn-clay">Connect →</button>
      </AF2_ModalFoot>
    </AF2_ModalShell>
  );
};

// MODEL CONFIG -----------------------------------------------
const AF2_ModelModal = ({ vendor, onClose }) => {
  if (!vendor) return null;
  return (
    <AF2_ModalShell open={!!vendor} onClose={onClose} width={620}>
      <AF2_ModalHead eyebrow="Provider" title={vendor.vendor} onClose={onClose}/>
      <AF2_ModalBody>
        <div className="af2-eyebrow">API key</div>
        <div className="af2-row" style={{ marginTop: 6, gap: 8 }}>
          <input className="af2-input af2-mono" defaultValue="sk-ant-•••••••••••••••••••• 4f8a" style={{ flex: 1 }}/>
          <button className="af2-btn af2-btn-sm">Rotate</button>
        </div>
        <div className="af2-muted" style={{ fontSize: 11.5, marginTop: 6 }}>Stored in HSM. Never leaves the workspace boundary.</div>

        <div className="af2-eyebrow" style={{ marginTop: 16 }}>Models enabled</div>
        <div style={{ marginTop: 8 }}>
          {vendor.models.map(m => (
            <label key={m} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--af2-line)" }}>
              <input type="checkbox" defaultChecked/>
              <span className="af2-mono" style={{ fontSize: 12.5, flex: 1 }}>{m}</span>
              <span className="af2-muted" style={{ fontSize: 11 }}>{m.includes("opus") ? "$0.15/1k" : m.includes("sonnet") ? "$0.03/1k" : "$0.005/1k"}</span>
            </label>
          ))}
        </div>

        <div className="af2-eyebrow" style={{ marginTop: 16 }}>Rate limits</div>
        <div className="af2-row" style={{ gap: 8, marginTop: 6 }}>
          <input className="af2-input" defaultValue="800 RPM" style={{ flex: 1 }}/>
          <input className="af2-input" defaultValue="2M TPM" style={{ flex: 1 }}/>
        </div>

        <div className="af2-eyebrow" style={{ marginTop: 16 }}>Spend cap · monthly</div>
        <input className="af2-input af2-mono" defaultValue="$5,000" style={{ width: "100%", marginTop: 6 }}/>
      </AF2_ModalBody>
      <AF2_ModalFoot>
        <button className="af2-btn af2-btn-sm" style={{ color: "var(--af2-clay)" }}>Disable provider</button>
        <span className="af2-spacer"/>
        <button className="af2-btn af2-btn-sm" onClick={onClose}>Cancel</button>
        <button className="af2-btn af2-btn-sm af2-btn-primary">Save</button>
      </AF2_ModalFoot>
    </AF2_ModalShell>
  );
};

Object.assign(window, { AF2_AgentModal, AF2_MissionModal, AF2_TicketModal, AF2_IntegrationModal, AF2_ModelModal, AF2_ModalShell, AF2_ModalHead, AF2_ModalBody, AF2_ModalFoot });
