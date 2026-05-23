import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import RouteErrorBoundary from "./RouteErrorBoundary";

function renderWithLoaderError(loaderError: unknown) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        loader: () => {
          throw loaderError;
        },
        element: <div>page</div>,
        errorElement: <RouteErrorBoundary />,
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("RouteErrorBoundary", () => {
  it("shows the rate-limit view when the loader throws a 429 Response", async () => {
    renderWithLoaderError(
      new Response("Rate limit cooldown for 12s", {
        status: 429,
        statusText: "Too Many Requests",
      }),
    );
    expect(await screen.findByText("You're going a little too fast")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("shows the rate-limit view when the loader throws an Error whose message mentions rate limiting", async () => {
    renderWithLoaderError(new Error("Rate limit cooldown for 5s"));
    expect(await screen.findByText("You're going a little too fast")).toBeInTheDocument();
  });

  it("shows the sign-in view for 401/403", async () => {
    renderWithLoaderError(new Response("nope", { status: 401, statusText: "Unauthorized" }));
    expect(await screen.findByText("Sign in to continue")).toBeInTheDocument();
  });

  it("shows the not-found view for 404", async () => {
    renderWithLoaderError(new Response("nope", { status: 404, statusText: "Not Found" }));
    expect(await screen.findByText("We couldn't find that")).toBeInTheDocument();
  });

  it("shows the server view for 5xx", async () => {
    renderWithLoaderError(new Response("oops", { status: 503, statusText: "Service Unavailable" }));
    expect(await screen.findByText("The server hit a snag")).toBeInTheDocument();
  });

  it("falls back to a generic view for unknown errors", async () => {
    renderWithLoaderError(new Error("Something obscure broke"));
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Something obscure broke")).toBeInTheDocument();
  });
});
