// Marketing landing variant.
const { useState: uSL, useEffect: uEL } = React;

function Landing() {
  const [intent, setIntent] = uSL("");
  const [demo, setDemo] = uSL(0);
  uEL(() => {
    const id = setInterval(() => setDemo(d => (d + 1) % 5), 900);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="af-lp">
      {/* nav */}
      <nav className="af-lp-nav">
        <div className="af-brand" style={{padding: 0}}>
          <div className="af-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M4 12 L9 4 L14 12 L9 20 Z" fill="#818cf8"/>
              <path d="M10 12 L15 4 L20 12 L15 20 Z" fill="#2dd4bf" opacity=".85"/>
            </svg>
          </div>
          <div className="af-brand-text"><div className="af-brand-name">AutoFlow</div></div>
        </div>
        <div className="af-lp-nav-links">
          <a>Templates</a><a>Integrations</a><a>Docs</a><a>Pricing</a><a>Changelog</a>
        </div>
        <div className="af-lp-nav-actions">
          <a className="af-mono af-fg-2">Sign in</a>
          <button className="af-deploy-btn">Start free</button>
        </div>
      </nav>

      {/* hero */}
      <section className="af-lp-hero">
        <div className="af-lp-hero-grid" />
        <div className="af-lp-hero-glow" />

        <div className="af-lp-hero-eyebrow">
          <span className="af-mcp-pill"><span className="af-mcp-dot" /><span className="af-mono">MCP-NATIVE</span></span>
          <span className="af-mono af-fg-3">v0.1 · open source · MIT</span>
        </div>

        <h1 className="af-lp-h1">
          Hire AI.<br/>
          <span className="af-lp-h1-grad">Deploy fast.</span> Earn more.
        </h1>
        <p className="af-lp-sub">
          AutoFlow is the intelligent nervous system for your business. Spin up autonomous AI workflows in minutes — agents, templates, and revenue infrastructure, all routed automatically across the cheapest LLM that can do the job.
        </p>

        {/* prompt bar */}
        <div className="af-lp-prompt">
          <span className="af-spark" />
          <input
            placeholder="Describe a workflow… 'When a Stripe payment fails, draft a recovery email and post to Slack'"
            value={intent}
            onChange={e => setIntent(e.target.value)}
          />
          <button className="af-deploy-btn">Generate flow →</button>
        </div>
        <div className="af-lp-hero-meta af-mono">
          <span>⌘K to focus</span><span>·</span><span>No credit card</span><span>·</span><span>BYOLLM (Anthropic, OpenAI, Bedrock, Vertex)</span>
        </div>

        {/* faux canvas preview */}
        <div className="af-lp-canvas">
          <div className="af-lp-canvas-chrome af-mono">
            <span className="af-lp-tab af-lp-tab-active">canvas.tsx</span>
            <span className="af-lp-tab">run · live</span>
            <span className="af-lp-canvas-spacer" />
            <span className="af-lp-canvas-pill"><span className="af-pulse-dot" />running</span>
          </div>
          <div className="af-lp-canvas-stage">
            {[
              { kind:"trigger", name:"Stripe · payment.failed", x: 40,  y: 60, glyph:"⚡", tone:"orange" },
              { kind:"llm",     name:"Diagnose Cause",          x: 240, y: 60, glyph:"✦", tone:"teal", tier:"lite" },
              { kind:"llm",     name:"Draft Recovery Email",    x: 440, y: 20, glyph:"✦", tone:"teal", tier:"standard" },
              { kind:"action",  name:"Post to #payments",       x: 440, y: 120, glyph:"◆", tone:"indigo" },
              { kind:"output",  name:"Emit event",              x: 660, y: 70, glyph:"→", tone:"indigo" },
            ].map((n, i) => (
              <div key={i}
                className={`af-node af-tone-${n.tone} af-node-glass ${demo === i ? "af-state-running" : demo > i ? "af-state-done" : ""}`}
                style={{ left: n.x, top: n.y, width: 180, position: "absolute" }}>
                <div className="af-node-head">
                  <span className="af-node-glyph">{n.glyph}</span>
                  <span className="af-node-kind">{n.kind}</span>
                  {n.tier && <span className={`af-tier af-tier-${n.tier}`}>{n.tier}</span>}
                </div>
                <div className="af-node-name">{n.name}</div>
              </div>
            ))}
            <svg className="af-lp-canvas-edges" width="900" height="220">
              {[[220,80,240,80],[420,80,440,40],[420,80,440,140],[620,40,660,80],[620,140,660,80]].map(([x1,y1,x2,y2],i)=>(
                <path key={i} d={`M ${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}`} stroke="rgba(99,102,241,0.45)" strokeWidth="1.6" fill="none" />
              ))}
            </svg>
          </div>
        </div>
      </section>

      {/* logos */}
      <section className="af-lp-logos">
        <div className="af-mono af-fg-3">TRUSTED BY TEAMS BUILDING ON</div>
        <div className="af-lp-logos-row">
          {["github","slack","linear","notion","postgresql","stripe"].map(f => (
            <div key={f} className="af-lp-logo"><img src={`autoflow-brand/public/integrations/${f}.svg`} alt={f}/></div>
          ))}
        </div>
      </section>

      {/* features */}
      <section className="af-lp-section">
        <div className="af-lp-eyebrow af-mono">CORE PRIMITIVES</div>
        <h2 className="af-lp-h2">Three built-in templates. <span className="af-fg-3">Or build your own from scratch.</span></h2>
        <div className="af-lp-grid">
          {[
            {cat:"Sales",   color:"indigo", name:"Lead Enrichment",     blurb:"Score, enrich, and route inbound leads to your CRM.",                metric:"4,218 runs/wk", model:"sonnet"},
            {cat:"Content", color:"teal",   name:"Content Generator",   blurb:"Brief in, brand-voiced draft + SEO meta out, ready to publish.",     metric:"1,840 runs/wk", model:"sonnet"},
            {cat:"Support", color:"orange", name:"Customer Support Bot",blurb:"Classify tickets, auto-respond to common ones, escalate the rest.",  metric:"9,320 runs/wk", model:"haiku"},
          ].map(t => (
            <div key={t.name} className={`af-lp-card af-lp-card-${t.color}`}>
              <span className={`af-tpl-cat af-tpl-cat-${t.color}`}>{t.cat}</span>
              <div className="af-lp-card-name">{t.name}</div>
              <p className="af-lp-card-blurb">{t.blurb}</p>
              <div className="af-lp-card-meta">
                <span className="af-mono af-fg-3">{t.metric}</span>
                <span className={`af-tier af-tier-${t.model === "haiku" ? "lite" : "standard"}`}>auto · {t.model}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* tier routing */}
      <section className="af-lp-section af-lp-section-dark">
        <div className="af-lp-split">
          <div>
            <div className="af-lp-eyebrow af-mono">TIER ROUTING</div>
            <h2 className="af-lp-h2">Save <span className="af-tealc">42%</span> on inference.<br/>Without thinking about it.</h2>
            <p className="af-lp-p">Every LLM step is automatically routed to the cheapest model that can handle its complexity. Classification goes to lite, generation to standard, orchestration to power. Override any step in one line.</p>
            <div className="af-lp-tiers">
              {[
                {tier:"lite",     pct:"45%", model:"haiku-4-5",  use:"classify · extract · yes/no"},
                {tier:"standard", pct:"38%", model:"sonnet-4-5", use:"draft · plan · transform"},
                {tier:"power",    pct:"17%", model:"opus-4-5",   use:"orchestrate · long-context"},
              ].map(t => (
                <div key={t.tier} className="af-lp-tier-row">
                  <span className={`af-tier af-tier-${t.tier}`}>{t.tier}</span>
                  <span className="af-mono af-fg-3 af-lp-tier-model">{t.model}</span>
                  <div className="af-cost-bar-track" style={{flex:1}}>
                    <div className={`af-cost-bar-fill af-tier-${t.tier}`} style={{width: t.pct}}>
                      <span className="af-mono">{t.pct}</span>
                    </div>
                  </div>
                  <span className="af-mono af-fg-3 af-lp-tier-use">{t.use}</span>
                </div>
              ))}
            </div>
          </div>
          <pre className="af-code af-mono af-lp-code">{`{
  "stepId": "step_classify",
  "costLog": {
    "modelTier": "lite",
    "modelId": "claude-haiku-4-5",
    "promptTokens": 210,
    "completionTokens": 55,
    "estimatedCostUsd": 0.0000921
  }
}`}</pre>
        </div>
      </section>

      {/* MCP section */}
      <section className="af-lp-section">
        <div className="af-lp-eyebrow af-mono">MCP-NATIVE</div>
        <h2 className="af-lp-h2">Every integration is a Model Context Protocol server.</h2>
        <p className="af-lp-p" style={{maxWidth: 720}}>The same tile your agent uses on the canvas exposes the same MCP spec your other agents already speak. No bespoke connectors. No glue code.</p>
        <div className="af-lp-mcp-row">
          {[
            { name:"GitHub",   file:"github" },{ name:"Slack",     file:"slack" },
            { name:"Linear",   file:"linear" },{ name:"Notion",    file:"notion" },
            { name:"Postgres", file:"postgresql"},{name:"Stripe",  file:"stripe" },
          ].map(c => (
            <div key={c.name} className="af-lp-mcp-tile">
              <div className="af-conn-tile" style={{width:40,height:40}}><img src={`autoflow-brand/public/integrations/${c.file}.svg`}/></div>
              <div className="af-lp-mcp-name">{c.name}</div>
              <span className="af-mono af-fg-4">mcp/2024-11-05</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="af-lp-cta">
        <h2 className="af-lp-h2" style={{textAlign:"center"}}>Hire AI. Deploy this afternoon.</h2>
        <div className="af-lp-cta-actions">
          <button className="af-deploy-btn" style={{padding:"12px 22px", fontSize:14}}>Start free</button>
          <button className="af-ghost-btn" style={{padding:"12px 22px", fontSize:13}}>Read the docs →</button>
        </div>
        <div className="af-mono af-fg-3" style={{marginTop:14}}>npm i autoflow · curl get.helloautoflow.com | sh</div>
      </section>

      <footer className="af-lp-foot af-mono af-fg-4">
        <span>© 2026 AutoFlow</span><span>·</span><span>MIT</span><span>·</span><span>helloautoflow.com</span>
      </footer>
    </div>
  );
}

window.AF_Landing = Landing;
