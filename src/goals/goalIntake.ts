import { z } from "zod";

const goalSourceDocumentSchema = z.object({
  sourceType: z.enum(["notion", "google-doc", "markdown"]),
  content: z.string().trim().min(1),
});

export const goalIntakeRequestSchema = z.object({
  goal: z.string().trim().min(1),
  answers: z.record(z.string().trim().min(1)).optional().default({}),
  sourceDocument: goalSourceDocumentSchema.optional(),
  readinessThreshold: z.number().min(0).max(1).optional().default(0.75),
});

const clarifyingQuestionSchema = z.object({
  id: z.string().trim().min(1),
  question: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  field: z.enum(["success_metrics", "constraints", "target_customer", "budget", "time_horizon", "other"]),
});

const normalizedGoalDocumentSchema = z.object({
  sourceType: z.enum(["free_text", "notion", "google-doc", "markdown"]),
  goal: z.string().trim().min(1),
  targetCustomer: z.string().trim().nullable(),
  successMetrics: z.array(z.string().trim().min(1)),
  constraints: z.array(z.string().trim().min(1)),
  budget: z.string().trim().nullable(),
  timeHorizon: z.string().trim().nullable(),
  importedContextSummary: z.string().trim().nullable().optional(),
  planReadinessThreshold: z.number().min(0).max(1),
});

const prdSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  targetCustomer: z.string().trim().min(1),
  problemStatement: z.string().trim().min(1),
  proposedSolution: z.string().trim().min(1),
  successMetrics: z.array(z.string().trim().min(1)).min(1),
  constraints: z.array(z.string().trim().min(1)).min(1),
  budget: z.string().trim().min(1),
  timeHorizon: z.string().trim().min(1),
  assumptions: z.array(z.string().trim().min(1)).default([]),
  risks: z.array(z.string().trim().min(1)).default([]),
  openQuestions: z.array(z.string().trim().min(1)).default([]),
});

const goalIntakeResultSchema = z
  .object({
    status: z.enum(["needs_clarification", "ready"]),
    readinessScore: z.number().min(0).max(1),
    missingInformation: z.array(z.string().trim().min(1)).default([]),
    clarifyingQuestions: z.array(clarifyingQuestionSchema).default([]),
    prd: prdSchema.nullable(),
    normalizedGoalDocument: normalizedGoalDocumentSchema,
  })
  .superRefine((value, ctx) => {
    if (value.status === "ready" && !value.prd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ready responses must include a PRD",
        path: ["prd"],
      });
    }

    if (value.status === "needs_clarification" && value.clarifyingQuestions.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "needs_clarification responses must include clarifying questions",
        path: ["clarifyingQuestions"],
      });
    }
  });

export type GoalIntakeRequest = z.infer<typeof goalIntakeRequestSchema>;
export type GoalIntakeResult = z.infer<typeof goalIntakeResultSchema>;

export function buildGoalIntakePrompt(input: GoalIntakeRequest): string {
  const importedContext = input.sourceDocument
    ? `Imported PRD context (${input.sourceDocument.sourceType}):\n${input.sourceDocument.content.trim()}`
    : "Imported PRD context: none";

  const priorAnswers =
    Object.keys(input.answers).length > 0
      ? JSON.stringify(input.answers, null, 2)
      : "{}";

  return [
    "You convert business goals into structured PRDs.",
    `Plan-readiness threshold: ${input.readinessThreshold}.`,
    "Return JSON only. Do not wrap the response in markdown fences.",
    "Decide whether the request is ready for a PRD or still needs clarification.",
    "A request is ready only if success metrics, constraints, target customer, budget, and time horizon are sufficiently specified.",
    "",
    "Return this JSON object shape:",
    "{",
    '  "status": "needs_clarification" | "ready",',
    '  "readinessScore": number,',
    '  "missingInformation": string[],',
    '  "clarifyingQuestions": [',
    '    { "id": string, "question": string, "rationale": string, "field": "success_metrics" | "constraints" | "target_customer" | "budget" | "time_horizon" | "other" }',
    "  ],",
    '  "prd": {',
    '    "title": string,',
    '    "summary": string,',
    '    "targetCustomer": string,',
    '    "problemStatement": string,',
    '    "proposedSolution": string,',
    '    "successMetrics": string[],',
    '    "constraints": string[],',
    '    "budget": string,',
    '    "timeHorizon": string,',
    '    "assumptions": string[],',
    '    "risks": string[],',
    '    "openQuestions": string[]',
    "  } | null,",
    '  "normalizedGoalDocument": {',
    '    "sourceType": "free_text" | "notion" | "google-doc" | "markdown",',
    '    "goal": string,',
    '    "targetCustomer": string | null,',
    '    "successMetrics": string[],',
    '    "constraints": string[],',
    '    "budget": string | null,',
    '    "timeHorizon": string | null,',
    '    "importedContextSummary": string | null,',
    '    "planReadinessThreshold": number',
    "  }",
    "}",
    "",
    "Rules:",
    "- If the request is ambiguous or incomplete, set status to needs_clarification.",
    "- Ask concise, non-overlapping clarifying questions that move the request toward the threshold.",
    "- If status is ready, include a complete PRD and keep clarifyingQuestions empty.",
    "- Use null for unknown scalar fields in normalizedGoalDocument and [] for unknown list fields.",
    "- Fold imported PRD context into the interpretation when relevant, but prefer current user intent if they conflict.",
    "",
    `Goal:\n${input.goal.trim()}`,
    "",
    `Prior answers:\n${priorAnswers}`,
    "",
    importedContext,
  ].join("\n");
}

export function parseGoalIntakeResponse(rawText: string): GoalIntakeResult {
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(cleaned) as unknown;
  return goalIntakeResultSchema.parse(parsed);
}
