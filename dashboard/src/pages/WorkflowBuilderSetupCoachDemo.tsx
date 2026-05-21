import { MemoryRouter } from "react-router-dom";
import type { WorkflowStep } from "../types/workflow";
import { StepSetupCoach, buildStepSetupContext } from "../components/workflow/StepSetupCoach";

const DEMO_STEP: WorkflowStep = {
  id: "support-llm",
  name: "Classify request",
  kind: "llm",
  description: "Determine category, urgency, and summary.",
  inputKeys: ["ticket"],
  outputKeys: ["classification"],
  promptTemplate: "",
};

export default function WorkflowBuilderSetupCoachDemo() {
  const template = {
    id: "demo",
    name: "Customer Support Bot",
    description: "",
    category: "support" as const,
    version: "1",
    configFields: [],
    steps: [
      {
        id: "t1",
        name: "Intake",
        kind: "trigger" as const,
        description: "",
        inputKeys: [],
        outputKeys: ["ticket"],
      },
      DEMO_STEP,
    ],
    sampleInput: {},
    expectedOutput: {},
  };

  const ctx = buildStepSetupContext(template, [], [], (k) => k);

  return (
    <MemoryRouter>
      <div className="flex h-screen bg-af2-paper">
        <div className="flex-1 p-8 text-af2-ink-3">Canvas preview (demo)</div>
        <aside className="w-[360px] border-l border-af2-line bg-af2-card shadow-xl">
          <StepSetupCoach
            step={DEMO_STEP}
            setupContext={ctx}
            llmConfigs={[]}
            onUpdateStep={() => undefined}
            onSuggestedAction={() => undefined}
            advancedContent={<p className="text-xs text-af2-ink-4">Advanced fields appear here in Studio.</p>}
          />
        </aside>
      </div>
    </MemoryRouter>
  );
}
