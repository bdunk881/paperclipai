import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tooltip, InfoTooltip } from "./Tooltip";

describe("Tooltip", () => {
  it("renders children and tooltip content", () => {
    render(<Tooltip content="Help text">Hover me</Tooltip>);
    expect(screen.getByText("Hover me")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Help text");
  });

  it("accepts custom className", () => {
    const { container } = render(
      <Tooltip content="tip" className="custom-class">child</Tooltip>
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });
});

describe("InfoTooltip", () => {
  it("renders info icon with accessible label", () => {
    render(<InfoTooltip content="More info" />);
    expect(screen.getByLabelText("More info")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("More info");
  });

  it("accepts custom className", () => {
    const { container } = render(<InfoTooltip content="tip" className="extra" />);
    expect(container.firstChild).toHaveClass("extra");
  });
});
