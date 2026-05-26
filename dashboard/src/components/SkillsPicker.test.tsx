/**
 * SkillsPicker tests (HEL-219).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react-original";
import { render } from "../test/render";
import { apiGet } from "../api/settingsClient";
import { SkillsPicker } from "./SkillsPicker";

vi.mock("../api/settingsClient", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-1", email: "x@y.com" },
    requireAccessToken: vi.fn().mockResolvedValue("token"),
  }),
}));

const mockApiGet = apiGet as unknown as Mock;

beforeEach(() => {
  mockApiGet.mockReset();
});

describe("SkillsPicker", () => {
  it("loads /api/skills and renders the list", async () => {
    mockApiGet.mockResolvedValueOnce({
      skills: [
        { key: "pdf", name: "pdf", description: "PDF utilities" },
        { key: "docx", name: "docx", description: "Word docs" },
      ],
    });

    render(<SkillsPicker value={[]} onChange={() => undefined} />);

    await screen.findByTestId("skills-picker");
    expect(screen.getByText("PDF utilities")).toBeInTheDocument();
    expect(screen.getByText("Word docs")).toBeInTheDocument();
  });

  it("pre-checks already-selected skills", async () => {
    mockApiGet.mockResolvedValueOnce({
      skills: [
        { key: "pdf", name: "pdf", description: "PDF utilities" },
        { key: "docx", name: "docx", description: "Word docs" },
      ],
    });
    render(<SkillsPicker value={["pdf"]} onChange={() => undefined} />);

    const checkboxes = await screen.findAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    // Visual feedback: the row containing the pre-selected skill has
    // the active border class. Pin that rather than the underlying
    // `checked` attribute since controlled inputs assert via the prop.
    expect(checkboxes[0]).toHaveProperty("checked", true);
    expect(checkboxes[1]).toHaveProperty("checked", false);
  });

  it("shows the empty state when no skills are installed", async () => {
    mockApiGet.mockResolvedValueOnce({ skills: [] });
    render(<SkillsPicker value={[]} onChange={() => undefined} />);
    expect(await screen.findByText(/No skills installed yet/i)).toBeInTheDocument();
  });

  it("renders an error message when the fetch fails", async () => {
    mockApiGet.mockRejectedValueOnce(new Error("API down"));
    render(<SkillsPicker value={[]} onChange={() => undefined} />);
    await waitFor(() =>
      expect(screen.getByText(/Could not load skills/i)).toBeInTheDocument(),
    );
  });
});
