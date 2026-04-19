import { CheckCircle2, AlertCircle } from "lucide-react";

type ToastVariant = "success" | "error";

interface ToastProps {
  message: string;
  variant: ToastVariant;
}

export default function Toast({ message, variant }: ToastProps) {
  const icon = variant === "success"
    ? <CheckCircle2 size={16} className="text-green-600" />
    : <AlertCircle size={16} className="text-red-600" />;

  const classes = variant === "success"
    ? "border-green-200 bg-green-50 text-green-800"
    : "border-red-200 bg-red-50 text-red-800";

  return (
    <div className={`fixed right-6 top-6 z-50 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-sm ${classes}`}>
      {icon}
      <span>{message}</span>
    </div>
  );
}

