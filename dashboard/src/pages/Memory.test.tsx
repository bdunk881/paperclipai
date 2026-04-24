import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Memory from "./Memory";

const {
  listMemoryEntriesMock,
  searchMemoryMock,
  getMemoryStatsMock,
  writeMemoryEntryMock,
  deleteMemoryEntryMock,
} = vi.hoisted(() => ({
  listMemoryEntriesMock: vi.fn(),
  searchMemoryMock: vi.fn(),
  getMemoryStatsMock: vi.fn(),
  writeMemoryEntryMock: vi.fn(),
  deleteMemoryEntryMock: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(),
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/mock-pdf-worker.js",
}));

vi.mock("../api/client", () => ({
  listMemoryEntries: listMemoryEntriesMock,
  searchMemory: searchMemoryMock,
  getMemoryStats: getMemoryStatsMock,
  writeMemoryEntry: writeMemoryEntryMock,
  deleteMemoryEntry: deleteMemoryEntryMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "user@example.com", name: "Test User" },
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn(),
    requireAccessToken: vi.fn().mockResolvedValue("token-123"),
  }),
}));

describe("Memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMemoryEntriesMock.mockResolvedValue([]);
    searchMemoryMock.mockResolvedValue([]);
    getMemoryStatsMock.mockResolvedValue({
      totalEntries: 2,
      totalBytes: 2048,
      workflowCount: 1,
    });
    writeMemoryEntryMock.mockResolvedValue({
      id: "entry-1",
      key: "knowledge.qa.1",
      text: "Question: Q\nAnswer: A",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    deleteMemoryEntryMock.mockResolvedValue(undefined);
  });

  it("renders the knowledge ingest surface from the design spec", async () => {
    render(
      <MemoryRouter>
        <Memory />
      </MemoryRouter>
    );

    expect(await screen.findByText("Knowledge Ingest")).toBeInTheDocument();
    expect(screen.getByText("File Dropzone")).toBeInTheDocument();
    expect(screen.getByText("Manual Q&A Table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ingest knowledge/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/knowledge ingest file dropzone/i)).toBeInTheDocument();
  });

  it("writes manual q&a rows into the memory api", async () => {
    render(
      <MemoryRouter>
        <Memory />
      </MemoryRouter>
    );

    await screen.findByText("Knowledge Ingest");

    const questionInput = screen.getByPlaceholderText("What should the agent know?");
    const answerInput = screen.getByPlaceholderText("Provide the canonical answer or context.");

    fireEvent.change(questionInput, { target: { value: "What is the refund policy?" } });
    fireEvent.change(answerInput, { target: { value: "Refunds are allowed within 30 days." } });
    fireEvent.click(screen.getByRole("button", { name: /ingest knowledge/i }));

    await waitFor(() => {
      expect(writeMemoryEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringMatching(/^knowledge\.qa\./),
          text: "Question: What is the refund policy?\nAnswer: Refunds are allowed within 30 days.",
          workflowName: "Knowledge Ingest",
        }),
        "token-123",
        "user-1"
      );
    });

    expect(await screen.findByText(/ingested successfully/i)).toBeInTheDocument();
  });

  it("renders separate select and delete controls for memory entries", async () => {
    listMemoryEntriesMock.mockResolvedValue([
      {
        id: "entry-1",
        key: "knowledge.qa.1",
        text: "Question: Q\nAnswer: A",
        workflowName: "Knowledge Ingest",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    render(
      <MemoryRouter>
        <Memory />
      </MemoryRouter>
    );

    const selectButton = await screen.findByRole("button", { name: /select memory entry knowledge\.qa\.1/i });
    const deleteButton = screen.getByRole("button", { name: /delete memory entry knowledge\.qa\.1/i });

    expect(selectButton.contains(deleteButton)).toBe(false);
    expect(deleteButton.closest("button")).toBe(deleteButton);
  });
});
