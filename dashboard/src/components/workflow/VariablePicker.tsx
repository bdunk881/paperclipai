/**
 * VariablePicker — sidecar `{{...}}` variable picker (HEL-241B).
 *
 * A small "+ Variable" button surfaced next to text + longtext fields
 * in the NodeConfigForm. Clicking opens a Radix Popover listing every
 * `outputKey` from sibling steps, grouped by step name. Selecting a
 * variable inserts `{{key}}` at the input's current caret position.
 *
 * Why this and not a TipTap mention extension:
 *   - The whole pain today is discoverability — users can't see what
 *     variables exist. A visible button solves that entirely.
 *   - Zero new editor framework. The textarea / input stays plain.
 *   - ~150 lines of code vs. ~1 week of TipTap integration + theme
 *     customization. If usage validates demand, v2 layers TipTap's
 *     mention extension on top (the runtime contract — flat `{{key}}`
 *     interpolation in src/engine/WorkflowEngine.ts — stays unchanged).
 *
 * The engine's `interpolate()` only resolves flat `{{key}}` today
 * (no dotted `{{step.field}}` syntax). So the picker emits flat
 * variable names; if two steps expose the same key, last-writer wins
 * in the run context — same as before, just now discoverable.
 */
import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Plus, Search } from "lucide-react";
import type { WorkflowStep } from "../../types/workflow";

interface VariablePickerProps {
  /**
   * All steps in the workflow. The picker filters out the current
   * step and groups the rest by name. Read-only.
   */
  allSteps: WorkflowStep[];
  /** Current step's id — excluded from the picker so steps can't reference themselves. */
  currentStepId: string;
  /** Called with `{{key}}` (already wrapped) so the caller can insert verbatim. */
  onInsert: (literal: string) => void;
  /** Lets the parent disable the trigger when the field is disabled. */
  disabled?: boolean;
}

interface VariableGroup {
  stepId: string;
  stepName: string;
  keys: string[];
}

export function VariablePicker({
  allSteps,
  currentStepId,
  onInsert,
  disabled,
}: VariablePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const groups = useMemo<VariableGroup[]>(() => {
    const out: VariableGroup[] = [];
    for (const s of allSteps) {
      if (s.id === currentStepId) continue;
      if (!s.outputKeys || s.outputKeys.length === 0) continue;
      out.push({
        stepId: s.id,
        stepName: s.name || s.kind,
        keys: s.outputKeys,
      });
    }
    return out;
  }, [allSteps, currentStepId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        keys: g.keys.filter(
          (k) =>
            k.toLowerCase().includes(q) || g.stepName.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.keys.length > 0);
  }, [groups, query]);

  const totalKeys = useMemo(
    () => groups.reduce((n, g) => n + g.keys.length, 0),
    [groups],
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled || totalKeys === 0}
          title={
            totalKeys === 0
              ? "No upstream step exposes variables yet"
              : "Insert a {{variable}} from another step"
          }
          className="inline-flex items-center gap-1 rounded-md border border-af2-line bg-af2-paper-3 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-af2-ink-3 transition hover:bg-af2-paper-2 hover:text-af2-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={10} />
          Variable
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[280px] rounded-lg border border-af2-line bg-af2-card p-2 shadow-af2-lg"
          align="end"
          sideOffset={6}
        >
          <div className="mb-2 flex items-center gap-2 rounded-md border border-af2-line-2 px-2 py-1.5">
            <Search size={12} className="text-af2-ink-4" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search variables"
              className="w-full bg-transparent text-xs text-af2-ink outline-none placeholder:text-af2-ink-4"
            />
          </div>
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-xs text-af2-ink-4">
              {totalKeys === 0
                ? "No other step has output keys yet. Add a step that emits an output, then come back."
                : "No matches."}
            </p>
          ) : (
            <ul className="max-h-[280px] overflow-y-auto">
              {filtered.map((g) => (
                <VariableGroupRow
                  key={g.stepId}
                  group={g}
                  onPick={(key) => {
                    onInsert(`{{${key}}}`);
                    setOpen(false);
                    setQuery("");
                  }}
                />
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function VariableGroupRow({
  group,
  onPick,
}: {
  group: VariableGroup;
  onPick: (key: string) => void;
}) {
  return (
    <li className="mb-2 last:mb-0">
      <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-af2-ink-4">
        {group.stepName}
      </div>
      {group.keys.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onPick(key)}
          className="block w-full rounded px-2 py-1 text-left text-xs font-mono text-af2-ink-2 transition hover:bg-af2-paper-2 hover:text-af2-ink"
        >
          {`{{${key}}}`}
        </button>
      ))}
    </li>
  );
}

