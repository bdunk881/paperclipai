import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { getRoleLibrary, type RoleLibraryEntry } from "../../api/missionsApi";

export interface LibraryRolePickerProps {
  eyebrow?: string;
  /** When set, prefer roles that report to this manager role key. */
  managerRoleKey?: string | null;
  /** Role keys that cannot be selected (already on team / plan). */
  disabledRoleKeys?: Set<string>;
  confirmLabel?: string;
  onConfirm: (roleKeys: string[]) => Promise<void>;
  /** Single-select mode for add-report flow. */
  singleSelect?: boolean;
  embedded?: boolean;
}

export function LibraryRolePicker({
  eyebrow = "+ Add a pre-built role",
  managerRoleKey,
  disabledRoleKeys = new Set(),
  confirmLabel,
  onConfirm,
  singleSelect = false,
  embedded = false,
}: LibraryRolePickerProps) {
  const { requireAccessToken } = useAuth();
  const [library, setLibrary] = useState<RoleLibraryEntry[] | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [deptFilter, setDeptFilter] = useState("all");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const token = await requireAccessToken();
        const roles = await getRoleLibrary(token);
        setLibrary(roles);
      } catch {
        setLibrary(null);
      }
    })();
  }, [requireAccessToken]);

  const sortedLibrary = useMemo(() => {
    if (!library) return [];
    if (!managerRoleKey) return library;
    return [...library].sort((a, b) => {
      const aMatch = a.defaultReportsToRoleKey === managerRoleKey ? 0 : 1;
      const bMatch = b.defaultReportsToRoleKey === managerRoleKey ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [library, managerRoleKey]);

  if (!library) return null;

  const departments = ["all", ...Array.from(new Set(library.map((r) => r.department)))];
  const filtered =
    deptFilter === "all"
      ? sortedLibrary
      : sortedLibrary.filter((r) => r.department === deptFilter);

  function toggleKey(key: string) {
    setSelectedKeys((prev) => {
      if (singleSelect) {
        return prev.has(key) ? new Set() : new Set([key]);
      }
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleAdd() {
    if (selectedKeys.size === 0) return;
    const keys = Array.from(selectedKeys);
    setAdding(true);
    try {
      await onConfirm(keys);
      setSelectedKeys(new Set());
    } finally {
      setAdding(false);
    }
  }

  const selectedCount = selectedKeys.size;
  const wrapperClass = embedded ? "" : "af2-card";

  return (
    <div className={wrapperClass} style={embedded ? undefined : { padding: "16px 20px", marginBottom: 16 }}>
      <div className="af2-eyebrow" style={{ marginBottom: 10 }}>
        {eyebrow}
      </div>
      <div className="af2-row" style={{ gap: 10, marginBottom: 12, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--af2-ink-3)" }}>Filter by department</label>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          style={{
            fontSize: 12,
            padding: "3px 8px",
            border: "1px solid var(--af2-line)",
            borderRadius: 4,
            background: "var(--af2-card)",
            color: "var(--af2-ink)",
          }}
        >
          {departments.map((d) => (
            <option key={d} value={d}>
              {d === "all" ? "All" : d}
            </option>
          ))}
        </select>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 8,
          marginBottom: 14,
        }}
      >
        {filtered.map((role) => {
          const disabled = disabledRoleKeys.has(role.roleKey);
          const selected = selectedKeys.has(role.roleKey);
          const reportsHere = managerRoleKey && role.defaultReportsToRoleKey === managerRoleKey;
          return (
            <label
              key={role.roleKey}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                border: `1px solid ${
                  disabled ? "transparent" : selected ? "var(--af2-sage)" : "var(--af2-line)"
                }`,
                background: disabled
                  ? "var(--af2-paper-2)"
                  : selected
                    ? "rgba(74,107,74,0.08)"
                    : "var(--af2-card)",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
                fontSize: 12,
              }}
            >
              <input
                type={singleSelect ? "radio" : "checkbox"}
                name={singleSelect ? "library-role" : undefined}
                disabled={disabled}
                checked={selected}
                onChange={() => toggleKey(role.roleKey)}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div>
                <div style={{ fontWeight: 600, color: "var(--af2-ink)" }}>
                  {role.title}
                  {reportsHere ? (
                    <span className="af2-muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                      · typical report
                    </span>
                  ) : null}
                </div>
                <div className="af2-muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
                  {role.mandate}
                </div>
              </div>
            </label>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => void handleAdd()}
        disabled={selectedCount === 0 || adding}
        className="af2-btn af2-btn-clay"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          opacity: selectedCount === 0 || adding ? 0.6 : 1,
          cursor: selectedCount === 0 || adding ? "not-allowed" : "pointer",
        }}
      >
        {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        {adding
          ? "Adding…"
          : confirmLabel ??
            (selectedCount === 0
              ? singleSelect
                ? "Select a role"
                : "Add pre-built role to team"
              : singleSelect
                ? "Add report"
                : `Add ${selectedCount} selected role${selectedCount === 1 ? "" : "s"}`)}
      </button>
    </div>
  );
}
