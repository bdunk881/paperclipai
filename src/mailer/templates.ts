/**
 * Email template registry for the app-side mailer (HEL-360). The Mailer's
 * `sendTemplate(template, …)` resolves content through here. Concrete templates
 * (workspace-invite, billing-receipt, system-status-notice, …) register from
 * their own tickets (HEL-362/363/366/…); this is just the seam + renderer.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type TemplateRenderer = (data: Record<string, unknown>) => RenderedEmail;

const registry: Record<string, TemplateRenderer> = {};

/** Register (or override) a template renderer by id. */
export function registerTemplate(name: string, renderer: TemplateRenderer): void {
  registry[name] = renderer;
}

/** Whether a template id is registered. */
export function hasTemplate(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(registry, name);
}

/** Render a registered template; throws on an unknown template id. */
export function renderTemplate(template: string, data: Record<string, unknown>): RenderedEmail {
  const renderer = registry[template];
  if (!renderer) {
    throw new Error(`Unknown email template: ${template}`);
  }
  return renderer(data);
}

/** Test/dev only: clear the registry. */
export function resetTemplatesForTests(): void {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
}
