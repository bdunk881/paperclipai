import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Send, Check, Users } from "lucide-react";
import { useOnboarding } from "../../context/OnboardingContext";

export default function OnboardingInviteTeammate() {
  const navigate = useNavigate();
  const { completeOnboarding } = useOnboarding();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [sent, setSent] = useState(false);

  function validate(): boolean {
    if (!email.trim()) {
      setEmailError("Email address is required.");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError("Please enter a valid email address.");
      return false;
    }
    setEmailError("");
    return true;
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    // Stub — real implementation would call POST /api/invites
    console.info("[invite] Sending invite to", email);
    setSent(true);
  }

  function handleFinish() {
    completeOnboarding();
    navigate("/");
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
        <span className="text-sm text-gray-500">Invite your team</span>
      </div>

      <div className="max-w-md mx-auto px-6 py-16">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center">
              <Users size={28} className="text-indigo-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Invite a teammate</h1>
          <p className="text-gray-500 text-sm">
            Better together — share AutoFlow with a colleague to collaborate on workflows.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          {sent ? (
            <div className="text-center py-4">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                  <Check size={24} className="text-green-600" />
                </div>
              </div>
              <p className="font-semibold text-gray-900 mb-1">Invite sent!</p>
              <p className="text-sm text-gray-500 mb-6">
                We've sent an invite to <strong>{email}</strong>.
              </p>
              <button
                onClick={handleFinish}
                data-testid="invite-finish-btn"
                className="w-full px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
              >
                Go to dashboard
              </button>
            </div>
          ) : (
            <form onSubmit={handleSend} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Teammate's email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError("");
                  }}
                  placeholder="colleague@company.com"
                  data-testid="invite-email-input"
                  className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    emailError ? "border-red-300 bg-red-50" : "border-gray-300"
                  }`}
                />
                {emailError && <p className="mt-1 text-xs text-red-600">{emailError}</p>}
              </div>
              <button
                type="submit"
                data-testid="send-invite-btn"
                className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
              >
                <Send size={15} />
                Send invite
              </button>
            </form>
          )}
        </div>

        {!sent && (
          <div className="mt-4 text-center">
            <button
              onClick={handleFinish}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
