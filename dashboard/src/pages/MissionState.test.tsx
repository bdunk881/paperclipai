import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import MissionState, { MissionStateView } from "./MissionState";

describe("MissionStateView", () => {
  beforeEach(() => {
    document.title = "AutoFlow";
  });

  it("renders the canonical Mission State breadcrumb and title", () => {
    render(
      <MemoryRouter>
        <MissionStateView />
      </MemoryRouter>
    );

    expect(screen.getByText("Mission State")).toBeInTheDocument();
    expect(screen.getByText("Launch AutoFlow Beta")).toBeInTheDocument();
  });

  it("renders loading states for cards when requested", () => {
    render(
      <MemoryRouter>
        <MissionStateView states={{ health: "loading" }} />
      </MemoryRouter>
    );

    const skeletons = document.querySelectorAll(".animate-mission-skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders an empty state for the blockers card", () => {
    render(
      <MemoryRouter>
        <MissionStateView states={{ blockers: "empty" }} />
      </MemoryRouter>
    );

    expect(screen.getByText("Clear to proceed")).toBeInTheDocument();
  });

  it("renders an error state for the readiness card", () => {
    render(
      <MemoryRouter>
        <MissionStateView states={{ readiness: "error" }} />
      </MemoryRouter>
    );

    expect(screen.getByText("Readiness metrics could not be loaded.")).toBeInTheDocument();
  });
});

describe("MissionState route behavior", () => {
  it("sets the browser title to Mission State", () => {
    render(
      <MemoryRouter initialEntries={["/mission-state"]}>
        <Routes>
          <Route path="/mission-state" element={<MissionState />} />
        </Routes>
      </MemoryRouter>
    );

    expect(document.title).toBe("Mission State | AutoFlow");
  });

  it("shows the staffing-plan entry pill when deep-linked from staffing-plan", () => {
    render(
      <MemoryRouter initialEntries={["/mission-state?entry=staffing-plan"]}>
        <Routes>
          <Route path="/mission-state" element={<MissionState />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText("Opened from Staffing Plan")).toBeInTheDocument();
  });
});
