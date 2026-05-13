import clsx from "clsx";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

export function Tooltip({
  content,
  children,
  className,
}: {
  content: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={clsx("group relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 hidden w-max max-w-xs -translate-x-1/2 rounded-md bg-af2-ink px-2 py-1 text-xs text-af2-paper shadow-[0_8px_24px_rgba(26,20,16,0.18)] group-hover:block group-focus-within:block"
      >
        {content}
      </span>
    </span>
  );
}

export function InfoTooltip({ content, className }: { content: string; className?: string }) {
  return (
    <Tooltip content={content} className={className}>
      <span
        tabIndex={0}
        aria-label={content}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-af2-ink-3 outline-none ring-af2-clay/40 transition hover:bg-af2-paper-2 hover:text-af2-ink focus:ring-2"
      >
        <Info size={14} />
      </span>
    </Tooltip>
  );
}
