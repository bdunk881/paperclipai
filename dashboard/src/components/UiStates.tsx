import { Loader2, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="rounded-md border border-af2-line bg-af2-card p-5">
      <div className="mb-4 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-af2-sage">
        <Loader2 size={14} className="animate-spin" />
        Live sync
      </div>
      <div className="scanline-skeleton h-3 rounded-full" />
      <div className="scanline-skeleton mt-3 h-3 w-3/4 rounded-full" />
      <p className="mt-4 text-sm text-af2-ink-3">{label}</p>
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-md border border-af2-clay/30 bg-af2-clay-soft/30 p-5">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-af2-ink">
        <AlertCircle size={16} className="text-af2-clay" />
        {title}
      </div>
      <p className="text-sm text-af2-ink-2">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center rounded-md border border-af2-clay bg-af2-clay px-3 py-1.5 text-xs font-medium text-white transition hover:bg-af2-clay-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  ctaLabel,
  ctaTo,
}: {
  title: string;
  description: string;
  ctaLabel?: string;
  ctaTo?: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-af2-line bg-af2-paper p-6 text-center">
      <h3 className="font-af2-serif text-lg font-medium text-af2-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-af2-ink-2">{description}</p>
      {ctaLabel && ctaTo && (
        <Link
          to={ctaTo}
          className="mt-4 inline-flex items-center rounded-md bg-af2-clay px-3.5 py-2 text-sm font-medium text-white transition hover:bg-af2-clay-2"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
