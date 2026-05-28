// HEL-286 — minimal ambient declarations for the y-websocket internals
// we depend on. The package ships as plain JavaScript with no .d.ts, so
// this file is the only place we let the untyped surface in. Everything
// in src/workflows/ydoc/ imports from here, not from "y-websocket/bin/*"
// directly, so the rest of the codebase sees a typed boundary.
//
// Only the symbols we actually call are declared. Don't expand this
// surface without checking the y-websocket source — overdeclaring would
// hide upstream API drift behind type fiction.

declare module "y-websocket/bin/utils" {
  import type { Doc as YDoc } from "yjs";
  import type { Awareness } from "y-protocols/awareness";
  import type { IncomingMessage } from "node:http";
  import type { WebSocket } from "ws";

  /**
   * A Y.Doc with the y-websocket extras (connection registry + awareness)
   * that `getYDoc` / `setupWSConnection` return.
   */
  export interface WSSharedDoc extends YDoc {
    name: string;
    conns: Map<WebSocket, Set<number>>;
    awareness: Awareness;
  }

  /** Get or create the named shared doc. */
  export function getYDoc(docname: string, gc?: boolean): WSSharedDoc;

  /** Wire a WS connection into a shared doc — sync + awareness framing. */
  export function setupWSConnection(
    conn: WebSocket,
    req: IncomingMessage,
    options?: { docName?: string; gc?: boolean },
  ): void;

  export interface PersistenceCallbacks {
    bindState: (docName: string, ydoc: WSSharedDoc) => Promise<void> | void;
    writeState: (docName: string, ydoc: WSSharedDoc) => Promise<void> | void;
    provider?: unknown;
  }

  /** Register persistence callbacks. Called once at process startup. */
  export function setPersistence(callbacks: PersistenceCallbacks | null): void;

  /** The live registry of shared docs, keyed by docname. */
  export const docs: Map<string, WSSharedDoc>;
}
