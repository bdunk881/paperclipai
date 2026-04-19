import { ApolloClient, type ApolloEnrichedPerson } from "./apollo-client";
import { AttioClient, mapApolloPersonToAttio } from "./attio-client";
import {
  ENTITY_CONFIGS,
  MAX_SEARCH_PAGES,
  DEFAULT_SEARCH_PAGE_SIZE,
  type EntityKey,
  type ICPSearchConfig,
} from "./config";

export interface ProspectingResult {
  entity: EntityKey;
  searched: number;
  enriched: number;
  synced: { people: number; companies: number };
  addedToLists: { leads: number; companies: number };
  errors: string[];
}

export async function runProspecting(
  entityKey: EntityKey,
  options: {
    apolloApiKey: string;
    attioApiKey: string;
    maxPages?: number;
    pageSize?: number;
    dryRun?: boolean;
  }
): Promise<ProspectingResult> {
  const config = ENTITY_CONFIGS[entityKey];
  const apollo = new ApolloClient(options.apolloApiKey);
  const attio = new AttioClient(options.attioApiKey);

  const maxPages = options.maxPages || MAX_SEARCH_PAGES;
  const pageSize = options.pageSize || DEFAULT_SEARCH_PAGE_SIZE;

  const result: ProspectingResult = {
    entity: entityKey,
    searched: 0,
    enriched: 0,
    synced: { people: 0, companies: 0 },
    addedToLists: { leads: 0, companies: 0 },
    errors: [],
  };

  // Step 1: Search Apollo for ICP matches
  const searchResults = [];
  for (let page = 1; page <= maxPages; page++) {
    const searchResponse = await apollo.searchPeople(config.apolloSearch, page, pageSize);
    searchResults.push(...searchResponse.people);
    result.searched += searchResponse.people.length;

    if (page >= searchResponse.totalPages || searchResponse.people.length < pageSize) {
      break;
    }
  }

  if (options.dryRun) {
    return result;
  }

  // Step 2: Bulk enrich by Apollo IDs (returns full contact data including emails)
  const apolloIds = searchResults.map((r) => r.id);
  let enrichedPeople: ApolloEnrichedPerson[] = [];
  try {
    enrichedPeople = await apollo.enrichByIds(apolloIds);
    result.enriched = enrichedPeople.length;
  } catch (err) {
    result.errors.push(`Bulk enrichment failed: ${err}`);
  }

  // Step 3: Sync to Attio
  const syncedCompanyDomains = new Set<string>();

  for (const person of enrichedPeople) {
    const mapped = mapApolloPersonToAttio(person, config.attioEntityTag);

    // Sync company first (if we have domain and haven't already synced it)
    if (mapped.companyDomain && mapped.companyData && !syncedCompanyDomains.has(mapped.companyDomain)) {
      try {
        const companyRecord = await attio.assertCompany(mapped.companyDomain, mapped.companyData);
        syncedCompanyDomains.add(mapped.companyDomain);
        result.synced.companies++;

        // Add to entity company list
        try {
          await attio.addToList(config.attioCompanyList, "companies", companyRecord.id.record_id);
          result.addedToLists.companies++;
        } catch (err) {
          // May already be on the list
          const errMsg = String(err);
          if (!errMsg.includes("already exists")) {
            result.errors.push(`List add failed for company ${mapped.companyDomain}: ${err}`);
          }
        }
      } catch (err) {
        result.errors.push(`Company sync failed for ${mapped.companyDomain}: ${err}`);
      }
    }

    // Sync person (requires email)
    if (mapped.email) {
      try {
        const personRecord = await attio.assertPerson(mapped.email, mapped.personData);
        result.synced.people++;

        // Add to entity leads list
        try {
          await attio.addToList(config.attioLeadsList, "people", personRecord.id.record_id);
          result.addedToLists.leads++;
        } catch (err) {
          const errMsg = String(err);
          if (!errMsg.includes("already exists")) {
            result.errors.push(`List add failed for person ${mapped.email}: ${err}`);
          }
        }
      } catch (err) {
        result.errors.push(`Person sync failed for ${mapped.email}: ${err}`);
      }
    }
  }

  return result;
}

export async function runEnrichmentRefresh(
  entityKey: EntityKey,
  options: {
    apolloApiKey: string;
    attioApiKey: string;
    limit?: number;
  }
): Promise<{ refreshed: number; errors: string[] }> {
  const config = ENTITY_CONFIGS[entityKey];
  const apollo = new ApolloClient(options.apolloApiKey);
  const attio = new AttioClient(options.attioApiKey);

  const result = { refreshed: 0, errors: [] as string[] };
  const limit = options.limit || 50;

  // Get existing people records tagged with this entity
  const records = await attio.listRecords("people", undefined, limit);

  for (const record of records) {
    const email = record.values?.email_addresses?.[0]?.email_address;
    const name = record.values?.name?.[0];

    if (!email && !name) continue;

    try {
      const enriched = await apollo.enrichPerson({
        email: email || undefined,
        first_name: name?.first_name || undefined,
        last_name: name?.last_name || undefined,
      });

      if (enriched) {
        const mapped = mapApolloPersonToAttio(enriched, config.attioEntityTag);
        if (mapped.email) {
          await attio.assertPerson(mapped.email, mapped.personData);
          result.refreshed++;
        }
      }
    } catch (err) {
      result.errors.push(`Refresh failed for ${email || name?.first_name}: ${err}`);
    }
  }

  return result;
}
