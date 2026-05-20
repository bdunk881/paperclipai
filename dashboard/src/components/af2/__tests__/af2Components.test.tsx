import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Af2Card,
  Af2Eyebrow,
  Af2H1,
  Af2H2,
  Af2H3,
  Af2Modal,
  Af2PageHead,
  Af2Pill,
} from "..";

describe("Af2Eyebrow", () => {
  it("renders children with the af2-eyebrow class", () => {
    render(<Af2Eyebrow>Run · Home</Af2Eyebrow>);
    const node = screen.getByText("Run · Home");
    expect(node.className).toContain("af2-eyebrow");
  });
});

describe("Af2Heading", () => {
  it("renders Af2H1 with serif font and offset margin", () => {
    render(<Af2H1>Title</Af2H1>);
    const heading = screen.getByText("Title");
    expect(heading.tagName).toBe("H1");
    expect(heading.className).toContain("af2-h1");
    expect(heading.className).toContain("font-af2-serif");
  });

  it("Af2H2 renders as h2 with serif", () => {
    render(<Af2H2>Section</Af2H2>);
    const heading = screen.getByText("Section");
    expect(heading.tagName).toBe("H2");
    expect(heading.className).toContain("af2-h2");
  });

  it("Af2H3 renders as h3", () => {
    render(<Af2H3>Sub</Af2H3>);
    const heading = screen.getByText("Sub");
    expect(heading.tagName).toBe("H3");
    expect(heading.className).toContain("af2-h3");
  });
});

describe("Af2PageHead", () => {
  it("renders eyebrow + title", () => {
    render(<Af2PageHead eyebrow="Workforce · Spend" title="Budget" />);
    expect(screen.getByText("Workforce · Spend")).toBeTruthy();
    expect(screen.getByText("Budget")).toBeTruthy();
  });

  it("renders subtitle when provided", () => {
    render(<Af2PageHead eyebrow="E" title="T" subtitle="42 of 100 used" />);
    expect(screen.getByText("42 of 100 used")).toBeTruthy();
  });

  it("renders actions slot when provided", () => {
    render(<Af2PageHead eyebrow="E" title="T" actions={<button>Refresh</button>} />);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });
});

describe("Af2Card", () => {
  it("renders children inside an af2-card div", () => {
    render(<Af2Card>Hello</Af2Card>);
    const inner = screen.getByText("Hello");
    expect(inner.className).toContain("af2-card");
  });

  it("applies default padding of 18", () => {
    render(<Af2Card>Hello</Af2Card>);
    const inner = screen.getByText("Hello");
    expect(inner.style.padding).toBe("18px");
  });

  it("honors a custom padding", () => {
    render(<Af2Card padding={32}>Hello</Af2Card>);
    expect(screen.getByText("Hello").style.padding).toBe("32px");
  });
});

describe("Af2Pill", () => {
  it("default tone renders just af2-pill", () => {
    render(<Af2Pill>idle</Af2Pill>);
    const pill = screen.getByText("idle");
    expect(pill.className).toBe("af2-pill");
  });

  it("maps live → af2-pill-live", () => {
    render(<Af2Pill tone="live">running</Af2Pill>);
    expect(screen.getByText("running").className).toContain("af2-pill-live");
  });

  it("maps pending → af2-pill-pending", () => {
    render(<Af2Pill tone="pending">review</Af2Pill>);
    expect(screen.getByText("review").className).toContain("af2-pill-pending");
  });

  it("maps clay → af2-pill-clay", () => {
    render(<Af2Pill tone="clay">blocked</Af2Pill>);
    expect(screen.getByText("blocked").className).toContain("af2-pill-clay");
  });

  it("maps plum → af2-pill-plum", () => {
    render(<Af2Pill tone="plum">approval</Af2Pill>);
    expect(screen.getByText("approval").className).toContain("af2-pill-plum");
  });
});

describe("Af2Modal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when closed", () => {
    render(
      <Af2Modal open={false} onClose={() => {}}>
        Hidden
      </Af2Modal>,
    );
    expect(screen.queryByText("Hidden")).toBeNull();
  });

  it("renders body, title, eyebrow, and footer when open", () => {
    render(
      <Af2Modal
        open
        onClose={() => {}}
        eyebrow="Workforce"
        title="Edit agent"
        footer={<button>Save</button>}
      >
        Body content
      </Af2Modal>,
    );
    expect(screen.getByText("Workforce")).toBeTruthy();
    expect(screen.getByText("Edit agent")).toBeTruthy();
    expect(screen.getByText("Body content")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <Af2Modal open onClose={onClose}>
        Body
      </Af2Modal>,
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismissOnBackdrop=false ignores backdrop clicks", () => {
    const onClose = vi.fn();
    render(
      <Af2Modal open onClose={onClose} dismissOnBackdrop={false}>
        Body
      </Af2Modal>,
    );
    // dispatch a synthetic mousedown on the backdrop element
    const dialog = screen.getByRole("dialog");
    dialog.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
