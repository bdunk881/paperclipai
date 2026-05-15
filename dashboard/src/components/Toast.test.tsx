import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Toast from "./Toast";

describe("Toast", () => {
  it("renders success variant with af2 sage styling", () => {
    const { container } = render(<Toast variant="success" message="Saved!" />);
    expect(screen.getByText("Saved!")).toBeInTheDocument();
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("bg-af2-sage/15");
    expect(wrapper.className).toContain("border-af2-sage/40");
  });

  it("renders error variant with af2 clay styling", () => {
    const { container } = render(<Toast variant="error" message="Failed!" />);
    expect(screen.getByText("Failed!")).toBeInTheDocument();
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("bg-af2-clay-soft/30");
    expect(wrapper.className).toContain("border-af2-clay/40");
  });

  it("has fixed positioning", () => {
    const { container } = render(<Toast variant="success" message="test" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("fixed");
    expect(wrapper.className).toContain("z-50");
  });
});
