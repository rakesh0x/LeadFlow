/** what a prospect provider has to be able to do. */

export type ProviderId = "apollo" | "pdl";
export type SearchKind = "people" | "companies";

/** the ideal customer profile the user described. */
export interface Icp {
  /** free-text job title, e.g. "head of growth". providers match loosely. */
  titles: string[];
  /** seniority filter, mapped to each provider's own vocabulary. */
  seniority: string[];
  /** where the company is based. */
  companyLocations: string[];
  /** where the person is based. */
  personLocations: string[];
  /** provider-native industry names. apollo needs exact matches. */
  industries: string[];
  /** employee count ranges as "min,max". empty means any size. */
  employeeRanges: string[];
  /** apollo only: restrict to these company domains. */
  domains: string[];
  /** apollo only: free-text company keywords. */
  keywords: string[];
}

export const EMPTY_ICP: Icp = {
  titles: [],
  seniority: [],
  companyLocations: [],
  personLocations: [],
  industries: [],
  employeeRanges: [],
  domains: [],
  keywords: [],
};

export function hasAnyFilter(icp: Icp): boolean {
  return (
    icp.titles.length > 0 ||
    icp.seniority.length > 0 ||
    icp.companyLocations.length > 0 ||
    icp.personLocations.length > 0 ||
    icp.industries.length > 0 ||
    icp.employeeRanges.length > 0 ||
    icp.domains.length > 0 ||
    icp.keywords.length > 0
  );
}

export interface ProspectPerson {
  /** stable id in the provider's own namespace. */
  providerRecordId: string;
  fullName: string;
  jobTitle: string | null;
  seniority: string | null;
  companyName: string | null;
  companyDomain: string | null;
  companyWebsite: string | null;
  companySize: string | null;
  industry: string | null;
  location: string | null;
  email: string | null;
  /** provider's own word for how trustworthy that email is. */
  emailStatus: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
}

export interface ProspectCompany {
  providerRecordId: string;
  name: string;
  domain: string | null;
  website: string | null;
  industry: string | null;
  employeeCount: number | null;
  sizeLabel: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  linkedinUrl: string | null;
  /** apollo returns a number of people at the company. used as a lead for enrichment. */
  peopleCount: number | null;
}

export interface SearchPage<T> {
  items: T[];
  total: number;
  page: number;
  hasMore: boolean;
  /** provider-specific pagination state (pdl scroll_token). */
  cursor: string | null;
  creditsUsed: number;
}

export type ProviderErrorCode =
  | "not_configured"
  | "unauthorized"
  | "forbidden"
  | "plan_blocked"
  | "out_of_credits"
  | "rate_limited"
  | "bad_request"
  | "unprocessable"
  | "server_error"
  | "network"
  | "timeout"
  | "unknown";

/** a failure the interface can explain in plain language. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly detail: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(init: {
    code: ProviderErrorCode;
    message: string;
    retryable?: boolean;
    status?: number | null;
    detail?: string | null;
    retryAfterSeconds?: number | null;
  }) {
    super(init.message);
    this.name = "ProviderError";
    this.code = init.code;
    this.retryable = init.retryable ?? false;
    this.status = init.status ?? null;
    this.detail = init.detail ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      status: this.status,
      detail: this.detail,
      retryAfterSeconds: this.retryAfterSeconds,
    };
  }
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** what you can search for with this provider. */
  kinds: SearchKind[];
  /** true when search results can include a real email address. */
  providesEmailOnSearch: boolean;
  /** how email addresses are obtained if not on search. */
  emailMethod: string;
  signupUrl: string;
  docsUrl: string;
  keyUrl: string;
  /** plain-language notes about plans and limits, shown in setup. */
  planNotes: string[];
  /** what the company size filter is called. */
  sizeFilterLabel: string;
  /** set when this provider cannot do company search. */
  companiesNote?: string;
}

export interface Provider {
  id: ProviderId;
  info: ProviderInfo;
  /** true when we hold a usable key for this provider. */
  isConfigured(secret: string | null, plan: string | null): boolean;
  searchPeople(args: { secret: string; icp: Icp; page: number; perPage: number; cursor: string | null }): Promise<SearchPage<ProspectPerson>>;
  searchCompanies?(args: { secret: string; icp: Icp; page: number; perPage: number }): Promise<SearchPage<ProspectCompany>>;
  /** resolve a real contact address. returns null when the provider has none. */
  revealEmail?(args: { secret: string; person: ProspectPerson }): Promise<{ email: string | null; status: string | null; confidence: string | null }>;
  /** cheap call that proves the key works. */
  verify?(args: { secret: string }): Promise<{ ok: true; label: string }>;
}