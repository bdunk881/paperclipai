import { useEffect, useState } from "react";
import { Loader, Send, Sparkles, X } from "lucide-react";
import clsx from "clsx";
import { generateWorkflow } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import type { WorkflowStep } from "../../types/workflow";
import { STEP_KIND_COPY } from "../../pages/workflowStepSetup";

/**
 * HEL-209 / PR E.2 — StudioAssistantPanel.
 *
 * Merged right-rail panel with three tabs: Build (generate a routine from a
 * description), Ask (chat about how the routine works), and Fix step
 * (contextual help for the currently selected node). Replaces the old
 * Copilot + Generate-with-AI split UIs with one place to ask for help.
 *
 * Build is wired to `generateWorkflow` from `api/client.ts`. Ask + Fix
 * step are scaffolded — they show the bubble UI but don't yet have a
 * backend, follow-up: HEL-209 backend.
 */
type Tab = "build" | "ask" | "fix";

type ChatBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Props = {
  selectedStep: WorkflowStep | null;
  onClose: () => void;
  onApplyGeneratedSteps: (steps: WorkflowStep[]) => void;
};

export function StudioAssistantPanel({
  selectedStep,
  onClose,
  onApplyGeneratedSteps,
}: Props) {
  const { getAccessToken } = useAuth();
  const [tab, setTab] = useState<Tab>("build");

  // Build tab state — wired to /workflows/generate.
  const [buildPrompt, setBuildPrompt] = useState("");
  const [buildBusy, setBuildBusy] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildPreview, setBuildPreview] = useState<WorkflowStep[] | null>(null);

  // Ask + Fix-step bubbles — scaffolded, no backend yet.
  const [askInput, setAskInput] = useState("");
  const [askBubbles, setAskBubbles] = useState<ChatBubble[]>([
    {
      id: "seed",
      role: "assistant",
      content:
        "Ask me how a step works, what data flows where, or how to wire up something. (Backend wiring lands in a follow-up.)",
    },
  ]);

  const [fixBubbles, setFixBubbles] = useState<ChatBubble[]>([]);

  useEffect(() => {
    if (!selectedStep) {
      setFixBubbles([]);
      return;
    }
    setFixBubbles([
      {
        id: `seed-${selectedStep.id}`,
        role: "assistant",
        content: `Selected node: ${selectedStep.name} (${STEP_KIND_COPY[selectedStep.kind].displayLabel}). Click "Suggest fix" and I'll propose a setup change.`,
      },
    ]);
  }, [selectedStep?.id, selectedStep?.kind, selectedStep?.name]);

  async function handleGenerate() {
    if (!buildPrompt.trim()) return;
    setBuildBusy(true);
    setBuildError(null);
    setBuildPreview(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const steps = await generateWorkflow(
        buildPrompt.trim(),
        undefined,
        accessToken,
      );
      setBuildPreview(steps);
    } catch (err) {
      setBuildError(
        err instanceof Error ? err.message : "Generation failed",
      );
    } finally {
      setBuildBusy(false);
    }
  }

  function handleApplyPreview() {
    if (!buildPreview) return;
    onApplyGeneratedSteps(buildPreview);
    setBuildPreview(null);
    setBuildPrompt("");
  }

  function handleAskSend() {
    if (!askInput.trim()) return;
    const userMsg: ChatBubble = {
      id: `u-${Date.now()}`,
      role: "user",
      content: askInput.trim(),
    };
    const reply: ChatBubble = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content:
        "(Scaffold) Ask backend not wired yet — see HEL-209 follow-up. For now, check the inspector or the step's learn text for guidance.",
    };
    setAskBubbles((prev) => [...prev, userMsg, reply]);
    setAskInput("");
  }

  function handleSuggestFix() {
    if (!selectedStep) return;
    const fix: ChatBubble = {
      id: `f-${Date.now()}`,
      role: "assistant",
      content: `(Scaffold) Suggesting a fix for "${selectedStep.name}" (${STEP_KIND_COPY[selectedStep.kind].displayLabel}). Backend lands later — for now the inspector cards on the right show the required fields.`,
    };
    setFixBubbles((prev) => [...prev, fix]);
  }

  return (
    <aside
      data-testid="studio-assistant-panel"
      aria-label="Studio assistant"
      className="flex h-full w-[340px] shrink-0 flex-col border-l border-af2-line bg-af2-paper"
    >
      <div className="flex items-start justify-between gap-3 border-b border-af2-line px-4 py-3">
        <div>
          <p className="af2-eyebrow">
            <Sparkles size={11} className="mr-1 inline -translate-y-px text-af2-clay" />
            Studio assistant
          </p>
          <p className="mt-1 text-xs leading-snug text-af2-ink-4">
            Build, ask, or fix the selected step — one panel instead of two.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close studio assistant"
          className="shrink-0 rounded p-1 text-af2-ink-3 transition hover:bg-af2-paper-2 hover:text-af2-ink"
        >
          <X size={16} />
        </button>
      </div>

      <div role="tablist" aria-label="Assistant tabs" className="flex border-b border-af2-line">
        {(
          [
            ["build", "Build"],
            ["ask", "Ask"],
            ["fix", "Fix step"],
          ] as const
        ).map(([key, label]) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={clsx(
                "flex-1 border-b-2 px-2 py-2 text-xs font-semibold transition",
                active
                  ? "border-af2-clay text-af2-clay"
                  : "border-transparent text-af2-ink-4 hover:text-af2-ink",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === "build" && (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-af2-ink-3">
                Describe what this routine should do
              </span>
              <textarea
                value={buildPrompt}
                onChange={(event) => setBuildPrompt(event.target.value)}
                rows={4}
                placeholder="e.g. When a support email arrives, classify urgency, draft a reply, and escalate high-urgency ones for sign-off."
                className="w-full resize-none rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
              />
            </label>
            {buildError && (
              <p className="text-xs text-af2-clay">{buildError}</p>
            )}
            {!buildPreview ? (
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={!buildPrompt.trim() || buildBusy}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-af2-clay px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50"
              >
                {buildBusy ? (
                  <>
                    <Loader size={14} className="animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Sparkles size={14} /> Generate
                  </>
                )}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-af2-ink-3">
                  Preview — {buildPreview.length} step
                  {buildPreview.length === 1 ? "" : "s"}
                </p>
                <ul className="space-y-1 rounded-lg border border-af2-line bg-af2-card p-2 text-sm">
                  {buildPreview.map((step, index) => (
                    <li
                      key={step.id}
                      className="flex items-center gap-2 px-2 py-1 text-af2-ink-2"
                    >
                      <span className="text-xs text-af2-ink-4">{index + 1}.</span>
                      <span className="font-medium text-af2-ink">{step.name}</span>
                      <span className="text-xs text-af2-ink-4">
                        ({STEP_KIND_COPY[step.kind]?.displayLabel ?? step.kind})
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleApplyPreview}
                    className="flex-1 rounded-lg bg-af2-clay px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                  >
                    Apply to canvas
                  </button>
                  <button
                    type="button"
                    onClick={() => setBuildPreview(null)}
                    className="rounded-lg border border-af2-line-2 px-3 py-2 text-sm font-medium text-af2-ink-2 transition hover:bg-af2-paper-2"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "ask" && (
          <div className="flex h-full flex-col gap-2">
            <div className="flex-1 space-y-2 overflow-y-auto">
              {askBubbles.map((b) => (
                <ChatBubbleRow key={b.id} bubble={b} />
              ))}
            </div>
            <div className="flex items-end gap-2 border-t border-af2-line pt-3">
              <textarea
                value={askInput}
                onChange={(event) => setAskInput(event.target.value)}
                rows={2}
                placeholder="Ask about a step or the routine…"
                className="flex-1 resize-none rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
              />
              <button
                type="button"
                onClick={handleAskSend}
                disabled={!askInput.trim()}
                className="rounded-lg bg-af2-clay p-2 text-white transition disabled:opacity-50"
                aria-label="Send message"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        )}

        {tab === "fix" && (
          <div className="space-y-3">
            {selectedStep ? (
              <>
                <div className="rounded-lg border border-af2-line bg-af2-paper-2 px-3 py-2 text-xs text-af2-ink-3">
                  Selected node: <strong className="text-af2-ink">{selectedStep.name}</strong> (
                  {STEP_KIND_COPY[selectedStep.kind].displayLabel})
                </div>
                <div className="space-y-2">
                  {fixBubbles.map((b) => (
                    <ChatBubbleRow key={b.id} bubble={b} />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleSuggestFix}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-af2-clay/30 bg-af2-clay-soft/30 px-3 py-2 text-sm font-semibold text-af2-clay transition hover:bg-af2-clay-soft/50"
                >
                  <Sparkles size={14} /> Suggest fix
                </button>
              </>
            ) : (
              <p className="text-xs text-af2-ink-4">
                Select a node on the canvas to get contextual fix suggestions.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function ChatBubbleRow({ bubble }: { bubble: ChatBubble }) {
  const isUser = bubble.role === "user";
  return (
    <div
      className={clsx(
        "max-w-[95%] rounded-lg px-3 py-2 text-sm leading-snug",
        isUser
          ? "ml-auto border border-af2-clay/20 bg-af2-clay-soft/30 text-af2-ink"
          : "border border-af2-line bg-af2-card text-af2-ink-2",
      )}
    >
      {bubble.content}
    </div>
  );
}
