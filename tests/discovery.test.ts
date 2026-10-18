/**
 * prospect discovery, end to end, against a real database and a stubbed provider.
 *
 * nothing here invents a lead. the stub stands in for apollo/pdl and returns exactly
 * the shape those apis return, so we are testing our mapping, our duplicate handling
 * and our import path rather than our imagination.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";

import { openDb } from "../src/lib/db/client";
import { nowIso } from "../src/lib/db/time";
import { PROVIDERS, saveCredential, resolveCredential, credentialStatuses } from "../src/lib/prospecting";
import { enrichCandidates, importCandidates, listCandidates, runSearch } from "../src/lib/prospecting/discovery";
import { ProviderError, type Icp, type ProspectCompany, type ProspectPerson, type SearchKind } from "../src/lib/prospecting/types";
import { getLead, queryLeads } from "../src/lib/queries/leads";
import { overview } from "../src/lib/queries/analytics";

let db: any;
let workspaceId: string;
let memberId: string;

/** what the stub returns, and what it should be told to hand back. */
const stub = {
  people: [] as ProspectPerson[],
  companies: [] as ProspectCompany[],
  /** what revealEmail resolves to, keyed by provider record id. */
  revealed: new Map<string, { email: string | null; status: string }>(),
  calls: [] as string[],
  lastIcp: null as Icp | null,
  failure: null as ProviderError | null,
};

const stubProvider = {
  id: "apollo" as const,
  info: {
    id: "apollo" as const,
    label: "stub",
    kinds: ["people", "companies"],
    providesEmailOnSearch: false,
    emailMethod: "stub",
    signupUrl: "https://example.test",
    docsUrl: "https://example.test",
    keyUrl: "https://example.test",
    planNotes: [],
    sizeFilterLabel: "size",
  },
  isConfigured: (secret: string | null) => Boolean(secret && secret.length >= 8),
  async searchPeople({ icp }: { icp: Icp }) {
    if (stub.failure) throw stub.failure;
    stub.calls.push("searchPeople");
    stub.lastIcp = icp;
    return {
      items: stub.people,
      total: stub.people.length,
      page: 1,
      hasMore: false,
      cursor: null,
      creditsUsed: 0,
    };
  },
  async searchCompanies() {
    stub.calls.push("searchCompanies");
    return { items: stub.companies, total: stub.companies.length, page: 1, hasMore: false, cursor: null, creditsUsed: 0 };
  },
  async revealEmail({ person }: { person: ProspectPerson }) {
    stub.calls.push(`reveal:${person.providerRecordId}`);
    const found = stub.revealed.get(person.providerRecordId);
    return { email: found?.email ?? null, status: found?.status ?? "none", confidence: "high" };
  },
  async verify() {
    return { ok: true as const, label: "stub" };
  },
};

/**
 * the stub takes the place of apollo for the whole file. it returns exactly the shape
 * the real api returns — including the fact that search carries no email address — so
 * these tests check our mapping and our import path, not our imagination.
 */
PROVIDERS.apollo = stubProvider as never;

const icp: Icp = {
  titles: ["head of growth"],
  seniority: ["vp"],
  companyLocations: ["united kingdom"],
  personLocations: [],
  industries: ["computer software"],
  employeeRanges: ["51,200"],
  domains: [],
  keywords: [],
};

before(() => {
  db = openDb(process.env.LEADFLOW_DB_PATH);
  const now = nowIso();
  workspaceId = "ws_discovery";
  db.prepare(`INSERT INTO workspaces (id,name,slug,timezone,settings_json,created_at,updated_at) VALUES (?,'discovery','discovery','utc','{}',?,?)`).run(
    workspaceId,
    now,
    now,
  );
  memberId = "mem_discovery";
  db.prepare(`INSERT INTO members (id,workspace_id,name,email,role,avatar_hue,created_at,updated_at) VALUES (?,?,?,?,'owner',262,?,?)`).run(
    memberId,
    workspaceId,
    "rhea kapoor",
    "rhea@discovery.test",
    now,
    now,
  );
});

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = `${process.env.LEADFLOW_DB_PATH}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

function person(over: Partial<ProspectPerson> & { providerRecordId: string }): ProspectPerson {
  return {
    fullName: "unknown",
    jobTitle: null,
    seniority: null,
    companyName: null,
    companyDomain: null,
    companyWebsite: null,
    companySize: null,
    industry: null,
    location: null,
    email: null,
    emailStatus: null,
    phone: null,
    linkedinUrl: null,
    xUrl: null,
    ...over,
  };
}

async function searchWith(people: ProspectPerson[], options: Partial<Parameters<typeof runSearch>[0]> = {}) {
  stub.people = people;
  return runSearch({
    workspaceId,
    providerId: "apollo",
    kind: "people" as SearchKind,
    icp,
    perPage: 25,
    actorId: memberId,
    ...options,
  });
}

describe("credentials", () => {
  it("refuses to search with no key, and says why", async () => {
    await assert.rejects(
      () => searchWith([]),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.code, "not_configured");
        assert.match(error.message, /is not connected/i);
        return true;
      },
    );
  });

  it("stores a key encrypted and never hands the plaintext back", () => {
    const raw = "super-secret-key-1234";
    const status = saveCredential(workspaceId, "apollo", raw, { plan: "free" });
    assert.equal(status.configured, true);
    assert.equal(status.source, "database");
    assert.ok(status.hint?.endsWith("1234"));
    assert.ok(!JSON.stringify(status).includes(raw), "the status must not contain the key");

    // the ciphertext on disk must not be the key either
    const row = db.prepare(`SELECT secret_ciphertext, secret_iv, secret_tag FROM provider_credentials WHERE workspace_id = ? AND provider = 'apollo'`).get(workspaceId) as Record<string, string>;
    assert.ok(!row.secret_ciphertext.includes(raw));
    assert.notEqual(row.secret_iv, "");
    assert.notEqual(row.secret_tag, "");

    const resolved = resolveCredential(workspaceId, "apollo");
    assert.equal(resolved?.secret, raw, "it decrypts correctly on the server");
  });

  it("reports which providers are usable", () => {
    const statuses = credentialStatuses(workspaceId);
    const apollo = statuses.find((s) => s.provider === "apollo");
    assert.equal(apollo?.configured, true);
    assert.equal(statuses.find((s) => s.provider === "pdl")?.configured, false);
  });
});

describe("discovery", () => {
  it("stages results for review without creating any leads", async () => {
    const before = queryLeads(workspaceId, {}, db).total;
    const outcome = await searchWith([
      person({
        providerRecordId: "p1",
        fullName: "ada kent",
        jobTitle: "head of growth",
        companyName: "northwind labs",
        companyDomain: "northwindlabs.com",
        companyWebsite: "https://northwindlabs.com",
        companySize: "51–200",
        industry: "computer software",
        location: "london, united kingdom",
        linkedinUrl: "https://linkedin.com/in/adakent",
      }),
    ]);

    assert.equal(outcome.inserted, 1);
    assert.equal(queryLeads(workspaceId, {}, db).total, before, "nothing was written to the lead table");

    const candidates = listCandidates(workspaceId, outcome.searchId, {}, db);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].full_name, "ada kent");
    assert.equal(candidates[0].dupe_status, "new");
    assert.equal(candidates[0].email, null, "apollo search does not return addresses, so none is invented");
  });

  it("passes the icp through to the provider in the provider's own shape", async () => {
    await searchWith([]);
    assert.ok(stub.lastIcp);
    assert.deepEqual(stub.lastIcp!.titles, ["head of growth"]);
    assert.deepEqual(stub.lastIcp!.seniority, ["vp"]);
    assert.deepEqual(stub.lastIcp!.employeeRanges, ["51,200"]);
    assert.deepEqual(stub.lastIcp!.industries, ["computer software"]);
  });

  it("flags a candidate we already have, without importing it", async () => {
    // seed a real lead first
    const { createLead } = await import("../src/lib/queries/leads");
    createLead(
      workspaceId,
      { full_name: "ada kent", email: "ada@northwindlabs.com", company_name: "northwind labs", company_website: "northwindlabs.com" },
      { database: db, actorId: memberId },
    );

    const outcome = await searchWith([
      person({
        providerRecordId: "p2",
        fullName: "ada kent",
        email: "ada@northwindlabs.com",
        jobTitle: "head of growth",
        companyName: "northwind labs",
        companyDomain: "northwindlabs.com",
        companyWebsite: "https://northwindlabs.com",
      }),
    ]);

    const candidates = listCandidates(workspaceId, outcome.searchId, {}, db);
    assert.equal(candidates[0].dupe_status, "exact", "a matching email is a certain duplicate");
    assert.ok(candidates[0].dupe_lead_id, "it points at the record we already have");
    assert.equal(outcome.alreadyKnown, 1);

    // importing it must not create a second lead
    const before = queryLeads(workspaceId, {}, db).total;
    const imported = importCandidates(workspaceId, [candidates[0].id], { actorId: memberId }, db);
    assert.equal(imported.imported, 0);
    assert.equal(imported.duplicatesSkipped, 1);
    assert.equal(queryLeads(workspaceId, {}, db).total, before, "no duplicate lead was created");
  });

  it("leaves an ambiguous match unticked until a human says otherwise", async () => {
    const { createLead } = await import("../src/lib/queries/leads");
    createLead(
      workspaceId,
      { full_name: "rob byrne", email: "rob@clinic.io", company_name: "clinic", company_website: "clinic.io" },
      { database: db, actorId: memberId },
    );

    const outcome = await searchWith([
      person({
        providerRecordId: "p3",
        fullName: "rob byrne",
        email: "r.byrne@clinic.io",
        companyName: "clinic",
        companyDomain: "clinic.io",
        companyWebsite: "https://clinic.io",
      }),
    ]);
    const candidate = listCandidates(workspaceId, outcome.searchId, {}, db)[0];
    assert.equal(candidate.dupe_status, "likely");

    const before = queryLeads(workspaceId, {}, db).total;
    const skipped = importCandidates(workspaceId, [candidate.id], { actorId: memberId }, db);
    assert.equal(skipped.duplicatesSkipped, 1);
    assert.equal(queryLeads(workspaceId, {}, db).total, before, "an unsure match is not imported by default");

    // the override is a decision made in the same pass a person ticks the box
    const again = await searchWith([
      person({
        providerRecordId: "p3b",
        fullName: "rob byrne",
        email: "r.byrne@clinic.io",
        companyName: "clinic",
        companyDomain: "clinic.io",
        companyWebsite: "https://clinic.io",
      }),
    ]);
    const retry = listCandidates(workspaceId, again.searchId, {}, db)[0];
    assert.equal(retry.dupe_status, "likely");

    const forced = importCandidates(workspaceId, [retry.id], { actorId: memberId, includeLikelyDuplicates: true }, db);
    assert.equal(forced.duplicatesSkipped, 0);
    assert.ok(forced.imported + forced.merged >= 1, "a human can override and bring them in");
  });
});

describe("enrichment", () => {
  it("only resolves addresses for the people who were picked", async () => {
    stub.calls.length = 0;
    stub.revealed.clear();

    const outcome = await searchWith([
      person({ providerRecordId: "p10", fullName: "cleo fay", companyDomain: "fayco.io", companyWebsite: "https://fayco.io" }),
      person({ providerRecordId: "p11", fullName: "dan oak", companyDomain: "oaklabs.io", companyWebsite: "https://oaklabs.io" }),
      person({ providerRecordId: "p12", fullName: "eve nim", companyDomain: "nim.io", companyWebsite: "https://nim.io" }),
    ]);
    const candidates = listCandidates(workspaceId, outcome.searchId, {}, db);
    assert.equal(candidates.length, 3);

    stub.revealed.set("p10", { email: "cleo@fayco.io", status: "verified" });

    const picked = candidates.filter((c) => c.provider_record_id === "p10").map((c) => c.id);
    const enriched = await enrichCandidates(workspaceId, picked, memberId, db);

    assert.equal(enriched.enriched, 1, "only the picked person was looked up");
    assert.deepEqual(
      stub.calls.filter((c) => c.startsWith("reveal:")),
      ["reveal:p10"],
      "the provider was not asked about anyone else",
    );

    const updated = listCandidates(workspaceId, outcome.searchId, {}, db);
    const cleo = updated.find((c) => c.provider_record_id === "p10")!;
    assert.equal(cleo.email, "cleo@fayco.io");
    assert.equal(cleo.email_status, "verified");
    assert.equal(updated.find((c) => c.provider_record_id === "p11")!.email, null, "the others are untouched");
  });

  it("records a failure rather than pretending it worked", async () => {
    stub.calls.length = 0;
    const outcome = await searchWith([
      person({ providerRecordId: "p20", fullName: "gus lee", companyDomain: "lee.io", companyWebsite: "https://lee.io" }),
    ]);
    const candidate = listCandidates(workspaceId, outcome.searchId, {}, db)[0];

    // no entry in revealed, so the provider reports no address
    await enrichCandidates(workspaceId, [candidate.id], memberId, db);
    const after = listCandidates(workspaceId, outcome.searchId, {}, db)[0];
    assert.equal(after.email, null, "nothing was invented for a person we could not resolve");
    assert.match(after.enrich_error ?? "", /no address/i);
  });
});

describe("import", () => {
  it("turns reviewed prospects into real leads with attribution and history", async () => {
    const { createSource } = await import("../src/lib/queries/sources");
    const sourceId = createSource(workspaceId, { name: "apollo search", kind: "paid" }, db);

    stub.revealed.set("p30", { email: "zoe.reed@harborlight.io", status: "verified" });
    const outcome = await searchWith([
      person({
        providerRecordId: "p30",
        fullName: "zoe reed",
        jobTitle: "vp marketing",
        companyName: "harbor light",
        companyDomain: "harborlight.io",
        companyWebsite: "https://harborlight.io",
        companySize: "51–200",
        industry: "computer software",
        location: "london, united kingdom",
        linkedinUrl: "https://linkedin.com/in/zoereed",
        email: "zoe.reed@harborlight.io",
        emailStatus: "verified",
      }),
    ]);
    const candidate = listCandidates(workspaceId, outcome.searchId, {}, db)[0];

    const beforeStats = overview(workspaceId, "all", undefined, undefined, db);
    const result = importCandidates(workspaceId, [candidate.id], { sourceId, actorId: memberId }, db);

    assert.equal(result.imported, 1);
    assert.equal(result.duplicatesSkipped, 0);
    const leadId = result.leadIds[0];
    assert.ok(leadId);

    const lead = getLead(db, workspaceId, leadId)!;
    assert.equal(lead.full_name, "zoe reed");
    assert.equal(lead.email, "zoe.reed@harborlight.io");
    assert.equal(lead.job_title, "vp marketing");
    assert.equal(lead.company_name, "harbor light");
    assert.equal(lead.source_id, sourceId, "the source they chose is on the record");
    assert.equal(lead.pipeline_stage, "new");
    assert.equal(lead.outreach_state, "never_contacted");
    assert.equal(lead.is_new, 1, "they arrive in the inbox");

    const attributed = db.prepare(`SELECT COUNT(*) AS n FROM lead_attributions WHERE lead_id = ? AND source_id = ?`).get(leadId, sourceId) as { n: number };
    assert.equal(attributed.n, 1, "source attribution is recorded");

    const events = db.prepare(`SELECT type FROM activity_events WHERE lead_id = ?`).all(leadId) as Array<{ type: string }>;
    assert.ok(events.some((e) => e.type === "lead_created"), "they appear on the activity timeline");

    const afterStats = overview(workspaceId, "all", undefined, undefined, db);
    assert.equal(afterStats.totalLeads, beforeStats.totalLeads + 1, "the dashboard count moved");
    assert.equal(afterStats.newUnprocessed, beforeStats.newUnprocessed + 1, "the inbox count moved");

    const marked = listCandidates(workspaceId, outcome.searchId, {}, db)[0];
    assert.equal(marked.import_state, "imported");
    assert.equal(marked.imported_lead_id, leadId);
  });

  it("imports someone with no address rather than guessing one", async () => {
    const outcome = await searchWith([
      person({
        providerRecordId: "p40",
        fullName: "hal wright",
        jobTitle: "founder",
        companyName: "wright studio",
        companyDomain: "wright.studio",
        companyWebsite: "https://wright.studio",
        linkedinUrl: "https://linkedin.com/in/halwright",
        emailStatus: "none",
      }),
    ]);
    const candidate = listCandidates(workspaceId, outcome.searchId, {}, db)[0];
    assert.equal(candidate.email, null);

    const result = importCandidates(workspaceId, [candidate.id], { actorId: memberId }, db);
    assert.equal(result.imported, 1);
    assert.equal(result.noEmailWarning, 1, "the caller is told some had no address");

    const lead = getLead(db, workspaceId, result.leadIds[0])!;
    assert.equal(lead.email, null, "no address was invented");
    assert.equal(lead.linkedin_url, "https://linkedin.com/in/halwright", "what we do know is kept");
  });

  it("will not import the same candidate twice", async () => {
    const outcome = await searchWith([
      person({
        providerRecordId: "p50",
        fullName: "ivy ash",
        companyDomain: "ashco.io",
        companyWebsite: "https://ashco.io",
        email: "ivy@ashco.io",
        emailStatus: "verified",
      }),
    ]);
    const candidate = listCandidates(workspaceId, outcome.searchId, {}, db)[0];

    const first = importCandidates(workspaceId, [candidate.id], { actorId: memberId }, db);
    assert.equal(first.imported, 1);

    const second = importCandidates(workspaceId, [candidate.id], { actorId: memberId }, db);
    assert.equal(second.imported, 0, "the row is no longer pending");
  });
});

describe("provider failures", () => {
  it("does not fabricate results when the provider is unreachable", async () => {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM prospect_searches`).get() as { n: number };

    stub.failure = new ProviderError({ code: "network", message: "could not reach apollo.", retryable: true });
    try {
      await assert.rejects(searchWith([person({ providerRecordId: "p99", fullName: "ghost person" })]), (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.code, "network");
        return true;
      });

      const after = db.prepare(`SELECT COUNT(*) AS n FROM prospect_searches`).get() as { n: number };
      assert.equal(after.n, before.n, "a failed search is not stored as a search");
      const ghosts = db.prepare(`SELECT COUNT(*) AS n FROM prospect_candidates WHERE full_name = 'ghost person'`).get() as { n: number };
      assert.equal(ghosts.n, 0, "nothing from a failed search was staged");
    } finally {
      stub.failure = null;
    }
  });

  it("surfaces a bad key without pretending it worked", () => {
    const row = db.prepare(`SELECT id FROM provider_credentials WHERE workspace_id = ? AND provider = 'apollo'`).get(workspaceId) as { id: string };
    db.prepare(`UPDATE provider_credentials SET secret_ciphertext = 'tampered' WHERE id = ?`).run(row.id);

    const resolved = resolveCredential(workspaceId, "apollo");
    assert.equal(resolved?.status.configured, false, "a key that cannot be decrypted is not usable");
    assert.match(resolved?.status.lastError ?? "", /different encryption key/i);

    // put it back so later assertions still work
    saveCredential(workspaceId, "apollo", "super-secret-key-1234", { plan: "free" });
  });
});
