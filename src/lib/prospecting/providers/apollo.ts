/**
 * apollo.io
 *
 * verified against the official docs:
 *  - base            https://api.apollo.io/api/v1
 *  - auth            x-api-key header
 *  - people search   POST /mixed_people/api_search   (no emails in the results)
 *  - company search  POST /mixed_companies/search
 *  - enrich one      POST /people/match              (1 credit when it finds data)
 *  - enrich ten      POST /people/bulk_match         (same, batched)
 *
 * the important thing about apollo is that search and email are two different calls.
 * search costs nothing but deliberately withholds addresses; the enrich call is what
 * costs a credit and what actually hands you an email with a confidence grade.
 */
import { apiFetch, withArrayParams } from "../http";
import {
  type Icp,
  type ProspectCompany,
  type ProspectPerson,
  type Provider,
  type ProviderInfo,
  type SearchPage,
} from "../types";

const BASE = "https://api.apollo.io/api/v1";

/** apollo's seniority vocabulary. we map onto it rather than making users guess. */
export const APOLLO_SENIORITY: Array<{ value: string; label: string }> = [
  { value: "owner", label: "owner" },
  { value: "founder", label: "founder" },
  { value: "c_suite", label: "c-suite" },
  { value: "partner", label: "partner" },
  { value: "vp", label: "vp" },
  { value: "head", label: "head of" },
  { value: "director", label: "director" },
  { value: "manager", label: "manager" },
  { value: "senior", label: "senior" },
  { value: "entry", label: "entry level" },
  { value: "intern", label: "intern" },
];

/** the sizes apollo accepts in its employee-range filter. */
export const APOLLO_SIZE_RANGES: Array<{ value: string; label: string }> = [
  { value: "1,10", label: "1–10 people" },
  { value: "11,20", label: "11–20 people" },
  { value: "21,50", label: "21–50 people" },
  { value: "51,100", label: "51–100 people" },
  { value: "101,200", label: "101–200 people" },
  { value: "201,500", label: "201–500 people" },
  { value: "501,1000", label: "501–1,000 people" },
  { value: "1001,2000", label: "1,001–2,000 people" },
  { value: "2001,5000", label: "2,001–5,000 people" },
  { value: "5001,10000", label: "5,001–10,000 people" },
  { value: "10001,", label: "more than 10,000 people" },
];

export const APOLLO_INFO: ProviderInfo = {
  id: "apollo",
  label: "apollo",
  kinds: ["people", "companies"],
  providesEmailOnSearch: false,
  emailMethod:
    "search tells us whether a person has an address. the enrich call is what returns the address itself, and costs 1 credit per person.",
  signupUrl: "https://www.apollo.io/sign-up",
  docsUrl: "https://docs.apollo.io/reference/people-api-search",
  keyUrl: "https://app.apollo.io/#/settings/integrations",
  sizeFilterLabel: "company size",
  planNotes: [
    "the free plan needs an account registered with a work email address, and apollo approves some of them by hand.",
    "people search itself is free. revealing an email address costs 1 credit per person.",
    "every filter is applied by apollo, so the list really is the people you asked for.",
  ],
};

interface ApolloOrg {
  id?: string;
  name?: string | null;
  website_url?: string | null;
  primary_domain?: string | null;
  domain?: string | null;
  industry?: string | null;
  industries?: string[] | null;
  estimated_num_employees?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  linkedin_url?: string | null;
  num_contacts?: number | null;
}

interface ApolloSearchPerson {
  id: string;
  first_name?: string | null;
  last_name_obfuscated?: string | null;
  name?: string | null;
  title?: string | null;
  seniority?: string | null;
  linkedin_url?: string | null;
  has_email?: boolean | null;
  has_direct_phone?: boolean | null;
  organization?: ApolloOrg | null;
  organization_id?: string | null;
}

interface ApolloSearchResponse {
  pagination?: { total_entries?: number; page?: number; per_page?: number; total_pages?: number } | null;
  people?: ApolloSearchPerson[] | null;
}

interface ApolloOrgSearchResponse {
  pagination?: { total_entries?: number; page?: number; per_page?: number; total_pages?: number } | null;
  organizations?: ApolloOrg[] | null;
}

interface ApolloMatchPerson extends ApolloSearchPerson {
  last_name?: string | null;
  name?: string | null;
  email?: string | null;
  email_status?: string | null;
  twitter_url?: string | null;
  extrapolated_email_confidence?: string | null;
  match_confidence?: string | null;
}

interface ApolloMatchResponse {
  person?: ApolloMatchPerson | null;
  match_confidence?: string | null;
}

function orgFilters(icp: Icp): Record<string, string | string[]> {
  return {
    organization_locations: icp.companyLocations,
    organization_industries: icp.industries,
    organization_num_employees_ranges: icp.employeeRanges,
    q_organization_domains_list: icp.domains,
    q_keywords: icp.keywords,
  };
}

function mapOrg(org: ApolloOrg | null | undefined) {
  const website = org?.website_url ?? org?.primary_domain ?? org?.domain ?? null;
  const domain = org?.primary_domain ?? org?.domain ?? (website ? hostOf(website) : null);
  return {
    name: org?.name ?? null,
    domain: domain ? domain.toLowerCase() : null,
    website: website ? withScheme(website) : null,
    industry: org?.industry ?? org?.industries?.[0] ?? null,
    employees: org?.estimated_num_employees ?? null,
    city: org?.city ?? null,
    region: org?.state ?? null,
    country: org?.country ?? null,
    linkedinUrl: org?.linkedin_url ?? null,
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(withScheme(url)).host.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  }
}

function withScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** apollo masks surnames in search results. we never invent one. */
function displayName(person: ApolloSearchPerson): string {
  if (person.name) return person.name.trim();
  const first = person.first_name?.trim();
  const last = person.last_name_obfuscated?.trim();
  if (first && last) return `${first} ${last}`;
  return first || last || "unknown";
}

function sizeLabel(employees: number | null): string | null {
  if (!employees || employees <= 0) return null;
  const bucket = APOLLO_SIZE_RANGES.find((r) => {
    const [min, max] = r.value.split(",");
    const lo = Number(min);
    const hi = max === "" ? Number.POSITIVE_INFINITY : Number(max);
    return employees >= lo && employees <= hi;
  });
  return bucket?.label ?? null;
}

export const apolloProvider: Provider = {
  id: "apollo",
  info: APOLLO_INFO,

  isConfigured(secret) {
    return Boolean(secret && secret.trim().length >= 8);
  },

  async searchPeople({ secret, icp, page, perPage }): Promise<SearchPage<ProspectPerson>> {
    const url = withArrayParams(`${BASE}/mixed_people/api_search`, {
      person_titles: icp.titles,
      person_seniority: icp.seniority,
      person_locations: icp.personLocations,
      ...orgFilters(icp),
      page,
      per_page: perPage,
    });

    const data = await apiFetch<ApolloSearchResponse>({
      method: "POST",
      url,
      headers: { "x-api-key": secret, "cache-control": "no-cache" },
      providerLabel: "apollo",
    });

    const people = data.people ?? [];
    const total = data.pagination?.total_entries ?? people.length;

    return {
      items: people.map((person) => {
        const org = mapOrg(person.organization);
        return {
          providerRecordId: person.id,
          fullName: displayName(person),
          jobTitle: person.title ?? null,
          seniority: person.seniority ?? null,
          companyName: org.name,
          companyDomain: org.domain,
          companyWebsite: org.website,
          companySize: sizeLabel(org.employees),
          industry: org.industry,
          location: [org.city, org.region, org.country].filter(Boolean).join(", ") || null,
          // apollo search never returns an address. has_email only says one exists.
          email: null,
          emailStatus: person.has_email ? "available on request" : "none",
          phone: null,
          linkedinUrl: person.linkedin_url ?? null,
          xUrl: null,
        } satisfies ProspectPerson;
      }),
      total,
      page,
      hasMore: page * perPage < total,
      cursor: null,
      creditsUsed: 0,
    };
  },

  async searchCompanies({ secret, icp, page, perPage }): Promise<SearchPage<ProspectCompany>> {
    const url = withArrayParams(`${BASE}/mixed_companies/search`, {
      ...orgFilters(icp),
      page,
      per_page: perPage,
    });

    const data = await apiFetch<ApolloOrgSearchResponse>({
      method: "POST",
      url,
      headers: { "x-api-key": secret, "cache-control": "no-cache" },
      providerLabel: "apollo",
    });

    const organizations = data.organizations ?? [];
    const total = data.pagination?.total_entries ?? organizations.length;

    return {
      items: organizations.map((org, index) => {
        const mapped = mapOrg(org);
        return {
          providerRecordId: org.id ?? `${mapped.domain ?? "org"}-${index}`,
          name: mapped.name ?? "unknown",
          domain: mapped.domain,
          website: mapped.website,
          industry: mapped.industry,
          employeeCount: mapped.employees,
          sizeLabel: sizeLabel(mapped.employees),
          city: mapped.city,
          region: mapped.region,
          country: mapped.country,
          linkedinUrl: mapped.linkedinUrl,
          peopleCount: org.num_contacts ?? null,
        } satisfies ProspectCompany;
      }),
      total,
      page,
      hasMore: page * perPage < total,
      cursor: null,
      creditsUsed: 0,
    };
  },

  /**
   * the enrich call. this is the only apollo call that costs a credit, and the only
   * one that can hand back a real address.
   */
  async revealEmail({ secret, person }) {
    const url = withArrayParams(`${BASE}/people/match`, {
      id: person.providerRecordId,
      reveal_personal_emails: "false",
      run_waterfall_email: "false",
    });

    const data = await apiFetch<ApolloMatchResponse>({
      method: "POST",
      url,
      headers: { "x-api-key": secret, "cache-control": "no-cache" },
      providerLabel: "apollo",
    });

    const match = data.person ?? null;
    if (!match) {
      return { email: null, status: "no match", confidence: data.match_confidence ?? "none" };
    }

    const email = match.email?.trim() || null;
    return {
      email,
      status: match.email_status ?? (email ? "unverified" : "none"),
      confidence: match.match_confidence ?? data.match_confidence ?? null,
    };
  },

  async verify({ secret }) {
    // the cheapest call that still proves the key works
    const url = withArrayParams(`${BASE}/mixed_people/api_search`, { page: 1, per_page: 1 });
    const data = await apiFetch<ApolloSearchResponse>({
      method: "POST",
      url,
      headers: { "x-api-key": secret, "cache-control": "no-cache" },
      providerLabel: "apollo",
    });
    const found = data.people?.[0];
    return { ok: true, label: found?.organization?.name ?? "apollo is answering" };
  },
};

export { sizeLabel as apolloSizeLabelFromEmployees };