/**
 * JsonTreeViewer — collapsible JSON tree (HEL-239 Pro upgrade).
 *
 * Free users get the flat indented `<pre>` rendering they had before.
 * Paid (Flow+) users get this interactive tree:
 *
 *   - Click `{ … }` / `[ … ]` headers to collapse a node.
 *   - Header shows the entry count (`3 keys`, `5 items`) so collapsed
 *     state still conveys structure.
 *   - "Raw JSON" toggle in the parent surface lets paid users escape
 *     back to `<pre>` when they want to copy or grep.
 *
 * Styling reuses the same `af2-*` colour roles as the existing
 * `JsonValue` renderer in RunAuditSidebar so the two surfaces feel
 * identical when the toggle is "tree".
 */
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";

interface JsonTreeViewerProps {
  value: unknown;
  /**
   * Depth threshold under which nodes start expanded. 0 = collapse
   * everything past the root, 2 = expand two levels deep, etc.
   * Default 2 — root + one level open, deeper levels click-to-expand.
   */
  initialOpenDepth?: number;
}

export function JsonTreeViewer({ value, initialOpenDepth = 2 }: JsonTreeViewerProps) {
  return (
    <div className="font-mono text-xs leading-6 text-af2-ink-2">
      <Node value={value} depth={0} initialOpenDepth={initialOpenDepth} />
    </div>
  );
}

function Node({
  value,
  depth,
  initialOpenDepth,
  keyName,
}: {
  value: unknown;
  depth: number;
  initialOpenDepth: number;
  keyName?: string;
}) {
  const isArray = Array.isArray(value);
  const isObject = !isArray && value !== null && typeof value === "object";

  if (!isArray && !isObject) {
    return (
      <div style={{ paddingLeft: `${depth * 14}px` }}>
        {keyName !== undefined && (
          <>
            <span className="text-af2-clay">&quot;{keyName}&quot;</span>
            <span>: </span>
          </>
        )}
        <Primitive value={value} />
      </div>
    );
  }

  return (
    <CollapsibleNode
      value={value as Record<string, unknown> | unknown[]}
      depth={depth}
      initialOpenDepth={initialOpenDepth}
      keyName={keyName}
      isArray={isArray}
    />
  );
}

function CollapsibleNode({
  value,
  depth,
  initialOpenDepth,
  keyName,
  isArray,
}: {
  value: Record<string, unknown> | unknown[];
  depth: number;
  initialOpenDepth: number;
  keyName?: string;
  isArray: boolean;
}) {
  const [open, setOpen] = useState(depth < initialOpenDepth);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value);
  const empty = entries.length === 0;
  const summary = isArray
    ? `${entries.length} ${entries.length === 1 ? "item" : "items"}`
    : `${entries.length} ${entries.length === 1 ? "key" : "keys"}`;
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";

  return (
    <div style={{ paddingLeft: `${depth * 14}px` }}>
      <button
        type="button"
        onClick={() => !empty && setOpen((prev) => !prev)}
        className={clsx(
          "inline-flex items-center gap-1 text-left",
          empty ? "cursor-default" : "cursor-pointer hover:text-af2-ink",
        )}
        aria-expanded={open}
      >
        {!empty &&
          (open ? (
            <ChevronDown size={10} className="text-af2-ink-4" />
          ) : (
            <ChevronRight size={10} className="text-af2-ink-4" />
          ))}
        {keyName !== undefined && (
          <>
            <span className="text-af2-clay">&quot;{keyName}&quot;</span>
            <span>: </span>
          </>
        )}
        <span>{openBracket}</span>
        {!open && (
          <span className="text-af2-ink-4">
            {empty ? "" : ` ${summary} `}
          </span>
        )}
        {!open && <span>{closeBracket}</span>}
      </button>
      {open && (
        <>
          {entries.map(([k, v]) => (
            <Node
              key={k}
              value={v}
              depth={depth + 1}
              initialOpenDepth={initialOpenDepth}
              keyName={isArray ? undefined : k}
            />
          ))}
          <div style={{ paddingLeft: `${depth * 14}px` }}>{closeBracket}</div>
        </>
      )}
    </div>
  );
}

function Primitive({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return <span className="text-af2-sage">&quot;{value}&quot;</span>;
  }
  if (typeof value === "number") {
    return <span className="text-af2-mustard">{value}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-af2-ink-2">{String(value)}</span>;
  }
  if (value === null) {
    return <span className="text-af2-ink-4">null</span>;
  }
  return <span className="text-af2-ink-4">undefined</span>;
}
