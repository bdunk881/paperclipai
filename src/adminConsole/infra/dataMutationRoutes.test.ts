import { isDenyListedPattern } from "./dataMutationRoutes";

describe("isDenyListedPattern", () => {
  it("rejects bull:* keyspace", () => {
    expect(isDenyListedPattern("bull:*")).toBe(true);
    expect(isDenyListedPattern("bull:runs:*")).toBe(true);
    expect(isDenyListedPattern("BULL:runs")).toBe(true);
  });
  it("rejects session:* keyspace", () => {
    expect(isDenyListedPattern("session:*")).toBe(true);
    expect(isDenyListedPattern("session:abc-123")).toBe(true);
  });
  it("rejects cache:llm-config:* keyspace", () => {
    expect(isDenyListedPattern("cache:llm-config:*")).toBe(true);
    expect(isDenyListedPattern("cache:llm-config:open-ai")).toBe(true);
  });
  it("permits unrelated patterns", () => {
    expect(isDenyListedPattern("cache:llm-cost:*")).toBe(false);
    expect(isDenyListedPattern("rate-limit:*")).toBe(false);
    expect(isDenyListedPattern("idempotency:*")).toBe(false);
  });
});
