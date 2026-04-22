/**
 * Unit tests for AutoFlow workflow templates.
 * These tests validate the structure and integrity of each template
 * (step wiring, required config fields, sample data shape) without
 * requiring a live LLM or external service connection.
 */

import {
  WORKFLOW_TEMPLATES,
  TEMPLATE_MAP,
  getTemplate,
  getTemplatesByCategory,
  customerSupportBot,
  leadEnrichment,
  contentGenerator,
} from "./index";
import { WorkflowTemplate, WorkflowStep } from "../types/workflow";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectAllOutputKeys(steps: WorkflowStep[]): Set<string> {
  const keys = new Set<string>();
  steps.forEach((s) => s.outputKeys.forEach((k) => keys.add(k)));
  return keys;
}

function validateStepWiring(template: WorkflowTemplate): string[] {
  const errors: string[] = [];
  const availableKeys = new Set<string>();

  for (const step of template.steps) {
    // All input keys must be available from prior steps, the trigger, or config fields
    const configKeys = new Set(template.configFields.map((f) => f.key));
    for (const key of step.inputKeys) {
      if (!availableKeys.has(key) && !configKeys.has(key)) {
        errors.push(
          `Step "${step.id}": input key "${key}" is not produced by any prior step or config field`
        );
      }
    }
    step.outputKeys.forEach((k) => availableKeys.add(k));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Registry tests
// ---------------------------------------------------------------------------

describe("Template registry", () => {
  it("exports 13 templates", () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(13);
  });

  it("all templates are indexed in TEMPLATE_MAP", () => {
    WORKFLOW_TEMPLATES.forEach((t) => {
      expect(TEMPLATE_MAP[t.id]).toBe(t);
    });
  });

  it("getTemplate returns the correct template", () => {
    expect(getTemplate(customerSupportBot.id)).toBe(customerSupportBot);
    expect(getTemplate(leadEnrichment.id)).toBe(leadEnrichment);
    expect(getTemplate(contentGenerator.id)).toBe(contentGenerator);
  });

  it("getTemplate throws for unknown id", () => {
    expect(() => getTemplate("tpl-unknown")).toThrow("Workflow template not found");
  });

  it("getTemplatesByCategory filters correctly", () => {
    expect(getTemplatesByCategory("support")).toContain(customerSupportBot);
    expect(getTemplatesByCategory("sales")).toContain(leadEnrichment);
    expect(getTemplatesByCategory("content")).toContain(contentGenerator);
  });
});

// ---------------------------------------------------------------------------
// Per-template structural tests
// ---------------------------------------------------------------------------

describe.each(
  WORKFLOW_TEMPLATES.map((template) => [template.name, template] as [string, WorkflowTemplate])
)(
  "Template: %s",
  (_name, template) => {
    it("has a unique non-empty id", () => {
      expect(typeof template.id).toBe("string");
      expect(template.id.length).toBeGreaterThan(0);
    });

    it("has at least one config field", () => {
      expect(template.configFields.length).toBeGreaterThan(0);
    });

    it("all required config fields have no defaultValue (or explicit default)", () => {
      template.configFields.forEach((f) => {
        if (!f.required) {
          // non-required fields should have a default
          expect(f.defaultValue).toBeDefined();
        }
      });
    });

    it("has at least 4 steps", () => {
      expect(template.steps.length).toBeGreaterThanOrEqual(4);
    });

    it("first step is a trigger", () => {
      expect(template.steps[0].kind).toBe("trigger");
    });

    it("has at least one LLM step", () => {
      const llmSteps = template.steps.filter((s) => s.kind === "llm");
      expect(llmSteps.length).toBeGreaterThanOrEqual(1);
    });

    it("all LLM steps have a promptTemplate", () => {
      template.steps
        .filter((s) => s.kind === "llm")
        .forEach((s) => {
          expect(typeof s.promptTemplate).toBe("string");
          expect(s.promptTemplate!.length).toBeGreaterThan(0);
        });
    });

    it("step ids are unique within the template", () => {
      const ids = template.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("step wiring is valid (no missing input keys)", () => {
      const errors = validateStepWiring(template);
      expect(errors).toEqual([]);
    });

    it("has a non-empty sampleInput", () => {
      expect(Object.keys(template.sampleInput).length).toBeGreaterThan(0);
    });

    it("has a non-empty expectedOutput", () => {
      expect(Object.keys(template.expectedOutput).length).toBeGreaterThan(0);
    });
  }
);

// ---------------------------------------------------------------------------
// Customer Support Bot — domain-specific tests
// ---------------------------------------------------------------------------

describe("Customer Support Bot — domain checks", () => {
  const tpl = customerSupportBot;

  it("has both auto-respond and escalate config fields", () => {
    const keys = tpl.configFields.map((f) => f.key);
    expect(keys).toContain("autoRespondCategories");
    expect(keys).toContain("escalateCategories");
  });

  it("classify step outputs intent and sentiment", () => {
    const classify = tpl.steps.find((s) => s.id === "step_classify")!;
    expect(classify.outputKeys).toContain("intent");
    expect(classify.outputKeys).toContain("sentiment");
  });

  it("route step uses condition based on intent", () => {
    const route = tpl.steps.find((s) => s.id === "step_route")!;
    expect(route.kind).toBe("condition");
    expect(route.condition).toContain("intent");
  });

  it("sample input matches expected trigger output keys", () => {
    const trigger = tpl.steps[0];
    trigger.outputKeys.forEach((k) => {
      expect(tpl.sampleInput).toHaveProperty(k);
    });
  });
});

// ---------------------------------------------------------------------------
// Lead Enrichment — domain-specific tests
// ---------------------------------------------------------------------------

describe("Lead Enrichment — domain checks", () => {
  const tpl = leadEnrichment;

  it("score step outputs a leadScore", () => {
    const score = tpl.steps.find((s) => s.id === "step_score_lead")!;
    expect(score.outputKeys).toContain("leadScore");
    expect(score.outputKeys).toContain("scoringRationale");
  });

  it("route step uses hotLeadThreshold condition", () => {
    const route = tpl.steps.find((s) => s.id === "step_route")!;
    expect(route.condition).toContain("hotLeadThreshold");
    expect(route.condition).toContain("leadScore");
  });

  it("CRM upsert step references crmIntegration config", () => {
    const upsert = tpl.steps.find((s) => s.id === "step_upsert_crm")!;
    expect(upsert.inputKeys).toContain("crmIntegration");
  });

  it("expected output reflects hot lead routing", () => {
    expect(tpl.expectedOutput.isHotLead).toBe(true);
    expect(tpl.expectedOutput.crmPipeline).toBe("hot_leads");
  });
});

// ---------------------------------------------------------------------------
// Content Generator — domain-specific tests
// ---------------------------------------------------------------------------

describe("Content Generator — domain checks", () => {
  const tpl = contentGenerator;

  it("brand rewrite step outputs confidenceScore", () => {
    const rewrite = tpl.steps.find((s) => s.id === "step_brand_rewrite")!;
    expect(rewrite.outputKeys).toContain("confidenceScore");
    expect(rewrite.outputKeys).toContain("finalContent");
    expect(rewrite.outputKeys).toContain("seoSlug");
  });

  it("assemble step produces a contentDocument", () => {
    const assemble = tpl.steps.find((s) => s.id === "step_assemble")!;
    expect(assemble.outputKeys).toContain("contentDocument");
  });

  it("route condition uses confidenceScore and autoPublishThreshold", () => {
    const route = tpl.steps.find((s) => s.id === "step_route")!;
    expect(route.condition).toContain("confidenceScore");
    expect(route.condition).toContain("autoPublishThreshold");
  });

  it("sample input has required brief fields", () => {
    const required = ["topic", "keywords", "audience", "format", "wordCount"];
    required.forEach((k) => {
      expect(tpl.sampleInput).toHaveProperty(k);
    });
  });
});
