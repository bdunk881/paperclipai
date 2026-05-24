import { useEffect, useState } from "react";
import { Loader, Send, X } from "lucide-react";
import {
  deployWorkflowAsTeam,
  type ControlPlaneDeployment,
  type DeployWorkflowAsTeamInput,
} from "../../api/client";
import type { WorkflowTemplate } from "../../types/workflow";

/**
 * HEL-209 / PR E.2 — LaunchTeamModal.
 *
 * Replaces the older "Deploy as Team" modal. Top-level radio picks how to
 * launch (as a Routine off this workflow, or a standalone Team) — both
 * paths still call `deployWorkflowAsTeam` from `api/client.ts` for v1;
 * downstream wiring for the standalone path is HEL-209 follow-up. Fields
 * mirror the prototype: team name, monthly budget (USD), default check-in
 * interval (minutes).
 */
export type LaunchMode = "routine" | "standalone";

export type LaunchTeamInput = {
  mode: LaunchMode;
  teamName: string;
  budgetMonthlyUsd: number;
  defaultIntervalMinutes: number;
};

type Props = {
  template: WorkflowTemplate;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onDeploy: (
    input: DeployWorkflowAsTeamInput,
    extras: LaunchTeamInput,
  ) => Promise<ControlPlaneDeployment | void> | void;
};

export function LaunchTeamModal({
  template,
  busy,
  error,
  onClose,
  onDeploy,
}: Props) {
  const [mode, setMode] = useState<LaunchMode>("routine");
  const [teamName, setTeamName] = useState(`${template.name} Team`);
  const [budgetMonthlyUsd, setBudgetMonthlyUsd] = useState(120);
  const [defaultIntervalMinutes, setDefaultIntervalMinutes] = useState(30);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, busy]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const payload: DeployWorkflowAsTeamInput = {
      templateId: template.id,
      teamName: teamName.trim() || undefined,
      budgetMonthlyUsd,
      defaultIntervalMinutes,
    };
    await onDeploy(payload, {
      mode,
      teamName: teamName.trim(),
      budgetMonthlyUsd,
      defaultIntervalMinutes,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-af2-ink/55 px-4 backdrop-blur-[2px]">
      <div className="af2-card max-h-[90vh] w-full max-w-2xl overflow-hidden shadow-af2-lg">
        <div className="flex items-start justify-between gap-4 border-b border-af2-line px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-af2-sage">
              Launch team
            </p>
            <h2 className="font-af2-serif mt-1 text-xl font-medium text-af2-ink">
              Turn this routine into agents that work for you
            </h2>
            <p className="mt-2 max-w-lg text-sm text-af2-ink-3">
              A manager agent orchestrates; each actionable step becomes a worker
              with its own budget and schedule.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close launch team dialog"
            className="rounded-full border border-af2-line p-2 text-af2-ink-3 transition hover:border-af2-line-2 hover:bg-af2-paper-2 hover:text-af2-ink"
            disabled={busy}
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
          <fieldset>
            <legend className="af2-eyebrow">Launch as</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <ModeOption
                value="routine"
                current={mode}
                onSelect={setMode}
                title="Launch as routine"
                description="Schedule this workflow with a manager + workers."
                disabled={busy}
              />
              <ModeOption
                value="standalone"
                current={mode}
                onSelect={setMode}
                title="Launch standalone team"
                description="Blank team — no link to the routine schedule."
                disabled={busy}
              />
            </div>
          </fieldset>

          <Field label="Team name">
            <input
              className="w-full rounded-xl border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              disabled={busy}
              required
            />
          </Field>

          <Field label="Monthly budget (USD)">
            <input
              type="number"
              min={0}
              step={10}
              className="w-full rounded-xl border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
              value={budgetMonthlyUsd}
              onChange={(event) =>
                setBudgetMonthlyUsd(Number(event.target.value) || 0)
              }
              disabled={busy}
            />
          </Field>

          <Field label="Default check-in interval (minutes)">
            <input
              type="number"
              min={1}
              className="w-full rounded-xl border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
              value={defaultIntervalMinutes}
              onChange={(event) =>
                setDefaultIntervalMinutes(Number(event.target.value) || 1)
              }
              disabled={busy}
            />
          </Field>

          {mode === "routine" && (
            <div className="rounded-md border border-af2-sage/30 bg-af2-sage/10 px-4 py-3 text-xs text-af2-sage">
              Scheduled triggers will auto-create a Routine so the team keeps
              working after launch.
            </div>
          )}
          {mode === "standalone" && (
            <div className="rounded-md border border-af2-mustard/30 bg-af2-mustard/10 px-4 py-3 text-xs text-af2-mustard">
              Standalone teams skip the routine wiring — you'll launch them
              manually from the Teams page.
            </div>
          )}
          {error && (
            <div className="rounded-md border border-af2-clay/30 bg-af2-clay/10 px-4 py-3 text-xs text-af2-clay">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-full border border-af2-line-2 px-4 py-2 text-sm font-medium text-af2-ink-2 transition hover:bg-af2-paper-2 hover:text-af2-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-full bg-af2-clay px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? <Loader size={15} className="animate-spin" /> : <Send size={15} />}
              Confirm launch
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModeOption({
  value,
  current,
  onSelect,
  title,
  description,
  disabled,
}: {
  value: LaunchMode;
  current: LaunchMode;
  onSelect: (v: LaunchMode) => void;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  const checked = value === current;
  return (
    <label
      className={
        "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-left transition " +
        (checked
          ? "border-af2-clay bg-af2-clay-soft/40 text-af2-ink"
          : "border-af2-line-2 bg-af2-card text-af2-ink-2 hover:border-af2-clay/30")
      }
    >
      <input
        type="radio"
        name="launch-mode"
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        disabled={disabled}
        className="mt-1 accent-af2-clay"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-af2-ink-4">{description}</span>
      </span>
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-af2-ink-3">
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Convenience helper if a caller wants a one-shot deploy without owning the
 * busy/error state — used by tests + simple call sites.
 */
export async function submitLaunchTeam(
  input: DeployWorkflowAsTeamInput,
  accessToken?: string,
): Promise<ControlPlaneDeployment> {
  return deployWorkflowAsTeam(input, accessToken);
}
