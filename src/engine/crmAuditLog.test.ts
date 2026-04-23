import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  auditCrmApiCall,
  categorizeIncludedFields,
  getAuditLog,
  clearAuditLog,
  CrmAuditEntry,
} from "./crmAuditLog";

describe("crmAuditLog", () => {
  beforeEach(() => {
    clearAuditLog();
    vi.restoreAllMocks();
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
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

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
      expect(consoleSpy).toHaveBeenCalledOnce();
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
});
