/**
 * HEL-286 — WebSocket upgrade handler for `/api/workflows/:workflowId/ydoc`.
 *
 * Drives the auth + workspace gate that Express middleware can't run on
 * upgrade events, then hands the socket to the per-workflow Y.Doc room.
 *
 * The dashboard's y-websocket client passes its bearer via the
 * `?access_token=` query param (browsers can't set headers on WS), mirroring
 * the EventSource shim in app.ts.
 */

import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { Pool } from "pg";
import { URL } from "node:url";
import { verifyBearerToken } from "../../auth/authMiddleware";
import {
  resolveWorkspaceRole,
  type WorkspaceRole,
} from "../../middleware/workspaceResolver";
import { withWorkspaceContext } from "../../middleware/workspaceContext";
import { WorkflowYDocRoom } from "./workflowYDocRoom";
import { createYDocSnapshotStore, type YDocSnapshotStore } from "./ydocSnapshotStore";

const YDOC_PATH = /^\/api\/workflows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/ydoc$/i;

const ALLOWED_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  "owner",
  "admin",
  "developer",
]);

export interface AttachYDocUpgradeHandlerOptions {
  pool: Pool;
  /** Test seam — defaults to createYDocSnapshotStore(pool). */
  snapshotStore?: YDocSnapshotStore;
}

export interface YDocUpgradeAttachment {
  rooms: Map<string, WorkflowYDocRoom>;
  detach(): Promise<void>;
}

export function attachYDocUpgradeHandler(
  server: HttpServer,
  options: AttachYDocUpgradeHandlerOptions,
): YDocUpgradeAttachment {
  const { pool } = options;
  const snapshotStore = options.snapshotStore ?? createYDocSnapshotStore(pool);

  const rooms = new Map<string, WorkflowYDocRoom>();
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = req.url ?? "";
    const pathname = url.split("?")[0] ?? "";
    const match = YDOC_PATH.exec(pathname);
    if (!match) {
      // Not ours. Other upgrade handlers (none today) get their turn.
      return;
    }
    const workflowId = match[1].toLowerCase();

    void authorizeAndUpgrade(req, socket, head, workflowId).catch((err: unknown) => {
      console.error(
        "[ydoc] upgrade handler crashed",
        err instanceof Error ? err.message : String(err),
      );
      rejectSocket(socket, 500, "Internal Server Error");
    });
  };

  async function authorizeAndUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    workflowId: string,
  ): Promise<void> {
    const reqUrl = new URL(req.url ?? "", "http://localhost");
    const token = reqUrl.searchParams.get("access_token");
    if (!token) {
      rejectSocket(socket, 401, "Missing access_token");
      return;
    }

    const verifyResult = await verifyBearerToken(token, { source: "ws-upgrade" });
    if (verifyResult.kind === "auth_not_configured") {
      rejectSocket(socket, 503, "Auth service not configured");
      return;
    }
    if (verifyResult.kind === "invalid") {
      rejectSocket(socket, 401, "Invalid or expired token");
      return;
    }

    const userId = verifyResult.auth.sub;
    const workspaceId =
      reqUrl.searchParams.get("workspaceId") ??
      verifyResult.auth.workspaceId ??
      null;
    if (!workspaceId || !isUuid(workspaceId)) {
      rejectSocket(socket, 400, "workspaceId required");
      return;
    }

    const role = await resolveWorkspaceRole(pool, workspaceId, userId);
    if (!role || !ALLOWED_ROLES.has(role)) {
      rejectSocket(socket, 403, "Forbidden");
      return;
    }

    // Defend against cross-workspace workflow access: verify the
    // workflow exists IN THIS workspace under RLS context.
    const exists = await withWorkspaceContext(
      pool,
      { workspaceId, userId },
      async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT id FROM workflows WHERE id = $1 LIMIT 1`,
          [workflowId],
        );
        return result.rows.length > 0;
      },
    );
    if (!exists) {
      rejectSocket(socket, 404, "Workflow not found");
      return;
    }

    let room = rooms.get(workflowId);
    if (!room) {
      room = new WorkflowYDocRoom(workflowId, workspaceId, { snapshotStore });
      rooms.set(workflowId, room);
    }
    const attachedRoom = room;

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      void attachedRoom.attachClient(ws, req, userId).catch((err: unknown) => {
        console.error(
          "[ydoc] attachClient failed",
          err instanceof Error ? err.message : String(err),
        );
        try {
          ws.close(1011, "attach failed");
        } catch {
          // ignore
        }
      });

      ws.on("close", () => {
        // Room GC: if the room has no live connections and isn't mid-flush,
        // drop it from the registry so a future attach starts clean.
        // The room's own close-handler runs flushAndStop concurrently; both
        // races are safe because rooms.delete is idempotent.
        queueMicrotask(() => {
          if (attachedRoom.connectionCount === 0) {
            rooms.delete(workflowId);
          }
        });
      });
    });
  }

  server.on("upgrade", onUpgrade);

  return {
    rooms,
    async detach() {
      server.off("upgrade", onUpgrade);
      // Flush every live room so a graceful shutdown doesn't lose state.
      await Promise.all(Array.from(rooms.values()).map((room) => room.flushAndStop()));
      rooms.clear();
      wss.close();
    },
  };
}

function rejectSocket(socket: Duplex, status: number, message: string): void {
  try {
    socket.write(
      `HTTP/1.1 ${status} ${message}\r\n` +
        `Connection: close\r\n` +
        `Content-Length: 0\r\n` +
        `\r\n`,
    );
  } catch {
    // best-effort — socket may already be dead
  }
  socket.destroy();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
