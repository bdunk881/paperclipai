import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { CheckCircle2, Activity, Users, Zap } from "lucide-react";
import { useOnboarding } from "../../context/OnboardingContext";
import type { WorkflowRun } from "../../types/workflow";

function trackEvent(name: string, props?: Record<string, unknown>) {
  console.info("[telemetry]", name, props);
}

export default function OnboardingSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state: onboarding, completeOnboarding } = useOnboarding();

  const run = (location.state as { run?: WorkflowRun } | null)?.run;

  useEffect(() => {
    trackEvent("onboarding.completed", { templateId: onboarding.selectedTemplateId });
    // Simulate email confirmation (real implementation would call backend)
    console.info("[email] Sending 'Your first AutoFlow run is live' to user");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleGoToDashboard() {
    completeOnboarding();
    navigate("/");
  }

  function handleViewMonitor() {
    completeOnboarding();
    navigate("/monitor");
  }

  function handleInviteTeammate() {
    navigate("/onboarding/invite");
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
        <span className="text-sm text-gray-500">Step 3 of 3 — Your first run is live</span>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-14">
        {/* Hero */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-4">
            <CheckCircle2 size={56} className="text-green-500" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Your workflow is running!</h1>
          <p className="text-gray-500">
            AutoFlow has started your first run. You'll receive a confirmation email once it
            completes.
          </p>
        </div>

        {/* Run summary */}
        {run && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <h2 className="font-semibold text-gray-900 mb-4">Run summary</h2>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Run ID</span>
                <span className="font-mono text-gray-700">{run.id}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Template</span>
                <span className="text-gray-700 font-medium">{run.templateName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Status</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-blue-700 font-medium capitalize">{run.status}</span>
                </span>
              </div>
              {run.stepResults.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Steps completed</span>
                  <span className="text-gray-700">
                    {run.stepResults.filter((s) => s.status === "success").length} /{" "}
                    {run.stepResults.length}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <button
            onClick={handleViewMonitor}
            data-testid="view-run-monitor-btn"
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
          >
            <Activity size={18} />
            View Run Monitor
          </button>
          <button
            onClick={handleInviteTeammate}
            data-testid="invite-teammate-btn"
            className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 font-semibold rounded-xl transition-colors"
          >
            <Users size={18} />
            Invite a teammate
          </button>
        </div>

        <div className="text-center">
          <button
            onClick={handleGoToDashboard}
            data-testid="go-to-dashboard-btn"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Skip to dashboard →
          </button>
        </div>
      </div>
    </div>
  );
}
