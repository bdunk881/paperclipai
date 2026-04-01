import { Link } from "react-router-dom";
import { Cpu, User, Bell, Shield } from "lucide-react";

const SETTINGS_SECTIONS = [
  {
    to: "/settings/llm-providers",
    icon: Cpu,
    title: "LLM Providers",
    description: "Connect your own API keys for OpenAI, Anthropic, Gemini, and Mistral to use in workflows.",
  },
  {
    to: "/settings/profile",
    icon: User,
    title: "Profile",
    description: "Update your display name, email, and account preferences.",
    disabled: true,
  },
  {
    to: "/settings/notifications",
    icon: Bell,
    title: "Notifications",
    description: "Choose when and how you get notified about workflow runs and alerts.",
    disabled: true,
  },
  {
    to: "/settings/security",
    icon: Shield,
    title: "Security",
    description: "Manage your password, active sessions, and two-factor authentication.",
    disabled: true,
  },
];

export default function Settings() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Manage your account and workspace configuration.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {SETTINGS_SECTIONS.map(({ to, icon: Icon, title, description, disabled }) => {
          const card = (
            <div
              className={`bg-white rounded-xl border border-gray-200 p-6 flex items-start gap-4 transition-shadow ${
                disabled ? "opacity-50 cursor-not-allowed" : "hover:shadow-md cursor-pointer"
              }`}
            >
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex-shrink-0">
                <Icon size={20} />
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">
                  {title}
                  {disabled && (
                    <span className="ml-2 text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      Coming soon
                    </span>
                  )}
                </p>
                <p className="text-sm text-gray-500">{description}</p>
              </div>
            </div>
          );

          return disabled ? (
            <div key={to}>{card}</div>
          ) : (
            <Link key={to} to={to} className="block">
              {card}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
