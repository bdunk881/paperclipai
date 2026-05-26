/**
 * SkillsTriage (HEL-219).
 *
 * Read-only triage queue for the security scanner's manifest. Shows
 * every entry in `skills/.manifest.json` grouped by verdict — approved,
 * needs_review, rejected — with the full findings list expanded under
 * each row. Approve / Reject actions deferred to a follow-up; the data
 * flow is in place so a future PR can add server-side mutations.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, AlertTriangle, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../api/settingsClient";
import { ErrorState } from "../components/UiStates";

type Verdict = "approved" | "needs_review" | "rejected";
type Severity = "info" | "warning" | "critical";

interface ScanFinding {
  severity: Severity;
  code: string;
  message: string;
  file?: string;
  excerpt?: string;
}

interface ManifestEntry {
  ref: string;
  skillKey: string;
  verdict: Verdict;
  scannedAt: string;
  findings: ScanFinding[];
}

interface ManifestResponse {
  entries: ManifestEntry[];
  generatedAt: string | null;
}

const VERDICT_ORDER: Verdict[] = ["needs_review", "rejected", "approved"];
const VERDICT_LABEL: Record<Verdict, string> = {
  approved: "Approved",
  needs_review: "Needs review",
  rejected: "Rejected",
};

export default function SkillsTriage() {
  const { user, requireAccessToken } = useAuth();
  const [data, setData] = useState<ManifestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const token = await requireAccessToken();
        const res = await apiGet<ManifestResponse>(
          "/api/skills/manifest",
          user,
          token,
        );
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load manifest");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requireAccessToken, user]);

  const groups = new Map<Verdict, ManifestEntry[]>();
  for (const entry of data?.entries ?? []) {
    const arr = groups.get(entry.verdict) ?? [];
    arr.push(entry);
    groups.set(entry.verdict, arr);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.skillKey.localeCompare(b.skillKey));
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <Link
          to="/settings"
          className="flex items-center gap-1.5 text-sm text-af2-ink-3 hover:text-af2-ink-2 mb-4"
        >
          <ArrowLeft size={14} />
          Back to Settings
        </Link>
        <h1 className="text-2xl font-bold text-af2-ink">Skills triage</h1>
        <p className="text-af2-ink-3 text-sm mt-1">
          Output of the per-skill security scanner. Approved skills are
          installed automatically; needs-review and rejected skills sit
          here with their findings until a human acts on them.
        </p>
        {data?.generatedAt ? (
          <p className="mt-2 text-xs text-af2-ink-3">
            Manifest generated{" "}
            {new Date(data.generatedAt).toLocaleString()}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-af2-ink-3 py-12">
          <Loader2 size={16} className="animate-spin" />
          Loading manifest…
        </div>
      ) : error ? (
        <ErrorState title="Manifest unavailable" message={error} />
      ) : !data || data.entries.length === 0 ? (
        <div className="text-center py-16 text-af2-ink-3 border-2 border-dashed border-af2-line rounded-xl">
          <p className="text-sm font-medium">No scan results yet</p>
          <p className="text-xs mt-1">
            Run <code>npm run skills:import</code> to populate the manifest.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {VERDICT_ORDER.map((verdict) => {
            const entries = groups.get(verdict) ?? [];
            if (entries.length === 0) return null;
            return (
              <section key={verdict} data-testid={`triage-section-${verdict}`}>
                <header className="mb-2 flex items-center gap-2">
                  <VerdictIcon verdict={verdict} />
                  <h2 className="text-sm font-semibold text-af2-ink">
                    {VERDICT_LABEL[verdict]}
                  </h2>
                  <span className="text-xs text-af2-ink-3">
                    ({entries.length})
                  </span>
                </header>
                <ul className="space-y-2">
                  {entries.map((entry) => (
                    <TriageRow key={entry.skillKey} entry={entry} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VerdictIcon({ verdict }: { verdict: Verdict }) {
  if (verdict === "approved") return <CheckCircle2 size={14} className="text-af2-sage" />;
  if (verdict === "needs_review") return <AlertTriangle size={14} className="text-af2-mustard" />;
  return <XCircle size={14} className="text-af2-clay" />;
}

function TriageRow({ entry }: { entry: ManifestEntry }) {
  return (
    <li
      data-testid={`triage-row-${entry.skillKey}`}
      className="bg-af2-card border border-af2-line rounded-xl p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold text-sm text-af2-ink">
            {entry.skillKey}
          </span>
          <span className="ml-2 text-[10px] text-af2-ink-3 font-mono">{entry.ref}</span>
        </div>
        <span className="text-[10px] text-af2-ink-3">
          {new Date(entry.scannedAt).toLocaleDateString()}
        </span>
      </div>
      {entry.findings.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {entry.findings.map((f, i) => (
            <li
              key={`${entry.skillKey}-${i}`}
              className={`text-xs px-3 py-2 rounded-md border ${
                f.severity === "critical"
                  ? "border-af2-clay/40 bg-af2-clay/10 text-af2-clay"
                  : f.severity === "warning"
                    ? "border-af2-mustard/40 bg-af2-mustard/10 text-af2-mustard"
                    : "border-af2-line bg-af2-paper-2 text-af2-ink-3"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-medium uppercase tracking-wide text-[10px]">
                  {f.severity}
                </span>
                <span className="font-mono text-[10px]">{f.code}</span>
                {f.file ? <span className="font-mono text-[10px] opacity-70">{f.file}</span> : null}
              </div>
              <p className="mt-1">{f.message}</p>
              {f.excerpt ? (
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] opacity-80">
                  {f.excerpt}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-af2-ink-3">No findings.</p>
      )}
    </li>
  );
}
