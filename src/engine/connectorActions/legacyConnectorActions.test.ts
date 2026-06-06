import { legacyConnectorActionsEnabled } from "./registry";

describe("legacyConnectorActionsEnabled (HEL-757)", () => {
  const ORIGINAL = process.env.AUTOFLOW_LEGACY_CONNECTOR_ACTIONS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AUTOFLOW_LEGACY_CONNECTOR_ACTIONS;
    else process.env.AUTOFLOW_LEGACY_CONNECTOR_ACTIONS = ORIGINAL;
  });

  it("defaults to enabled when unset", () => {
    delete process.env.AUTOFLOW_LEGACY_CONNECTOR_ACTIONS;
    expect(legacyConnectorActionsEnabled()).toBe(true);
  });

  it("stays enabled for any value other than 'false'", () => {
    process.env.AUTOFLOW_LEGACY_CONNECTOR_ACTIONS = "true";
    expect(legacyConnectorActionsEnabled()).toBe(true);
  });

  it("is disabled only when explicitly 'false'", () => {
    process.env.AUTOFLOW_LEGACY_CONNECTOR_ACTIONS = "false";
    expect(legacyConnectorActionsEnabled()).toBe(false);
  });
});

describe("connectorActions barrel registration gating (HEL-757)", () => {
  const ORIGINAL = process.env.AUTOFLOW_LEGACY_CONNECTOR_ACTIONS;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AUTOFLOW_LEGACY_CONNECTOR_ACTIONS;
    else process.env.AUTOFLOW_LEGACY_CONNECTOR_ACTIONS = ORIGINAL;
  });

  it("registers the legacy Slack actions by default (flag on)", () => {
    jest.isolateModules(() => {
      delete process.env.AUTOFLOW_LEGACY_CONNECTOR_ACTIONS;
      const mod = require("./index") as typeof import("./index");
      expect(mod.getConnectorAction("slack.notify")).toBeDefined();
      expect(mod.getConnectorAction("slack.dispatchNotification")).toBeDefined();
    });
  });

  it("drops the legacy Slack actions when AUTOFLOW_LEGACY_CONNECTOR_ACTIONS=false, but keeps Composio", () => {
    jest.isolateModules(() => {
      process.env.AUTOFLOW_LEGACY_CONNECTOR_ACTIONS = "false";
      const mod = require("./index") as typeof import("./index");
      expect(mod.getConnectorAction("slack.notify")).toBeUndefined();
      expect(mod.getConnectorAction("slack.dispatchNotification")).toBeUndefined();
      // The Composio path is the canonical surface — always registered regardless of the legacy flag.
      expect(mod.getConnectorAction("composio.execute")).toBeDefined();
    });
  });
});
