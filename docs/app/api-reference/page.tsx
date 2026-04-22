import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Reference",
};

function EndpointBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: "bg-emerald-100 text-emerald-700",
    POST: "bg-blue-100 text-blue-700",
    PUT: "bg-amber-100 text-amber-700",
    DELETE: "bg-red-100 text-red-700",
    PATCH: "bg-violet-100 text-violet-700",
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-bold font-mono ${colors[method] ?? "bg-gray-100 text-gray-600"}`}
    >
      {method}
    </span>
  );
}

export default function ApiReferencePage() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">API Reference</h1>
      <p className="text-lg text-gray-500 mb-8">
        All endpoints are REST + JSON. Base URL: <code>http://localhost:3000</code> locally,{" "}
        <code>https://helloautoflow.com</code> in production.
      </p>

      {/* Templates */}
      <h2 id="templates" className="text-2xl font-bold text-gray-900 mt-10 mb-4">
        Templates
      </h2>
      <p className="text-gray-600 mb-6">
        Templates are pre-built workflow definitions. You select a template to start a run.
      </p>

      {/* GET /api/templates */}
      <div className="mb-8 rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3 bg-gray-50 px-5 py-3 border-b border-gray-200">
          <EndpointBadge method="GET" />
          <code className="text-sm font-mono text-gray-800">/api/templates</code>
          <span className="text-sm text-gray-500 ml-2">List all templates</span>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Query params</p>
            <div className="overflow-hidden rounded-lg border border-gray-100">
              <table className="min-w-full text-sm divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Param</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Type</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Description</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs text-indigo-600">category</td>
                    <td className="px-4 py-2 text-gray-500">string</td>
                    <td className="px-4 py-2 text-gray-600">
                      Filter by category: <code>sales</code>, <code>content</code>,{" "}
                      <code>support</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Example response</p>
            <pre className="text-xs">{`{
  "templates": [
    {
      "id": "tpl-lead-enrich",
      "name": "Lead Enrichment",
      "description": "Enriches incoming leads...",
      "category": "sales",
      "version": "1.0.0",
      "stepCount": 7,
      "configFieldCount": 3
    }
  ],
  "total": 3
}`}</pre>
          </div>
        </div>
      </div>

      {/* GET /api/templates/:id */}
      <div className="mb-8 rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3 bg-gray-50 px-5 py-3 border-b border-gray-200">
          <EndpointBadge method="GET" />
          <code className="text-sm font-mono text-gray-800">/api/templates/:id</code>
          <span className="text-sm text-gray-500 ml-2">Get a single template</span>
        </div>
        <div className="p-5">
          <p className="text-sm text-gray-600 mb-3">
            Returns the full template definition including all steps and config field schemas.
          </p>
          <pre className="text-xs">{`curl http://localhost:3000/api/templates/tpl-lead-enrich`}</pre>
        </div>
      </div>

      {/* GET /api/templates/:id/sample */}
      <div className="mb-8 rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3 bg-gray-50 px-5 py-3 border-b border-gray-200">
          <EndpointBadge method="GET" />
          <code className="text-sm font-mono text-gray-800">/api/templates/:id/sample</code>
          <span className="text-sm text-gray-500 ml-2">Get sample input/output</span>
        </div>
        <div className="p-5">
          <p className="text-sm text-gray-600 mb-3">
            Returns <code>sampleInput</code> and <code>expectedOutput</code> for a template — useful for
            understanding the data contract before running.
          </p>
        </div>
      </div>

      {/* Runs */}
      <h2 id="runs" className="text-2xl font-bold text-gray-900 mt-10 mb-4">
        Runs
      </h2>
      <p className="text-gray-600 mb-6">
        A run is a single execution of a workflow template. Runs are async — the API returns immediately
        with a run object, and you poll for status changes.
      </p>

      {/* POST /api/runs */}
      <div className="mb-8 rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3 bg-gray-50 px-5 py-3 border-b border-gray-200">
          <EndpointBadge method="POST" />
          <code className="text-sm font-mono text-gray-800">/api/runs</code>
          <span className="text-sm text-gray-500 ml-2">Start a new workflow run</span>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Request body</p>
            <div className="overflow-hidden rounded-lg border border-gray-100">
              <table className="min-w-full text-sm divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Field</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Type</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Required</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs text-indigo-600">templateId</td>
                    <td className="px-4 py-2 text-gray-500">string</td>
                    <td className="px-4 py-2 text-emerald-600 font-medium">yes</td>
                    <td className="px-4 py-2 text-gray-600">Template ID to execute</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs text-indigo-600">input</td>
                    <td className="px-4 py-2 text-gray-500">object</td>
                    <td className="px-4 py-2 text-gray-400">no</td>
                    <td className="px-4 py-2 text-gray-600">Workflow trigger data (lead, brief, ticket etc.)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs text-indigo-600">config</td>
                    <td className="px-4 py-2 text-gray-500">object</td>
                    <td className="px-4 py-2 text-gray-400">no</td>
                    <td className="px-4 py-2 text-gray-600">Template config overrides (CRM, thresholds, etc.)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Example</p>
            <pre className="text-xs">{`curl -X POST http://localhost:3000/api/runs \\
  -H "Content-Type: application/json" \\
  -d '{
    "templateId": "tpl-content-gen",
    "input": {
      "topic": "How to reduce SaaS churn",
      "audience": "B2B SaaS founders",
      "format": "Blog post"
    },
    "config": {
      "brandVoice": "conversational, data-driven",
      "brandName": "Acme"
    }
  }'`}</pre>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Response (202)</p>
            <pre className="text-xs">{`{
  "id": "run_abc123",
  "templateId": "tpl-content-gen",
  "status": "pending",
  "createdAt": "2026-04-01T12:00:00.000Z",
  "steps": [...]
}`}</pre>
          </div>
        </div>
      </div>

      {/* GET /api/runs */}
      <div className="mb-8 rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3 bg-gray-50 px-5 py-3 border-b border-gray-200">
          <EndpointBadge method="GET" />
          <code className="text-sm font-mono text-gray-800">/api/runs</code>
          <span className="text-sm text-gray-500 ml-2">List all runs</span>
        </div>
        <div className="p-5">
          <p className="text-sm text-gray-600 mb-3">
            Returns all runs, sorted by creation date descending. Filter by template with the{" "}
            <code>templateId</code> query param.
          </p>
          <pre className="text-xs">{`curl "http://localhost:3000/api/runs?templateId=tpl-lead-enrich"`}</pre>
        </div>
      </div>

      {/* GET /api/runs/:id */}
      <div className="mb-8 rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3 bg-gray-50 px-5 py-3 border-b border-gray-200">
          <EndpointBadge method="GET" />
          <code className="text-sm font-mono text-gray-800">/api/runs/:id</code>
          <span className="text-sm text-gray-500 ml-2">Get a run by ID</span>
        </div>
        <div className="p-5">
          <p className="text-sm text-gray-600 mb-3">
            Returns the full run object including step logs and output. Poll this endpoint to track
            execution progress. Status transitions:{" "}
            <code>pending</code> → <code>running</code> → <code>completed</code> | <code>failed</code>.
          </p>
        </div>
      </div>

      {/* Webhooks */}
      <h2 id="webhooks" className="text-2xl font-bold text-gray-900 mt-10 mb-4">
        Webhooks
      </h2>
      <p className="text-gray-600 mb-6">
        Trigger workflows from external systems (CRMs, form builders, Zapier, etc.) via a simple
        POST webhook.
      </p>

      <div className="mb-8 rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3 bg-gray-50 px-5 py-3 border-b border-gray-200">
          <EndpointBadge method="POST" />
          <code className="text-sm font-mono text-gray-800">/api/webhooks/:templateId</code>
          <span className="text-sm text-gray-500 ml-2">Trigger a workflow from a webhook</span>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            The entire request body is forwarded as the run <code>input</code>. The template must exist.
            Returns a <code>runId</code> immediately.
          </p>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Example — Typeform integration</p>
            <pre className="text-xs">{`# Point your Typeform webhook at:
POST https://helloautoflow.com/api/webhooks/tpl-lead-enrich

# Body (forwarded as run input):
{
  "name": "Jane Smith",
  "email": "jane@acme.com",
  "company": "Acme Corp"
}`}</pre>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Response (202)</p>
            <pre className="text-xs">{`{ "runId": "run_xyz789", "status": "pending" }`}</pre>
          </div>
        </div>
      </div>

      {/* Health */}
      <h2 id="health" className="text-2xl font-bold text-gray-900 mt-10 mb-4">
        Health
      </h2>

      <div className="mb-8 rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-3 bg-gray-50 px-5 py-3 border-b border-gray-200">
          <EndpointBadge method="GET" />
          <code className="text-sm font-mono text-gray-800">/health</code>
          <span className="text-sm text-gray-500 ml-2">Server health check</span>
        </div>
        <div className="p-5">
          <p className="text-sm text-gray-600 mb-3">
            Returns server status plus a summary of template count and run statistics.
          </p>
          <pre className="text-xs">{`{
  "status": "ok",
  "templates": 3,
  "runs": {
    "total": 142,
    "running": 2,
    "completed": 138,
    "failed": 2
  }
}`}</pre>
        </div>
      </div>

      {/* Error codes */}
      <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">Error codes</h2>
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Meaning</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {[
              ["200", "Success"],
              ["202", "Accepted — run started asynchronously"],
              ["400", "Bad request — missing or invalid parameters"],
              ["404", "Template or run not found"],
              ["500", "Internal server error"],
            ].map(([code, desc]) => (
              <tr key={code}>
                <td className="px-4 py-3 font-mono text-xs text-indigo-600">{code}</td>
                <td className="px-4 py-3 text-gray-600">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
