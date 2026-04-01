import { Link } from "react-router-dom";
import { Cpu, User, Bell, Shield, Key } from "lucide-react";

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
  },
  {
    to: "/settings/notifications",
    icon: Bell,
    title: "Notifications",
    description: "Choose when and how you get notified about workflow runs and alerts.",
  },
  {
    to: "/settings/security",
    icon: Shield,
    title: "Security",
    description: "Manage your password, active sessions, and two-factor authentication.",
  },
  {
    to: "/settings/api-keys",
    icon: Key,
    title: "API Keys",
    description: "Generate and manage API keys for programmatic access to Alterflow.",
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
        {SETTINGS_SECTIONS.map(({ to, icon: Icon, title, description }) => (
          <Link key={to} to={to} className="block">
            <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-start gap-4 hover:shadow-md cursor-pointer transition-shadow">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex-shrink-0">
                <Icon size={20} />
              </div>
              <div>
                <p className="font-semibold text-gray-900 mb-1">{title}</p>
                <p className="text-sm text-gray-500">{description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
