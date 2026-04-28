import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Approvals from "./Approvals";

const {
  createHitlAskCeoRequestMock,
  listApprovalsMock,
  listControlPlaneTeamsMock,
  getHitlCompanyStateMock,
  listHitlNotificationsMock,
  resolveApprovalMock,
  updateHitlCheckpointScheduleMock,
  createHitlCheckpointMock,
  createHitlArtifactCommentMock,
} = vi.hoisted(() => ({
  createHitlAskCeoRequestMock: vi.fn(),
  listApprovalsMock: vi.fn(),
  listControlPlaneTeamsMock: vi.fn(),
  getHitlCompanyStateMock: vi.fn(),
  listHitlNotificationsMock: vi.fn(),
  resolveApprovalMock: vi.fn(),
  updateHitlCheckpointScheduleMock: vi.fn(),
  createHitlCheckpointMock: vi.fn(),
  createHitlArtifactCommentMock: vi.fn(),
}));

const requireAccessTokenMock = vi.fn();

vi.mock("../api/client", () => ({
  createHitlAskCeoRequest: createHitlAskCeoRequestMock,
  listApprovals: listApprovalsMock,
  listControlPlaneTeams: listControlPlaneTeamsMock,
  getHitlCompanyState: getHitlCompanyStateMock,
  listHitlNotifications: listHitlNotificationsMock,
  resolveApproval: resolveApprovalMock,
  updateHitlCheckpointSchedule: updateHitlCheckpointScheduleMock,
  createHitlCheckpoint: createHitlCheckpointMock,
  createHitlArtifactComment: createHitlArtifactCommentMock,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-123", email: "operator@example.com", name: "Operator" },
    requireAccessToken: requireAccessTokenMock,
  }),
}));

describe("Approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAccessTokenMock.mockResolvedValue("token-123");
    listApprovalsMock.mockResolvedValue([]);
    listControlPlaneTeamsMock.mockResolvedValue([
      {
        id: "company-1",
        name: "AutoFlow Build",
        status: "running",
      },
    ]);
    getHitlCompanyStateMock.mockResolvedValue({
      companyId: "company-1",
      version: "2026-04-28T20:00:00.000Z",
      summary: {
        companyId: "company-1",
        version: "2026-04-28T20:00:00.000Z",
        team: {
          id: "company-1",
          name: "AutoFlow Build",
          status: "running",
          budgetMonthlyUsd: 2000,
          agentCount: 4,
          activeExecutionCount: 1,
          openTaskCount: 3,
        },
        hitl: {
          openCheckpointCount: 2,
          unresolvedCommentCount: 1,
          askCeoRequestCount: 1,
        },
      },
      checkpointSchedule: {
        id: "schedule-1",
        companyId: "company-1",
        userId: "user-123",
        enabled: true,
        timezone: "America/New_York",
        notificationChannels: ["inbox", "agent_wake"],
        weeklyReview: {
          enabled: true,
          dayOfWeek: 5,
          hour: 16,
          minute: 0,
        },
        milestoneGate: {
          enabled: true,
          blockingStatuses: ["at_risk", "ready_for_review", "blocked"],
        },
        kpiDeviation: {
          enabled: true,
          thresholds: [],
        },
        createdAt: "2026-04-28T20:00:00.000Z",
        updatedAt: "2026-04-28T20:00:00.000Z",
      },
      checkpoints: [
        {
          id: "checkpoint-1",
          companyId: "company-1",
          userId: "user-123",
          triggerType: "manual",
          source: "manual",
          title: "Review the launch narrative",
          status: "pending",
          artifactRefs: [],
          createdAt: "2026-04-28T20:00:00.000Z",
          updatedAt: "2026-04-28T20:00:00.000Z",
          notificationIds: [],
        },
      ],
      artifactComments: [
        {
          id: "comment-1",
          companyId: "company-1",
          userId: "user-123",
          artifact: {
            kind: "document",
            id: "prd-1",
            title: "Launch PRD",
          },
          anchor: {
            quote: "Ask the CEO should include citations",
          },
          body: "Please add the company-state evidence block before this ships.",
          status: "open",
          routing: {
            recipientType: "agent",
            recipientId: "backend-engineer",
          },
          createdAt: "2026-04-28T20:00:00.000Z",
          updatedAt: "2026-04-28T20:00:00.000Z",
          notificationIds: [],
        },
      ],
      askCeoRequests: [
        {
          id: "ask-1",
          companyId: "company-1",
          userId: "user-123",
          question: "What needs my attention?",
          status: "answered",
          response: {
            summary: "Company AutoFlow Build has 3 open tasks and 2 checkpoints.",
            recommendedActions: [
              "Review newly opened checkpoints before advancing milestones.",
            ],
            citedEntities: [],
            companyStateVersion: "2026-04-28T20:00:00.000Z",
          },
          createdAt: "2026-04-28T20:00:00.000Z",
        },
      ],
    });
    listHitlNotificationsMock.mockResolvedValue([
      {
        id: "notification-1",
        companyId: "company-1",
        userId: "user-123",
        kind: "checkpoint",
        channel: "inbox",
        recipientType: "user",
        recipientId: "user-123",
        status: "pending",
        payload: {},
        createdAt: "2026-04-28T20:00:00.000Z",
      },
    ]);
  });

  it("renders the HITL console with company-scoped data", async () => {
    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>
    );

    expect(
      await screen.findByText("Approvals, checkpoints, and routed feedback in one lane.")
    ).toBeInTheDocument();
    expect(screen.getAllByText("Open checkpoints")).toHaveLength(2);
    expect(screen.getByText("Review the launch narrative")).toBeInTheDocument();
    expect(screen.getByText("Launch PRD")).toBeInTheDocument();
    expect(screen.getByText("Latest answer")).toBeInTheDocument();
  });

  it("submits an Ask the CEO request and refreshes the console", async () => {
    createHitlAskCeoRequestMock.mockResolvedValue({
      id: "ask-2",
      companyId: "company-1",
      userId: "user-123",
      question: "What changed today?",
      status: "answered",
      response: {
        summary: "New checkpoint activity detected.",
        recommendedActions: [],
        citedEntities: [],
        companyStateVersion: "2026-04-28T20:00:00.000Z",
      },
      createdAt: "2026-04-28T20:00:00.000Z",
    });

    render(
      <MemoryRouter>
        <Approvals />
      </MemoryRouter>
    );

    expect(await screen.findByText("Latest answer")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("What needs my attention right now?"), {
      target: { value: "What changed today?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => {
      expect(createHitlAskCeoRequestMock).toHaveBeenCalledWith(
        "company-1",
        {
          question: "What changed today?",
          context: { checkpointId: "checkpoint-1" },
        },
        "token-123"
      );
    });
  });
});
