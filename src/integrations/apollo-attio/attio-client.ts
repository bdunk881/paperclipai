import { ATTIO_API_BASE, type EntityKey } from "./config";
import type { ApolloEnrichedPerson } from "./apollo-client";

interface AttioRecord {
  id: { record_id: string };
  created_at: string;
  web_url: string;
}

interface AttioListEntry {
  id: { entry_id: string };
  parent_record_id: string;
  created_at: string;
}

export class AttioClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const response = await fetch(`${ATTIO_API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Attio API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  async assertCompany(
    domain: string,
    data: {
      name?: string;
      description?: string;
      entity?: string;
      source?: string;
      region?: string;
      linkedin?: string;
      employee_range?: string;
    }
  ): Promise<AttioRecord> {
    const values: Record<string, any> = {
      domains: [{ domain }],
    };

    if (data.name) values.name = [{ value: data.name }];
    if (data.description) values.description = [{ value: data.description }];
    if (data.entity) values.entity = [{ option: data.entity }];
    if (data.source) values.source = [{ option: data.source }];
    if (data.region) values.region = [{ option: data.region }];
    if (data.linkedin) values.linkedin = [{ value: data.linkedin }];
    if (data.employee_range) values.employee_range = [{ option: data.employee_range }];

    const result = await this.request(
      "/objects/companies/records?matching_attribute=domains",
      {
        method: "PUT",
        body: JSON.stringify({ data: { values } }),
      }
    );

    return result.data;
  }

  async assertPerson(
    email: string,
    data: {
      firstName?: string;
      lastName?: string;
      jobTitle?: string;
      entity?: string;
      source?: string;
      linkedin?: string;
      phone?: string;
      city?: string;
      state?: string;
      country?: string;
    }
  ): Promise<AttioRecord> {
    const values: Record<string, any> = {
      email_addresses: [{ email_address: email }],
    };

    if (data.firstName || data.lastName) {
      const fullName = [data.firstName, data.lastName].filter(Boolean).join(" ");
      values.name = [{ first_name: data.firstName || "", last_name: data.lastName || "", full_name: fullName }];
    }
    if (data.jobTitle) values.job_title = [{ value: data.jobTitle }];
    if (data.entity) values.entity = [{ option: data.entity }];
    if (data.source) values.source = [{ option: data.source }];
    if (data.linkedin) values.linkedin = [{ value: data.linkedin }];
    if (data.phone) values.phone_numbers = [{ original_phone_number: data.phone }];
    // Location requires full address fields (line_1..line_4, locality, region, postcode, country_code).
    // Apollo enrichment only provides city/state/country, so we skip location for now
    // to avoid validation errors. Full address enrichment can be added when needed.

    const result = await this.request(
      "/objects/people/records?matching_attribute=email_addresses",
      {
        method: "PUT",
        body: JSON.stringify({ data: { values } }),
      }
    );

    return result.data;
  }

  async addToList(
    listSlug: string,
    parentObject: "people" | "companies",
    recordId: string,
    entryValues: Record<string, any> = {}
  ): Promise<AttioListEntry> {
    const result = await this.request(`/lists/${listSlug}/entries`, {
      method: "POST",
      body: JSON.stringify({
        data: {
          parent_record_id: recordId,
          parent_object: parentObject,
          entry_values: entryValues,
        },
      }),
    });

    return result.data;
  }

  async listRecords(
    objectSlug: string,
    filter?: Record<string, any>,
    limit = 50
  ): Promise<any[]> {
    const body: any = { limit };
    if (filter) body.filter = filter;

    const result = await this.request(`/objects/${objectSlug}/records/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    return result.data || [];
  }
}

export function mapApolloPersonToAttio(
  person: ApolloEnrichedPerson,
  entityTag: string
): {
  email: string | null;
  personData: Parameters<AttioClient["assertPerson"]>[1];
  companyDomain: string | null;
  companyData: Parameters<AttioClient["assertCompany"]>[1] | null;
} {
  const org = person.organization;
  const phoneNumber = person.phone_numbers?.[0]?.raw_number || null;

  return {
    email: person.email,
    personData: {
      firstName: person.first_name,
      lastName: person.last_name,
      jobTitle: person.title,
      entity: entityTag,
      source: "Apollo",
      linkedin: person.linkedin_url || undefined,
      phone: phoneNumber || undefined,
      city: person.city || undefined,
      state: person.state || undefined,
      country: person.country || undefined,
    },
    companyDomain: org?.primary_domain || null,
    companyData: org
      ? {
          name: org.name,
          description: org.short_description || undefined,
          entity: entityTag,
          source: "Apollo",
          linkedin: org.linkedin_url || undefined,
          employee_range: mapEmployeeRange(org.estimated_num_employees),
        }
      : null,
  };
}

function mapEmployeeRange(count: number | null): string | undefined {
  if (!count) return undefined;
  if (count <= 10) return "1-10";
  if (count <= 50) return "11-50";
  if (count <= 250) return "51-250";
  if (count <= 1000) return "251-1K";
  if (count <= 5000) return "1K-5K";
  if (count <= 10000) return "5K-10K";
  if (count <= 50000) return "10K-50K";
  if (count <= 100000) return "50K-100K";
  return "100K+";
}
