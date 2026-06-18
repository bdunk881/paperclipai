/**
 * HEL-709: typed per-run streams.
 *
 * `defineRunStream<T>(name)` declares a named stream with a compile-time chunk
 * type T; `.publish(workspaceId, runId, chunk)` emits a `stream.chunk` envelope
 * on the existing workspace stream (so it rides the HEL-708 per-run SSE for
 * free). The dashboard's `useRealtimeStream<T>(runId, name)` consumes it
 * type-safely. The transport is untyped (it's JSON over SSE); T is the
 * producer↔consumer contract, the trigger.dev `streams.define`/`streams.pipe`
 * pattern.
 */

import {
  publishWorkspaceStreamEvent,
  type WorkspaceStreamEnvelope,
} from "./agentTrace/streamPublisher";

export interface RunStream<T> {
  readonly name: string;
  /**
   * Emit a chunk to this run's stream. Best-effort + non-throwing: a streaming
   * failure must never break run execution (mirrors publishWorkspaceStreamEvent).
   */
  publish(workspaceId: string, runId: string, chunk: T): Promise<WorkspaceStreamEnvelope | null>;
}

export function defineRunStream<T>(name: string): RunStream<T> {
  return {
    name,
    async publish(workspaceId, runId, chunk) {
      if (!workspaceId || !runId) return null;
      try {
        return await publishWorkspaceStreamEvent(workspaceId, {
          kind: "stream.chunk",
          runId,
          streamName: name,
          chunk,
        });
      } catch {
        return null;
      }
    },
  };
}

/**
 * Built-in `progress` stream: the engine pipes one chunk per completed step so
 * a browser can render live step-by-step progress via
 * `useRealtimeStream<RunProgressChunk>(runId, "progress")`.
 */
export interface RunProgressChunk {
  index: number;
  stepId: string;
  stepName: string;
  status: "success" | "failure" | "skipped" | "running";
  durationMs: number;
}

export const runProgressStream = defineRunStream<RunProgressChunk>("progress");
