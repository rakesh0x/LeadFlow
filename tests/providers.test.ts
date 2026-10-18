/**
 * checks our provider adapters against the exact response shapes from the published
 * apollo and people data labs documentation.
 *
 * no network, no credits. this proves we read the payloads correctly, build the requests
 * the way each api documents, and turn their error envelopes into something a person can
 * act on. the payloads below are transcribed from the vendors' own examples.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { apolloProvider } from "../src/lib/prospecting/providers/apollo";
import { pdlProvider, buildPdlQuery } from "../src/lib/prospecting/providers/pdl";
import { ProviderError, type Icp } from "../src/lib/prospecting/types";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const captured: Captured[] = [];
let canned: { status: number; body: unknown; headers?: Record<string, string> } = { status: 200, body: {} };
const realFetch = globalThis.fetch;

beforeEach(() => {
  captured.length = 0;
  canned = { status: 200, body: {} };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    captured.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    return new Response(JSON.stringify(canned.body), {
      status: canned.status,
      headers: { "content-type": "application/json", ...(canned.headers ?? {}) },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** urlsearchparams encodes spaces as "+", so read it properly rather than by eye. */
function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}
function arrayParam(url: string, name: string): string[] {
  return params(url).getAll(`${name}[]`);
}

const blankIcp: Icp = {
  titles: [],
  seniority: [],
  companyLocations: [],
  personLocations: [],
  industries: [],
  employeeRanges: [],
  domains: [],
  keywords: [],
};

// ---------------------------------------------------------------- apollo

describe("apollo people search", () => {
  it("sends the request the api documents", async () => {
    canned.body = { pagination: { total_entries: 0 }, people: [] };

    await apolloProvider.searchPeople({
      secret: "test-key",
      icp: {
        ...blankIcp,
        titles: ["head of growth", "vp sales"],
        seniority: ["vp"],
        companyLocations: ["united kingdom"],
        industries: ["computer software"],
        employeeRanges: ["51,200"],
        domains: ["acme.com"],
      },
      page: 2,
      perPage: 25,
      cursor: null,
    });

    const request = captured[0];
    assert.equal(request.method, "POST");
    assert.match(request.url, /^https:\/\/api\.apollo\.io\/api\/v1\/mixed_people\/api_search\?/);
    assert.equal(request.headers["x-api-key"], "test-key", "the key goes in the x-api-key header");

    assert.deepEqual(arrayParam(request.url, "person_titles"), ["head of growth", "vp sales"]);
    assert.deepEqual(arrayParam(request.url, "person_seniority"), ["vp"]);
    assert.deepEqual(arrayParam(request.url, "organization_locations"), ["united kingdom"]);
    assert.deepEqual(arrayParam(request.url, "organization_industries"), ["computer software"]);
    assert.deepEqual(arrayParam(request.url, "organization_num_employees_ranges"), ["51,200"]);
    assert.deepEqual(arrayParam(request.url, "q_organization_domains_list"), ["acme.com"]);
    assert.equal(params(request.url).get("page"), "2");
    assert.equal(params(request.url).get("per_page"), "25");
  });

  it("reads a documented response and refuses to invent an address", async () => {
    canned.body = {
      pagination: { total_entries: 137, page: 1, per_page: 2 },
      people: [
        {
          id: "64a7ff0cc4dfae00013df1a5",
          first_name: "Marcus",
          last_name_obfuscated: "Ellery",
          title: "VP of Sales Operations",
          seniority: "vp",
          linkedin_url: "http://www.linkedin.com/in/marcus-ellery-4c2b81de",
          has_email: true,
          has_direct_phone: false,
          organization: {
            id: "5e66b6381e05b4008c8331b8",
            name: "Apollo.io",
            website_url: "http://www.apollo.io",
            primary_domain: "apollo.io",
            industry: "information technology & services",
            estimated_num_employees: 1600,
            city: "San Francisco",
            state: "California",
            country: "United States",
            linkedin_url: "https://www.linkedin.com/company/apolloio",
          },
        },
      ],
    };

    const page = await apolloProvider.searchPeople({
      secret: "test-key",
      icp: { ...blankIcp, titles: ["vp"] },
      page: 1,
      perPage: 2,
      cursor: null,
    });

    assert.equal(page.total, 137);
    assert.equal(page.hasMore, true);
    assert.equal(page.creditsUsed, 0, "apollo people search is free");

    const person = page.items[0];
    assert.equal(person.providerRecordId, "64a7ff0cc4dfae00013df1a5");
    assert.equal(person.fullName, "Marcus Ellery");
    assert.equal(person.jobTitle, "VP of Sales Operations");
    assert.equal(person.seniority, "vp");
    assert.equal(person.companyName, "Apollo.io");
    assert.equal(person.companyDomain, "apollo.io");
    assert.equal(person.companyWebsite, "http://www.apollo.io");
    assert.equal(person.companySize, "1,001–2,000 people", "1600 employees maps to the right bucket");
    assert.equal(person.industry, "information technology & services");
    assert.equal(person.location, "San Francisco, California, United States");
    assert.equal(person.linkedinUrl, "http://www.linkedin.com/in/marcus-ellery-4c2b81de");
    assert.equal(person.email, null, "apollo search withholds addresses, so we must not make one up");
    assert.match(person.emailStatus ?? "", /available on request/);
  });

  it("handles a record with no organisation data", async () => {
    canned.body = { pagination: { total_entries: 1 }, people: [{ id: "abc", first_name: "Solo", last_name_obfuscated: "Trader", title: null }] };

    const page = await apolloProvider.searchPeople({ secret: "test-key", icp: blankIcp, page: 1, perPage: 25, cursor: null });
    assert.equal(page.items[0].fullName, "Solo Trader");
    assert.equal(page.items[0].companyName, null);
    assert.equal(page.items[0].email, null);
    assert.match(page.items[0].emailStatus ?? "", /none/);
  });
});

describe("apollo company search", () => {
  it("sends and reads the documented company shape", async () => {
    canned.body = {
      pagination: { total_entries: 500, page: 1, per_page: 25 },
      organizations: [
        {
          id: "61f2d5a8c40b7200019e4f31",
          name: "Northstar Analytics",
          website_url: "https://www.northstaranalytics.io",
          primary_domain: "northstaranalytics.io",
          industry: "information technology & services",
          estimated_num_employees: 850,
          city: "San Francisco",
          state: "California",
          country: "United States",
          linkedin_url: "https://www.linkedin.com/company/apolloio",
          num_contacts: 42,
        },
      ],
    };

    const page = await apolloProvider.searchCompanies!({
      secret: "test-key",
      icp: { ...blankIcp, industries: ["information technology & services"], employeeRanges: ["501,1000"] },
      page: 1,
      perPage: 25,
    });

    assert.match(captured[0].url, /mixed_companies\/search/);
    assert.deepEqual(arrayParam(captured[0].url, "organization_industries"), ["information technology & services"]);
    assert.deepEqual(arrayParam(captured[0].url, "organization_num_employees_ranges"), ["501,1000"]);

    assert.equal(page.total, 500);
    const company = page.items[0];
    assert.equal(company.name, "Northstar Analytics");
    assert.equal(company.domain, "northstaranalytics.io");
    assert.equal(company.employeeCount, 850);
    assert.equal(company.sizeLabel, "501–1,000 people");
    assert.equal(company.city, "San Francisco");
    assert.equal(company.peopleCount, 42);
  });
});

describe("apollo enrichment", () => {
  it("reads a documented enrich response", async () => {
    canned.body = {
      person: {
        id: "64a7ff0cc4dfae00013df1a5",
        first_name: "Marcus",
        last_name: "Ellery",
        name: "Marcus Ellery",
        title: "VP of Sales Operations",
        email: "marcus.ellery@apollo.io",
        email_status: "verified",
        match_confidence: "high",
        twitter_url: "https://x.com/marcus",
        organization: { name: "Apollo.io", primary_domain: "apollo.io" },
      },
    };

    const outcome = await apolloProvider.revealEmail!({
      secret: "test-key",
      person: { providerRecordId: "64a7ff0cc4dfae00013df1a5" } as never,
    });

    assert.equal(outcome.email, "marcus.ellery@apollo.io");
    assert.equal(outcome.status, "verified");
    assert.equal(outcome.confidence, "high");

    assert.match(captured[0].url, /\/api\/v1\/people\/match\?/);
    assert.equal(params(captured[0].url).get("id"), "64a7ff0cc4dfae00013df1a5");
    // we do not pay for waterfall or phone, so we do not ask for them
    assert.equal(params(captured[0].url).get("run_waterfall_email"), "false");
    assert.equal(params(captured[0].url).get("reveal_personal_emails"), "false");
    assert.equal(captured[0].headers["x-api-key"], "test-key");
  });

  it("reports no address rather than making one up when apollo has none", async () => {
    canned.body = { person: { id: "x", name: "No Contact", email: null, email_status: "not_available" }, match_confidence: "none" };

    const outcome = await apolloProvider.revealEmail!({ secret: "test-key", person: { providerRecordId: "x" } as never });
    assert.equal(outcome.email, null, "apollo had no address and we did not make one up");
    assert.equal(outcome.status, "not_available", "we pass on what apollo actually said");
  });
});

describe("apollo errors", () => {
  const cases: Array<[number, unknown, string, boolean]> = [
    [401, { error_code: "AUTH_AUTHENTICATION_CREDENTIALS_INVALID", message: "bad key" }, "unauthorized", false],
    [403, { error_code: "PLAN_BLOCKED", message: "upgrade your plan" }, "plan_blocked", false],
    [402, { error_code: "OUT_OF_CREDITS", message: "no credits left" }, "out_of_credits", false],
    [429, { error_code: "RATE_LIMITED", message: "slow down" }, "rate_limited", true],
    [422, { error_code: "INVALID_PARAM", message: "bad industry" }, "unprocessable", false],
    [500, { error_code: "SERVER_ERROR", message: "boom" }, "server_error", true],
  ];

  for (const [status, body, expectedCode, retryable] of cases) {
    it(`turns ${status} into ${expectedCode}`, async () => {
      canned = { status, body, headers: status === 429 ? { "retry-after": "1" } : undefined };

      await assert.rejects(
        () =>
          apolloProvider.searchPeople({
            secret: "test-key",
            icp: { ...blankIcp, titles: ["x"] },
            page: 1,
            perPage: 1,
            cursor: null,
          }),
        (error: unknown) => {
          assert.ok(error instanceof ProviderError);
          assert.equal(error.code, expectedCode);
          assert.equal(error.retryable, retryable);
          assert.ok(error.message.length > 0, "there is always something to read");
          return true;
        },
      );
    });
  }

  it("does not loop forever on a failing provider", async () => {
    canned = { status: 500, body: { error_code: "SERVER_ERROR", message: "boom" } };
    await assert.rejects(() =>
      apolloProvider.searchPeople({ secret: "test-key", icp: blankIcp, page: 1, perPage: 1, cursor: null }),
    );
    assert.ok(captured.length <= 3, `expected at most one retry, saw ${captured.length} attempts`);
  });
});

// ---------------------------------------------------------------- pdl

describe("people data labs", () => {
  it("sends the request the api documents", async () => {
    canned.body = { status: 200, data: [], total: 0, scroll_token: null };

    await pdlProvider.searchPeople({
      secret: "test-key",
      icp: { ...blankIcp, titles: ["head of growth"], seniority: ["cxo"], employeeRanges: ["51,200"] },
      page: 1,
      perPage: 25,
      cursor: null,
    });

    const request = captured[0];
    assert.equal(request.method, "POST");
    assert.match(request.url, /^https:\/\/api\.peopledatalabs\.com\/v5\/person\/search$/);
    assert.equal(request.headers["X-Api-Key"], "test-key", "pdl authenticates with X-Api-Key");

    const body = request.body as Record<string, unknown>;
    assert.equal(body.size, 25);
    assert.equal(body.titlecase, true, "we ask for proper casing rather than fixing it ourselves");
    const query = body.query as { bool?: unknown };
    assert.ok(query?.bool, "the body carries an elasticsearch query, as documented");
  });

  it("maps a documented person record", async () => {
    canned.body = {
      status: 200,
      total: 1,
      scroll_token: "1117$12.176522",
      data: [
        {
          id: "geOZltvqXDfpKzxgrzmJZj_0000",
          full_name: "kimberly patton",
          job_title: "tax adviser",
          job_title_levels: ["vp"],
          job_company_name: "hall, rios and miller",
          job_company_website: "hall-rios-and-miller.com",
          job_company_size: "10001+",
          job_company_industry: "wireless",
          job_company_location_name: "east diana, quebec, canada",
          linkedin_url: "linkedin.com/in/kimberly_patton",
          twitter_url: "twitter.com/kimberly_patton",
          emails: [{ address: "kimberly_patton@hall-rios-and-miller.com", type: "professional", num_sources: 10 }],
          work_email: "kimberly_patton@hall-rios-and-miller.com",
          phone_numbers: ["+12493405557"],
        },
      ],
    };

    const page = await pdlProvider.searchPeople({ secret: "test-key", icp: blankIcp, page: 1, perPage: 25, cursor: null });

    assert.equal(page.total, 1);
    assert.equal(page.cursor, "1117$12.176522");
    assert.equal(page.hasMore, true);
    assert.equal(page.creditsUsed, 1, "pdl bills one credit per profile returned");

    const person = page.items[0];
    assert.equal(person.providerRecordId, "geOZltvqXDfpKzxgrzmJZj_0000");
    assert.equal(person.fullName, "kimberly patton");
    assert.equal(person.jobTitle, "tax adviser");
    assert.equal(person.seniority, "vp");
    assert.equal(person.companyName, "hall, rios and miller");
    assert.equal(person.companyDomain, "hall-rios-and-miller.com");
    assert.equal(person.companyWebsite, "https://hall-rios-and-miller.com", "the scheme is added, not invented");
    assert.equal(person.companySize, "10001+");
    assert.equal(person.email, "kimberly_patton@hall-rios-and-miller.com");
    assert.equal(person.emailStatus, "professional");
    assert.equal(person.linkedinUrl, "https://linkedin.com/in/kimberly_patton", "pdl returns profile urls with no scheme");
    assert.equal(person.xUrl, "https://twitter.com/kimberly_patton");
    assert.equal(person.phone, "+12493405557");
    assert.equal(person.location, "east diana, quebec, canada");
  });

  it("sends the scroll token back when paginating", async () => {
    canned.body = { status: 200, data: [], total: 99, scroll_token: "next-token" };

    await pdlProvider.searchPeople({ secret: "test-key", icp: blankIcp, page: 4, perPage: 25, cursor: "previous-token" });

    const body = captured[0].body as Record<string, unknown>;
    assert.equal(body.scroll_token, "previous-token");
    assert.equal(body.from, undefined, "scroll_token and from must not both be sent");
  });

  it("never sends a request with no filters", async () => {
    canned.body = { status: 200, data: [], total: 0 };
    await pdlProvider.searchPeople({ secret: "test-key", icp: blankIcp, page: 1, perPage: 25, cursor: null });
    const body = captured[0].body as { query: { bool: { must: unknown[] } } };
    assert.ok(body.query.bool.must.length > 0, "there is always a baseline condition");
  });

  it("builds a query using only the types the api accepts", () => {
    const query = buildPdlQuery({
      titles: ["head of growth"],
      seniority: ["cxo"],
      companyLocations: ["united kingdom"],
      personLocations: ["berlin"],
      industries: ["computer software"],
      employeeRanges: ["51,200"],
      domains: ["Acme.com"],
      keywords: ["logistics"],
    }) as { query: { bool: { must: unknown[]; should: unknown[]; minimum_should_match: number } } };

    const { bool } = query.query;
    assert.equal(bool.minimum_should_match, 1);

    // each clause is { <query type>: { <field>: ... } }. the type is the only key we control,
    // and pdl only accepts these ten.
    const allowed = ["term", "terms", "exists", "bool", "match", "range", "match_phrase", "wildcard", "prefix", "match_all"];
    const structural = new Set(["bool", "must", "should", "minimum_should_match", "query"]);
    const walk = (node: unknown, depth = 0) => {
      if (Array.isArray(node)) {
        node.forEach((child) => walk(child, depth));
        return;
      }
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (depth === 1 && !structural.has(key)) {
          assert.ok(allowed.includes(key), `pdl does not accept the query type "${key}"`);
        }
        walk(value, depth + 1);
      }
    };
    walk({ bool });

    // domains are normalised before they leave the building
    assert.match(JSON.stringify(bool.must), /acme\.com/);
    assert.doesNotMatch(JSON.stringify(bool.must), /Acme\.com/);
    // a size range becomes a numeric range, so we never depend on their bucket names
    assert.match(JSON.stringify(bool.must), /job_company_employee_count/);
  });

  it("understands every range format a person might type", () => {
    const fromRange = (value: string) =>
      JSON.stringify(buildPdlQuery({ ...blankIcp, employeeRanges: [value] }) as { query: { bool: { must: unknown[] } } });

    assert.match(fromRange("51,200"), /job_company_employee_count/);
    assert.match(fromRange("51-200"), /job_company_employee_count/);
    assert.match(fromRange("51 to 200"), /job_company_employee_count/);
    assert.match(fromRange("1001+"), /job_company_employee_count/);
  });

  it("maps a 401 to a plain explanation", async () => {
    canned = { status: 401, body: { message: "invalid api key" } };
    await assert.rejects(
      () => pdlProvider.searchPeople({ secret: "bad", icp: blankIcp, page: 1, perPage: 10, cursor: null }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.code, "unauthorized");
        assert.match(error.message, /copied the whole thing/i);
        return true;
      },
    );
  });
});