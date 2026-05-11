import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatTicketTimestamp,
  relativeTicketTime,
  statusLabel,
  priorityLabel,
  slaLabel,
  ticketStatusClasses,
  ticketPriorityClasses,
  ticketSlaClasses,
  ticketUpdateIcon,
  ticketUpdateTone,
  primaryAssignee,
  collaboratorCount,
  aggregateActorCounts,
  slaStateIcon,
  normalizeTicketSlaState,
} from "./ticketingUi.helpers";
import {
  AlertTriangle,
  CheckCircle2,
  MessageSquare,
  OctagonAlert,
  PauseCircle,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { TicketRecord, TicketUpdate } from "../../api/tickets";

const NOW = new Date("2025-06-01T12:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// normalizeTicketSlaState
// ---------------------------------------------------------------------------
describe("normalizeTicketSlaState", () => {
  it("maps 'warning' to 'at_risk'", () => {
    expect(normalizeTicketSlaState("warning")).toBe("at_risk");
  });

  it("passes through 'breached'", () => {
    expect(normalizeTicketSlaState("breached")).toBe("breached");
  });

  it("passes through 'paused'", () => {
    expect(normalizeTicketSlaState("paused")).toBe("paused");
  });

  it("passes through 'on_track'", () => {
    expect(normalizeTicketSlaState("on_track")).toBe("on_track");
  });

  it("maps unknown values to 'at_risk'", () => {
    expect(normalizeTicketSlaState("unknown_state")).toBe("at_risk");
  });
});

// ---------------------------------------------------------------------------
// formatTicketTimestamp
// ---------------------------------------------------------------------------
describe("formatTicketTimestamp", () => {
  it("returns 'No date' for undefined", () => {
    expect(formatTicketTimestamp(undefined)).toBe("No date");
  });

  it("returns a formatted string for a valid timestamp", () => {
    const result = formatTicketTimestamp("2025-05-01T10:00:00.000Z");
    expect(typeof result).toBe("string");
    expect(result).not.toBe("No date");
  });
});

// ---------------------------------------------------------------------------
// relativeTicketTime
// ---------------------------------------------------------------------------
describe("relativeTicketTime", () => {
  it("returns 'No activity' for undefined", () => {
    expect(relativeTicketTime(undefined)).toBe("No activity");
  });

  it("returns minutes ago for < 60 minutes", () => {
    const ts = new Date(NOW - 20 * 60 * 1000).toISOString();
    expect(relativeTicketTime(ts)).toMatch(/^\d+m ago$/);
  });

  it("returns hours ago for 1–24 hours", () => {
    const ts = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeTicketTime(ts)).toMatch(/^\d+h ago$/);
  });

  it("returns days ago for > 24 hours", () => {
    const ts = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTicketTime(ts)).toMatch(/^\d+d ago$/);
  });
});

// ---------------------------------------------------------------------------
// statusLabel / priorityLabel / slaLabel
// ---------------------------------------------------------------------------
describe("statusLabel", () => {
  it("replaces underscore with space", () => {
    expect(statusLabel("in_progress")).toBe("in progress");
  });

  it("leaves non-underscored status as-is", () => {
    expect(statusLabel("open")).toBe("open");
  });
});

describe("priorityLabel", () => {
  it("returns the priority as-is", () => {
    expect(priorityLabel("urgent")).toBe("urgent");
  });
});

describe("slaLabel", () => {
  it("normalises 'warning' → 'at_risk' then replaces underscore", () => {
    expect(slaLabel("warning")).toBe("at risk");
  });

  it("returns 'on track' for 'on_track'", () => {
    expect(slaLabel("on_track")).toBe("on track");
  });
});

// ---------------------------------------------------------------------------
// ticketStatusClasses
// ---------------------------------------------------------------------------
describe("ticketStatusClasses", () => {
  it("returns indigo for 'open'", () => {
    expect(ticketStatusClasses("open")).toContain("indigo");
  });

  it("returns teal for 'in_progress'", () => {
    expect(ticketStatusClasses("in_progress")).toContain("teal");
  });

  it("returns orange for 'blocked'", () => {
    expect(ticketStatusClasses("blocked")).toContain("orange");
  });

  it("returns slate for 'resolved'", () => {
    expect(ticketStatusClasses("resolved")).toContain("slate");
  });

  it("returns rose for 'cancelled'", () => {
    expect(ticketStatusClasses("cancelled")).toContain("rose");
  });

  it("returns default slate for unknown status", () => {
    expect(ticketStatusClasses("other" as never)).toContain("slate-700");
  });
});

// ---------------------------------------------------------------------------
// ticketPriorityClasses
// ---------------------------------------------------------------------------
describe("ticketPriorityClasses", () => {
  it("returns FF5F57 for 'urgent'", () => {
    expect(ticketPriorityClasses("urgent")).toContain("FF5F57");
  });

  it("returns orange for 'high'", () => {
    expect(ticketPriorityClasses("high")).toContain("orange");
  });

  it("returns teal for 'medium'", () => {
    expect(ticketPriorityClasses("medium")).toContain("teal");
  });

  it("returns slate for 'low'", () => {
    expect(ticketPriorityClasses("low")).toContain("slate");
  });

  it("returns default slate-700 for unknown", () => {
    expect(ticketPriorityClasses("other" as never)).toContain("slate-700");
  });
});

// ---------------------------------------------------------------------------
// ticketSlaClasses
// ---------------------------------------------------------------------------
describe("ticketSlaClasses", () => {
  it("returns FFD93D for 'at_risk'", () => {
    expect(ticketSlaClasses("at_risk")).toContain("FFD93D");
  });

  it("returns FFD93D for legacy 'warning' value", () => {
    expect(ticketSlaClasses("warning")).toContain("FFD93D");
  });

  it("returns FF5F57 for 'breached'", () => {
    expect(ticketSlaClasses("breached")).toContain("FF5F57");
  });

  it("returns slate-500 for 'paused'", () => {
    expect(ticketSlaClasses("paused")).toContain("slate-500");
  });

  it("returns teal for 'on_track'", () => {
    expect(ticketSlaClasses("on_track")).toContain("teal");
  });

  it("maps unknown SLA state to at_risk classes via normalizeTicketSlaState", () => {
    // normalizeTicketSlaState("unknown") → "at_risk", so at_risk colour applies
    expect(ticketSlaClasses("unknown")).toContain("FFD93D");
  });
});

// ---------------------------------------------------------------------------
// ticketUpdateIcon / ticketUpdateTone
// ---------------------------------------------------------------------------
describe("ticketUpdateIcon", () => {
  it("returns OctagonAlert for status_change", () => {
    expect(ticketUpdateIcon({ type: "status_change" } as TicketUpdate)).toBe(OctagonAlert);
  });

  it("returns ShieldAlert for structured_update", () => {
    expect(ticketUpdateIcon({ type: "structured_update" } as TicketUpdate)).toBe(ShieldAlert);
  });

  it("returns MessageSquare for comment", () => {
    expect(ticketUpdateIcon({ type: "comment" } as TicketUpdate)).toBe(MessageSquare);
  });

  it("returns MessageSquare as default for unknown", () => {
    expect(ticketUpdateIcon({ type: "other" } as unknown as TicketUpdate)).toBe(MessageSquare);
  });
});

describe("ticketUpdateTone", () => {
  it("returns orange for status_change", () => {
    expect(ticketUpdateTone({ type: "status_change" } as TicketUpdate)).toContain("orange");
  });

  it("returns teal for structured_update", () => {
    expect(ticketUpdateTone({ type: "structured_update" } as TicketUpdate)).toContain("teal");
  });

  it("returns slate for comment", () => {
    expect(ticketUpdateTone({ type: "comment" } as TicketUpdate)).toContain("slate");
  });

  it("returns slate as default for unknown", () => {
    expect(ticketUpdateTone({ type: "other" } as unknown as TicketUpdate)).toContain("slate");
  });
});

// ---------------------------------------------------------------------------
// slaStateIcon
// ---------------------------------------------------------------------------
describe("slaStateIcon", () => {
  it("returns PauseCircle for 'paused'", () => {
    expect(slaStateIcon("paused")).toBe(PauseCircle);
  });

  it("returns XCircle for 'breached'", () => {
    expect(slaStateIcon("breached")).toBe(XCircle);
  });

  it("returns AlertTriangle for 'at_risk'", () => {
    expect(slaStateIcon("at_risk")).toBe(AlertTriangle);
  });

  it("returns AlertTriangle for legacy 'warning'", () => {
    expect(slaStateIcon("warning")).toBe(AlertTriangle);
  });

  it("returns CheckCircle2 for 'on_track'", () => {
    expect(slaStateIcon("on_track")).toBe(CheckCircle2);
  });

  it("maps unknown state to at_risk then returns AlertTriangle", () => {
    // normalizeTicketSlaState("unknown") → "at_risk"
    expect(slaStateIcon("unknown")).toBe(AlertTriangle);
  });
});

// ---------------------------------------------------------------------------
// primaryAssignee / collaboratorCount
// ---------------------------------------------------------------------------
describe("primaryAssignee", () => {
  it("returns the primary assignee", () => {
    const ticket = {
      assignees: [
        { type: "agent", id: "a1", role: "collaborator" },
        { type: "user", id: "u1", role: "primary" },
      ],
    } as unknown as TicketRecord;
    expect(primaryAssignee(ticket)).toMatchObject({ id: "u1", role: "primary" });
  });

  it("returns undefined when there is no primary assignee", () => {
    const ticket = { assignees: [{ type: "agent", id: "a1", role: "collaborator" }] } as unknown as TicketRecord;
    expect(primaryAssignee(ticket)).toBeUndefined();
  });
});

describe("collaboratorCount", () => {
  it("counts collaborator-role assignees", () => {
    const ticket = {
      assignees: [
        { type: "agent", id: "a1", role: "collaborator" },
        { type: "agent", id: "a2", role: "collaborator" },
        { type: "user", id: "u1", role: "primary" },
      ],
    } as unknown as TicketRecord;
    expect(collaboratorCount(ticket)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// aggregateActorCounts
// ---------------------------------------------------------------------------
describe("aggregateActorCounts", () => {
  it("returns empty array for no tickets", () => {
    expect(aggregateActorCounts([])).toEqual([]);
  });

  it("aggregates counts for the same actor across tickets", () => {
    const tickets = [
      { status: "open", assignees: [{ type: "agent", id: "a1", role: "primary" }] },
      { status: "in_progress", assignees: [{ type: "agent", id: "a1", role: "primary" }] },
    ] as unknown as TicketRecord[];
    const result = aggregateActorCounts(tickets);
    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(2);
    expect(result[0].open).toBe(1);
    expect(result[0].in_progress).toBe(1);
  });

  it("sorts actors by total descending", () => {
    const tickets = [
      { status: "open", assignees: [{ type: "agent", id: "a1", role: "primary" }, { type: "user", id: "u1", role: "collaborator" }] },
      { status: "open", assignees: [{ type: "agent", id: "a1", role: "primary" }] },
    ] as unknown as TicketRecord[];
    const result = aggregateActorCounts(tickets);
    expect(result[0].id).toBe("a1");
    expect(result[1].id).toBe("u1");
  });
});
