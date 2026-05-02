import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Rocket } from "lucide-react";
import { getAgentCatalogTemplate, type AgentCatalogTemplate } from "../api/agentCatalog";
import { useAuth } from "../context/AuthContext";

export default function AgentDetail() {
  const params = useParams();
  const { getAccessToken } = useAuth();
  const [template, setTemplate] = useState<AgentCatalogTemplate | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const accessToken = await getAccessToken();
      if (!accessToken || !params.templateId) {
        setTemplate(null);
        return;
      }

      const nextTemplate = await getAgentCatalogTemplate(params.templateId, accessToken);
      setTemplate(nextTemplate);
    })();
  }, [getAccessToken, params.templateId]);

  if (template === undefined) {
    return <div className="p-8 text-sm text-gray-500">Loading agent template...</div>;
  }

  if (!template) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-gray-900">Agent template not found</h1>
        <Link to="/agents" className="mt-4 inline-flex items-center gap-2 text-blue-600 hover:text-blue-700">
          <ArrowLeft size={14} />
          Back to catalog
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50 p-8">
      <div className="mx-auto max-w-4xl">
        <Link to="/agents" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft size={14} />
          Back to catalog
        </Link>

        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
              <p className="mt-1 text-sm text-gray-500">{template.category} template</p>
            </div>
            {template.defaultModel ? (
              <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                {template.defaultModel}
              </span>
            ) : null}
          </div>

          <p className="mt-5 leading-relaxed text-gray-700">{template.description}</p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <section className="rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900">Capabilities</h2>
              <ul className="mt-3 space-y-2 text-sm text-gray-700">
                {template.skills.map((skill) => (
                  <li key={skill}>{skill}</li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900">Default Instructions</h2>
              <p className="mt-3 text-sm leading-relaxed text-gray-700">{template.defaultInstructions}</p>
            </section>
          </div>

          <div className="mt-8 flex flex-wrap gap-3 border-t border-gray-100 pt-5">
            <Link
              to={`/agents/deploy/${template.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Rocket size={14} />
              Deploy agent
            </Link>
            <Link
              to="/agents/my"
              className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              View my agents
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
