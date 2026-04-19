import { describe, it, expect } from "vitest";
import { sanitizeContext } from "./crmFieldAllowlist";

describe("sanitizeContext", () => {
  it("keeps allowed CRM fields", () => {
    const ctx = {
      companyName: "Acme Corp",
      industry: "Software",
      firstName: "Jane",
      lastName: "Doe",
      title: "VP Sales",
      dealValue: 50000,
      requirements: "Need automation",
    };

    const { sanitized, strippedCount } = sanitizeContext(ctx);

    expect(strippedCount).toBe(0);
    expect(sanitized).toEqual(ctx);
  });

  it("strips email fields", () => {
    const ctx = {
      companyName: "Acme Corp",
      email: "jane@acme.com",
      contactEmail: "jane@acme.com",
    };

    const { sanitized, blockedCategories, strippedCount } = sanitizeContext(ctx);

    expect(sanitized).toEqual({ companyName: "Acme Corp" });
    expect(strippedCount).toBe(2);
    expect(blockedCategories).toContain("contact_pii");
  });

  it("strips phone and address fields", () => {
    const ctx = {
      name: "Jane Doe",
      phone: "555-1234",
      mobilePhone: "555-5678",
      address: "123 Main St",
      city: "Austin",
      state: "TX",
      zipCode: "78701",
    };

    const { sanitized, strippedCount } = sanitizeContext(ctx);

    expect(sanitized).toEqual({ name: "Jane Doe" });
    expect(strippedCount).toBe(6);
  });

  it("strips social media fields", () => {
    const ctx = {
      title: "CTO",
      linkedinUrl: "https://linkedin.com/in/jane",
      twitterHandle: "@jane",
      facebookUrl: "https://facebook.com/jane",
    };

    const { sanitized, strippedCount } = sanitizeContext(ctx);

    expect(sanitized).toEqual({ title: "CTO" });
    expect(strippedCount).toBe(3);
  });

  it("strips auth and financial fields", () => {
    const ctx = {
      industry: "Finance",
      password: "hunter2",
      apiKey: "sk-xxx",
      token: "jwt-xxx",
      cardNumber: "4111111111111111",
      bankAccount: "123456789",
      paymentMethod: "visa",
    };

    const { sanitized, blockedCategories, strippedCount } = sanitizeContext(ctx);

    expect(sanitized).toEqual({ industry: "Finance" });
    expect(strippedCount).toBe(6);
    expect(blockedCategories).toContain("auth");
    expect(blockedCategories).toContain("financial");
  });

  it("strips sensitive ID fields", () => {
    const ctx = {
      name: "Jane",
      ssn: "123-45-6789",
      taxId: "98-7654321",
    };

    const { sanitized, strippedCount } = sanitizeContext(ctx);

    expect(sanitized).toEqual({ name: "Jane" });
    expect(strippedCount).toBe(2);
  });

  it("passes through unknown workflow keys that are not blocked patterns", () => {
    const ctx = {
      customWorkflowKey: "some value",
      blogPost: "Hello world",
      _stub: true,
    };

    const { sanitized, strippedCount } = sanitizeContext(ctx);

    expect(strippedCount).toBe(0);
    expect(sanitized).toEqual(ctx);
  });

  it("deduplicates blocked categories", () => {
    const ctx = {
      email: "a@b.com",
      phone: "555",
      mobilePhone: "666",
    };

    const { blockedCategories } = sanitizeContext(ctx);

    // email and phone/mobile are all contact_pii — should appear once
    expect(blockedCategories).toEqual(["contact_pii"]);
  });

  it("handles empty context", () => {
    const { sanitized, strippedCount, blockedCategories } = sanitizeContext({});

    expect(sanitized).toEqual({});
    expect(strippedCount).toBe(0);
    expect(blockedCategories).toEqual([]);
  });

  it("handles mixed allowed and blocked fields in realistic CRM context", () => {
    const ctx = {
      companyName: "Altitude Media",
      industry: "Digital Media",
      employees: 50,
      firstName: "Brad",
      lastName: "Duncan",
      jobTitle: "CEO",
      email: "brad@altitudemedia.com",
      phone: "+1-555-0123",
      linkedinUrl: "https://linkedin.com/in/brad",
      dealValue: 120000,
      stage: "proposal",
      requirements: "AI workflow automation",
      address: "123 Main St, Austin TX",
    };

    const { sanitized, strippedCount, blockedCategories } = sanitizeContext(ctx);

    expect(sanitized).toEqual({
      companyName: "Altitude Media",
      industry: "Digital Media",
      employees: 50,
      firstName: "Brad",
      lastName: "Duncan",
      jobTitle: "CEO",
      dealValue: 120000,
      stage: "proposal",
      requirements: "AI workflow automation",
    });
    expect(strippedCount).toBe(4);
    expect(blockedCategories).toContain("contact_pii");
    expect(blockedCategories).toContain("social_media");
  });
});
