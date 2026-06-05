import {
  registerTemplate,
  renderTemplate,
  hasTemplate,
  resetTemplatesForTests,
} from "./templates";

beforeEach(() => resetTemplatesForTests());

describe("template registry", () => {
  it("renders a registered template", () => {
    registerTemplate("greet", (d) => ({
      subject: `Hi ${d.name}`,
      html: `<p>${d.name}</p>`,
      text: `${d.name}`,
    }));
    expect(hasTemplate("greet")).toBe(true);
    expect(renderTemplate("greet", { name: "Sam" })).toEqual({
      subject: "Hi Sam",
      html: "<p>Sam</p>",
      text: "Sam",
    });
  });

  it("throws on an unknown template id", () => {
    expect(hasTemplate("nope")).toBe(false);
    expect(() => renderTemplate("nope", {})).toThrow(/Unknown email template/);
  });
});
