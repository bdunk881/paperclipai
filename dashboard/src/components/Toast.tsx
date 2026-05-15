import { CheckCircle2, AlertCircle } from "lucide-react";

type ToastVariant = "success" | "error";

interface ToastProps {
  message: string;
  variant: ToastVariant;
}

// HEL-115 — v1 → v2 sweep. Success tone now uses af2-sage; error tone uses
// af2-clay. Matches the toast pattern in docs/design/v2/components.jsx.
export default function Toast({ message, variant }: ToastProps) {
  const icon =
    variant === "success" ? (
      <CheckCircle2 size={16} className="text-af2-sage" />
    ) : (
      <AlertCircle size={16} className="text-af2-clay" />
    );

  const classes =
    variant === "success"
      ? "border-af2-sage/40 bg-af2-sage/15 text-af2-ink"
      : "border-af2-clay/40 bg-af2-clay-soft/30 text-af2-ink";

  return (
    <div
      className={`fixed right-6 top-6 z-50 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-sm ${classes}`}
    >
      {icon}
      <span>{message}</span>
    </div>
  );
}
