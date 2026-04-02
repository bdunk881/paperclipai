import { useNavigate } from "react-router-dom";
import { Zap, Bot, GitBranch, BarChart3, ArrowRight } from "lucide-react";
import { useOnboarding } from "../../context/OnboardingContext";

const VALUE_PROPS = [
  {
    icon: <Bot size={20} className="text-blue-600" />,
    title: "AI-powered workflows",
    body: "Chain LLM steps, conditions, and actions into automated pipelines without writing code.",
  },
  {
    icon: <GitBranch size={20} className="text-purple-600" />,
    title: "6 ready-made templates",
    body: "Start from a battle-tested template and customise it for your exact use case.",
  },
  {
    icon: <BarChart3 size={20} className="text-green-600" />,
    title: "Real-time run monitor",
    body: "Watch every step execute live, inspect outputs, and replay failed runs in one click.",
  },
];

export default function OnboardingWelcome() {
  const navigate = useNavigate();
  const { setStep } = useOnboarding();

  function handleGetStarted() {
    setStep("templates");
    navigate("/onboarding/templates");
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center px-4">
      <div className="w-full max-w-2xl">
        {/* Logo + heading */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-5 shadow-lg">
            <Zap size={28} className="text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight mb-3">
            Welcome to AutoFlow
          </h1>
          <p className="text-lg text-gray-500 max-w-md">
            You're two minutes away from your first automated AI workflow. Let's pick a template and
            run it.
          </p>
        </div>

        {/* Value props */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {VALUE_PROPS.map(({ icon, title, body }) => (
            <div
              key={title}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 text-center"
            >
              <div className="flex justify-center mb-3">{icon}</div>
              <p className="font-semibold text-gray-900 text-sm mb-1">{title}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleGetStarted}
            data-testid="onboarding-get-started"
            className="flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-md transition-colors text-base"
          >
            Get started
            <ArrowRight size={18} />
          </button>
          <p className="text-xs text-gray-400">No credit card required during beta</p>
        </div>
      </div>
    </div>
  );
}
