import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2, Zap } from "lucide-react";
import clsx from "clsx";
import { listTemplates, type TemplateSummary } from "../../api/client";
import { useOnboarding } from "../../context/OnboardingContext";

const CATEGORY_COLORS: Record<string, { pill: string; dot: string }> = {
  support: { pill: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  sales: { pill: "bg-green-100 text-green-700", dot: "bg-green-500" },
  content: { pill: "bg-purple-100 text-purple-700", dot: "bg-purple-500" },
  custom: { pill: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
};

function CategoryPill({ category }: { category: string }) {
  const colors = CATEGORY_COLORS[category] ?? { pill: "bg-gray-100 text-gray-600", dot: "bg-gray-400" };
  return (
    <span className={clsx("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium", colors.pill)}>
      <span className={clsx("w-1.5 h-1.5 rounded-full", colors.dot)} />
      {category.charAt(0).toUpperCase() + category.slice(1)}
    </span>
  );
}

export default function OnboardingTemplatePicker() {
  const navigate = useNavigate();
  const { selectTemplate } = useOnboarding();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    listTemplates()
      .then(setTemplates)
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(id: string) {
    setSelected(id);
  }

  function handleContinue() {
    if (!selected) return;
    selectTemplate(selected);
    navigate(`/onboarding/configure/${selected}`);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600">
          <Zap size={16} className="text-white" />
        </div>
        <span className="font-bold text-gray-900">AutoFlow</span>
        <span className="text-gray-300 mx-2">|</span>
        <span className="text-sm text-gray-500">Step 1 of 3 — Choose a template</span>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Pick a workflow template</h1>
          <p className="text-gray-500">
            Choose the template that best fits your use case. You can configure it in the next step.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={32} className="animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => handleSelect(tpl.id)}
                data-testid={`template-card-${tpl.id}`}
                className={clsx(
                  "text-left bg-white rounded-xl border-2 p-5 transition-all shadow-sm hover:shadow-md",
                  selected === tpl.id
                    ? "border-blue-500 ring-2 ring-blue-100"
                    : "border-gray-200 hover:border-gray-300"
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <CategoryPill category={tpl.category} />
                  {selected === tpl.id && (
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">{tpl.name}</h3>
                <p className="text-sm text-gray-500 leading-relaxed mb-4 line-clamp-3">
                  {tpl.description}
                </p>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span>{tpl.stepCount} steps</span>
                  <span>·</span>
                  <span>{tpl.configFieldCount} config fields</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate("/onboarding")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={handleContinue}
            disabled={!selected}
            data-testid="template-picker-continue"
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
          >
            Configure template
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
