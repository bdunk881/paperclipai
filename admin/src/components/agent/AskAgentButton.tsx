import { useState } from "react";
import { AskAgentModal, type AskAgentContext } from "./AskAgentModal";

export interface AskAgentButtonProps {
  context: AskAgentContext;
  label?: string;
  size?: "sm" | "md";
}

/**
 * Small "Ask agent →" affordance to sprinkle next to any alert / metric
 * / row / tile / job in the Infra UI. Opens AskAgentModal on click.
 */
export function AskAgentButton({ context, label = "Ask agent", size = "sm" }: AskAgentButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: size === "sm" ? "0.15rem 0.5rem" : "0.4rem 0.75rem",
          fontSize: size === "sm" ? "0.78rem" : "0.92rem",
          background: "transparent",
          border: "1px solid #c8ccd1",
          borderRadius: "4px",
          color: "#1f57d3",
        }}
        title="Send this context to a configured webhook with your question"
      >
        {label} →
      </button>
      <AskAgentModal open={open} context={context} onClose={() => setOpen(false)} />
    </>
  );
}
