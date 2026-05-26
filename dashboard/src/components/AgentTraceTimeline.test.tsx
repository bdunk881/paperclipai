/**
 * AgentTraceTimeline tests — HEL-221 parent → child rendering.
 *
 * Verifies that when the event stream contains a parent turn whose
 * `delegate_to_subagent` tool call spawned a child turn (different
 * turnId), the timeline renders the child events nested under the
 * parent's tool call instead of interleaving them into one flat list.
 */

import { describe, expect, it } from "vitest";
import { render } from "../test/render";
import { screen, within } from "@testing-library/react-original";
import type { AgentTraceEnvelope } from "../api/agentTrace";
import { AgentTraceTimeline } from "./AgentTraceTimeline";

const PARENT_TURN = "turn-parent";
const CHILD_TURN = "turn-child";
const DELEGATE_CALL_ID = "call-delegate-1";

function envelope(
  partial: Partial<AgentTraceEnvelope> & {
    seq: number;
    event: AgentTraceEnvelope["event"];
  },
): AgentTraceEnvelope {
  return {
    workspaceId: "ws-1",
    agentId: "agent-parent",
    runId: "run-1",
    turnId: PARENT_TURN,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    at: new Date(2026, 4, 26, 12, 0, partial.seq).toISOString(),
    ...partial,
  };
}

function buildScenario(): AgentTraceEnvelope[] {
  return [
    // Parent: turn starts and emits the delegate tool call.
    envelope({
      seq: 1,
      event: { type: "turn.started", at: "2026-05-26T12:00:01Z" },
    }),
    envelope({
      seq: 2,
      event: {
        type: "tool_call.started",
        callId: DELEGATE_CALL_ID,
        name: "delegate_to_subagent",
      },
    }),
    envelope({
      seq: 3,
      event: {
        type: "tool_call.completed",
        callId: DELEGATE_CALL_ID,
        name: "delegate_to_subagent",
        arguments: { agent_name: "QualifierBot", task: "Qualify this lead" },
      },
    }),
    // Child turn (different turnId) — appears between the parent's
    // tool_call.completed and the eventual tool_result.
    envelope({
      seq: 4,
      turnId: CHILD_TURN,
      agentId: "agent-child",
      event: { type: "turn.started", at: "2026-05-26T12:00:04Z" },
    }),
    envelope({
      seq: 5,
      turnId: CHILD_TURN,
      agentId: "agent-child",
      event: {
        type: "tool_call.completed",
        callId: "child-tool-1",
        name: "lookup_contact",
        arguments: { email: "lead@example.com" },
      },
    }),
    envelope({
      seq: 6,
      turnId: CHILD_TURN,
      agentId: "agent-child",
      event: {
        type: "turn.completed",
        text: "Lead qualified.",
        usage: { promptTokens: 100, completionTokens: 25 },
      },
    }),
    // Parent: tool_result then own turn.completed.
    envelope({
      seq: 7,
      event: {
        type: "tool_result",
        callId: DELEGATE_CALL_ID,
        name: "delegate_to_subagent",
        outputPreview: '{"ok":true,"reply":"Lead qualified."}',
      },
    }),
    envelope({
      seq: 8,
      event: {
        type: "turn.completed",
        text: "Delegated and confirmed.",
        usage: { promptTokens: 200, completionTokens: 40 },
      },
    }),
  ];
}

describe("AgentTraceTimeline — HEL-221 subagent tree", () => {
  it("renders the empty state when there are no events", () => {
    render(<AgentTraceTimeline events={[]} />);
    expect(screen.getByText(/Waiting for live trace events/i)).toBeInTheDocument();
  });

  it("renders a subagent-branch <details> when a delegated child turn is present", () => {
    render(<AgentTraceTimeline events={buildScenario()} />);
    const branch = screen.getByTestId("subagent-branch");
    expect(branch).toBeInTheDocument();
    // The branch is keyed off the child turn's turnId.
    expect(branch.getAttribute("data-turn-id")).toBe(CHILD_TURN);
    // The summary surfaces a count of visible child events.
    expect(within(branch).getByText(/Subagent turn/i)).toBeInTheDocument();
  });

  it("nests the child's tool call inside the subagent branch", () => {
    render(<AgentTraceTimeline events={buildScenario()} />);
    const branch = screen.getByTestId("subagent-branch");
    // The child's lookup_contact tool call should be inside the branch.
    expect(within(branch).getByText(/Tool ready · lookup_contact/i)).toBeInTheDocument();
    // The parent's delegate_to_subagent call should NOT be inside the
    // branch — it's the row that owns the branch.
    expect(
      within(branch).queryByText(/Tool ready · delegate_to_subagent/i),
    ).not.toBeInTheDocument();
  });

  it("renders only the parent's flat list when there are no child turns", () => {
    const flat: AgentTraceEnvelope[] = [
      envelope({ seq: 1, event: { type: "turn.started", at: "2026-05-26T12:00:01Z" } }),
      envelope({
        seq: 2,
        event: { type: "turn.completed", text: "Done.", usage: { promptTokens: 1, completionTokens: 1 } },
      }),
    ];
    render(<AgentTraceTimeline events={flat} />);
    expect(screen.queryByTestId("subagent-branch")).toBeNull();
  });
});
