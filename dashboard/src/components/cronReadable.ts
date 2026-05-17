/**
 * Cron-to-English helper (Wave 4). Translates a small set of common
 * 5-field cron expressions into plain-English so small-business owners
 * don't have to read `0 9 * * 1-5`.
 *
 * Anything not covered by the explicit patterns falls back to the raw
 * cron string with a one-line explainer. We deliberately don't pull in
 * `cronstrue` (no new dep) — the long tail of weird expressions are
 * vanishingly rare for routines an SMB authors.
 */

export interface ReadableCron {
  /** Human-readable phrase (e.g. "Every weekday at 9:00 am UTC"). */
  label: string;
  /** Set when we recognized the pattern; null = "raw passthrough". */
  recognized: boolean;
}

export function readableCron(cron: string | null | undefined): ReadableCron {
  if (!cron) {
    return { label: "Not scheduled", recognized: true };
  }
  const trimmed = cron.trim();
  if (!trimmed) {
    return { label: "Not scheduled", recognized: true };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return { label: trimmed, recognized: false };
  }

  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];

  // Helpers ------------------------------------------------------------
  const everyDayMonth = dom === "*" && month === "*";
  const fixedMin = /^\d+$/.test(minute);
  const fixedHour = /^\d+$/.test(hour);
  const formattedTime =
    fixedMin && fixedHour
      ? `${formatHour(Number(hour))}${Number(minute) === 0 ? "" : `:${String(Number(minute)).padStart(2, "0")}`} ${Number(hour) >= 12 ? "pm" : "am"} UTC`
      : null;

  // Common patterns ----------------------------------------------------
  // Every weekday at HH:MM
  if (everyDayMonth && dow === "1-5" && formattedTime) {
    return { label: `Every weekday at ${formattedTime}`, recognized: true };
  }
  // Every day at HH:MM
  if (everyDayMonth && dow === "*" && formattedTime) {
    return { label: `Every day at ${formattedTime}`, recognized: true };
  }
  // Specific day of week
  if (everyDayMonth && /^[0-6]$/.test(dow) && formattedTime) {
    const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(dow)];
    return { label: `Every ${dayName} at ${formattedTime}`, recognized: true };
  }
  // Every N hours
  const everyNHoursMatch = /^\*\/(\d+)$/.exec(hour);
  if (everyDayMonth && dow === "*" && minute === "0" && everyNHoursMatch) {
    const n = Number(everyNHoursMatch[1]);
    return { label: `Every ${n} hour${n === 1 ? "" : "s"}`, recognized: true };
  }
  // First of every month at HH:MM
  if (dom === "1" && month === "*" && dow === "*" && formattedTime) {
    return { label: `First of every month at ${formattedTime}`, recognized: true };
  }

  return { label: trimmed, recognized: false };
}

function formatHour(h24: number): number {
  if (h24 === 0) return 12;
  if (h24 <= 12) return h24;
  return h24 - 12;
}
