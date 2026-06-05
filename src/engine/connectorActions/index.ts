// HEL-656: importing this barrel registers the built-in connector actions
// (side-effect imports below) and re-exports the registry API. The engine
// imports it so its built-ins are always registered wherever a run executes.
//
// Each seed module's registration is cheap (metadata only) — the connector
// SDKs/services are imported lazily inside each action's `invoke`, so loading
// this barrel never pulls connector credential vaults into module-eval.
import "./slackActions";
import "./hubspotActions";

export * from "./registry";
