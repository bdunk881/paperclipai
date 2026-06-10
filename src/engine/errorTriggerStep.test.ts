/**
 * HEL-679: error trigger — unit tests.
 *
 * Hoists the HEL-772 errorTrigger payload to the top of the output, and surfaces
 * safe nulls when the payload is absent or not an object.
 */

import { handleErrorTrigger } from "./errorTriggerStep";

describe("handleErrorTrigger (HEL-679)", () => {
  it("hoists the errorTrigger payload fields to the top of the output", () => {
    const out = handleErrorTrigger({
      errorTrigger: {
        failedRunId: "run-1",
        failedStepId: "step-2",
        templateId: "tpl-1",
        templateName: "Main",
        error: "boom",
      },
    });
    expect(out).toMatchObject({
      failedRunId: "run-1",
      failedStepId: "step-2",
      failedTemplateId: "tpl-1",
      failedTemplateName: "Main",
      errorMessage: "boom",
    });
    expect(out.errorTrigger).toMatchObject({ failedRunId: "run-1", error: "boom" });
  });

  it("surfaces safe nulls when there is no errorTrigger payload", () => {
    const out = handleErrorTrigger({});
    expect(out).toEqual({
      errorTrigger: {},
      failedRunId: null,
      failedStepId: null,
      failedTemplateId: null,
      failedTemplateName: null,
      errorMessage: null,
    });
  });

  it("ignores a non-object errorTrigger value", () => {
    const out = handleErrorTrigger({ errorTrigger: "nope" });
    expect(out.errorTrigger).toEqual({});
    expect(out.errorMessage).toBeNull();
  });
});
