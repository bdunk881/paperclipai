import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import IntegrationMarketplace from "./IntegrationMarketplace";

describe("IntegrationMarketplace", () => {
  it("filters integrations by search and category, then clears the empty state", () => {
    render(<IntegrationMarketplace />);

    expect(screen.getByText(/browse and connect/i)).toBeInTheDocument();
    expect(screen.getByText(/workflow templates/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /marketing \(/i }));

    expect(screen.getByText(/showing 14 of 162 integrations/i)).toBeInTheDocument();
    expect(screen.getByText("Mailchimp")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search integrations, categories, or actions/i), {
      target: { value: "nonexistent integration" },
    });

    expect(screen.getByText(/no integrations match your search/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));

    expect(screen.getByText(/showing 162 of 162 integrations/i)).toBeInTheDocument();
    expect(screen.getAllByText("Salesforce").length).toBeGreaterThan(0);
  });

  it("switches list mode, opens the detail drawer, toggles connection state, and closes it", () => {
    render(<IntegrationMarketplace />);

    const listButton = screen.getAllByRole("button").find((button) => button.querySelector("svg.lucide-list"));
    if (!listButton) throw new Error("List mode button not found");
    fireEvent.click(listButton);

    fireEvent.click(screen.getAllByText("Salesforce").at(-1) as HTMLElement);

    expect(screen.getByRole("heading", { name: "Salesforce" })).toBeInTheDocument();
    expect(screen.getAllByText(/lead capture to crm/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeInTheDocument();
    expect(screen.getByText(/click connect below to set up api key or oauth authentication/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));
    expect(screen.getByText(/this integration is authenticated and ready to use/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^disconnect$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^disconnect$/i }));
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeInTheDocument();

    const closeButton = screen.getAllByRole("button").find((button) => button.querySelector("svg.lucide-x"));
    if (!closeButton) throw new Error("Drawer close button not found");
    fireEvent.click(closeButton);

    expect(screen.queryByRole("heading", { name: "Salesforce" })).not.toBeInTheDocument();
  });

  it("hides templates, supports search by action, and shows premium upgrade messaging", () => {
    render(<IntegrationMarketplace />);

    fireEvent.click(screen.getByRole("button", { name: /templates/i }));
    expect(screen.queryByText(/workflow templates/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search integrations, categories, or actions/i), {
      target: { value: "write_range" },
    });

    expect(screen.getByText(/showing 1 of 162 integrations/i)).toBeInTheDocument();
    expect(screen.getAllByText("Google Sheets").length).toBeGreaterThan(0);
    expect(screen.queryByText("Salesforce")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/search integrations, categories, or actions/i), {
      target: { value: "copper" },
    });

    fireEvent.click(screen.getAllByText("Copper").at(-1) as HTMLElement);

    expect(screen.getByText(/this is a premium integration\. upgrade your plan to connect/i)).toBeInTheDocument();
    expect(screen.getByText(/upgrade to premium to configure authentication/i)).toBeInTheDocument();

    const upgradeButton = screen.getByRole("button", { name: /upgrade required/i });
    expect(upgradeButton).toBeDisabled();
  });
});
