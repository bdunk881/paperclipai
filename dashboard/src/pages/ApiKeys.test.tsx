import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ApiKeys from "./ApiKeys";

describe("ApiKeys", () => {
  it("renders the disabled placeholder state", () => {
    render(<ApiKeys />);

    expect(screen.getByText("API key lifecycle is not enabled yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate key (coming soon)" })).toBeDisabled();
    expect(
      screen.getByText("This page intentionally does not simulate keys to avoid false-success UX.")
    ).toBeInTheDocument();
  });
});
