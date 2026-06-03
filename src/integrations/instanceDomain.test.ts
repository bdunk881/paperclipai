/**
 * Guard tests for tenant-supplied `instanceDomain` substitution.
 *
 * `instanceDomain` is substituted into outbound URLs that carry credentials
 * (OAuth token/authorization endpoints with the client secret, and API base
 * URLs with the bearer/api-key header). It must be a bare host so a tenant
 * can't redirect those requests to an attacker host (SSRF + credential leak).
 */
import { assertValidInstanceDomain, resolveUrlTemplate } from "./authAdapters";

describe("assertValidInstanceDomain", () => {
  it("accepts bare hosts (optionally with a port)", () => {
    for (const ok of [
      "acme.example.com",
      "dev12345.service-now.com",
      "my-org.my.salesforce.com",
      "localhost",
      "api.example.com:8443",
    ]) {
      expect(() => assertValidInstanceDomain(ok)).not.toThrow();
    }
  });

  it("rejects schemes, paths, userinfo, and query characters", () => {
    for (const bad of [
      "https://evil.com",
      "evil.com/path",
      "attacker.example/.salesforce.com/x",
      "good.com@evil.com",
      "evil.com#",
      "evil.com?q=1",
      "evil.com/",
      "evil .com",
      "evil.com\n",
      "{{nested}}",
      "",
    ]) {
      expect(() => assertValidInstanceDomain(bad)).toThrow(/invalid instanceDomain/i);
    }
  });
});

describe("resolveUrlTemplate", () => {
  it("substitutes a valid instanceDomain", () => {
    expect(
      resolveUrlTemplate("https://{{instanceDomain}}/v1/x", "acme.my.salesforce.com"),
    ).toBe("https://acme.my.salesforce.com/v1/x");
  });

  it("returns the template unchanged when no instanceDomain is given", () => {
    expect(resolveUrlTemplate("https://api.example.com/v1", undefined)).toBe(
      "https://api.example.com/v1",
    );
  });

  it("throws rather than redirecting to an attacker host", () => {
    expect(() =>
      resolveUrlTemplate("https://{{instanceDomain}}/oauth/token", "evil.com/.salesforce.com"),
    ).toThrow(/invalid instanceDomain/i);
  });
});
