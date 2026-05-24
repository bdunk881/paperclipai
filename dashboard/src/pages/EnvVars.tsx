/**
 * HEL-206 (PR C) page wrapper for the EnvVarManager component.
 *
 * Standalone /env-vars route - PR B (HEL-205) introduces a Connections hub
 * page with tabs (Integrations, Connectors, Env Vars). Until that lands on
 * `dev`, this PR ships the same surface as its own top-level route. When
 * PR B merges, reviewers can rebase this PR and move the manager into
 * the Connections hub tab.
 */

import EnvVarManager from "../components/connections/EnvVarManager";

export default function EnvVarsPage() {
  return <EnvVarManager />;
}
