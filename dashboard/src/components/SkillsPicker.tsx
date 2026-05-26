/**
 * SkillsPicker (HEL-219).
 *
 * Multi-select picker over the workspace's installed skills. Fetches
 * the list from `GET /api/skills` and reports the selected keys via
 * `onChange`. Persistence is up to the parent — `SkillsPicker` is
 * stateless past its local fetch.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../api/settingsClient";

export interface SkillSummary {
  key: string;
  name: string;
  description: string;
  license?: string;
}

interface SkillsPickerProps {
  /** Skill keys currently selected. */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function SkillsPicker({ value, onChange, disabled = false }: SkillsPickerProps) {
  const { user, requireAccessToken } = useAuth();
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await requireAccessToken();
        const data = await apiGet<{ skills: SkillSummary[] }>(
          "/api/skills",
          user,
          token,
        );
        if (!cancelled) setSkills(data.skills);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load skills");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requireAccessToken, user]);

  if (error) {
    return (
      <p className="text-xs text-af2-clay" role="alert">
        Could not load skills: {error}
      </p>
    );
  }
  if (skills === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-af2-ink-3">
        <Loader2 size={12} className="animate-spin" />
        Loading skills…
      </div>
    );
  }
  if (skills.length === 0) {
    return (
      <p className="text-xs text-af2-ink-3">
        No skills installed yet. Run <code>npm run skills:import</code> to
        bootstrap a set.
      </p>
    );
  }

  const selected = new Set(value);

  function toggle(key: string) {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next].sort());
  }

  return (
    <ul className="space-y-1" data-testid="skills-picker">
      {skills.map((s) => {
        const checked = selected.has(s.key);
        return (
          <li
            key={s.key}
            className={`flex items-start gap-2 px-3 py-2 rounded-md border ${
              checked ? "border-af2-clay/50 bg-af2-clay/5" : "border-af2-line bg-af2-card"
            }`}
          >
            <input
              type="checkbox"
              id={`skill-${s.key}`}
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(s.key)}
              className="mt-0.5"
            />
            <label htmlFor={`skill-${s.key}`} className="flex-1 cursor-pointer">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-sm text-af2-ink">{s.name}</span>
                <span className="text-[10px] text-af2-ink-3 font-mono">{s.key}</span>
              </div>
              {s.description ? (
                <p className="mt-0.5 text-xs text-af2-ink-2">{s.description}</p>
              ) : null}
            </label>
          </li>
        );
      })}
    </ul>
  );
}
