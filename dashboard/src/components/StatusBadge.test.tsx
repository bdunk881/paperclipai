/**
 * Unit tests for the StatusBadge component.
 *
 * Verifies rendering for all run and step status values,
 * the animated pulse indicator for "running", and class application.
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

  it("applies green styling for 'completed'", () => {
    render(<StatusBadge status="completed" />);
    const badge = screen.getByText("completed");
    expect(badge.className).toMatch(/green/);
  });

  it("applies red styling for 'failed'", () => {
    render(<StatusBadge status="failed" />);
    const badge = screen.getByText("failed");
    expect(badge.className).toMatch(/red/);
  });

  it("applies purple styling for 'escalated'", () => {
    render(<StatusBadge status="escalated" />);
    const badge = screen.getByText("escalated");
    expect(badge.className).toMatch(/purple/);
  });

  it("applies yellow styling for 'running'", () => {
    render(<StatusBadge status="running" />);
    const badge = screen.getByText("running");
    expect(badge.className).toMatch(/yellow/);
  });

  it("applies gray styling for 'pending'", () => {
    render(<StatusBadge status="pending" />);
    const badge = screen.getByText("pending");
    expect(badge.className).toMatch(/gray/);
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
  const stepStatuses = ["success", "failure", "skipped"] as const;

  for (const status of stepStatuses) {
    it(`renders the '${status}' label`, () => {
      render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
    });
  }

  it("applies green styling for 'success'", () => {
    render(<StatusBadge status="success" />);
    const badge = screen.getByText("success");
    expect(badge.className).toMatch(/green/);
  });

  it("applies red styling for 'failure'", () => {
    render(<StatusBadge status="failure" />);
    const badge = screen.getByText("failure");
    expect(badge.className).toMatch(/red/);
  });

  it("applies gray styling for 'skipped'", () => {
    render(<StatusBadge status="skipped" />);
    const badge = screen.getByText("skipped");
    expect(badge.className).toMatch(/gray/);
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
