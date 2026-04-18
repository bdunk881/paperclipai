import { Loader2, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
      <Loader2 size={16} className="animate-spin text-blue-600" />
      <span>{label}</span>
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
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-900/60 dark:bg-red-950/40">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700">
        <AlertCircle size={16} />
        {title}
      </div>
      <p className="text-sm text-red-700">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900/40"
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
    <div className="rounded-xl border border-dashed border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 p-6 text-center dark:border-gray-700 dark:from-gray-900 dark:to-gray-800">
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
