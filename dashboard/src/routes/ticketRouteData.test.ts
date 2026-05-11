import { describe, it, expect } from "vitest";
import { buildCreateTicketPayload, buildAssignees } from "./ticketRouteData";

// ---------------------------------------------------------------------------
// buildAssignees
// ---------------------------------------------------------------------------
describe("buildAssignees", () => {
  it("assigns role='primary' to the first entry and 'collaborator' to the rest", () => {
    const result = buildAssignees("user:u1", ["agent:a1", "user:u2"]);
    expect(result[0]).toMatchObject({ type: "user", id: "u1", role: "primary" });
    expect(result[1]).toMatchObject({ type: "agent", id: "a1", role: "collaborator" });
    expect(result[2]).toMatchObject({ type: "user", id: "u2", role: "collaborator" });
  });

  it("deduplicates collaborators that equal the primary actor", () => {
    const result = buildAssignees("user:u1", ["user:u1", "agent:a1"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "u1", role: "primary" });
    expect(result[1]).toMatchObject({ id: "a1", role: "collaborator" });
  });

  it("handles id parts that contain colons (preserves full id)", () => {
    const result = buildAssignees("agent:ns:id-complex", []);
    expect(result[0]).toMatchObject({ type: "agent", id: "ns:id-complex", role: "primary" });
  });

  it("returns only the primary when collaboratorKeys is empty", () => {
    const result = buildAssignees("user:u1", []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ role: "primary" });
  });
});

// ---------------------------------------------------------------------------
// buildCreateTicketPayload
// ---------------------------------------------------------------------------
describe("buildCreateTicketPayload", () => {
  const BASE_PAYLOAD = {
    title: "  My Ticket  ",
    description: "  Some desc  ",
    priority: "medium" as const,
    primaryActorKey: "user:u1",
    collaboratorKeys: [],
    dueDate: "",
    tags: "",
    externalSyncRequested: false,
  };

  it("trims title and description", () => {
    const result = buildCreateTicketPayload(BASE_PAYLOAD);
    expect(result.title).toBe("My Ticket");
    expect(result.description).toBe("Some desc");
  });

  it("converts dueDate to ISO string when present", () => {
    const result = buildCreateTicketPayload({ ...BASE_PAYLOAD, dueDate: "2025-12-31" });
    expect(result.dueDate).toMatch(/^2025-12-31/);
  });

  it("leaves dueDate undefined when empty string", () => {
    const result = buildCreateTicketPayload({ ...BASE_PAYLOAD, dueDate: "" });
    expect(result.dueDate).toBeUndefined();
  });

  it("splits, trims, and filters empty tags", () => {
    const result = buildCreateTicketPayload({ ...BASE_PAYLOAD, tags: " bug , , feature " });
    expect(result.tags).toEqual(["bug", "feature"]);
  });

  it("returns empty tags array when tags string is empty", () => {
    const result = buildCreateTicketPayload({ ...BASE_PAYLOAD, tags: "" });
    expect(result.tags).toEqual([]);
  });

  it("passes workspaceId through", () => {
    const result = buildCreateTicketPayload({ ...BASE_PAYLOAD, workspaceId: "ws-1" });
    expect(result.workspaceId).toBe("ws-1");
  });

  it("passes externalSyncRequested through", () => {
    const result = buildCreateTicketPayload({ ...BASE_PAYLOAD, externalSyncRequested: true });
    expect(result.externalSyncRequested).toBe(true);
  });
});
