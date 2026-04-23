import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Toast from "./Toast";

describe("Toast", () => {
  it("renders success variant with green styling", () => {
    const { container } = render(<Toast variant="success" message="Saved!" />);
    expect(screen.getByText("Saved!")).toBeInTheDocument();
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("bg-green-50");
    expect(wrapper.className).toContain("border-green-200");
  });

  it("renders error variant with red styling", () => {
    const { container } = render(<Toast variant="error" message="Failed!" />);
    expect(screen.getByText("Failed!")).toBeInTheDocument();
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("bg-red-50");
    expect(wrapper.className).toContain("border-red-200");
  });

  it("has fixed positioning", () => {
    const { container } = render(<Toast variant="success" message="test" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("fixed");
    expect(wrapper.className).toContain("z-50");
  });
});
