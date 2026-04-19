import {
  APOLLO_API_BASE,
  DEFAULT_SEARCH_PAGE_SIZE,
  ENRICHMENT_BATCH_SIZE,
  type ApolloSearchParams,
} from "./config";

export interface ApolloSearchResult {
  id: string;
  first_name: string;
  last_name_obfuscated?: string;
  title: string;
  has_email: boolean;
  organization: {
    name: string;
    has_industry: boolean;
    has_phone: boolean;
    has_city: boolean;
    has_state: boolean;
    has_country: boolean;
  };
}

export interface ApolloEnrichedPerson {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  email: string | null;
  email_status: string | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
  github_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  formatted_address: string | null;
  phone_numbers?: Array<{ raw_number: string; type: string }>;
  headline: string | null;
  departments: string[];
  functions: string[];
  organization: {
    id: string;
    name: string;
    website_url: string | null;
    linkedin_url: string | null;
    industry: string | null;
    estimated_num_employees: number | null;
    city: string | null;
    state: string | null;
    country: string | null;
    short_description: string | null;
    logo_url: string | null;
    founded_year: number | null;
    primary_domain: string | null;
  } | null;
}

export class ApolloClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async searchPeople(
    params: ApolloSearchParams,
    page = 1,
    perPage = DEFAULT_SEARCH_PAGE_SIZE
  ): Promise<{ people: ApolloSearchResult[]; totalEntries: number; totalPages: number }> {
    const response = await fetch(`${APOLLO_API_BASE}/mixed_people/api_search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": this.apiKey,
      },
      body: JSON.stringify({
        page,
        per_page: perPage,
        ...params,
      }),
    });

    if (!response.ok) {
      throw new Error(`Apollo search failed: ${response.status} ${await response.text()}`);
    }

    const data: any = await response.json();
    return {
      people: data.people || [],
      totalEntries: data.pagination?.total_entries || 0,
      totalPages: data.pagination?.total_pages || 0,
    };
  }

  async enrichByIds(ids: string[]): Promise<ApolloEnrichedPerson[]> {
    const results: ApolloEnrichedPerson[] = [];
    for (let i = 0; i < ids.length; i += ENRICHMENT_BATCH_SIZE) {
      const batch = ids.slice(i, i + ENRICHMENT_BATCH_SIZE);
      const response = await fetch(`${APOLLO_API_BASE}/people/bulk_match`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": this.apiKey,
        },
        body: JSON.stringify({
          reveal_personal_emails: false,
          reveal_phone_number: false,
          details: batch.map((id) => ({ id })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Apollo bulk enrichment failed: ${response.status} ${await response.text()}`);
      }

      const data: any = await response.json();
      const matches = data.matches || [];
      for (const match of matches) {
        if (match) results.push(match);
      }
    }
    return results;
  }

  async enrichPerson(params: {
    first_name?: string;
    last_name?: string;
    email?: string;
    organization_name?: string;
    domain?: string;
    linkedin_url?: string;
  }): Promise<ApolloEnrichedPerson | null> {
    const response = await fetch(`${APOLLO_API_BASE}/people/match`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": this.apiKey,
      },
      body: JSON.stringify({
        ...params,
        reveal_personal_emails: false,
        reveal_phone_number: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Apollo enrichment failed: ${response.status} ${await response.text()}`);
    }

    const data: any = await response.json();
    return data.person || null;
  }
}
