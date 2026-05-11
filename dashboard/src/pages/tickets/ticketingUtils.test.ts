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
} from "./ticketingUtils";
import { MessageSquare, OctagonAlert, ShieldAlert } from "lucide-react";
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
// formatTicketTimestamp
// ---------------------------------------------------------------------------
describe("formatTicketTimestamp", () => {
  it("returns 'No date' when value is undefined", () => {
    expect(formatTicketTimestamp(undefined)).toBe("No date");
  });

  it("returns formatted date string for a valid ISO timestamp", () => {
    const result = formatTicketTimestamp("2025-05-01T10:30:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe("No date");
  });
});

// ---------------------------------------------------------------------------
// relativeTicketTime
// ---------------------------------------------------------------------------
describe("relativeTicketTime", () => {
  it("returns 'No activity' when value is undefined", () => {
    expect(relativeTicketTime(undefined)).toBe("No activity");
  });

  it("returns minutes ago for timestamps under 60 minutes old", () => {
    const thirtyMinsAgo = new Date(NOW - 30 * 60 * 1000).toISOString();
    const result = relativeTicketTime(thirtyMinsAgo);
    expect(result).toMatch(/^\d+m ago$/);
  });

  it("returns hours ago for timestamps between 1 and 24 hours old", () => {
    const twoHoursAgo = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const result = relativeTicketTime(twoHoursAgo);
    expect(result).toMatch(/^\d+h ago$/);
  });

  it("returns days ago for timestamps older than 24 hours", () => {
    const threeDaysAgo = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
    const result = relativeTicketTime(threeDaysAgo);
    expect(result).toMatch(/^\d+d ago$/);
  });

  it("uses minimum 1 minute for very recent timestamps", () => {
    const justNow = new Date(NOW - 5 * 1000).toISOString();
    expect(relativeTicketTime(justNow)).toBe("1m ago");
  });
});

// ---------------------------------------------------------------------------
// statusLabel / priorityLabel / slaLabel
// ---------------------------------------------------------------------------
describe("statusLabel", () => {
  it("replaces underscore with space", () => {
    expect(statusLabel("in_progress")).toBe("in progress");
  });

  it("returns the status as-is when no underscore", () => {
    expect(statusLabel("open")).toBe("open");
  });
});

describe("priorityLabel", () => {
  it("returns the priority unchanged", () => {
    expect(priorityLabel("high")).toBe("high");
  });
});

describe("slaLabel", () => {
  it("replaces underscore with space in SLA state", () => {
    expect(slaLabel("on_track")).toBe("on track");
  });

  it("returns the value unchanged when no underscore", () => {
    expect(slaLabel("breached")).toBe("breached");
  });
});

// ---------------------------------------------------------------------------
// ticketStatusClasses
// ---------------------------------------------------------------------------
describe("ticketStatusClasses", () => {
  it("returns indigo classes for 'open'", () => {
    expect(ticketStatusClasses("open")).toContain("indigo");
  });

  it("returns teal classes for 'in_progress'", () => {
    expect(ticketStatusClasses("in_progress")).toContain("teal");
  });

  it("returns orange classes for 'blocked'", () => {
    expect(ticketStatusClasses("blocked")).toContain("orange");
  });

  it("returns slate classes for 'resolved'", () => {
    expect(ticketStatusClasses("resolved")).toContain("slate");
  });

  it("returns rose classes for 'cancelled'", () => {
    expect(ticketStatusClasses("cancelled")).toContain("rose");
  });

  it("returns default slate classes for unknown status", () => {
    expect(ticketStatusClasses("unknown" as never)).toContain("slate-700");
  });
});

// ---------------------------------------------------------------------------
// ticketPriorityClasses
// ---------------------------------------------------------------------------
describe("ticketPriorityClasses", () => {
  it("returns red-toned classes for 'urgent'", () => {
    expect(ticketPriorityClasses("urgent")).toContain("FF5F57");
  });

  it("returns orange classes for 'high'", () => {
    expect(ticketPriorityClasses("high")).toContain("orange");
  });

  it("returns teal classes for 'medium'", () => {
    expect(ticketPriorityClasses("medium")).toContain("teal");
  });

  it("returns slate classes for 'low'", () => {
    expect(ticketPriorityClasses("low")).toContain("slate");
  });

  it("returns default slate classes for unknown priority", () => {
    expect(ticketPriorityClasses("unknown" as never)).toContain("slate-700");
  });
});

// ---------------------------------------------------------------------------
// ticketSlaClasses
// ---------------------------------------------------------------------------
describe("ticketSlaClasses", () => {
  it("returns yellow classes for 'warning'", () => {
    expect(ticketSlaClasses("warning")).toContain("FFD93D");
  });

  it("returns red classes for 'breached'", () => {
    expect(ticketSlaClasses("breached")).toContain("FF5F57");
  });

  it("returns slate classes for 'paused'", () => {
    expect(ticketSlaClasses("paused")).toContain("slate-500");
  });

  it("returns teal classes for 'on_track'", () => {
    expect(ticketSlaClasses("on_track")).toContain("teal");
  });

  it("returns default slate classes for unknown state", () => {
    expect(ticketSlaClasses("unknown")).toContain("slate-700");
  });
});

// ---------------------------------------------------------------------------
// ticketUpdateIcon
// ---------------------------------------------------------------------------
describe("ticketUpdateIcon", () => {
  it("returns OctagonAlert for 'status_change'", () => {
    const update = { type: "status_change" } as TicketUpdate;
    expect(ticketUpdateIcon(update)).toBe(OctagonAlert);
  });

  it("returns ShieldAlert for 'structured_update'", () => {
    const update = { type: "structured_update" } as TicketUpdate;
    expect(ticketUpdateIcon(update)).toBe(ShieldAlert);
  });

  it("returns MessageSquare for 'comment'", () => {
    const update = { type: "comment" } as TicketUpdate;
    expect(ticketUpdateIcon(update)).toBe(MessageSquare);
  });

  it("returns MessageSquare as default for unknown type", () => {
    const update = { type: "unknown" } as unknown as TicketUpdate;
    expect(ticketUpdateIcon(update)).toBe(MessageSquare);
  });
});

// ---------------------------------------------------------------------------
// ticketUpdateTone
// ---------------------------------------------------------------------------
describe("ticketUpdateTone", () => {
  it("returns orange for 'status_change'", () => {
    const update = { type: "status_change" } as TicketUpdate;
    expect(ticketUpdateTone(update)).toContain("orange");
  });

  it("returns teal for 'structured_update'", () => {
    const update = { type: "structured_update" } as TicketUpdate;
    expect(ticketUpdateTone(update)).toContain("teal");
  });

  it("returns slate for 'comment'", () => {
    const update = { type: "comment" } as TicketUpdate;
    expect(ticketUpdateTone(update)).toContain("slate");
  });

  it("returns slate as default for unknown type", () => {
    const update = { type: "unknown" } as unknown as TicketUpdate;
    expect(ticketUpdateTone(update)).toContain("slate");
  });
});

// ---------------------------------------------------------------------------
// primaryAssignee
// ---------------------------------------------------------------------------
describe("primaryAssignee", () => {
  it("returns the primary assignee when present", () => {
    const ticket = {
      assignees: [
        { type: "agent", id: "a1", role: "collaborator" },
        { type: "agent", id: "a2", role: "primary" },
      ],
    } as unknown as TicketRecord;
    expect(primaryAssignee(ticket)).toEqual({ type: "agent", id: "a2", role: "primary" });
  });

  it("returns undefined when there is no primary assignee", () => {
    const ticket = {
      assignees: [{ type: "agent", id: "a1", role: "collaborator" }],
    } as unknown as TicketRecord;
    expect(primaryAssignee(ticket)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// collaboratorCount
// ---------------------------------------------------------------------------
describe("collaboratorCount", () => {
  it("counts collaborators correctly", () => {
    const ticket = {
      assignees: [
        { type: "agent", id: "a1", role: "collaborator" },
        { type: "agent", id: "a2", role: "primary" },
        { type: "user", id: "u1", role: "collaborator" },
      ],
    } as unknown as TicketRecord;
    expect(collaboratorCount(ticket)).toBe(2);
  });

  it("returns 0 when there are no collaborators", () => {
    const ticket = {
      assignees: [{ type: "agent", id: "a1", role: "primary" }],
    } as unknown as TicketRecord;
    expect(collaboratorCount(ticket)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// aggregateActorCounts
// ---------------------------------------------------------------------------
describe("aggregateActorCounts", () => {
  it("returns empty array for no tickets", () => {
    expect(aggregateActorCounts([])).toEqual([]);
  });

  it("aggregates counts across multiple tickets for same actor", () => {
    const tickets = [
      {
        status: "open",
        assignees: [{ type: "agent", id: "a1", role: "primary" }],
      },
      {
        status: "resolved",
        assignees: [{ type: "agent", id: "a1", role: "primary" }],
      },
    ] as unknown as TicketRecord[];

    const result = aggregateActorCounts(tickets);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a1");
    expect(result[0].total).toBe(2);
    expect(result[0].open).toBe(1);
    expect(result[0].resolved).toBe(1);
  });

  it("tracks multiple actors and sorts by total descending", () => {
    const tickets = [
      {
        status: "open",
        assignees: [
          { type: "agent", id: "a1", role: "primary" },
          { type: "user", id: "u1", role: "collaborator" },
        ],
      },
      {
        status: "in_progress",
        assignees: [{ type: "agent", id: "a1", role: "primary" }],
      },
    ] as unknown as TicketRecord[];

    const result = aggregateActorCounts(tickets);
    expect(result[0].id).toBe("a1"); // a1 has total=2, u1 has total=1
    expect(result[0].total).toBe(2);
    expect(result[1].id).toBe("u1");
    expect(result[1].total).toBe(1);
  });

  it("initialises new actor counts from zero", () => {
    const tickets = [
      {
        status: "blocked",
        assignees: [{ type: "agent", id: "new-agent", role: "primary" }],
      },
    ] as unknown as TicketRecord[];

    const result = aggregateActorCounts(tickets);
    expect(result[0].blocked).toBe(1);
    expect(result[0].open).toBe(0);
    expect(result[0].cancelled).toBe(0);
  });
});
