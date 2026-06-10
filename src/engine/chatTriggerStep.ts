/**
 * Chat trigger step (HEL-678, Phase 1).
 *
 * The head of a chat-triggered workflow (n8n Chat Trigger). A run started with a
 * `chat` payload (`{ message, sessionId, userId }`) — e.g. from a chat surface
 * POSTing to /api/runs — surfaces those fields as first-class context so a
 * downstream `llm` / `agent` step can answer `{{chatMessage}}`. With no payload
 * it surfaces safe nulls, so the trigger still validates as a workflow head.
 */

export function handleChatTrigger(context: Record<string, unknown>): Record<string, unknown> {
  const raw = context["chat"];
  const chat: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  return {
    chat,
    chatMessage: chat["message"] ?? context["chatMessage"] ?? null,
    chatSessionId: chat["sessionId"] ?? context["chatSessionId"] ?? null,
    chatUserId: chat["userId"] ?? context["chatUserId"] ?? null,
  };
}
