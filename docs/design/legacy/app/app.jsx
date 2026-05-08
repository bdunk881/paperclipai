// Root composition + tweaks + run simulation + prompt-to-flow.

const { useState: uS, useEffect: uE, useCallback: uCB, useMemo: uM, useRef: uR } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "comfy",
  "accent": "soft",
  "grid": "dots",
  "nodeStyle": "glass",
  "mood": "orchestrator",
  "templateId": "tpl-lead-enrich"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const { TEMPLATES, TIER_INFO } = window.AF_DATA;

  const [activeId, setActiveId] = uS(t.templateId);
  uE(() => { setActiveId(t.templateId); }, [t.templateId]);

  // Per-template node-position overrides + tier overrides
  const [nodeOverrides, setNodeOverrides] = uS({});
  const [tierOverrides, setTierOverrides] = uS({});

  const baseTemplate = TEMPLATES.find(x => x.id === activeId) || TEMPLATES[0];
  const template = uM(() => {
    const ov = nodeOverrides[activeId] || {};
    const to = tierOverrides[activeId] || {};
    return {
      ...baseTemplate,
      nodes: baseTemplate.nodes.map(n => ({
        ...n,
        ...(ov[n.id] || {}),
        ...(to[n.id] ? { tier: to[n.id] } : {}),
      })),
    };
  }, [baseTemplate, activeId, nodeOverrides, tierOverrides]);

  const [selectedId, setSelectedId] = uS(null);
  const [configValues, setConfigValues] = uS({});

  // Run simulation
  const [runStates, setRunStates] = uS({});
  const [costLog, setCostLog] = uS([]);
  const [runActiveEdge, setRunActiveEdge] = uS(null);
  const [isRunning, setIsRunning] = uS(false);
  const [lastRun, setLastRun] = uS(null);

  // Prompt-to-flow draft nodes
  const [draftNodes, setDraftNodes] = uS(null);

  uE(() => {
    setSelectedId(null);
    setRunStates({});
    setCostLog([]);
    setRunActiveEdge(null);
  }, [activeId]);

  const onNodeMove = uCB((id, x, y) => {
    setNodeOverrides(o => ({ ...o, [activeId]: { ...(o[activeId] || {}), [id]: { x, y } } }));
  }, [activeId]);

  const onTierChange = uCB((id, tier) => {
    setTierOverrides(o => ({ ...o, [activeId]: { ...(o[activeId] || {}), [id]: tier } }));
  }, [activeId]);

  const runSample = uCB(() => {
    if (isRunning) return;
    setIsRunning(true);
    setRunStates({});
    setCostLog([]);
    const start = Date.now();
    const nodes = template.nodes;
    const edges = template.edges;
    let i = 0;
    const tick = () => {
      if (i >= nodes.length) {
        setIsRunning(false);
        setRunActiveEdge(null);
        setLastRun({ duration: ((Date.now() - start) / 1000).toFixed(2) + "s" });
        return;
      }
      const n = nodes[i];
      setRunStates(s => ({ ...s, [n.id]: "running" }));
      setRunActiveEdge(null);
      setTimeout(() => {
        setRunStates(s => ({ ...s, [n.id]: "done" }));
        if (n.kind === "llm") {
          const tier = n.tier || "standard";
          const info = TIER_INFO[tier];
          const promptTokens = 180 + Math.floor(Math.random() * 120);
          const completionTokens = 40 + Math.floor(Math.random() * 80);
          const cost = (info.inCost * promptTokens + info.outCost * completionTokens) / 1000;
          setCostLog(c => [...c, {
            stepId: n.id, modelTier: tier, modelId: info.model,
            promptTokens, completionTokens, estimatedCostUsd: cost,
          }]);
        }
        // animate edge to next
        const next = nodes[i + 1];
        if (next) {
          const edge = edges.find(([f, to]) => f === n.id && to === next.id) ||
                       edges.find(([f]) => f === n.id);
          if (edge) setRunActiveEdge(`${edge[0]}->${edge[1]}`);
        }
        i += 1;
        setTimeout(tick, 320);
      }, n.kind === "llm" ? 700 + Math.random() * 400 : 280 + Math.random() * 220);
    };
    tick();
  }, [isRunning, template, TIER_INFO]);

  const clearRun = () => {
    setRunStates({}); setCostLog([]); setRunActiveEdge(null); setLastRun(null);
  };

  const onPromptToFlow = (text, done) => {
    // Materialize a fake graph in the canvas for ~1.6s
    const nodes = [
      { kind: "trigger",   name: "Stripe payment.failed", x: 80,  y: 220 },
      { kind: "llm",       name: "Diagnose Failure",      x: 340, y: 220 },
      { kind: "llm",       name: "Draft Recovery Email",  x: 600, y: 140 },
      { kind: "action",    name: "Post to Slack",         x: 600, y: 320 },
      { kind: "output",    name: "Emit Event",            x: 880, y: 220 },
    ];
    setDraftNodes([]);
    let k = 0;
    const reveal = () => {
      if (k >= nodes.length) { setTimeout(() => { setDraftNodes(null); done(); }, 700); return; }
      setDraftNodes(d => [...(d || []), nodes[k]]);
      k += 1;
      setTimeout(reveal, 220);
    };
    reveal();
  };

  const selectedNode = selectedId ? template.nodes.find(n => n.id === selectedId) : null;

  return (
    <div className={`af-shell af-density-${t.density}`} data-theme={t.theme}>
      <header className="af-topbar">
        <div className="af-crumbs">
          <span>Workspace</span>
          <span className="af-sep">›</span>
          <span>Workflows</span>
          <span className="af-sep">›</span>
          <em>{template.name}</em>
        </div>
        <span className="af-topbar-pill">
          <span className="af-pulse-dot" /> Live · prod-us-east
        </span>
        <span className="af-topbar-pill af-mono">staging-first ✓</span>
        <div className="af-topbar-spacer" />
        <button className="af-ghost-btn">Export JSON</button>
        <button className="af-ghost-btn">Logs</button>
        <button className="af-deploy-btn">Deploy</button>
      </header>

      <window.AF_Sidebar
        templates={TEMPLATES}
        activeId={activeId}
        onSelect={(id) => { setActiveId(id); setTweak("templateId", id); }}
        onPromptToFlow={onPromptToFlow}
      />

      <window.AF_Canvas
        template={template}
        selectedId={selectedId}
        onSelect={setSelectedId}
        runStates={runStates}
        runActiveEdgeKey={runActiveEdge}
        gridStyle={t.grid}
        nodeStyle={t.nodeStyle}
        accentIntensity={t.accent}
        density={t.density}
        onNodeMove={onNodeMove}
        draftNodes={draftNodes}
        mood={t.mood}
      />

      <window.AF_Inspector
        template={template}
        selectedNode={selectedNode}
        configValues={configValues}
        onConfigChange={(k, v) => setConfigValues(c => ({ ...c, [k]: v }))}
        onTierChange={onTierChange}
      />

      <window.AF_Runtime
        template={template}
        runStates={runStates}
        costLog={costLog}
        isRunning={isRunning}
        onRun={runSample}
        onClear={clearRun}
        lastRun={lastRun}
        mood={t.mood}
      />

      <TweaksPanel>
        <TweakSection label="Theme & Mood" />
        <TweakRadio label="Theme" value={t.theme}
          options={["dark","light"]} onChange={(v) => setTweak("theme", v)} />
        <TweakSelect label="Mood variant" value={t.mood}
          options={[
            {value:"orchestrator", label:"Orchestrator — neon traces"},
            {value:"assistant",    label:"Assistant — soft glows"},
            {value:"infrastructure",label:"Infrastructure — terminal grid"},
          ]}
          onChange={(v) => setTweak("mood", v)} />
        <TweakRadio label="Accent intensity" value={t.accent}
          options={["soft","neon"]} onChange={(v) => setTweak("accent", v)} />

        <TweakSection label="Canvas" />
        <TweakRadio label="Grid" value={t.grid}
          options={["dots","lines","clean"]} onChange={(v) => setTweak("grid", v)} />
        <TweakRadio label="Node style" value={t.nodeStyle}
          options={["glass","solid","wire"]} onChange={(v) => setTweak("nodeStyle", v)} />
        <TweakRadio label="Density" value={t.density}
          options={["compact","comfy"]} onChange={(v) => setTweak("density", v)} />

        <TweakSection label="Active template" />
        <TweakSelect label="Workflow" value={t.templateId}
          options={TEMPLATES.map(x => ({ value: x.id, label: `${x.name} · ${x.category}` }))}
          onChange={(v) => setTweak("templateId", v)} />

        <TweakSection label="Demo" />
        <TweakButton label="Run sample workflow" onClick={runSample} />
        <TweakButton label="Try prompt-to-flow" onClick={() => {
          const ta = document.querySelector(".af-prompt-input textarea");
          if (ta) {
            ta.focus();
            ta.value = "When a Stripe payment fails, draft a recovery email and post to Slack";
            ta.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
