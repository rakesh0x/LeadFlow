/**
 * people data labs
 *
 * verified against the official docs:
 *  - endpoint  POST https://api.peopledatalabs.com/v5/person/search
 *  - auth      X-Api-Key header
 *  - body      { query: <elasticsearch>, size, scroll_token?, dataset, titlecase }
 *  - response  { status, data: [...], total, scroll_token }
 *
 * pdl has the sharpest filters of the two and an instant free tier, which is why it is
 * worth having. the catch is that the free tier masks contact data, so an address from a
 * free key may not be deliverable. we record which plan a key is on so the interface can
 * say so rather than quietly passing it off as a real address.
 */
import { apiFetch } from "../http";
import type { Icp, ProspectPerson, Provider, ProviderInfo, SearchPage } from "../types";

const ENDPOINT = "https://api.peopledatalabs.com/v5/person/search";

export const PDL_INFO: ProviderInfo = {
  id: "pdl",
  label: "people data labs",
  kinds: ["people"],
  providesEmailOnSearch: true,
  emailMethod:
    "email addresses come back with the search itself, but the free plan masks them. mark the key as a pro key if you have one.",
  signupUrl: "https://www.peopledatalabs.com/signup",
  docsUrl: "https://docs.peopledatalabs.com/docs/reference-person-search-api",
  keyUrl: "https://dashboard.peopledatalabs.com/",
  sizeFilterLabel: "company size",
  companiesNote: "company search is not wired up for this provider here. use apollo if you want a list of companies.",
  planNotes: [
    "free is instant: 100 records a month, no sales call. contact data is masked on the free plan.",
    "pro starts around $98 a month for 350 records, and unmasked emails and phone numbers.",
    "rate limit is 10 requests a minute, which is plenty for a page of results.",
    "sign up, then copy the active key from the dashboard's api keys page.",
  ],
};

interface PdlEmail {
  address?: string | null;
  type?: string | null;
  num_sources?: number | null;
}

interface PdlPerson {
  id?: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  job_title?: string | null;
  title?: string | null;
  job_title_levels?: string[] | null;
  job_company_name?: string | null;
  job_company_website?: string | null;
  job_company_domain?: string | null;
  job_company_size?: string | null;
  job_company_employee_count?: number | null;
  job_company_industry?: string | null;
  job_company_location_country?: string | null;
  job_company_location_name?: string | null;
  location_country?: string | null;
  location_name?: string | null;
  work_email?: string | null;
  emails?: PdlEmail[] | null;
  phone_numbers?: string[] | null;
  linkedin_url?: string | null;
  twitter_url?: string | null;
}

interface PdlResponse {
  status?: number;
  data?: PdlPerson[] | null;
  total?: number | null;
  scroll_token?: string | null;
}

/**
 * "51,200", "51-200", "51 to 200" and "51–200" all mean the same thing to us, and so
 * does "1,001+". anything we cannot read is dropped rather than guessed at.
 */
export function parseRange(range: string): { min: number; max: number } | null {
  const value = range.trim();
  const open = value.match(/^(\d[\d,]*)\s*\+/);
  if (open) return { min: Number(open[1].replace(/,/g, "")), max: Number.MAX_SAFE_INTEGER };
  const pair = value.match(/^(\d[\d,]*?)\s*(?:,|-|\u2013|to)\s*(\d[\d,]*)$/i);
  if (pair) {
    return { min: Number(pair[1].replace(/,/g, "")), max: Number(pair[2].replace(/,/g, "")) };
  }
  const single = value.match(/^(\d[\d,]*)$/);
  if (single) {
    const n = Number(single[1].replace(/,/g, ""));
    return { min: n, max: n };
  }
  return null;
}

/**
 * builds an elasticsearch query. pdl accepts term, terms, exists, bool, match,
 * range, match_phrase, wildcard, prefix and match_all — which is all we need.
 */
export function buildPdlQuery(icp: Icp): Record<string, unknown> {
  const must: unknown[] = [];
  const should: unknown[] = [];

  if (icp.titles.length) {
    should.push(
      ...icp.titles.map((title) => ({
        match: { job_title: { query: title, operator: "and" } },
      })),
    );
  }

  if (icp.seniority.length) {
    must.push({ terms: { job_title_levels: icp.seniority } });
  }

  if (icp.personLocations.length) {
    should.push(
      ...icp.personLocations.flatMap((loc) => [
        { wildcard: { "location_name.keyword": { value: `*${loc.toLowerCase()}*` } } },
        { wildcard: { "location_names.keyword": { value: `*${loc.toLowerCase()}*` } } },
      ]),
    );
  }

  if (icp.companyLocations.length) {
    should.push(
      ...icp.companyLocations.flatMap((loc) => [
        { wildcard: { "job_company_location_name.keyword": { value: `*${loc.toLowerCase()}*` } } },
        { wildcard: { "job_company_location_country": { value: loc.toLowerCase() } } },
      ]),
    );
  }

  if (icp.industries.length) {
    should.push(
      ...icp.industries.map((industry) => ({
        match: { job_company_industry: { query: industry, operator: "and" } },
      })),
    );
  }

  if (icp.domains.length) {
    must.push({
      terms: {
        "job_company_domain.keyword": icp.domains.map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "")),
      },
    });
  }

  // employee ranges are turned into a numeric range so we never depend on pdl's bucket names
  const ranges = icp.employeeRanges.map(parseRange).filter((r): r is { min: number; max: number } => r !== null);
  if (ranges.length === 1) {
    must.push({ range: { job_company_employee_count: { gte: ranges[0].min, lte: ranges[0].max } } });
  } else if (ranges.length > 1) {
    must.push({
      bool: {
        should: ranges.map((r) => ({ range: { job_company_employee_count: { gte: r.min, lte: r.max } } })),
        minimum_should_match: 1,
      },
    });
  }

  if (icp.keywords.length) {
    should.push(
      ...icp.keywords.map((keyword) => ({ match: { job_company_name: { query: keyword, operator: "and" } } })),
    );
  }

  // only people with some professional footprint at a company
  must.push({ exists: { field: "job_company_name" } });

  const bool: Record<string, unknown> = { must };
  if (should.length) {
    bool.should = should;
    bool.minimum_should_match = 1;
  }

  return { query: { bool } };
}

function bestEmail(person: PdlPerson): { email: string | null; type: string | null } {
  const professional = (person.emails ?? []).find((e) => (e.type ?? "").toLowerCase() === "professional");
  if (professional?.address) return { email: professional.address.trim(), type: "professional" };
  if (person.work_email) return { email: person.work_email.trim(), type: "work" };
  const anyWork = (person.emails ?? []).find((e) => e.address);
  if (anyWork?.address) return { email: anyWork.address.trim(), type: anyWork.type ?? "unknown" };
  return { email: null, type: null };
}

function site(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export const pdlProvider: Provider = {
  id: "pdl",
  info: PDL_INFO,

  isConfigured(secret) {
    return Boolean(secret && secret.trim().length >= 8);
  },

  async searchPeople({ secret, icp, page, perPage, cursor }): Promise<SearchPage<ProspectPerson>> {
    const body: Record<string, unknown> = {
      ...buildPdlQuery(icp),
      size: Math.min(100, Math.max(1, perPage)),
      titlecase: true,
      // emails need the email dataset; we never read personal contact data
      dataset: "all,-consumer_social,-street_address",
    };
    // pdl paginates with a scroll token rather than an offset
    if (cursor) body.scroll_token = cursor;
  else body.from = Math.max(0, (page - 1) * Math.min(100, Math.max(1, perPage)));

    const data = await apiFetch<PdlResponse>({
      method: "POST",
      url: ENDPOINT,
      headers: { "X-Api-Key": secret },
      body,
      providerLabel: "people data labs",
    });

    const people = data.data ?? [];
    const nextCursor = data.scroll_token ?? null;

    return {
      items: people.map((person) => {
        const email = bestEmail(person);
        const website = person.job_company_domain ?? person.job_company_website ?? null;
        return {
          providerRecordId: person.id ?? `${person.full_name ?? "unknown"}@${website ?? "no-domain"}`,
          fullName: (person.full_name ?? `${person.first_name ?? ""} ${person.last_name ?? ""}`).trim() || "unknown",
          jobTitle: person.job_title ?? person.title ?? null,
          seniority: person.job_title_levels?.[0] ?? null,
          companyName: person.job_company_name ?? null,
          companyDomain: website ? website.replace(/^https?:\/\//, "").replace(/^www\./, "") : null,
          companyWebsite: site(website),
          companySize: person.job_company_size ?? null,
          industry: person.job_company_industry ?? null,
          location: person.job_company_location_name ?? person.location_name ?? person.job_company_location_country ?? null,
          email: email.email,
          emailStatus: email.type,
          phone: person.phone_numbers?.[0] ?? null,
          // pdl returns profile urls without a scheme
          linkedinUrl: person.linkedin_url ? site(person.linkedin_url) : null,
          xUrl: person.twitter_url ? site(person.twitter_url) : null,
        } satisfies ProspectPerson;
      }),
      total: data.total ?? people.length,
      page,
      hasMore: nextCursor !== null,
      cursor: nextCursor,
      // pdl bills one credit per profile returned
      creditsUsed: people.length,
    };
  },

  /** pdl search already carries the address, so there is nothing to resolve afterwards. */
  // eslint-disable-next-line require-await
  async revealEmail({ person }) {
    return {
      email: person.email,
      status: person.emailStatus,
      confidence: null,
    };
  },

  async verify({ secret }) {
    const data = await apiFetch<PdlResponse>({
      method: "POST",
      url: ENDPOINT,
      headers: { "X-Api-Key": secret },
      body: { query: { query: { match_all: {} } }, size: 1, titlecase: true },
      providerLabel: "people data labs",
    });
    const found = data.data?.[0];
    return { ok: true, label: found?.job_company_name ?? "people data labs is answering" };
  },
};