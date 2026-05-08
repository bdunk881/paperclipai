// MCP server detail.
const { useState: uSC } = React;

function MCPServerDetail() {
  const [tab, setTab] = uSC("tools");
  const tools = [
    { name: "github.openPullRequest", args: ["repo","title","branch","body"], scope: "write" },
    { name: "github.commentOnIssue",  args: ["issue","body"],                 scope: "write" },
    { name: "github.searchCode",      args: ["query","repo?"],                scope: "read"  },
    { name: "github.listIssues",      args: ["repo","state?","label?"],       scope: "read"  },
    { name: "github.getPullRequest",  args: ["repo","pr"],                    scope: "read"  },
    { name: "github.mergePull",       args: ["repo","pr","strategy?"],        scope: "write" },
    { name: "github.requestReview",   args: ["repo","pr","reviewers"],        scope: "write" },
    { name: "github.diffPull",        args: ["repo","pr"],                    scope: "read"  },
  ];
  const events = [
    { ts: "10:42:18.213", tool: "github.searchCode",      ms: 142, ok: true,  caller: "tpl-support-bot · run_8a3f2c" },
    { ts: "10:42:17.987", tool: "github.listIssues",      ms: 88,  ok: true,  caller: "tpl-support-bot · run_8a3f2c" },
    { ts: "10:41:51.044", tool: "github.commentOnIssue",  ms: 213, ok: true,  caller: "tpl-content-gen · run_de91a0" },
    { ts: "10:39:02.611", tool: "github.openPullRequest", ms: 412, ok: true,  caller: "manual · @bdunk881" },
    { ts: "10:38:14.302", tool: "github.diffPull",        ms: 67,  ok: false, caller: "tpl-support-bot · run_77b1ee" },
    { ts: "10:35:00.881", tool: "github.searchCode",      ms: 158, ok: true,  caller: "tpl-content-gen · run_440caa" },
  ];

  return (
    <div className="af-mcp">
      <header className="af-mcp-head">
        <div className="af-mcp-hero">
          <div className="af-mcp-logo">
            <img src="autoflow-brand/public/integrations/github.svg" alt="GitHub" />
          </div>
          <div>
            <div className="af-rh-eyebrow af-mono"><span className="af-mcp-dot" /> MCP SERVER · v1.4.2</div>
            <h1 className="af-mcp-title">github</h1>
            <div className="af-mcp-sub">Pull requests, issues, code search, and reviews. Backed by official GitHub REST + GraphQL.</div>
            <div className="af-mcp-pills">
              <span className="af-pill af-mono">spec://mcp/2024-11-05</span>
              <span className="af-pill af-mono">8 tools</span>
              <span className="af-pill af-mono">2 resources</span>
              <span className="af-pill af-mono">stdio · sse</span>
            </div>
          </div>
        </div>
        <div className="af-mcp-side">
          <button className="af-deploy-btn">Connect</button>
          <div className="af-mcp-conn">
            <div className="af-mcp-conn-row"><span className="af-mono af-fg-3">scope</span><span className="af-mono">repo, read:org</span></div>
            <div className="af-mcp-conn-row"><span className="af-mono af-fg-3">auth</span><span className="af-mono">github-app · 4 repos</span></div>
            <div className="af-mcp-conn-row"><span className="af-mono af-fg-3">latency</span><span className="af-mono">p50 86ms · p99 412ms</span></div>
            <div className="af-mcp-conn-row"><span className="af-mono af-fg-3">uptime 7d</span><span className="af-mono af-tealc">99.98%</span></div>
          </div>
        </div>
      </header>

      <div className="af-mcp-tabs">
        {["tools", "resources", "events", "config", "manifest"].map(x => (
          <button key={x} className={`af-tab ${tab === x ? "af-tab-active" : ""}`} onClick={() => setTab(x)}>{x}</button>
        ))}
      </div>

      <div className="af-mcp-body">
        {tab === "tools" && (
          <div className="af-mcp-tools">
            {tools.map(t => (
              <div key={t.name} className="af-mcp-tool">
                <div className="af-mcp-tool-head">
                  <span className={`af-mcp-tool-scope af-mcp-scope-${t.scope}`}>{t.scope}</span>
                  <span className="af-mcp-tool-name af-mono">{t.name}</span>
                  <span className="af-mcp-tool-spacer" />
                  <button className="af-ghost-btn">Try</button>
                </div>
                <div className="af-mcp-tool-args">
                  {t.args.map(a => <span key={a} className="af-pill af-mono">{a}</span>)}
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === "events" && (
          <div className="af-mcp-events">
            {events.map((e, i) => (
              <div key={i} className={`af-mcp-event ${e.ok ? "" : "af-mcp-event-fail"}`}>
                <span className="af-mono af-fg-3 af-mcp-event-ts">{e.ts}</span>
                <span className={`af-mcp-event-status ${e.ok ? "af-mcp-event-ok" : "af-mcp-event-err"}`}>{e.ok ? "200" : "ERR"}</span>
                <span className="af-mono af-mcp-event-tool">{e.tool}</span>
                <span className="af-mono af-fg-3 af-mcp-event-ms">{e.ms}ms</span>
                <span className="af-mono af-fg-3 af-mcp-event-caller">{e.caller}</span>
              </div>
            ))}
          </div>
        )}
        {tab === "resources" && (
          <div className="af-mcp-tools">
            <div className="af-mcp-tool"><div className="af-mcp-tool-head"><span className="af-mcp-tool-scope af-mcp-scope-read">resource</span><span className="af-mcp-tool-name af-mono">github://repos/{"{owner}"}/{"{repo}"}</span></div><div className="af-mcp-tool-args"><span className="af-pill af-mono">readme</span><span className="af-pill af-mono">stars</span><span className="af-pill af-mono">defaultBranch</span></div></div>
            <div className="af-mcp-tool"><div className="af-mcp-tool-head"><span className="af-mcp-tool-scope af-mcp-scope-read">resource</span><span className="af-mcp-tool-name af-mono">github://issues/{"{repo}"}/{"{number}"}</span></div><div className="af-mcp-tool-args"><span className="af-pill af-mono">title</span><span className="af-pill af-mono">body</span><span className="af-pill af-mono">labels</span><span className="af-pill af-mono">comments</span></div></div>
          </div>
        )}
        {tab === "config" && (
          <div className="af-fields" style={{maxWidth: 520}}>
            <label className="af-field"><span className="af-field-label">Server URL</span><input className="af-input af-mono" defaultValue="mcp+sse://gh.autoflow.com/v1" /></label>
            <label className="af-field"><span className="af-field-label">Auth method</span><div className="af-tier-picker"><button className="af-tier-btn af-tier-active af-tier-standard"><span className="af-tier-name">GitHub App</span><span className="af-tier-model af-mono">recommended</span></button><button className="af-tier-btn"><span className="af-tier-name">PAT</span><span className="af-tier-model af-mono">user-scoped</span></button><button className="af-tier-btn"><span className="af-tier-name">OAuth</span><span className="af-tier-model af-mono">oauth-2</span></button></div></label>
            <label className="af-field"><span className="af-field-label">Allowed tools</span><div className="af-pill-row">{tools.map(t => <span key={t.name} className="af-pill af-mono">{t.name.split(".")[1]}</span>)}</div></label>
          </div>
        )}
        {tab === "manifest" && (
          <pre className="af-code af-mono" style={{maxHeight:"none"}}>{JSON.stringify({
            name: "github", version: "1.4.2",
            spec: "mcp/2024-11-05",
            transport: ["stdio", "sse"],
            tools: tools.map(t => ({ name: t.name, scope: t.scope, args: t.args })),
            resources: ["github://repos/{owner}/{repo}", "github://issues/{repo}/{number}"],
            auth: { type: "github_app", scopes: ["repo", "read:org"] },
          }, null, 2)}</pre>
        )}
      </div>
    </div>
  );
}

window.AF_MCPDetail = MCPServerDetail;
