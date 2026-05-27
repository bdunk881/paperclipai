import { apiRequest } from "../lib/apiClient";

export interface AgentWebhook {
  id: string;
  name: string;
  url: string;
  secret_present: boolean;
  custom_headers_present: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  disabled_at: string | null;
}

export interface AskRow {
  id: string;
  agent_webhook_id: string;
  admin_user_id: string;
  kind: string;
  source: string;
  subject_ref: Record<string, unknown>;
  payload: Record<string, unknown>;
  admin_question: string;
  status: "pending" | "sent" | "delivered" | "failed";
  http_status: number | null;
  response_excerpt: string | null;
  sent_at: string;
  completed_at: string | null;
}

export async function listAgentWebhooks(): Promise<AgentWebhook[]> {
  const res = await apiRequest<{ webhooks: AgentWebhook[] }>("/api/admin-console/agent-webhooks");
  return res.webhooks;
}

export async function createAgentWebhook(input: {
  name: string;
  url: string;
  hmacSecret?: string | null;
  customHeaders?: Record<string, string> | null;
  reason?: string;
}): Promise<AgentWebhook> {
  const res = await apiRequest<{ webhook: AgentWebhook }>("/api/admin-console/agent-webhooks", {
    method: "POST",
    body: input,
  });
  return res.webhook;
}

export async function updateAgentWebhook(
  id: string,
  input: {
    name?: string;
    url?: string;
    hmacSecret?: string | null;
    customHeaders?: Record<string, string> | null;
    disabledAt?: string | null;
    reason?: string;
  },
): Promise<AgentWebhook> {
  const res = await apiRequest<{ webhook: AgentWebhook }>(
    `/api/admin-console/agent-webhooks/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input },
  );
  return res.webhook;
}

export async function deleteAgentWebhook(id: string, reason?: string): Promise<void> {
  await apiRequest(`/api/admin-console/agent-webhooks/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: { reason },
  });
}

export async function testAgentWebhook(id: string): Promise<{
  status: "sent" | "failed";
  http_status: number | null;
  excerpt: string | null;
  error: string | null;
}> {
  return apiRequest(`/api/admin-console/agent-webhooks/${encodeURIComponent(id)}/test`, {
    method: "POST",
    body: {},
  });
}

export async function listRecentAsks(id: string): Promise<AskRow[]> {
  const res = await apiRequest<{ asks: AskRow[] }>(
    `/api/admin-console/agent-webhooks/${encodeURIComponent(id)}/recent-asks`,
  );
  return res.asks;
}

export interface AskInput {
  webhookId: string;
  kind: string;
  source: string;
  subjectRef?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  adminQuestion: string;
}

export async function sendAsk(input: AskInput): Promise<{
  ask_id: string;
  status: "sent" | "failed";
  http_status: number | null;
  excerpt: string | null;
  error: string | null;
}> {
  return apiRequest("/api/admin-console/agent-webhooks/asks", {
    method: "POST",
    body: input,
  });
}
