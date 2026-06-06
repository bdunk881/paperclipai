// HEL-656: importing this barrel registers the built-in connector actions
// (side-effect imports below) and re-exports the registry API. The engine
// imports it so its built-ins are always registered wherever a run executes.
//
// Each seed module's registration is cheap (metadata only) — the connector
// SDKs/services are imported lazily inside each action's `invoke`, so loading
// this barrel never pulls connector credential vaults into module-eval.
import { registerSlackConnectorActions } from "./slackActions";
import "./composioActions";
import { legacyConnectorActionsEnabled } from "./registry";

// HEL-757: the Composio path (composioActions, above) is always registered and
// is the canonical connector surface. The legacy hand-rolled connector actions
// (Slack via its bespoke connector service) are gated so they can be retired —
// default ON; set AUTOFLOW_LEGACY_CONNECTOR_ACTIONS=false to drop them once the
// toolkit is reachable through Composio.
if (legacyConnectorActionsEnabled()) {
  registerSlackConnectorActions();
}

export * from "./registry";
