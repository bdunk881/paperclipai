import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useState } from "react";
import { apiRequest, ApiError } from "../lib/apiClient";
import { IdentityTab } from "../components/tabs/IdentityTab";
import { ActivityTab } from "../components/tabs/ActivityTab";
import { BillingTab } from "../components/tabs/BillingTab";
import { WorkspacesTab } from "../components/tabs/WorkspacesTab";
import { NotesTab } from "../components/tabs/NotesTab";
import { AbuseSignalsTab } from "../components/tabs/AbuseSignalsTab";
import { DataHygieneTab } from "../components/tabs/DataHygieneTab";
import { ImpersonationTab } from "../components/tabs/ImpersonationTab";

interface Customer360Data {
  user: {
    user_id: string;
    email: string | null;
    display_name: string | null;
    is_platform_admin: boolean;
    timezone: string;
    created_at: string;
  };
  workspaces: Array<{
    workspace_id: string;
    name: string;
    role: string;
    owner_user_id: string;
    created_at: string;
  }>;
  notes: Array<{
    id: string;
    body: string;
    pinned: boolean;
    author_admin_id: string;
    created_at: string;
    updated_at: string;
  }>;
}

const TABS = [
  { id: "identity", label: "Identity" },
  { id: "activity", label: "Activity" },
  { id: "workspaces", label: "Workspaces" },
  { id: "billing", label: "Billing" },
  { id: "impersonation", label: "Impersonate" },
  { id: "notes", label: "Notes" },
  { id: "abuse", label: "Abuse signals" },
  { id: "data-hygiene", label: "Data hygiene" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Customer360() {
  const { userId } = useParams<{ userId: string }>();
  const [tab, setTab] = useState<TabId>("identity");
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["customer", userId],
    enabled: !!userId,
    queryFn: () => apiRequest<Customer360Data>(`/api/admin-console/lookup/user/${userId}`),
  });

  if (!userId) return <div className="card">Missing user id.</div>;
  if (query.isLoading) return <div className="muted">Loading…</div>;
  if (query.isError) {
    const e = query.error as ApiError | Error;
    return (
      <div className="banner danger">
        Failed to load: {"status" in e ? `${e.status} ` : ""}
        {e.message}
      </div>
    );
  }
  const data = query.data!;
  const reload = () => qc.invalidateQueries({ queryKey: ["customer", userId] });

  return (
    <>
      <div className="card">
        <h2>{data.user.display_name ?? data.user.email ?? data.user.user_id}</h2>
        <div className="muted code">{data.user.user_id}</div>
        <div className="muted">
          {data.user.email ?? "no email"} · created {new Date(data.user.created_at).toLocaleString()}
          {data.user.is_platform_admin && (
            <>
              {" · "}
              <span className="pill warning">platform admin</span>
            </>
          )}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={tab === t.id ? "active" : ""}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "identity" && <IdentityTab userId={userId} />}
      {tab === "activity" && <ActivityTab userId={userId} />}
      {tab === "workspaces" && <WorkspacesTab userId={userId} workspaces={data.workspaces} onChange={reload} />}
      {tab === "billing" && <BillingTab userId={userId} workspaces={data.workspaces} />}
      {tab === "impersonation" && <ImpersonationTab userId={userId} />}
      {tab === "notes" && <NotesTab userId={userId} notes={data.notes} onChange={reload} />}
      {tab === "abuse" && <AbuseSignalsTab userId={userId} />}
      {tab === "data-hygiene" && <DataHygieneTab userId={userId} />}
    </>
  );
}
