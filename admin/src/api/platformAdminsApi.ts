import { apiRequest } from "../lib/apiClient";

export interface PlatformAdminView {
  user_id: string;
  display_name: string | null;
  email: string | null;
  granted_at: string | null;
}

export interface PlatformAdminsList {
  admins: PlatformAdminView[];
  self_user_id: string;
}

export async function listPlatformAdmins(): Promise<PlatformAdminsList> {
  return apiRequest<PlatformAdminsList>("/api/admin-console/platform-admins");
}

export interface RevokeInput {
  userId: string;
  reason: string;
  /** Required typed-confirmation string: "REVOKE". */
  confirm: string;
}

export async function revokePlatformAdmin(input: RevokeInput): Promise<void> {
  await apiRequest(
    `/api/admin-console/platform-admins/${encodeURIComponent(input.userId)}/revoke`,
    {
      method: "POST",
      body: { reason: input.reason, confirm: input.confirm },
    },
  );
}
