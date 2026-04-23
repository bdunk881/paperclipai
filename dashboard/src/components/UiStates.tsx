import { Loader2, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="rounded-2xl border border-teal-100 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300">
        <Loader2 size={14} className="animate-spin" />
        Live Sync
      </div>
      <div className="scanline-skeleton h-3 rounded-full" />
      <div className="scanline-skeleton mt-3 h-3 w-3/4 rounded-full" />
      <p className="mt-4 text-sm text-gray-500 dark:text-gray-300">{label}</p>
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
    <div className="signal-lost rounded-2xl border border-slate-300 bg-white/90 p-5 dark:border-surface-700 dark:bg-surface-900/90">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
        <AlertCircle size={16} />
        {title}
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-lg border border-indigo-200 bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 dark:border-indigo-500/40"
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
    <div className="rounded-xl border border-dashed border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 p-6 text-center dark:border-surface-800 dark:from-surface-900 dark:to-surface-800">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 dark:text-gray-300">{description}</p>
      {ctaLabel && ctaTo && (
        <Link
          to={ctaTo}
          className="mt-4 inline-flex items-center rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
