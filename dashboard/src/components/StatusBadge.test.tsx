/**
 * Unit tests for the StatusBadge component.
 *
 * Verifies rendering for all run and step status values, the animated pulse
 * indicator for "running", and class application. After the af2 shell sweep
 * the status colors map to af2 tones rather than raw Tailwind colors:
 *   - sage    = success / live / running / completed / on-track
 *   - clay    = error / blocked / failed / off-track
 *   - mustard = pending / awaiting / at-risk
 *   - plum    = governance / escalated
 *   - ink-3   = neutral / skipped / not-started
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatusBadge } from "./StatusBadge";

// ---------------------------------------------------------------------------
// Run status values
// ---------------------------------------------------------------------------

describe("StatusBadge — run statuses", () => {
  const runStatuses = ["pending", "running", "completed", "failed", "escalated"] as const;

  for (const status of runStatuses) {
    it(`renders the '${status}' label`, () => {
      render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
    });
  }

  it("applies sage (success) styling for 'completed'", () => {
    render(<StatusBadge status="completed" />);
    const badge = screen.getByText("completed");
    expect(badge.className).toMatch(/af2-sage/);
  });

  it("applies clay (alert) styling for 'failed'", () => {
    render(<StatusBadge status="failed" />);
    const badge = screen.getByText("failed");
    expect(badge.className).toMatch(/af2-clay/);
  });

  it("applies plum (governance) styling for 'escalated'", () => {
    render(<StatusBadge status="escalated" />);
    const badge = screen.getByText("escalated");
    expect(badge.className).toMatch(/af2-plum/);
  });

  it("applies sage (live) styling for 'running'", () => {
    render(<StatusBadge status="running" />);
    const badge = screen.getByText("running");
    expect(badge.className).toMatch(/af2-sage/);
  });

  it("applies neutral (ink-3 + paper-2) styling for 'pending'", () => {
    render(<StatusBadge status="pending" />);
    const badge = screen.getByText("pending");
    expect(badge.className).toMatch(/af2-(ink-3|paper-2)/);
  });

  it("renders awaiting approval with the mapped label", () => {
    render(<StatusBadge status="awaiting_approval" />);
    expect(screen.getByText("awaiting approval")).toBeInTheDocument();
  });

  it("shows animated pulse indicator when status is 'running'", () => {
    const { container } = render(<StatusBadge status="running" />);
    const pulse = container.querySelector(".animate-pulse");
    expect(pulse).toBeInTheDocument();
  });

  it("does not show animated pulse indicator for non-running statuses", () => {
    for (const status of ["pending", "completed", "failed", "escalated"] as const) {
      const { container } = render(<StatusBadge status={status} />);
      const pulse = container.querySelector(".animate-pulse");
      expect(pulse).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Step status values
// ---------------------------------------------------------------------------

describe("StatusBadge — step statuses", () => {
  const stepStatuses = ["success", "failure", "skipped", "running"] as const;

  for (const status of stepStatuses) {
    it(`renders the '${status}' label`, () => {
      render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
    });
  }

  it("applies sage styling for 'success'", () => {
    render(<StatusBadge status="success" />);
    expect(screen.getByText("success").className).toMatch(/af2-sage/);
  });

  it("applies clay styling for 'failure'", () => {
    render(<StatusBadge status="failure" />);
    expect(screen.getByText("failure").className).toMatch(/af2-clay/);
  });

  it("applies neutral styling for 'skipped'", () => {
    render(<StatusBadge status="skipped" />);
    expect(screen.getByText("skipped").className).toMatch(/af2-(ink-3|paper-2)/);
  });
});

describe("StatusBadge — mission statuses", () => {
  const missionStatuses = ["On Track", "At Risk", "Blocked", "Off Track", "Not Started"] as const;

  for (const status of missionStatuses) {
    it(`renders the '${status}' label`, () => {
      render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
    });
  }

  it("applies sage styling for 'On Track'", () => {
    render(<StatusBadge status="On Track" />);
    expect(screen.getByText("On Track").className).toMatch(/af2-sage/);
  });

  it("applies mustard styling for 'At Risk'", () => {
    render(<StatusBadge status="At Risk" />);
    expect(screen.getByText("At Risk").className).toMatch(/af2-mustard/);
  });

  it("applies clay styling for 'Blocked'", () => {
    render(<StatusBadge status="Blocked" />);
    expect(screen.getByText("Blocked").className).toMatch(/af2-clay/);
  });
});

// ---------------------------------------------------------------------------
// Shared rendering properties
// ---------------------------------------------------------------------------

describe("StatusBadge — shared rendering", () => {
  it("renders a <span> element", () => {
    render(<StatusBadge status="completed" />);
    const badge = screen.getByText("completed");
    expect(badge.tagName.toLowerCase()).toBe("span");
  });

  it("includes 'capitalize' class so status text is capitalised via CSS", () => {
    render(<StatusBadge status="completed" />);
    const badge = screen.getByText("completed");
    expect(badge.className).toMatch(/capitalize/);
  });

  it("includes rounded-full class for pill shape", () => {
    render(<StatusBadge status="completed" />);
    const badge = screen.getByText("completed");
    expect(badge.className).toMatch(/rounded-full/);
  });
});
