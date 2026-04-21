declare module "@xyflow/react" {
  import type * as React from "react";

  export type XYPosition = { x: number; y: number };

  export type Connection = {
    source: string | null;
    target: string | null;
  };

  export type Edge = {
    id: string;
    source: string;
    target: string;
    type?: string;
    animated?: boolean;
    className?: string;
    markerEnd?: unknown;
    style?: React.CSSProperties;
  };

  export type Node<T = unknown> = {
    id: string;
    type?: string;
    position: XYPosition;
    data: T;
    draggable?: boolean;
    selectable?: boolean;
  };

  export type NodeProps<T extends Node = Node> = {
    id: string;
    data: T["data"];
    selected?: boolean;
    dragging?: boolean;
  };

  export type NodeTypes = Record<string, React.ComponentType<NodeProps>>;

  export const Background: React.ComponentType<Record<string, unknown>>;
  export const Controls: React.ComponentType<Record<string, unknown>>;
  export const Handle: React.ComponentType<Record<string, unknown>>;
  export const ReactFlow: React.ComponentType<Record<string, unknown>>;

  export const MarkerType: {
    ArrowClosed: string;
  };

  export const Position: {
    Top: string;
    Bottom: string;
    Left: string;
    Right: string;
  };

  export const BackgroundVariant: {
    Dots: string;
  };
}
