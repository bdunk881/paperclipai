import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Login from "./Login";

const { loginMock, signupMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  signupMock: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    login: loginMock,
    signup: signupMock,
    logout: vi.fn(),
    getAccessToken: vi.fn(),
  }),
}));

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders both AutoFlow auth actions", () => {
    render(<Login />);

    expect(screen.getByText("Sign in to AutoFlow")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create your account" })).toBeInTheDocument();
  });

  it("shows an error when sign-in fails", async () => {
    loginMock.mockRejectedValueOnce(new Error("redirect failed"));

    render(<Login />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Sign-in failed. Please try again.")).toBeInTheDocument();
  });

  it("shows an error when signup fails", async () => {
    signupMock.mockRejectedValueOnce(new Error("signup redirect failed"));

    render(<Login />);
    fireEvent.click(screen.getByRole("button", { name: "Create your account" }));

    expect(await screen.findByText("Signup failed. Please try again.")).toBeInTheDocument();
    await waitFor(() => {
      expect(signupMock).toHaveBeenCalledTimes(1);
    });
  });
});
