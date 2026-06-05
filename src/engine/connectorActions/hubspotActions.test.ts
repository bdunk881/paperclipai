/**
 * HEL-659: real hubspot.createContact connector action.
 */

jest.mock("../../integrations/hubspot/service", () => ({
  hubSpotConnectorService: { createContact: jest.fn() },
}));

import "./hubspotActions";
import { getConnectorAction } from "./registry";
import { hubSpotConnectorService } from "../../integrations/hubspot/service";
import type { WorkflowStep } from "../../types/workflow";

const mockCreate = hubSpotConnectorService.createContact as jest.MockedFunction<
  typeof hubSpotConnectorService.createContact
>;

function inv(opts: {
  inputs?: Record<string, unknown>;
  config?: Record<string, unknown>;
  userId?: string;
}) {
  return {
    userId: opts.userId ?? "user-1",
    inputs: opts.inputs ?? {},
    config: {},
    step: { config: opts.config ?? {} } as unknown as WorkflowStep,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("hubspot.createContact (HEL-659)", () => {
  it("is registered in the connector-action library", () => {
    const def = getConnectorAction("hubspot.createContact");
    expect(def).toBeDefined();
    expect(def?.connectorKey).toBe("hubspot");
    expect(def?.isWrite).toBe(true);
  });

  it("creates a contact via the connector with mapped fields", async () => {
    mockCreate.mockResolvedValue({ id: "C-1", properties: {} } as never);
    const def = getConnectorAction("hubspot.createContact")!;

    const out = await def.invoke(inv({ inputs: { email: "lead@example.com", firstName: "Ada" } }));

    expect(mockCreate).toHaveBeenCalledWith("user-1", { email: "lead@example.com", firstname: "Ada" });
    expect(out).toMatchObject({ created: true, contactId: "C-1" });
  });

  it("prefers step.config over step inputs", async () => {
    mockCreate.mockResolvedValue({ id: "C-2", properties: {} } as never);
    const def = getConnectorAction("hubspot.createContact")!;

    await def.invoke(inv({ inputs: { email: "in@example.com" }, config: { email: "cfg@example.com" } }));

    expect(mockCreate).toHaveBeenCalledWith("user-1", { email: "cfg@example.com" });
  });

  it("throws honestly when no email or name is supplied (no CRM call)", async () => {
    const def = getConnectorAction("hubspot.createContact")!;

    await expect(def.invoke(inv({ inputs: {} }))).rejects.toThrow(/email or name/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
