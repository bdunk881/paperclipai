import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { workflowYDocWebSocketUrl } from "../api/workflowsApi";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";

export type YDocConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface UseYDocResult {
  doc: Y.Doc | null;
  status: YDocConnectionStatus;
  synced: boolean;
}

type WebsocketStatusEvent = {
  status?: "connected" | "disconnected";
};

/**
 * Open the workflow Y.Doc WebSocket. The browser cannot set Authorization
 * headers on WebSocket upgrades, so the access token uses the same
 * `?access_token=` query-param shim as presence SSE.
 */
export function useYDoc(workflowId: string | null): UseYDocResult {
  const { getAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [status, setStatus] = useState<YDocConnectionStatus>("idle");
  const [synced, setSynced] = useState(false);

  const doc = useMemo(() => {
    if (!workflowId) return null;
    return new Y.Doc();
  }, [workflowId]);

  useEffect(() => {
    let cancelled = false;
    setAccessToken(null);

    if (!workflowId) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const token = await getAccessToken();
        if (!cancelled) setAccessToken(token ?? null);
      } catch {
        if (!cancelled) setAccessToken(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workflowId, getAccessToken]);

  useEffect(() => {
    if (!workflowId || !doc || !accessToken || !activeWorkspaceId) {
      setStatus("idle");
      setSynced(false);
      return;
    }

    setStatus("connecting");
    setSynced(false);

    const provider = new WebsocketProvider(
      workflowYDocWebSocketUrl(),
      `${workflowId}/ydoc`,
      doc,
      {
        connect: true,
        params: {
          access_token: accessToken,
          workspaceId: activeWorkspaceId,
        },
      },
    );

    const handleStatus = (event: WebsocketStatusEvent): void => {
      setStatus(event.status === "connected" ? "connected" : "disconnected");
    };
    const handleSync = (isSynced: boolean): void => {
      setSynced(isSynced);
    };
    const handleConnectionError = (): void => {
      setStatus("error");
      setSynced(false);
    };

    provider.on("status", handleStatus);
    provider.on("sync", handleSync);
    provider.on("connection-error", handleConnectionError);

    return () => {
      provider.off("status", handleStatus);
      provider.off("sync", handleSync);
      provider.off("connection-error", handleConnectionError);
      provider.destroy();
      setSynced(false);
    };
  }, [workflowId, doc, accessToken, activeWorkspaceId]);

  return { doc, status, synced };
}
