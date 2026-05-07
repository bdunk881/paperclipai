import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Save, ShieldAlert } from "lucide-react";
import clsx from "clsx";
import {
  getTicketSlaSettings,
  updateTicketSlaSettings,
  type TicketEscalationRuleRow,
  type TicketSlaPolicyRow,
  type TicketSlaSettingsPayload,
} from "../api/ticketingSla";
import { getTicketActorProfile, type TicketActorRef, type TicketPriority } from "../api/tickets";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";

type Unit = "m" | "h" | "d";

type EditablePolicyRow = {
  priority: TicketPriority;
  firstResponseValue: number;
  firstResponseUnit: Unit;
  resolutionValue: number;
  resolutionUnit: Unit;
};

type EditableEscalationRule = {
  priority: TicketPriority;
  notifyTargets: string;
  autoBumpPriority: boolean;
  autoReassign: boolean;
  fallbackActorId: string;
};

export default function TicketSlaSettings() {
  const { getAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [settings, setSettings] = useState<TicketSlaSettingsPayload | null>(null);
  const [policyRows, setPolicyRows] = useState<EditablePolicyRow[]>([]);
  const [ruleRows, setRuleRows] = useState<EditableEscalationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const nextSettings = await getTicketSlaSettings(accessToken);
      setSettings(nextSettings);
      setPolicyRows(nextSettings.policies.map(toEditablePolicy));
      setRuleRows(nextSettings.escalationRules.map(toEditableRule));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load SLA settings");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadSettings();
  }, [activeWorkspaceId, loadSettings]);

  useEffect(() => {
    if (saveState !== "saved") return undefined;
    const timeout = window.setTimeout(() => setSaveState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [saveState]);

  const validationErrors = useMemo(() => {
    const errors = new Map<TicketPriority, string>();

    for (const row of policyRows) {
      if (row.firstResponseValue <= 0 || row.resolutionValue <= 0) {
        errors.set(row.priority, "Targets must be greater than zero.");
      }
    }

    for (const row of ruleRows) {
      if (row.autoReassign && !row.fallbackActorId) {
        errors.set(row.priority, "Fallback actor is required when auto-reassign is enabled.");
      }
    }

    return errors;
  }, [policyRows, ruleRows]);

  async function handleSave() {
    if (!settings || validationErrors.size > 0) {
      setError(validationErrors.values().next().value ?? "Resolve validation errors before saving.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const accessToken = (await getAccessToken()) ?? undefined;
      const payload: TicketSlaSettingsPayload = {
        workspaceId: activeWorkspaceId ?? settings.workspaceId,
        policies: policyRows.map(fromEditablePolicy),
        escalationRules: ruleRows.map((row) => fromEditableRule(row, settings.fallbackCandidates)),
        fallbackCandidates: settings.fallbackCandidates,
        updatedAt: settings.updatedAt,
      };
      const saved = await updateTicketSlaSettings(payload, accessToken);
      setSettings(saved);
      setPolicyRows(saved.policies.map(toEditablePolicy));
      setRuleRows(saved.escalationRules.map(toEditableRule));
      setSaveState("saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save SLA settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-full bg-[#0b1120] pb-28 text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <section className="rounded-[30px] border border-slate-800/80 bg-slate-950/85 px-6 py-6 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <Link
                to="/settings"
                className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-100"
              >
                <ArrowLeft size={14} />
                Back to settings
              </Link>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-200">
                <ShieldAlert size={12} />
                Workspace SLA
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-100">
                SLA Policy Editor
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Define response and resolution targets by priority, then set the breach actions that keep work moving.
              </p>
            </div>
            <Link
              to="/tickets/sla"
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-teal-500/40 hover:text-teal-100"
            >
              Monitor dashboard
            </Link>
          </div>
        </section>

        {loading ? (
          <>
            <div className="scanline-skeleton min-h-[280px] rounded-[30px]" />
            <div className="scanline-skeleton min-h-[320px] rounded-[30px]" />
          </>
        ) : error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : settings ? (
          <>
            <section className="rounded-[30px] border border-slate-800 bg-slate-950/85 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Policy Editor
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-100">Targets by priority</h2>
              <div className="mt-5 grid gap-4">
                {policyRows.map((row) => {
                  const invalid = validationErrors.has(row.priority);
                  return (
                    <div
                      key={row.priority}
                      className={clsx(
                        "grid gap-4 rounded-[28px] border bg-slate-900/70 p-4 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]",
                        invalid ? "border-[#FF5F57]/50" : "border-slate-800"
                      )}
                    >
                      <div>
                        <p className="font-ticket-mono text-xs uppercase tracking-[0.2em] text-slate-400">
                          {row.priority}
                        </p>
                      </div>
                      <DurationField
                        label="First Response Target"
                        value={row.firstResponseValue}
                        unit={row.firstResponseUnit}
                        onValueChange={(value) => updatePolicyRow(row.priority, "firstResponseValue", value, setPolicyRows)}
                        onUnitChange={(value) => updatePolicyRow(row.priority, "firstResponseUnit", value, setPolicyRows)}
                        success={saveState === "saved"}
                      />
                      <DurationField
                        label="Resolution Target"
                        value={row.resolutionValue}
                        unit={row.resolutionUnit}
                        onValueChange={(value) => updatePolicyRow(row.priority, "resolutionValue", value, setPolicyRows)}
                        onUnitChange={(value) => updatePolicyRow(row.priority, "resolutionUnit", value, setPolicyRows)}
                        success={saveState === "saved"}
                      />
                      {invalid ? (
                        <p className="md:col-span-3 text-sm text-[#ffb2ae]">{validationErrors.get(row.priority)}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-[30px] border border-slate-800 bg-slate-950/85 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Escalation Builder
              </p>
              <h2 className="mt-2 text-lg font-semibold text-slate-100">Breach rules</h2>
              <div className="mt-5 grid gap-4">
                {ruleRows.map((row) => {
                  const invalid = validationErrors.has(row.priority);
                  return (
                    <div
                      key={row.priority}
                      className={clsx(
                        "grid gap-4 rounded-[24px] border bg-slate-900/70 p-4",
                        invalid
                          ? "border-orange-500/50 animate-soft-shake"
                          : "border-slate-800"
                      )}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <p className="font-ticket-mono text-xs uppercase tracking-[0.2em] text-slate-400">
                          {row.priority}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <ToggleField
                            checked={row.autoBumpPriority}
                            label="Auto-Bump Priority"
                            onChange={(checked) => updateRuleRow(row.priority, "autoBumpPriority", checked, setRuleRows)}
                          />
                          <ToggleField
                            checked={row.autoReassign}
                            label="Auto-Reassign"
                            onChange={(checked) => updateRuleRow(row.priority, "autoReassign", checked, setRuleRows)}
                          />
                        </div>
                      </div>

                      <label className="grid gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Notify Targets
                        </span>
                        <input
                          value={row.notifyTargets}
                          onChange={(event) => updateRuleRow(row.priority, "notifyTargets", event.target.value, setRuleRows)}
                          placeholder="@CTO, #incident-room, ops@autoflow.ai"
                          className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-400"
                        />
                      </label>

                      <label className="grid gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Fallback Actor
                        </span>
                        <select
                          value={row.fallbackActorId}
                          onChange={(event) => updateRuleRow(row.priority, "fallbackActorId", event.target.value, setRuleRows)}
                          className={clsx(
                            "rounded-2xl border bg-slate-950/70 px-4 py-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400",
                            row.autoReassign && !row.fallbackActorId
                              ? "border-orange-500 text-orange-100"
                              : "border-slate-800"
                          )}
                        >
                          <option value="">Select fallback actor</option>
                          {settings.fallbackCandidates.map((actor) => (
                            <option key={`${actor.type}:${actor.id}`} value={`${actor.type}:${actor.id}`}>
                              {getTicketActorProfile(actor).name}
                            </option>
                          ))}
                        </select>
                      </label>

                      {invalid ? (
                        <p className="text-sm text-orange-200">{validationErrors.get(row.priority)}</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800/80 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8">
          <div>
            <p className="text-sm font-medium text-slate-200">Save SLA policy changes</p>
            <p className="text-xs text-slate-500">
              Targets and escalation rules apply to newly created tickets after save.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saveState === "saved" ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-teal-500/15 px-3 py-1.5 text-sm text-teal-200">
                <Check size={14} />
                Saved
              </span>
            ) : null}
            <button
              onClick={() => {
                void handleSave();
              }}
              disabled={saving}
              className={clsx(
                "inline-flex min-w-[160px] items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition",
                saving
                  ? "cursor-not-allowed bg-slate-700 text-slate-400"
                  : "bg-indigo-500 text-white hover:bg-indigo-400"
              )}
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toEditablePolicy(row: TicketSlaPolicyRow): EditablePolicyRow {
  const firstResponse = pickDisplayDuration(row.firstResponseMinutes);
  const resolution = pickDisplayDuration(row.resolutionMinutes);
  return {
    priority: row.priority,
    firstResponseValue: firstResponse.value,
    firstResponseUnit: firstResponse.unit,
    resolutionValue: resolution.value,
    resolutionUnit: resolution.unit,
  };
}

function fromEditablePolicy(row: EditablePolicyRow): TicketSlaPolicyRow {
  return {
    priority: row.priority,
    firstResponseMinutes: toMinutes(row.firstResponseValue, row.firstResponseUnit),
    resolutionMinutes: toMinutes(row.resolutionValue, row.resolutionUnit),
  };
}

function toEditableRule(row: TicketEscalationRuleRow): EditableEscalationRule {
  return {
    priority: row.priority,
    notifyTargets: row.notifyTargets.join(", "),
    autoBumpPriority: row.autoBumpPriority,
    autoReassign: row.autoReassign,
    fallbackActorId: row.fallbackActor ? `${row.fallbackActor.type}:${row.fallbackActor.id}` : "",
  };
}

function fromEditableRule(
  row: EditableEscalationRule,
  candidates: TicketActorRef[]
): TicketEscalationRuleRow {
  return {
    priority: row.priority,
    notifyTargets: row.notifyTargets
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    autoBumpPriority: row.autoBumpPriority,
    autoReassign: row.autoReassign,
    fallbackActor: candidates.find((actor) => `${actor.type}:${actor.id}` === row.fallbackActorId),
  };
}

function pickDisplayDuration(minutes: number): { value: number; unit: Unit } {
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: "d" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "h" };
  return { value: minutes, unit: "m" };
}

function toMinutes(value: number, unit: Unit): number {
  if (unit === "d") return value * 1440;
  if (unit === "h") return value * 60;
  return value;
}

function updatePolicyRow<K extends keyof EditablePolicyRow>(
  priority: TicketPriority,
  key: K,
  value: EditablePolicyRow[K],
  setRows: React.Dispatch<React.SetStateAction<EditablePolicyRow[]>>
) {
  setRows((rows) => rows.map((row) => (row.priority === priority ? { ...row, [key]: value } : row)));
}

function updateRuleRow<K extends keyof EditableEscalationRule>(
  priority: TicketPriority,
  key: K,
  value: EditableEscalationRule[K],
  setRows: React.Dispatch<React.SetStateAction<EditableEscalationRule[]>>
) {
  setRows((rows) => rows.map((row) => (row.priority === priority ? { ...row, [key]: value } : row)));
}

function DurationField({
  label,
  value,
  unit,
  onValueChange,
  onUnitChange,
  success,
}: {
  label: string;
  value: number;
  unit: Unit;
  onValueChange: (value: number) => void;
  onUnitChange: (value: Unit) => void;
  success: boolean;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
        <input
          type="number"
          min={1}
          value={value}
          onChange={(event) => onValueChange(Number(event.target.value))}
          className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 font-ticket-mono text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
        <div className="relative">
          <select
            value={unit}
            onChange={(event) => onUnitChange(event.target.value as Unit)}
            className="w-full rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 font-ticket-mono text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
          >
            <option value="m">m</option>
            <option value="h">h</option>
            <option value="d">d</option>
          </select>
          {success ? <Check size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-teal-300" /> : null}
        </div>
      </div>
    </label>
  );
}

function ToggleField({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-xs text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-indigo-400"
      />
      {label}
    </label>
  );
}
