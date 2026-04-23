import { WorkflowCategory, WorkflowTemplate } from "../types/workflow";

type TemplateBlueprint = {
  id: string;
  name: string;
  description: string;
  category: WorkflowCategory;
  inputLabel: string;
  inputKey: string;
  primaryEntity: string;
  objective: string;
  system: string;
  destination: string;
  action: string;
  scoreLabel?: string;
  scoreKey?: string;
};

export function createPipelineTemplate(blueprint: TemplateBlueprint): WorkflowTemplate {
  const scoreLabel = blueprint.scoreLabel ?? "Priority Score";
  const scoreKey = blueprint.scoreKey ?? "priorityScore";

  return {
    id: blueprint.id,
    name: blueprint.name,
    description: blueprint.description,
    category: blueprint.category,
    version: "1.0.0",
    configFields: [
      {
        key: "workspaceName",
        label: "Workspace Name",
        type: "string",
        required: true,
        description: "Used to contextualize generated summaries and routing decisions.",
      },
      {
        key: "systemOfRecord",
        label: "System of Record",
        type: "string",
        required: true,
        defaultValue: blueprint.system.toLowerCase(),
        description: "Primary external system this workflow updates.",
      },
      {
        key: "destinationQueue",
        label: "Destination Queue",
        type: "string",
        required: false,
        defaultValue: blueprint.destination,
        description: "Queue, channel, or downstream topic receiving the final payload.",
      },
      {
        key: "approvalThreshold",
        label: scoreLabel,
        type: "number",
        required: false,
        defaultValue: 70,
        description: "Threshold used by the routing step to determine the fast path.",
      },
    ],
    steps: [
      {
        id: "step_trigger",
        name: `Receive ${blueprint.inputLabel}`,
        kind: "trigger",
        description: `Accepts an inbound ${blueprint.inputLabel.toLowerCase()} payload.`,
        inputKeys: [],
        outputKeys: [blueprint.inputKey, "accountId", "source", "submittedAt"],
      },
      {
        id: "step_analyze",
        name: `Analyze ${blueprint.primaryEntity}`,
        kind: "llm",
        description: `Uses AI to summarize the ${blueprint.primaryEntity.toLowerCase()} and extract decision-ready metadata.`,
        inputKeys: ["workspaceName", blueprint.inputKey, "source"],
        outputKeys: ["summary", scoreKey, "recommendedAction"],
        promptTemplate:
          `You operate workflow automation for {{workspaceName}}.\n\n` +
          `${blueprint.inputLabel}: {{${blueprint.inputKey}}}\n` +
          `Source: {{source}}\n\n` +
          `Summarize the ${blueprint.primaryEntity.toLowerCase()}, estimate ${scoreLabel.toLowerCase()} from 0 to 100, and recommend the best next action for ${blueprint.objective}.\n` +
          "Respond with JSON containing summary, " +
          `${scoreKey}, recommendedAction.`,
      },
      {
        id: "step_route",
        name: "Route Outcome",
        kind: "condition",
        description: "Determines whether the workflow takes the fast path or review path.",
        inputKeys: [scoreKey, "approvalThreshold"],
        outputKeys: ["shouldFastTrack"],
        condition: `${scoreKey} >= approvalThreshold`,
      },
      {
        id: "step_execute",
        name: `Update ${blueprint.system}`,
        kind: "action",
        description: `Sends the recommended action to ${blueprint.system} and downstream automation.`,
        inputKeys: [
          "systemOfRecord",
          "destinationQueue",
          "accountId",
          "summary",
          scoreKey,
          "recommendedAction",
          "shouldFastTrack",
        ],
        outputKeys: ["recordId", "disposition"],
        action: blueprint.action,
      },
      {
        id: "step_output",
        name: "Emit Result",
        kind: "output",
        description: "Publishes the workflow result for analytics and audit trails.",
        inputKeys: ["recordId", "disposition", "shouldFastTrack"],
        outputKeys: ["event"],
      },
    ],
    sampleInput: {
      [blueprint.inputKey]: `${blueprint.inputLabel} payload for ${blueprint.name}`,
      accountId: "acct_demo_001",
      source: "api",
      submittedAt: "2026-04-19T16:00:00.000Z",
    },
    expectedOutput: {
      recordId: `${blueprint.id}-record-001`,
      disposition: "processed",
      shouldFastTrack: true,
      event: {
        type: `${blueprint.id}.completed`,
        destination: blueprint.destination,
      },
    },
  };
}
