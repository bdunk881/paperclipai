// Shared topnav for sub-pages.
function AFPageNav({ active }) {
  const links = [
    { id: "builder", label: "Builder", href: "AutoFlow Builder.html" },
    { id: "runs",    label: "Runs",    href: "AutoFlow Runs.html" },
    { id: "market",  label: "Integrations", href: "AutoFlow Marketplace.html" },
    { id: "mcp",     label: "MCP server",   href: "AutoFlow MCP.html" },
    { id: "landing", label: "Landing", href: "AutoFlow Landing.html" },
    { id: "hub",     label: "All views ›",  href: "AutoFlow.html" },
  ];
  return (
    <nav className="af-page-nav">
      <a href="AutoFlow.html" className="af-brand" style={{padding: 0, textDecoration: "none", color: "inherit"}}>
        <div className="af-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M4 12 L9 4 L14 12 L9 20 Z" fill="#818cf8"/>
            <path d="M10 12 L15 4 L20 12 L15 20 Z" fill="#2dd4bf" opacity=".85"/>
          </svg>
        </div>
        <div className="af-brand-text"><div className="af-brand-name">AutoFlow</div></div>
      </a>
      <div className="af-page-nav-links">
        {links.map(l => (
          <a key={l.id} href={l.href} className={active === l.id ? "af-page-nav-active" : ""}>{l.label}</a>
        ))}
      </div>
      <div className="af-page-nav-spacer" />
      <span className="af-mcp-pill"><span className="af-mcp-dot" /><span className="af-mono">workspace · helloautoflow</span></span>
    </nav>
  );
}
window.AFPageNav = AFPageNav;
