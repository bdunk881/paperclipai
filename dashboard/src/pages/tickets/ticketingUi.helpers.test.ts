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

  it("maps unknown values to 'on_track'", () => {
    expect(normalizeTicketSlaState("unknown_state")).toBe("on_track");
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
// ticketStatusClasses — DASH-35: v2 af2 token palette
// ---------------------------------------------------------------------------
describe("ticketStatusClasses", () => {
  it("returns neutral ink chip for 'open'", () => {
    expect(ticketStatusClasses("open")).toContain("af2-ink");
  });

  it("returns sage for 'in_progress'", () => {
    expect(ticketStatusClasses("in_progress")).toContain("af2-sage");
  });

  it("returns mustard for 'blocked'", () => {
    expect(ticketStatusClasses("blocked")).toContain("af2-mustard");
  });

  it("returns muted ink-3 for 'resolved'", () => {
    expect(ticketStatusClasses("resolved")).toContain("af2-ink-3");
  });

  it("returns clay for 'cancelled'", () => {
    expect(ticketStatusClasses("cancelled")).toContain("af2-clay");
  });

  it("returns muted default for unknown status", () => {
    expect(ticketStatusClasses("other" as never)).toContain("af2-ink-2");
  });
});

// ---------------------------------------------------------------------------
// ticketPriorityClasses — DASH-35
// ---------------------------------------------------------------------------
describe("ticketPriorityClasses", () => {
  it("returns clay for 'urgent'", () => {
    expect(ticketPriorityClasses("urgent")).toContain("af2-clay");
  });

  it("returns mustard for 'high'", () => {
    expect(ticketPriorityClasses("high")).toContain("af2-mustard");
  });

  it("returns neutral ink for 'medium'", () => {
    expect(ticketPriorityClasses("medium")).toContain("af2-ink");
  });

  it("returns muted for 'low'", () => {
    expect(ticketPriorityClasses("low")).toContain("af2-ink-3");
  });

  it("returns muted default for unknown", () => {
    expect(ticketPriorityClasses("other" as never)).toContain("af2-ink-2");
  });
});

// ---------------------------------------------------------------------------
// ticketSlaClasses — DASH-35
// ---------------------------------------------------------------------------
describe("ticketSlaClasses", () => {
  it("returns mustard for 'at_risk'", () => {
    expect(ticketSlaClasses("at_risk")).toContain("af2-mustard");
  });

  it("returns on_track sage for legacy 'warning' (now normalizes to on_track default? no — warning→at_risk)", () => {
    // normalizeTicketSlaState("warning") → "at_risk"
    expect(ticketSlaClasses("warning")).toContain("af2-mustard");
  });

  it("returns clay for 'breached'", () => {
    expect(ticketSlaClasses("breached")).toContain("af2-clay");
  });

  it("returns muted ink-3 for 'paused'", () => {
    expect(ticketSlaClasses("paused")).toContain("af2-ink-3");
  });

  it("returns sage for 'on_track'", () => {
    expect(ticketSlaClasses("on_track")).toContain("af2-sage");
  });

  it("maps unknown SLA state to on_track sage via normalizeTicketSlaState", () => {
    // normalizeTicketSlaState("unknown") → "on_track" (DASH-35)
    expect(ticketSlaClasses("unknown")).toContain("af2-sage");
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
  it("returns mustard for status_change", () => {
    expect(ticketUpdateTone({ type: "status_change" } as TicketUpdate)).toContain("af2-mustard");
  });

  it("returns sage for structured_update", () => {
    expect(ticketUpdateTone({ type: "structured_update" } as TicketUpdate)).toContain("af2-sage");
  });

  it("returns muted ink-2 for comment", () => {
    expect(ticketUpdateTone({ type: "comment" } as TicketUpdate)).toContain("af2-ink-2");
  });

  it("returns muted default for unknown", () => {
    expect(ticketUpdateTone({ type: "other" } as unknown as TicketUpdate)).toContain("af2-ink-2");
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

  it("maps unknown state to on_track then returns CheckCircle2", () => {
    // DASH-35: normalizeTicketSlaState("unknown") → "on_track"
    expect(slaStateIcon("unknown")).toBe(CheckCircle2);
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

  it("returns undefined when there's no primary", () => {
    const ticket = {
      assignees: [{ type: "agent", id: "a1", role: "collaborator" }],
    } as unknown as TicketRecord;
    expect(primaryAssignee(ticket)).toBeUndefined();
  });
});

describe("collaboratorCount", () => {
  it("counts only collaborators (not primary)", () => {
    const ticket = {
      assignees: [
        { type: "user", id: "u1", role: "primary" },
        { type: "agent", id: "a1", role: "collaborator" },
        { type: "agent", id: "a2", role: "collaborator" },
      ],
    } as unknown as TicketRecord;
    expect(collaboratorCount(ticket)).toBe(2);
  });

  it("returns 0 with no collaborators", () => {
    const ticket = {
      assignees: [{ type: "user", id: "u1", role: "primary" }],
    } as unknown as TicketRecord;
    expect(collaboratorCount(ticket)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// aggregateActorCounts
// ---------------------------------------------------------------------------
describe("aggregateActorCounts", () => {
  it("aggregates ticket counts per actor across statuses, sorted by total desc", () => {
    const tickets = [
      {
        status: "open",
        assignees: [{ type: "user", id: "u1", role: "primary" }],
      },
      {
        status: "in_progress",
        assignees: [
          { type: "user", id: "u1", role: "primary" },
          { type: "agent", id: "a1", role: "collaborator" },
        ],
      },
      {
        status: "resolved",
        assignees: [{ type: "agent", id: "a1", role: "primary" }],
      },
    ] as unknown as TicketRecord[];

    const result = aggregateActorCounts(tickets);
    expect(result).toHaveLength(2);
    // u1: open=1, in_progress=1 → total=2
    // a1: in_progress=1, resolved=1 → total=2
    // sort is by total desc, ties allowed
    expect(result[0].total).toBe(2);
    expect(result[1].total).toBe(2);
  });

  it("returns empty array when given no tickets", () => {
    expect(aggregateActorCounts([])).toEqual([]);
  });
});
