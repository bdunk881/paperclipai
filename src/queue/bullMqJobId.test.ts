import {
  buildAgentPromptJobIdForTicket,
  buildBullMqJobId,
  buildRoutineCronAgentPromptJobId,
  hashForJobIdSegment,
  isJobIdAlreadyExists,
} from "./bullMqJobId";

describe("bullMqJobId", () => {
  const ticketId = "612a0dea-4628-4577-b082-88cfd1980f6c";

  it("never includes colons in job ids", () => {
    expect(buildBullMqJobId("ticket", ticketId, "assignment")).not.toContain(":");
    expect(
      buildAgentPromptJobIdForTicket({
        ticketId,
        triggerKind: "manual",
        prompt: "Investigate the outage",
      }),
    ).not.toContain(":");
    expect(buildRoutineCronAgentPromptJobId("routine-uuid", 1710000000000)).not.toContain(":");
  });

  it("dedupes manual runs for the same prompt", () => {
    const a = buildAgentPromptJobIdForTicket({
      ticketId,
      triggerKind: "manual",
      prompt: "same prompt",
    });
    const b = buildAgentPromptJobIdForTicket({
      ticketId,
      triggerKind: "manual",
      prompt: "same prompt",
    });
    expect(a).toBe(b);
  });

  it("uses update id for assignment_update", () => {
    const jobId = buildAgentPromptJobIdForTicket({
      ticketId,
      triggerKind: "assignment_update",
      updateId: "update-123",
      prompt: "new comment",
    });
    expect(jobId).toContain("update-123");
    expect(jobId).not.toContain(":");
  });

  it("hashes long or unsafe segments", () => {
    const id = buildBullMqJobId("x", "a".repeat(200));
    expect(id).toHaveLength(64);
    expect(id).not.toContain(":");
  });

  it("hashForJobIdSegment is stable", () => {
    expect(hashForJobIdSegment("hello")).toBe(hashForJobIdSegment("hello"));
    expect(hashForJobIdSegment("hello")).not.toBe(hashForJobIdSegment("world"));
  });

  it("detects duplicate BullMQ job id errors", () => {
    expect(isJobIdAlreadyExists(new Error("Job job-1 already exists"))).toBe(true);
    expect(isJobIdAlreadyExists(new Error("Custom Id cannot contain :"))).toBe(false);
  });
});
