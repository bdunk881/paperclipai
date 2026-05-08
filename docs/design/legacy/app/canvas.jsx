// Workflow canvas — pan/zoom, dotted grid, draggable nodes, animated edges.

const { useState, useRef, useEffect, useCallback, useMemo } = React;

function toneClass(tone) {
  return {
    indigo: "af-tone-indigo",
    teal:   "af-tone-teal",
    orange: "af-tone-orange",
  }[tone] || "af-tone-indigo";
}

function NodeCard({ node, kind, selected, runState, nodeStyle, density, onMouseDown, onClick }) {
  const tone = toneClass(kind.tone);
  const styleCls = `af-node-${nodeStyle}`;
  const stateCls = runState ? `af-state-${runState}` : "";
  const compact = density === "compact";
  return (
    <div
      className={`af-node ${tone} ${styleCls} ${selected ? "af-selected" : ""} ${stateCls}`}
      style={{
        left: node.x,
        top: node.y,
        width: compact ? 200 : 224,
        padding: compact ? "10px 12px" : "12px 14px",
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      <div className="af-node-head">
        <span className="af-node-glyph">{kind.glyph}</span>
        <span className="af-node-kind">{kind.label}</span>
        {node.tier && <span className={`af-tier af-tier-${node.tier}`}>{node.tier}</span>}
        <span className="af-node-spacer" />
        <span className={`af-dot af-dot-${runState || "idle"}`} />
      </div>
      <div className="af-node-name">{node.name}</div>
      {node.action && <div className="af-node-meta af-mono">{node.action}</div>}
      {node.condition && <div className="af-node-meta af-mono">if {node.condition}</div>}
      {node.outputKeys && (
        <div className="af-node-pills">
          {node.outputKeys.slice(0, 3).map((k) => (
            <span key={k} className="af-pill af-mono">{k}</span>
          ))}
          {node.outputKeys.length > 3 && <span className="af-pill af-mono">+{node.outputKeys.length - 3}</span>}
        </div>
      )}
      {/* connection ports */}
      <span className="af-port af-port-in" />
      <span className="af-port af-port-out" />
    </div>
  );
}

function edgePath(a, b) {
  const x1 = a.x + 224, y1 = a.y + 38;
  const x2 = b.x,        y2 = b.y + 38;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

function Canvas({
  template, selectedId, onSelect, runStates, runActiveEdgeKey,
  gridStyle, nodeStyle, accentIntensity, density, onNodeMove,
  draftNodes, mood,
}) {
  const wrapRef = useRef(null);
  const [zoom, setZoom] = useState(0.78);
  const [pan, setPan] = useState({ x: 60, y: 20 });
  const dragRef = useRef(null);
  const panRef = useRef(null);

  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const next = Math.min(1.4, Math.max(0.4, zoom * (e.deltaY < 0 ? 1.08 : 0.93)));
    setZoom(next);
  };

  const startPan = (e) => {
    if (e.target !== wrapRef.current && !e.target.classList.contains("af-canvas-bg")) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
    document.body.style.cursor = "grabbing";
  };
  useEffect(() => {
    const move = (e) => {
      if (panRef.current) {
        setPan({ x: panRef.current.ox + (e.clientX - panRef.current.sx),
                 y: panRef.current.oy + (e.clientY - panRef.current.sy) });
      }
      if (dragRef.current) {
        const { id, sx, sy, ox, oy } = dragRef.current;
        const nx = ox + (e.clientX - sx) / zoom;
        const ny = oy + (e.clientY - sy) / zoom;
        onNodeMove(id, nx, ny);
      }
    };
    const up = () => {
      panRef.current = null;
      dragRef.current = null;
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [zoom, onNodeMove]);

  const startNodeDrag = (node) => (e) => {
    e.stopPropagation();
    dragRef.current = { id: node.id, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y };
  };

  const nodes = template.nodes;
  const nodeMap = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);
  const KINDS = window.AF_DATA.NODE_KINDS;

  const fitView = () => {
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
    const minX = Math.min(...xs) - 40;
    const minY = Math.min(...ys) - 40;
    const maxX = Math.max(...xs) + 240;
    const maxY = Math.max(...ys) + 140;
    const w = wrapRef.current?.clientWidth || 1200;
    const h = wrapRef.current?.clientHeight || 700;
    const z = Math.min(w / (maxX - minX), h / (maxY - minY), 1);
    setZoom(z);
    setPan({ x: -minX * z + 24, y: -minY * z + 24 });
  };

  return (
    <div
      className={`af-canvas af-grid-${gridStyle} af-mood-${mood} af-accent-${accentIntensity}`}
      ref={wrapRef}
      onWheel={onWheel}
      onMouseDown={startPan}
    >
      <div className="af-canvas-bg" />
      <div className="af-canvas-vignette" />

      <div
        className="af-canvas-stage"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        {/* edges */}
        <svg className="af-edges" width="2400" height="1400">
          <defs>
            <marker id="af-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="currentColor" />
            </marker>
            <filter id="af-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {template.edges.map(([from, to, label], i) => {
            const a = nodeMap[from], b = nodeMap[to];
            if (!a || !b) return null;
            const key = `${from}->${to}`;
            const active = runActiveEdgeKey === key;
            const fromState = runStates[from];
            const completed = fromState === "done";
            return (
              <g key={i} className={`af-edge ${active ? "af-edge-active" : ""} ${completed ? "af-edge-completed" : ""}`}>
                <path d={edgePath(a, b)} className="af-edge-path" markerEnd="url(#af-arrow)" />
                {active && <path d={edgePath(a, b)} className="af-edge-flow" />}
                {label && (
                  <foreignObject x={(a.x + b.x) / 2 + 80} y={(a.y + b.y) / 2 + 14} width="120" height="28">
                    <div className="af-edge-label af-mono">{label}</div>
                  </foreignObject>
                )}
              </g>
            );
          })}
        </svg>

        {/* nodes */}
        {nodes.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            kind={KINDS[n.kind]}
            selected={selectedId === n.id}
            runState={runStates[n.id]}
            nodeStyle={nodeStyle}
            density={density}
            onMouseDown={startNodeDrag(n)}
            onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
          />
        ))}

        {/* draft nodes (prompt-to-flow materializing) */}
        {draftNodes && draftNodes.map((n, i) => (
          <div
            key={`d-${i}`}
            className="af-node af-node-draft"
            style={{ left: n.x, top: n.y, width: 220, animationDelay: `${i * 90}ms` }}
          >
            <div className="af-node-head">
              <span className="af-node-glyph">{KINDS[n.kind]?.glyph}</span>
              <span className="af-node-kind">{KINDS[n.kind]?.label}</span>
            </div>
            <div className="af-node-name">{n.name}</div>
          </div>
        ))}
      </div>

      {/* canvas controls */}
      <div className="af-canvas-controls">
        <button className="af-cc-btn" onClick={() => setZoom(z => Math.min(1.4, z * 1.1))}>+</button>
        <div className="af-cc-zoom af-mono">{Math.round(zoom * 100)}%</div>
        <button className="af-cc-btn" onClick={() => setZoom(z => Math.max(0.4, z * 0.9))}>−</button>
        <div className="af-cc-sep" />
        <button className="af-cc-btn af-cc-fit" onClick={fitView}>Fit</button>
      </div>

      <div className="af-canvas-mini af-mono">
        <span className="af-mini-dot af-tone-orange" /> trigger
        <span className="af-mini-dot af-tone-indigo" /> action
        <span className="af-mini-dot af-tone-teal" /> llm
      </div>
    </div>
  );
}

window.AF_Canvas = Canvas;
