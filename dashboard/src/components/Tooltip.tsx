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
        className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 hidden w-max max-w-xs -translate-x-1/2 rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow-md group-hover:block group-focus-within:block"
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
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 outline-none ring-blue-500 transition hover:bg-gray-100 hover:text-gray-600 focus:ring-2"
      >
        <Info size={14} />
      </span>
    </Tooltip>
  );
}
