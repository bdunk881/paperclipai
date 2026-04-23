import { LlmTier } from "./llmRouter";
import { PromptFeatures } from "./promptFeatures";

const DEFAULT_RING_BUFFER_SIZE = 1000;

function parseRingBufferSize(raw: string | undefined): number {
  if (!raw) return DEFAULT_RING_BUFFER_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RING_BUFFER_SIZE;
  }
  return parsed;
}

export interface ClassificationDecisionLogEntry {
  timestamp: string;
  promptHash: string;
  features: PromptFeatures;
  selectedTier: LlmTier;
  confidenceScore: number;
  modelId: string;
}

export interface ClassificationDecisionLogInput {
  promptHash: string;
  features: PromptFeatures;
  selectedTier: LlmTier;
  confidenceScore: number;
  modelId: string;
}

class ClassificationDecisionLogStore {
  private readonly capacity: number;
  private readonly entries: ClassificationDecisionLogEntry[] = [];

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  log(input: ClassificationDecisionLogInput): ClassificationDecisionLogEntry {
    const entry: ClassificationDecisionLogEntry = {
      timestamp: new Date().toISOString(),
      promptHash: input.promptHash,
      features: input.features,
      selectedTier: input.selectedTier,
      confidenceScore: input.confidenceScore,
      modelId: input.modelId,
    };

    if (this.entries.length >= this.capacity) {
      this.entries.shift();
    }
    this.entries.push(entry);
    return entry;
  }

  list(): ClassificationDecisionLogEntry[] {
    return [...this.entries];
  }

  getCapacity(): number {
    return this.capacity;
  }

  clear(): void {
    this.entries.length = 0;
  }
}

const routingDecisionLog = new ClassificationDecisionLogStore(
  parseRingBufferSize(process.env.CLASSIFICATION_LOG_RING_BUFFER_SIZE)
);

export function logClassificationDecision(input: ClassificationDecisionLogInput): ClassificationDecisionLogEntry {
  return routingDecisionLog.log(input);
}

export function listClassificationDecisions(): ClassificationDecisionLogEntry[] {
  return routingDecisionLog.list();
}

export function getClassificationDecisionLogCapacity(): number {
  return routingDecisionLog.getCapacity();
}

export function clearClassificationDecisionsForTests(): void {
  routingDecisionLog.clear();
}
