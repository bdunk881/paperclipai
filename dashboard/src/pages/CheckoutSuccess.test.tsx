import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import CheckoutSuccess from "./CheckoutSuccess";

describe("CheckoutSuccess", () => {
  it("renders the post-checkout confirmation and dashboard link", () => {
    render(
      <MemoryRouter>
        <CheckoutSuccess />
      </MemoryRouter>
    );

    expect(screen.getByText("You're all set!")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Dashboard" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "support@autoflow.ai" })).toHaveAttribute(
      "href",
      "mailto:support@autoflow.ai"
    );
  });
});
