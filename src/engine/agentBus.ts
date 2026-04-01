/**
 * Agent message bus — in-process pub/sub for manager↔worker communication.
 *
 * Each workflow run gets an isolated bus instance keyed by runId + stepId so
 * messages from different steps never cross-contaminate.
 *
 * Upgrade path: replace the EventEmitter backbone with a Redis pub/sub client
 * (ioredis) — the caller API (publish / subscribe / drain) stays the same.
 */

import { EventEmitter } from "events";
import type { AgentMessage } from "../types/workflow";

export class AgentBus {
  private readonly emitter = new EventEmitter();
  private readonly log: AgentMessage[] = [];

  /** Publish a message on the bus and append it to the replay log. */
  publish(msg: AgentMessage): void {
    this.log.push(msg);
    this.emitter.emit("message", msg);
  }

  /** Subscribe to all future messages on this bus. */
  subscribe(handler: (msg: AgentMessage) => void): () => void {
    this.emitter.on("message", handler);
    return () => this.emitter.off("message", handler);
  }

  /** Return all messages recorded so far (ordered chronologically). */
  drain(): AgentMessage[] {
    return [...this.log];
  }
}

// ---------------------------------------------------------------------------
// Bus registry — keyed by `${runId}:${stepId}` so each agent step in each run
// gets its own isolated channel.
// ---------------------------------------------------------------------------

const registry = new Map<string, AgentBus>();

export function getBus(runId: string, stepId: string): AgentBus {
  const key = `${runId}:${stepId}`;
  let bus = registry.get(key);
  if (!bus) {
    bus = new AgentBus();
    registry.set(key, bus);
  }
  return bus;
}

/** Clean up bus state after a run finishes to avoid memory leaks. */
export function releaseBus(runId: string, stepId: string): void {
  registry.delete(`${runId}:${stepId}`);
}
