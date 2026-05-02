import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Zap } from "lucide-react";
import { listTemplates, type TemplateSummary } from "../api/client";
import { useAuth } from "../context/AuthContext";

export default function Templates() {
  const navigate = useNavigate();
  const { getAccessToken } = useAuth();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAccessToken()
      .then(() => listTemplates())
      .then((results) => {
        if (!cancelled) setTemplates(results);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load templates");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="animate-spin text-teal-400" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-400">
        <p className="text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:border-slate-500"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-100">Workflow Templates</h1>
        <p className="mt-2 text-sm text-slate-400">
          Choose a template to launch a new workflow in the builder.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-700 py-16 text-slate-500">
          <Zap size={28} />
          <p className="text-sm">No templates available yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => navigate(`/templates/${template.id}`)}
              className="group flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-left transition hover:border-teal-500/50 hover:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  {template.category}
                </span>
                <span className="text-[10px] text-slate-600">v{template.version}</span>
              </div>
              <div>
                <h3 className="font-semibold text-slate-100 group-hover:text-teal-300 transition">
                  {template.name}
                </h3>
                <p className="mt-1 text-xs text-slate-400 line-clamp-2">{template.description}</p>
              </div>
              <div className="mt-auto flex gap-4 text-xs text-slate-500">
                <span>{template.stepCount} steps</span>
                <span>{template.configFieldCount} config fields</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
