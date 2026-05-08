// Integration marketplace.
const { useState: uSM, useMemo: uMM } = React;

const AF_INTEGRATIONS = [
  { name: "Slack",       file: "slack",       cat: "Comms",      installed: true,  popular: true,  desc: "Post messages, trigger from threads, route alerts." },
  { name: "GitHub",      file: "github",      cat: "Dev",        installed: true,  popular: true,  desc: "Open PRs, comment on issues, react to webhook events." },
  { name: "Linear",      file: "linear",      cat: "Dev",        installed: false, popular: true,  desc: "Create issues, sync status, sprint reporting." },
  { name: "Notion",      file: "notion",      cat: "Docs",       installed: false, popular: true,  desc: "Create pages, append to databases, sync metadata." },
  { name: "Postgres",    file: "postgresql",  cat: "Data",       installed: true,  popular: false, desc: "Query, upsert rows, capture change events." },
  { name: "Stripe",      file: "stripe",      cat: "Billing",    installed: true,  popular: true,  desc: "Listen for payments, refunds, subscription events." },
  { name: "HubSpot",     file: "github",      cat: "CRM",        installed: false, popular: true,  desc: "Upsert contacts, deals, lifecycle stages." },
  { name: "Salesforce",  file: "github",      cat: "CRM",        installed: false, popular: false, desc: "Read & write standard + custom objects via Bulk API." },
  { name: "Zendesk",     file: "linear",      cat: "Support",    installed: false, popular: false, desc: "Ingest tickets, post replies, escalate to agents." },
  { name: "OpenAI",      file: "stripe",      cat: "LLM",        installed: true,  popular: true,  desc: "BYO key. Routed automatically by the tier classifier." },
  { name: "Anthropic",   file: "notion",      cat: "LLM",        installed: true,  popular: true,  desc: "BYO key. Default tier-routed provider." },
  { name: "Vertex AI",   file: "postgresql",  cat: "LLM",        installed: false, popular: false, desc: "Google models, region-pinned." },
  { name: "Bedrock",     file: "postgresql",  cat: "LLM",        installed: false, popular: false, desc: "AWS-hosted models, IAM-scoped." },
  { name: "Apollo",      file: "github",      cat: "Enrichment", installed: true,  popular: true,  desc: "Fetch company + person data for lead scoring." },
  { name: "Clearbit",    file: "linear",      cat: "Enrichment", installed: false, popular: false, desc: "Domain + person enrichment." },
  { name: "Twilio",      file: "stripe",      cat: "Comms",      installed: false, popular: false, desc: "SMS + voice triggers and actions." },
  { name: "SendGrid",    file: "stripe",      cat: "Comms",      installed: false, popular: false, desc: "Transactional email actions." },
  { name: "Webhook",     file: "github",      cat: "Triggers",   installed: true,  popular: true,  desc: "Generic HTTP entrypoint for any workflow." },
];

const CATS = ["All", "LLM", "CRM", "Comms", "Dev", "Data", "Docs", "Support", "Billing", "Enrichment", "Triggers"];

function IntegrationMarketplace() {
  const [cat, setCat] = uSM("All");
  const [q, setQ] = uSM("");
  const [hover, setHover] = uSM(null);

  const list = uMM(() => AF_INTEGRATIONS.filter(i =>
    (cat === "All" || i.cat === cat) &&
    (q === "" || i.name.toLowerCase().includes(q.toLowerCase()))
  ), [cat, q]);

  const installed = AF_INTEGRATIONS.filter(i => i.installed).length;

  return (
    <div className="af-mp">
      <header className="af-mp-hero">
        <div className="af-rh-eyebrow af-mono">INTEGRATIONS · MCP-NATIVE</div>
        <h1 className="af-mp-title">The MCP marketplace</h1>
        <p className="af-mp-sub">Every integration is a Model Context Protocol server. Drop a tile on the canvas and the agent gets the right tools, scoped per workflow.</p>
        <div className="af-mp-stats">
          <div><div className="af-mp-statv">{AF_INTEGRATIONS.length}</div><div className="af-mp-statl af-mono">INTEGRATIONS</div></div>
          <div><div className="af-mp-statv af-tealc">{installed}</div><div className="af-mp-statl af-mono">INSTALLED</div></div>
          <div><div className="af-mp-statv">100%</div><div className="af-mp-statl af-mono">MCP-COMPLIANT</div></div>
        </div>
      </header>

      <div className="af-mp-toolbar">
        <input className="af-input af-mp-search" placeholder="Search 18 integrations…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="af-mp-cats">
          {CATS.map(c => (
            <button key={c} className={`af-mp-cat ${cat === c ? "af-mp-cat-active" : ""}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>

      <div className="af-mp-section-head">
        <span className="af-mono">POPULAR</span><span className="af-rh-tab-n af-mono">{list.filter(i => i.popular).length}</span>
      </div>
      <div className="af-mp-grid">
        {list.filter(i => i.popular).map(i => (
          <IntegrationTile key={i.name} i={i} onHover={setHover} active={hover === i.name} />
        ))}
      </div>

      {list.filter(i => !i.popular).length > 0 && (
        <>
          <div className="af-mp-section-head"><span className="af-mono">ALL</span><span className="af-rh-tab-n af-mono">{list.filter(i => !i.popular).length}</span></div>
          <div className="af-mp-grid">
            {list.filter(i => !i.popular).map(i => (
              <IntegrationTile key={i.name} i={i} onHover={setHover} active={hover === i.name} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function IntegrationTile({ i, onHover, active }) {
  return (
    <div className={`af-mp-tile ${active ? "af-mp-tile-active" : ""} ${i.installed ? "af-mp-tile-installed" : ""}`}
         onMouseEnter={() => onHover(i.name)} onMouseLeave={() => onHover(null)}>
      <div className="af-mp-tile-head">
        <div className="af-mp-tile-logo">
          <img src={`autoflow-brand/public/integrations/${i.file}.svg`} alt={i.name} />
        </div>
        <span className="af-mp-tile-cat af-mono">{i.cat}</span>
        {i.installed && <span className="af-mp-tile-installed-pill af-mono"><span className="af-dot af-dot-done" />installed</span>}
      </div>
      <div className="af-mp-tile-name">{i.name}</div>
      <div className="af-mp-tile-desc">{i.desc}</div>
      <div className="af-mp-tile-foot">
        <span className="af-mcp-pill"><span className="af-mcp-dot" /><span className="af-mono">MCP</span></span>
        <button className={`af-mp-tile-btn ${i.installed ? "af-mp-tile-btn-ghost" : ""}`}>
          {i.installed ? "Configure" : "Install"}
        </button>
      </div>
    </div>
  );
}

window.AF_Marketplace = IntegrationMarketplace;
