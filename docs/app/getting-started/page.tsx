import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Quick Start",
};

export default function GettingStartedPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Quick Start</h1>
      <p className="text-lg text-gray-500 mb-8">
        Get AutoFlow running locally in under 5 minutes.
      </p>

      <h2 id="prerequisites" className="text-xl font-semibold text-gray-900 mb-3">
        Prerequisites
      </h2>
      <ul className="list-disc pl-5 text-gray-600 space-y-1 mb-8">
        <li>Node.js 18 or later</li>
        <li>npm 9+</li>
        <li>Docker (optional — for containerized deployment)</li>
      </ul>

      <h2 id="install" className="text-xl font-semibold text-gray-900 mb-3">
        1. Clone and install
      </h2>
      <pre className="mb-6">{`git clone https://github.com/autoflow-hq/autoflow.git
cd autoflow
npm install`}</pre>

      <h2 id="start" className="text-xl font-semibold text-gray-900 mb-3">
        2. Start the API server
      </h2>
      <p className="text-gray-600 mb-3">
        The development server starts on port{" "}
        <code>3000</code> with hot-reload.
      </p>
      <pre className="mb-6">{`npm run dev`}</pre>

      <p className="text-gray-600 mb-3">Verify it started:</p>
      <pre className="mb-6">{`curl http://localhost:3000/health

# Response:
{
  "status": "ok",
  "templates": 3,
  "runs": { "total": 0, "running": 0, "completed": 0, "failed": 0 }
}`}</pre>

      <h2 id="first-run" className="text-xl font-semibold text-gray-900 mb-3">
        3. Run your first workflow
      </h2>
      <p className="text-gray-600 mb-3">
        Start the Lead Enrichment workflow with a sample lead:
      </p>
      <pre className="mb-3">{`curl -X POST http://localhost:3000/api/runs \\
  -H "Content-Type: application/json" \\
  -d '{
    "templateId": "tpl-lead-enrich",
    "input": {
      "name": "Jane Smith",
      "email": "jane@acme.com",
      "company": "Acme Corp"
    },
    "config": {
      "crmIntegration": "hubspot",
      "idealCustomerProfile": "Series A SaaS, 50-200 employees, US-based"
    }
  }'`}</pre>
      <p className="text-gray-600 mb-3">
        The API returns immediately with a run object (status{" "}
        <code>pending</code> → <code>running</code> → <code>completed</code>).
        Poll the run ID to track progress:
      </p>
      <pre className="mb-8">{`curl http://localhost:3000/api/runs/<run-id>`}</pre>

      <h2 id="templates" className="text-xl font-semibold text-gray-900 mb-3">
        4. Explore templates
      </h2>
      <p className="text-gray-600 mb-3">List all available templates:</p>
      <pre className="mb-3">{`curl http://localhost:3000/api/templates`}</pre>
      <p className="text-gray-600 mb-3">
        Get a template's full definition including config fields and step definitions:
      </p>
      <pre className="mb-3">{`curl http://localhost:3000/api/templates/tpl-lead-enrich`}</pre>
      <p className="text-gray-600 mb-8">
        Get sample input/output to understand what a template expects:
      </p>
      <pre className="mb-8">{`curl http://localhost:3000/api/templates/tpl-lead-enrich/sample`}</pre>

      <h2 id="docker" className="text-xl font-semibold text-gray-900 mb-3">
        5. Run via Docker
      </h2>
      <p className="text-gray-600 mb-3">
        The included <code>docker-compose.yml</code> starts the API backend and React dashboard:
      </p>
      <pre className="mb-3">{`docker compose up`}</pre>
      <ul className="list-disc pl-5 text-gray-600 space-y-1 mb-8">
        <li>
          API: <code>http://localhost:8000</code>
        </li>
        <li>
          Dashboard: <code>http://localhost:3001</code>
        </li>
      </ul>

      <h2 id="self-hosting" className="text-xl font-semibold text-gray-900 mb-3">
        Self-hosting in production
      </h2>
      <p className="text-gray-600 mb-3">
        AutoFlow ships with a production-ready deployment config for{" "}
        <a href="https://www.hetzner.com/" className="text-indigo-600 hover:underline">
          Hetzner
        </a>{" "}
        +{" "}
        <a href="https://coolify.io/" className="text-indigo-600 hover:underline">
          Coolify
        </a>{" "}
        (~€7.49/mo for a VPS). See{" "}
        <a
          href="https://github.com/autoflow-hq/autoflow/blob/main/infra/README.md"
          className="text-indigo-600 hover:underline"
        >
          infra/README.md
        </a>{" "}
        for full setup instructions including DNS, TLS, and CI/CD configuration.
      </p>

      <div className="mt-10 rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4">
        <p className="text-sm font-semibold text-indigo-800">
          Next step:{" "}
          <a href="/api-reference" className="underline">
            Explore the full API reference →
          </a>
        </p>
      </div>
    </div>
  );
}
