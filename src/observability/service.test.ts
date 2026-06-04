import { buildObservabilityEventsCsv } from "./service";
import type { ObservabilityEvent } from "./types";

const HEADER =
  "occurred_at,sequence,category,type,actor_type,actor_id,actor_label,subject_type,subject_id,subject_label,summary,payload_json";

function evt(over: Partial<ObservabilityEvent> = {}): ObservabilityEvent {
  return {
    id: "e1",
    sequence: "1000",
    userId: "u1",
    category: "run",
    type: "run.completed",
    actor: { type: "run", id: "run-1", label: "Run One" },
    subject: { type: "execution", id: "exec-1", label: "Exec One" },
    summary: "did a thing",
    payload: { status: "completed" },
    occurredAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

describe("buildObservabilityEventsCsv (HEL-357)", () => {
  it("emits a header-only file when there are no events", () => {
    expect(buildObservabilityEventsCsv([])).toBe(HEADER);
  });

  it("emits one quoted row per event with the payload serialized as JSON", () => {
    const csv = buildObservabilityEventsCsv([evt()]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe(
      '"2026-06-01T00:00:00.000Z","1000","run","run.completed","run","run-1","Run One","execution","exec-1","Exec One","did a thing","{""status"":""completed""}"',
    );
  });

  it("escapes embedded commas, quotes, and newlines (RFC-4180 doubling)", () => {
    const csv = buildObservabilityEventsCsv([
      evt({ summary: 'has "quotes", commas, and\na newline' }),
    ]);
    // The field stays a single quoted cell; quotes are doubled and the comma /
    // newline live inside the quotes.
    expect(csv).toContain('"has ""quotes"", commas, and\na newline"');
  });

  it("blanks missing optional actor/subject labels", () => {
    const csv = buildObservabilityEventsCsv([
      evt({
        actor: { type: "system", id: "sys" },
        subject: { type: "workspace", id: "ws" },
      }),
    ]);
    const row = csv.split("\n")[1];
    expect(row).toContain('"system","sys","",'); // actor_type, actor_id, actor_label(empty)
    expect(row).toContain('"workspace","ws","",'); // subject_type, subject_id, subject_label(empty)
  });

  it("serializes events in the order given (caller paginates ascending)", () => {
    const csv = buildObservabilityEventsCsv([
      evt({ sequence: "1", summary: "first" }),
      evt({ sequence: "2", summary: "second" }),
    ]);
    const lines = csv.split("\n");
    expect(lines[1]).toContain('"first"');
    expect(lines[2]).toContain('"second"');
  });
});
