import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Signup from "./Signup";

function LocationProbe() {
  const location = useLocation();
  return <div>{`${location.pathname}${location.search}`}</div>;
}

describe("Signup", () => {
  it("redirects to the native auth signup mode", async () => {
    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <Routes>
          <Route path="/signup" element={<Signup />} />
          <Route
            path="/login"
            element={
              <div>
                <div>Login Route</div>
                <LocationProbe />
              </div>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Login Route")).toBeInTheDocument();
    expect(screen.getByText("/login?mode=signup")).toBeInTheDocument();
  });
});
