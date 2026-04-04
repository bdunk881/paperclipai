export type EntityKey = "autoflow" | "above_the_wild" | "threat_warriors" | "altimedia";

export interface ICPSearchConfig {
  entity: EntityKey;
  label: string;
  attioEntityTag: string;
  attioLeadsList: string;
  attioCompanyList: string;
  attioCompanyListParentObject: "companies" | "deals";
  apolloSearch: ApolloSearchParams;
}

export interface ApolloSearchParams {
  person_titles?: string[];
  person_seniorities?: string[];
  organization_industry_tag_ids?: string[];
  q_organization_keyword_tags?: string[];
  person_locations?: string[];
  organization_locations?: string[];
  organization_num_employees_ranges?: string[];
  q_keywords?: string;
}

export const ENTITY_CONFIGS: Record<EntityKey, ICPSearchConfig> = {
  autoflow: {
    entity: "autoflow",
    label: "AutoFlow",
    attioEntityTag: "AutoFlow",
    attioLeadsList: "autoflow_leads",
    attioCompanyList: "sales",
    attioCompanyListParentObject: "companies",
    apolloSearch: {
      person_titles: [
        "VP Operations",
        "Director of Operations",
        "Head of Operations",
        "VP Engineering",
        "CTO",
        "COO",
        "Director of Automation",
        "Head of Digital Transformation",
        "VP Product",
        "Director of IT",
        "Head of Process Improvement",
        "Chief Digital Officer",
        "VP of Technology",
        "Director of Innovation",
      ],
      person_seniorities: ["vp", "director", "c_suite", "founder"],
      q_organization_keyword_tags: [
        "SaaS",
        "automation",
        "workflow",
        "artificial intelligence",
        "machine learning",
        "digital transformation",
        "business process",
        "enterprise software",
      ],
      organization_num_employees_ranges: ["11,50", "51,200", "201,500", "501,1000"],
    },
  },

  above_the_wild: {
    entity: "above_the_wild",
    label: "Above the Wild",
    attioEntityTag: "Above the Wild",
    attioLeadsList: "atw_creator_roster",
    attioCompanyList: "atw_brand_directory",
    attioCompanyListParentObject: "companies",
    apolloSearch: {
      person_titles: [
        "Brand Partnerships Manager",
        "Sponsorship Manager",
        "Talent Manager",
        "Influencer Marketing Manager",
        "Director of Brand Partnerships",
        "VP Marketing",
        "Head of Sponsorships",
        "Agency Director",
        "Talent Agent",
        "Director of Influencer Relations",
        "Brand Manager",
        "Head of Creator Partnerships",
      ],
      person_seniorities: ["director", "vp", "manager", "c_suite"],
      q_organization_keyword_tags: [
        "brand",
        "media",
        "entertainment",
        "agency",
        "talent management",
        "influencer",
        "content creator",
        "sponsorship",
        "outdoor",
        "lifestyle",
      ],
    },
  },

  threat_warriors: {
    entity: "threat_warriors",
    label: "Threat Warriors",
    attioEntityTag: "Threat Warriors",
    attioLeadsList: "people_6",
    attioCompanyList: "tw_active_engagements",
    attioCompanyListParentObject: "companies",
    apolloSearch: {
      person_titles: [
        "IT Director",
        "IT Manager",
        "CISO",
        "VP of IT",
        "Director of Information Security",
        "Chief Information Officer",
        "Systems Administrator",
        "Network Administrator",
        "Director of Technology",
        "Office Manager",
        "Owner",
        "CEO",
      ],
      person_seniorities: ["owner", "founder", "c_suite", "director", "manager"],
      organization_locations: ["Virginia, United States"],
      q_organization_keyword_tags: [
        "small business",
        "professional services",
        "healthcare",
        "legal",
        "accounting",
        "manufacturing",
        "construction",
        "real estate",
        "financial services",
      ],
      organization_num_employees_ranges: ["1,10", "11,50", "51,200"],
    },
  },

  altimedia: {
    entity: "altimedia",
    label: "AltiMedia",
    attioEntityTag: "AltiMedia",
    attioLeadsList: "am_corporate_contacts",
    attioCompanyList: "am_vendor_directory",
    attioCompanyListParentObject: "companies",
    apolloSearch: {
      person_titles: [
        "Marketing Director",
        "CMO",
        "VP Marketing",
        "Head of Marketing",
        "Director of Communications",
        "Brand Director",
        "Content Director",
      ],
      person_seniorities: ["director", "vp", "c_suite"],
      q_organization_keyword_tags: [
        "marketing",
        "advertising",
        "media production",
        "digital marketing",
        "creative agency",
      ],
    },
  },
};

export const APOLLO_API_BASE = "https://api.apollo.io/api/v1";
export const ATTIO_API_BASE = "https://api.attio.com/v2";

export const DEFAULT_SEARCH_PAGE_SIZE = 25;
export const MAX_SEARCH_PAGES = 10;
export const ENRICHMENT_BATCH_SIZE = 10;
