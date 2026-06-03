const queryPostgresMock = jest.fn();
jest.mock("../db/postgres", () => ({
  isPostgresConfigured: jest.fn(() => false),
  queryPostgres: (...args: unknown[]) => queryPostgresMock(...args),
}));

import {
  auditCrmApiCall,
  categorizeIncludedFields,
  getAuditLog,
  getAuditLogAsync,
  clearAuditLog,
  CrmAuditEntry,
} from "./crmAuditLog";
import { isPostgresConfigured } from "../db/postgres";

const mockIsPgConfigured = jest.mocked(isPostgresConfigured);

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("crmAuditLog", () => {
  beforeEach(() => {
    clearAuditLog();
    jest.restoreAllMocks();
    mockIsPgConfigured.mockReturnValue(false);
    queryPostgresMock.mockReset();
    queryPostgresMock.mockResolvedValue({ rows: [] });
  });

  describe("categorizeIncludedFields", () => {
    it("classifies account info fields", () => {
      const categories = categorizeIncludedFields({
        companyName: "Acme",
        industry: "Tech",
        employeeCount: 50,
      });
      expect(categories).toEqual(["account_info"]);
    });

    it("classifies contact identity fields", () => {
      const categories = categorizeIncludedFields({
        firstName: "Jane",
        lastName: "Doe",
        title: "VP Sales",
      });
      expect(categories).toEqual(["contact_identity"]);
    });

    it("classifies deal data fields", () => {
      const categories = categorizeIncludedFields({
        dealValue: 50000,
        dealStage: "proposal",
        closeDate: "2026-06-01",
        requirements: "CRM integration",
      });
      expect(categories).toEqual(["deal_data"]);
    });

    it("classifies proposal context fields", () => {
      const categories = categorizeIncludedFields({
        scope: "Full implementation",
        deliverables: "Dashboard + API",
      });
      expect(categories).toEqual(["proposal_context"]);
    });

    it("classifies engine internal fields", () => {
      const categories = categorizeIncludedFields({
        output: "some output",
        _stub: true,
        content: "hello",
      });
      expect(categories).toEqual(["engine_internal"]);
    });

    it("returns 'other' for unrecognized fields", () => {
      const categories = categorizeIncludedFields({
        customField: "value",
        anotherThing: 42,
      });
      expect(categories).toEqual(["other"]);
    });

    it("deduplicates categories from multiple fields", () => {
      const categories = categorizeIncludedFields({
        companyName: "Acme",
        industry: "Tech",
        firstName: "Jane",
        dealValue: 50000,
      });
      expect(categories).toEqual(["account_info", "contact_identity", "deal_data"]);
    });

    it("returns empty array for empty context", () => {
      expect(categorizeIncludedFields({})).toEqual([]);
    });
  });

  describe("auditCrmApiCall", () => {
    it("records an audit entry with all required fields", () => {
      const consoleSpy = jest.spyOn(console, "info").mockImplementation(() => {});

      auditCrmApiCall({
        userId: "user-123",
        runId: "run-456",
        stepId: "step-llm-1",
        stepKind: "llm",
        apiEndpoint: "anthropic/claude-sonnet-4-20250514",
        originalFieldCount: 8,
        sanitizedCtx: {
          companyName: "Acme",
          dealValue: 50000,
          requirements: "Integration",
        },
        blockedCategories: ["contact_pii", "financial"],
        strippedCount: 3,
      });

      const log = getAuditLog();
      expect(log).toHaveLength(1);

      const entry = log[0];
      expect(entry.userId).toBe("user-123");
      expect(entry.runId).toBe("run-456");
      expect(entry.stepId).toBe("step-llm-1");
      expect(entry.stepKind).toBe("llm");
      expect(entry.apiEndpoint).toBe("anthropic/claude-sonnet-4-20250514");
      expect(entry.includedFieldCategories).toEqual(["account_info", "deal_data"]);
      expect(entry.blockedFieldCategories).toEqual(["contact_pii", "financial"]);
      expect(entry.strippedFieldCount).toBe(3);
      expect(entry.totalFieldCount).toBe(8);
      expect(entry.timestamp).toBeTruthy();

      // Verify structured JSON was logged
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const loggedJson = JSON.parse(consoleSpy.mock.calls[0][0] as string);
      expect(loggedJson.level).toBe("audit");
      expect(loggedJson.event).toBe("crm_data_api_call");
    });

    it("records entry for agent step kind", () => {
      jest.spyOn(console, "info").mockImplementation(() => {});

      auditCrmApiCall({
        userId: "user-789",
        runId: "run-abc",
        stepId: "step-agent-1",
        stepKind: "agent",
        apiEndpoint: "openai/gpt-4o",
        originalFieldCount: 5,
        sanitizedCtx: { scope: "Full project" },
        blockedCategories: [],
        strippedCount: 0,
      });

      const log = getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].stepKind).toBe("agent");
      expect(log[0].blockedFieldCategories).toEqual([]);
      expect(log[0].strippedFieldCount).toBe(0);
    });

    it("does not include actual field values in audit entry", () => {
      jest.spyOn(console, "info").mockImplementation(() => {});

      auditCrmApiCall({
        userId: "user-1",
        runId: "run-1",
        stepId: "step-1",
        stepKind: "llm",
        apiEndpoint: "anthropic/claude-sonnet-4-20250514",
        originalFieldCount: 3,
        sanitizedCtx: {
          companyName: "Secret Corp",
          dealValue: 999999,
          requirements: "Very sensitive requirements text",
        },
        blockedCategories: ["contact_pii"],
        strippedCount: 2,
      });

      const entry = getAuditLog()[0];
      const serialized = JSON.stringify(entry);

      // Actual values must not appear in the audit entry
      expect(serialized).not.toContain("Secret Corp");
      expect(serialized).not.toContain("999999");
      expect(serialized).not.toContain("Very sensitive requirements text");
    });

    it("sorts blocked categories alphabetically", () => {
      jest.spyOn(console, "info").mockImplementation(() => {});

      auditCrmApiCall({
        userId: "u",
        runId: "r",
        stepId: "s",
        stepKind: "llm",
        apiEndpoint: "test",
        originalFieldCount: 5,
        sanitizedCtx: {},
        blockedCategories: ["social_media", "contact_pii", "auth"],
        strippedCount: 5,
      });

      expect(getAuditLog()[0].blockedFieldCategories).toEqual([
        "auth",
        "contact_pii",
        "social_media",
      ]);
    });

    it("accumulates multiple entries", () => {
      jest.spyOn(console, "info").mockImplementation(() => {});

      for (let i = 0; i < 3; i++) {
        auditCrmApiCall({
          userId: "u",
          runId: `run-${i}`,
          stepId: `step-${i}`,
          stepKind: "llm",
          apiEndpoint: "test",
          originalFieldCount: 1,
          sanitizedCtx: {},
          blockedCategories: [],
          strippedCount: 0,
        });
      }

      expect(getAuditLog()).toHaveLength(3);
    });
  });

  describe("clearAuditLog", () => {
    it("empties the audit log", () => {
      jest.spyOn(console, "info").mockImplementation(() => {});

      auditCrmApiCall({
        userId: "u",
        runId: "r",
        stepId: "s",
        stepKind: "llm",
        apiEndpoint: "test",
        originalFieldCount: 0,
        sanitizedCtx: {},
        blockedCategories: [],
        strippedCount: 0,
      });

      expect(getAuditLog()).toHaveLength(1);
      clearAuditLog();
      expect(getAuditLog()).toHaveLength(0);
    });
  });

  describe("Postgres persistence (B3/HEL-460)", () => {
    it("persists each entry to crm_data_access_log when Postgres is configured", async () => {
      mockIsPgConfigured.mockReturnValue(true);
      jest.spyOn(console, "info").mockImplementation(() => {});

      auditCrmApiCall({
        userId: "user-x",
        runId: "run-x",
        stepId: "step-x",
        stepKind: "llm",
        apiEndpoint: "anthropic/claude",
        originalFieldCount: 4,
        sanitizedCtx: { companyName: "Acme", dealValue: 1 },
        blockedCategories: ["contact_pii"],
        strippedCount: 1,
      });

      await flush(); // fire-and-forget persist settles

      expect(queryPostgresMock).toHaveBeenCalledTimes(1);
      const [sql, params] = queryPostgresMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("INSERT INTO crm_data_access_log");
      expect(params[0]).toBe("user-x"); // user_id
      expect(params[3]).toBe("llm"); // step_kind
      // categories are stored, never raw values
      expect(JSON.stringify(params)).not.toContain("Acme");
    });

    it("does not touch Postgres in dev/test (no DATABASE_URL)", async () => {
      jest.spyOn(console, "info").mockImplementation(() => {});
      auditCrmApiCall({
        userId: "u",
        runId: "r",
        stepId: "s",
        stepKind: "llm",
        apiEndpoint: "x",
        originalFieldCount: 0,
        sanitizedCtx: {},
        blockedCategories: [],
        strippedCount: 0,
      });
      await flush();
      expect(queryPostgresMock).not.toHaveBeenCalled();
    });

    it("getAuditLogAsync reads durable rows from Postgres", async () => {
      mockIsPgConfigured.mockReturnValue(true);
      queryPostgresMock.mockResolvedValueOnce({
        rows: [
          {
            user_id: "u1",
            run_id: "r1",
            step_id: "s1",
            step_kind: "agent",
            api_endpoint: "openai/gpt",
            included_field_categories: ["account_info"],
            blocked_field_categories: ["contact_pii"],
            stripped_field_count: 2,
            total_field_count: 5,
            recorded_at: new Date("2026-06-01T00:00:00Z"),
          },
        ],
      });

      const rows = await getAuditLogAsync({ userId: "u1" });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: "u1",
        stepKind: "agent",
        includedFieldCategories: ["account_info"],
        blockedFieldCategories: ["contact_pii"],
        strippedFieldCount: 2,
        totalFieldCount: 5,
      });
    });

    it("bounds the in-memory ring so it can't grow unbounded", () => {
      jest.spyOn(console, "info").mockImplementation(() => {});
      for (let i = 0; i < 1100; i++) {
        auditCrmApiCall({
          userId: "u",
          runId: `r${i}`,
          stepId: "s",
          stepKind: "llm",
          apiEndpoint: "x",
          originalFieldCount: 0,
          sanitizedCtx: {},
          blockedCategories: [],
          strippedCount: 0,
        });
      }
      expect(getAuditLog().length).toBeLessThanOrEqual(1000);
    });
  });
});
