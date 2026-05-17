/**
 * Instructions API client (Wave 3).
 *
 * Per-agent Job Descriptions are stored as `workspace_instructions`
 * rows with kind="instruction" + agent_id=<agent>. The backend CRUD
 * routes live at /api/instructions (existing HEL-87 surface) and the
 * wizard endpoint lives at /api/agents/:id/job-description/draft
 * (Wave 3).
 *
 * The dashboard treats Job Descriptions as a domain-level concept on
 * top of the generic instruction store — this client exposes only
 * the subset the AgentJobDescription page needs.
 */

import { getApiBasePath } from "./baseUrl";
import { trackedFetch } from "./trackedFetch";

const BASE = getApiBasePath();

function buildHeaders(accessToken: string, extra?: HeadersInit): HeadersInit {
  return { ...(extra ?? {}), Authorization: `Bearer ${accessToken}` };
}

async function parseJsonOrError<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? fallback);
  }
  return response.json() as Promise<T>;
}

export interface Instruction {
  id: string;
  workspaceId: string;
  missionId: string | null;
  agentId: string | null;
  kind: "instruction" | "triage_policy";
  title: string;
  body: string;
  version: number;
  authorUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Returns every active instruction scoped to the given agent. The
 * dashboard's Job Description view uses the most-recent one as the
 * canonical document; older rows are version history.
 */
export async function listAgentInstructions(
  agentId: string,
  accessToken: string,
): Promise<Instruction[]> {
  const url = new URL(`${BASE}/instructions`, window.location.origin);
  url.searchParams.set("agent_id", agentId);
  url.searchParams.set("kind", "instruction");
  const response = await trackedFetch(url.toString().replace(window.location.origin, ""), {
    headers: buildHeaders(accessToken),
  });
  const payload = await parseJsonOrError<{ instructions: Instruction[] }>(
    response,
    `Failed to load instructions: ${response.status}`,
  );
  return payload.instructions;
}

export interface SaveInstructionInput {
  /** Pass an existing id to PATCH; omit to create a new row. */
  id?: string;
  agentId?: string;
  missionId?: string;
  title: string;
  body: string;
}

/**
 * Create-or-update. PATCH bumps the version on the backend; POST
 * creates a fresh row at version 1.
 */
export async function saveInstruction(
  input: SaveInstructionInput,
  accessToken: string,
): Promise<Instruction> {
  if (input.id) {
    const response = await trackedFetch(`${BASE}/instructions/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({ title: input.title, body: input.body }),
    });
    return parseJsonOrError<Instruction>(
      response,
      `Failed to update instruction: ${response.status}`,
    );
  }
  const response = await trackedFetch(`${BASE}/instructions`, {
    method: "POST",
    headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      kind: "instruction",
      agent_id: input.agentId,
      mission_id: input.missionId,
    }),
  });
  return parseJsonOrError<Instruction>(
    response,
    `Failed to save instruction: ${response.status}`,
  );
}

export interface JobDescriptionAnswers {
  mission: string;
  decisions: string;
  asks: string;
  hardRules?: string;
}

export interface DraftedJobDescription {
  title: string;
  body: string;
  provider: string;
  model: string;
}

/**
 * LLM wizard: takes four short answers and returns a drafted Job
 * Description markdown body. The dashboard loads the returned body
 * into the editor; the user can then edit + Save (which is a separate
 * call to saveInstruction).
 *
 * Pre-fix the dashboard's 15s default would have aborted any wizard
 * call that took longer than that. The backend is configured for
 * 120s on each provider (DEFAULT_LLM_REQUEST_TIMEOUT_MS), so we
 * generously give the fetch 90s to receive the response.
 */
const WIZARD_TIMEOUT_MS = 90_000;

export async function draftAgentJobDescription(
  agentId: string,
  answers: JobDescriptionAnswers,
  accessToken: string,
): Promise<DraftedJobDescription> {
  const response = await trackedFetch(
    `${BASE}/agents/${encodeURIComponent(agentId)}/job-description/draft`,
    {
      method: "POST",
      headers: buildHeaders(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({ answers }),
    },
    { timeoutMs: WIZARD_TIMEOUT_MS },
  );
  return parseJsonOrError<DraftedJobDescription>(
    response,
    `Failed to draft job description: ${response.status}`,
  );
}
