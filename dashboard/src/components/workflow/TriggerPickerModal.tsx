/**
 * HEL-688 — "What triggers this workflow?" picker.
 *
 * A searchable catalog of the wired trigger step-kinds (friendly labels +
 * descriptions from STEP_KIND_COPY), mirroring n8n's trigger picker. Selecting
 * one adds that trigger to the canvas via the parent's addStep. App-event
 * (Composio) triggers are managed in the Connections trigger panel, not here.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { clsx } from "clsx";
import { Af2Modal } from "../af2/Af2Modal";
import { STEP_KIND_COPY, TRIGGER_PICKER_KINDS } from "../../pages/workflowStepSetup";
import type { StepKind } from "../../types/workflow";

/** Extra search terms beyond the label/subtitle (synonyms users may type). */
const SEARCH_KEYWORDS: Partial<Record<StepKind, string>> = {
  trigger: "manual start run api webhook on demand",
  cron_trigger: "schedule cron time daily weekly recurring",
  interval_trigger: "schedule interval every minutes recurring poll",
  form_trigger: "form submit submission input intake",
  chat_trigger: "chat message chatbot conversation",
  error_trigger: "error failure on error catch handler",
  sub_workflow_trigger: "sub workflow child called reusable nested",
  file_trigger: "file upload watch document",
};

export interface TriggerPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (kind: StepKind) => void;
  /** Supplies the per-kind canvas icon (KIND_META lives in WorkflowBuilder). */
  iconFor: (kind: StepKind) => ReactNode;
}

export function TriggerPickerModal({ open, onClose, onSelect, iconFor }: TriggerPickerModalProps) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TRIGGER_PICKER_KINDS;
    return TRIGGER_PICKER_KINDS.filter((kind) => {
      const copy = STEP_KIND_COPY[kind];
      const haystack = `${copy.displayLabel} ${copy.subtitle} ${SEARCH_KEYWORDS[kind] ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [query]);

  return (
    <Af2Modal
      open={open}
      onClose={onClose}
      eyebrow="Add trigger"
      title="What triggers this workflow?"
      maxWidth={520}
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-af2-ink-4" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search triggers…"
          aria-label="Search triggers"
          className="w-full rounded-lg border border-af2-line bg-af2-paper py-2 pl-8 pr-3 text-sm text-af2-ink outline-none focus:border-af2-line-2"
        />
      </div>

      {results.length === 0 ? (
        <p className="py-6 text-center text-sm text-af2-ink-4">No triggers match “{query}”.</p>
      ) : (
        <ul className="space-y-1.5" role="list">
          {results.map((kind) => {
            const copy = STEP_KIND_COPY[kind];
            return (
              <li key={kind}>
                <button
                  type="button"
                  onClick={() => onSelect(kind)}
                  aria-label={`Add ${copy.displayLabel} trigger`}
                  className="flex w-full items-start gap-3 rounded-lg border border-af2-line bg-af2-card px-3 py-2.5 text-left transition hover:border-af2-line-2 hover:bg-af2-paper-2"
                >
                  <span
                    className={clsx(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                      "border border-af2-line bg-af2-paper text-af2-ink-2",
                    )}
                  >
                    {iconFor(kind)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-af2-ink">
                      {copy.displayLabel}
                    </span>
                    <span className="block text-xs text-af2-ink-3">{copy.subtitle}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Af2Modal>
  );
}
