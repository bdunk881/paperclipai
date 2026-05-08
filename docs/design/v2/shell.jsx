// Shared shell — topbar, sidebar, page wrapper.

const AF2_Mark = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" style={{ display: "block" }}>
    <rect width="32" height="32" rx="7" fill="var(--af2-ink)"/>
    <path d="M9 11.5a4.5 4.5 0 0 1 9 0v9a4.5 4.5 0 0 1-9 0M14 11.5a4.5 4.5 0 0 1 9 0v9" fill="none" stroke="var(--af2-paper)" strokeWidth="2.2" strokeLinecap="round"/>
  </svg>
);

const AF2_Wordmark = () => (
  <div className="af2-row" style={{ gap: 9 }}>
    <AF2_Mark size={26}/>
    <span style={{ fontFamily: "var(--af2-serif)", fontSize: 19, fontWeight: 500, letterSpacing: "-0.02em" }}>
      AutoFlow
    </span>
  </div>
);

const AF2_WorkspaceSwitch = ({ ws }) => (
  <div className="af2-wsswitch" title="Switch workspace">
    <div className={`af2-wsmark af2-tone-${ws.tone}`}>{ws.initials}</div>
    <div className="af2-wsmeta">
      <span className="af2-wsname">{ws.name}</span>
      <span className="af2-wsplan">{ws.plan}</span>
    </div>
    <svg className="af2-wschev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 10l5 5 5-5"/></svg>
  </div>
);

const AF2_Topbar = ({ ws }) => (
  <div className="af2-topbar">
    <AF2_WorkspaceSwitch ws={ws}/>
    <div className="af2-tb-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: "var(--af2-ink-4)" }}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input placeholder="Search agents, missions, tickets, runs…"/>
      <span className="af2-tb-search-kbd">⌘K</span>
    </div>
    <div className="af2-spacer"/>
    <button className="af2-btn af2-btn-sm">＋ New mission</button>
    <div className="af2-tb-icon" title="Inbox">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13l2-8h14l2 8M3 13v6h18v-6M3 13h6l1 2h4l1-2h6"/></svg>
    </div>
    <div className="af2-tb-icon" title="Help">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.7-2.5 2-2.5 4M12 17.5h.01"/></svg>
    </div>
    <div className="af2-tb-avatar">JD</div>
  </div>
);

const AF2_Sidebar = ({ active, onNav }) => {
  const nav = window.AF2_NAV;
  const Icon = window.AF2_ICON;
  return (
    <aside className="af2-sidebar">
      {nav.map((it, i) => {
        if (it.section) return <div key={"s" + i} className="af2-nav-section">{it.section}</div>;
        const a = it.id === active;
        return (
          <a key={it.id} className={`af2-nav-link${a ? " active" : ""}`} onClick={() => onNav && onNav(it.id)}>
            {Icon(it.icon)}
            <span>{it.label}</span>
            {it.badge && <span className={`af2-nav-badge${it.badgeClay ? " af2-nav-badge-clay" : ""}`}>{it.badge}</span>}
          </a>
        );
      })}
      <div className="af2-sidebar-foot">
        <div className="af2-budget-mini">
          <svg width="36" height="36" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="14" fill="none" stroke="var(--af2-line)" strokeWidth="3"/>
            <circle cx="18" cy="18" r="14" fill="none" stroke="var(--af2-clay)" strokeWidth="3" strokeLinecap="round"
                    strokeDasharray="88" strokeDashoffset="32" transform="rotate(-90 18 18)"/>
          </svg>
          <div className="af2-budget-mini-text">
            <strong>$1,207</strong> / $2,000<br/>
            <small>Workspace budget · Aug</small>
          </div>
        </div>
      </div>
    </aside>
  );
};

const AF2_Avatar = ({ a, size = "" }) => (
  <div className={`af2-avatar ${size} af2-tone-${a.tone}`} title={a.name}>
    {a.name.split(" ").map(n => n[0]).slice(0,2).join("")}
    {a.status && <span className={`af2-avatar-status ${a.status}`}/>}
  </div>
);

const AF2_App = ({ active, onNav, children }) => {
  const ws = window.AF2_DATA.workspaces[0];
  return (
    <div className="af2-app">
      <AF2_Topbar ws={ws}/>
      <AF2_Sidebar active={active} onNav={onNav}/>
      <main className="af2-main">{children}</main>
    </div>
  );
};

Object.assign(window, { AF2_Mark, AF2_Wordmark, AF2_Topbar, AF2_Sidebar, AF2_App, AF2_Avatar });
