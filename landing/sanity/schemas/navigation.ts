import { defineType, defineField } from "sanity";

export const navigationSchema = defineType({
  name: "navigation",
  title: "Navigation",
  type: "document",
  fields: [
    defineField({
      name: "productLabel",
      title: "Product Link Label",
      type: "string",
      description: "Navigation link label for #product anchor",
    }),
    defineField({
      name: "workforceLabel",
      title: "Workforce Link Label",
      type: "string",
      description: "Navigation link label for #workforce anchor",
    }),
    defineField({
      name: "integrationsLabel",
      title: "Integrations Link Label",
      type: "string",
      description: "Navigation link label for #integrations anchor",
    }),
    defineField({
      name: "pricingLabel",
      title: "Pricing Link Label",
      type: "string",
      description: "Navigation link label for #pricing anchor",
    }),
    defineField({
      name: "blogLabel",
      title: "Blog Link Label",
      type: "string",
      description: "Navigation link label for /blog route",
    }),
    defineField({
      name: "gitHubLabel",
      title: "GitHub Link Label",
      type: "string",
      description: "Navigation link label for external GitHub link",
    }),
    defineField({
      name: "gitHubUrl",
      title: "GitHub URL",
      type: "url",
      description: "External GitHub repository URL",
    }),
    defineField({
      name: "signInLabel",
      title: "Sign In Button Label",
      type: "string",
      description: "Navigation sign-in link label",
    }),
    defineField({
      name: "startFreeLabel",
      title: "Start Free Button Label",
      type: "string",
      description: "Navigation start-free button label",
    }),
  ],
});
