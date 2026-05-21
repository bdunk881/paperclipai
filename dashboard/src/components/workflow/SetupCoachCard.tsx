import type { ReactNode } from "react";

type Props = {
  index: number;
  total: number;
  title: string;
  hint?: string;
  children: ReactNode;
};

export function SetupCoachCard({ index, total, title, hint, children }: Props) {
  return (
    <section className="rounded-xl border border-af2-line bg-af2-paper-2/80 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-af2-ink-3">
        {index} of {total} — {title}
      </p>
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-af2-ink-4">{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
