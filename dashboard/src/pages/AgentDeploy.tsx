import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, LoaderCircle, Rocket } from "lucide-react";
import { createDeployment, getAgentTemplate } from "../data/agentMarketplaceData";

const PERMISSIONS = ["read", "write", "execute"] as const;
const DEPLOY_STAGES = ["Validating configuration", "Provisioning runtime", "Connecting integrations", "Finalizing deployment"];

export default function AgentDeploy() {
  const params = useParams();
  const navigate = useNavigate();
  const template = params.templateId ? getAgentTemplate(params.templateId) : null;

  const [name, setName] = useState(template ? `${template.name} Instance` : "");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(["read", "execute"]);
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>(template?.requiredIntegrations ?? []);
  const [isDeploying, setIsDeploying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isDeploying) return;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 100) {
          window.clearInterval(timer);
          return 100;
        }
        return current + 20;
      });
    }, 300);

    return () => window.clearInterval(timer);
  }, [isDeploying]);

  useEffect(() => {
    if (!template || !isDeploying || progress < 100) return;
    createDeployment({
      template,
      name: name.trim(),
      permissions: selectedPermissions,
      integrations: selectedIntegrations,
    });

    const doneTimer = window.setTimeout(() => {
      navigate("/agents/my");
    }, 400);

    return () => window.clearTimeout(doneTimer);
  }, [isDeploying, name, navigate, progress, selectedIntegrations, selectedPermissions, template]);

  const stage = useMemo(() => {
    const index = Math.min(Math.floor(progress / 25), DEPLOY_STAGES.length - 1);
    return DEPLOY_STAGES[index] ?? DEPLOY_STAGES[0];
  }, [progress]);

  if (!template) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-gray-900">Agent template not found</h1>
        <Link to="/agents" className="inline-flex items-center gap-2 mt-4 text-blue-600 hover:text-blue-700">
          <ArrowLeft size={14} />
          Back to catalog
        </Link>
      </div>
    );
  }

  const currentTemplate = template;
  const allIntegrations = [...currentTemplate.requiredIntegrations, ...currentTemplate.optionalIntegrations];

  function togglePermission(permission: string) {
    setSelectedPermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission]
    );
  }

  function toggleIntegration(integration: string) {
    if (currentTemplate.requiredIntegrations.includes(integration)) return;
    setSelectedIntegrations((current) =>
      current.includes(integration)
        ? current.filter((item) => item !== integration)
        : [...current, integration]
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    if (selectedPermissions.length === 0) return;
    if (!currentTemplate.requiredIntegrations.every((integration) => selectedIntegrations.includes(integration))) {
      return;
    }
    setIsDeploying(true);
    setProgress(10);
  }

  return (
    <div className="min-h-full bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        <Link to={`/agents/${template.id}`} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} />
          Back to details
        </Link>

        <div className="mt-4 bg-white rounded-xl border border-gray-200 p-6">
          <h1 className="text-2xl font-bold text-gray-900">Deploy {template.name}</h1>
          <p className="text-sm text-gray-500 mt-1">Configure runtime permissions and integrations before deployment.</p>

          <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
            <section>
              <label htmlFor="agent-name" className="block text-sm font-medium text-gray-700 mb-1.5">
                Agent name
              </label>
              <input
                id="agent-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter a deployment name"
                disabled={isDeploying}
              />
            </section>

            <section>
              <p className="text-sm font-medium text-gray-700 mb-2">Permissions</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {PERMISSIONS.map((permission) => (
                  <label key={permission} className="flex items-center gap-2 rounded-lg border border-gray-200 p-2.5 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={selectedPermissions.includes(permission)}
                      onChange={() => togglePermission(permission)}
                      disabled={isDeploying}
                    />
                    <span className="capitalize">{permission}</span>
                  </label>
                ))}
              </div>
            </section>

            <section>
              <p className="text-sm font-medium text-gray-700 mb-2">Integrations</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {allIntegrations.map((integration) => {
                  const required = template.requiredIntegrations.includes(integration);
                  const checked = selectedIntegrations.includes(integration);
                  return (
                    <label
                      key={integration}
                      className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-2.5 text-sm text-gray-700"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleIntegration(integration)}
                          disabled={isDeploying || required}
                        />
                        <span>{integration}</span>
                      </div>
                      {required ? (
                        <span className="text-xs font-medium text-blue-700 bg-blue-50 rounded-full px-2 py-0.5">required</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </section>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={isDeploying}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isDeploying ? <LoaderCircle size={14} className="animate-spin" /> : <Rocket size={14} />}
                {isDeploying ? "Deploying..." : "Deploy agent"}
              </button>
              <Link
                to="/agents/my"
                className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </Link>
            </div>
          </form>

          {isDeploying ? (
            <section className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-4">
              <p className="text-sm font-medium text-blue-800">Deploying agent</p>
              <p className="text-xs text-blue-700 mt-1">{stage}</p>
              <div className="mt-3 h-2 w-full rounded-full bg-blue-100">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-blue-700 mt-2">{progress}% complete</p>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
