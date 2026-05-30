import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { useYDoc, type UseYDocResult } from "./useYDoc";

type Handler = (...args: unknown[]) => void;

interface FakeProviderInstance {
  serverUrl: string;
  roomName: string;
  doc: unknown;
  options: { params?: Record<string, string>; connect?: boolean };
  destroyed: boolean;
  emit(event: string, ...args: unknown[]): void;
}

const mocks = vi.hoisted(() => {
  const providers: FakeProviderInstance[] = [];

  class FakeProvider implements FakeProviderInstance {
    handlers = new Map<string, Set<Handler>>();
    destroyed = false;

    constructor(
      public serverUrl: string,
      public roomName: string,
      public doc: unknown,
      public options: { params?: Record<string, string>; connect?: boolean },
    ) {
      providers.push(this);
    }

    on(event: string, handler: Handler): void {
      const handlers = this.handlers.get(event) ?? new Set<Handler>();
      handlers.add(handler);
      this.handlers.set(event, handlers);
    }

    off(event: string, handler: Handler): void {
      this.handlers.get(event)?.delete(handler);
    }

    emit(event: string, ...args: unknown[]): void {
      this.handlers.get(event)?.forEach((handler) => handler(...args));
    }

    destroy(): void {
      this.destroyed = true;
    }
  }

  return {
    activeWorkspaceId: "workspace-1" as string | null,
    getAccessToken: vi.fn<() => Promise<string | null>>(),
    providers,
    FakeProvider,
  };
});

vi.mock("y-websocket", () => ({ WebsocketProvider: mocks.FakeProvider }));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ getAccessToken: mocks.getAccessToken }),
}));

vi.mock("../context/useWorkspace", () => ({
  useWorkspace: () => ({ activeWorkspaceId: mocks.activeWorkspaceId }),
}));

function Probe({
  workflowId,
  onResult,
}: {
  workflowId: string | null;
  onResult?: (result: UseYDocResult) => void;
}) {
  const result = useYDoc(workflowId);
  onResult?.(result);
  return null;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useYDoc", () => {
  beforeEach(() => {
    mocks.activeWorkspaceId = "workspace-1";
    mocks.getAccessToken.mockReset();
    mocks.getAccessToken.mockResolvedValue("token-1");
    mocks.providers.length = 0;
  });

  it("does nothing without a workflow id", async () => {
    render(<Probe workflowId={null} />);

    await act(async () => {
      await flush();
    });

    expect(mocks.getAccessToken).not.toHaveBeenCalled();
    expect(mocks.providers).toHaveLength(0);
  });

  it("opens the workflow ydoc WebSocket with token and workspace params", async () => {
    render(<Probe workflowId="workflow-1" />);

    await act(async () => {
      await flush();
    });

    expect(mocks.providers).toHaveLength(1);
    const provider = mocks.providers[0]!;
    const url = new URL(provider.serverUrl);
    expect(url.protocol).toBe("ws:");
    expect(url.pathname).toBe("/api/workflows");
    expect(provider.roomName).toBe("workflow-1/ydoc");
    expect(provider.options.connect).toBe(true);
    expect(provider.options.params).toEqual({
      access_token: "token-1",
      workspaceId: "workspace-1",
    });
  });

  it("reports connection and sync status from the provider", async () => {
    let snapshot: UseYDocResult | undefined;
    render(
      <Probe
        workflowId="workflow-1"
        onResult={(result) => {
          snapshot = result;
        }}
      />,
    );

    await act(async () => {
      await flush();
    });

    expect(snapshot!.status).toBe("connecting");
    expect(snapshot!.synced).toBe(false);

    await act(async () => {
      mocks.providers[0]!.emit("status", { status: "connected" });
      mocks.providers[0]!.emit("sync", true);
    });

    expect(snapshot!.status).toBe("connected");
    expect(snapshot!.synced).toBe(true);

    await act(async () => {
      mocks.providers[0]!.emit("status", { status: "disconnected" });
    });

    expect(snapshot!.status).toBe("disconnected");
  });

  it("waits for an active workspace before connecting", async () => {
    mocks.activeWorkspaceId = null;
    render(<Probe workflowId="workflow-1" />);

    await act(async () => {
      await flush();
    });

    expect(mocks.providers).toHaveLength(0);
  });

  it("destroys the provider on unmount", async () => {
    const { unmount } = render(<Probe workflowId="workflow-1" />);

    await act(async () => {
      await flush();
    });

    const provider = mocks.providers[0]!;
    unmount();
    expect(provider.destroyed).toBe(true);
  });
});
