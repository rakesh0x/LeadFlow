/**
 * discovery.
 *
 * a search is a two-step affair and the order matters:
 *   1. ask the provider who matches the icp. nothing is written to the lead table yet.
 *   2. run every result through the existing duplicate engine so a person can be
 *      reviewed before they are added, and told honestly if we already know them.
 *
 * only the import step turns a candidate into a lead, and that goes through the same
 * createLead path as every other entry point, so states, events and analytics all move.
 */
import type { Database } from "better-sqlite3";
import { db } from "../db/client";
import { newProspectCandidateId, newProspectSearchId } from "../db/ids";
import { nowIso } from "../db/time";
import { recordEvent, writeLog } from "../engine/events";
import { findMatches, AUTO_MERGE_CONFIDENCE } from "../engine/dedupe";
import { createLead } from "../queries/leads";
import { getProvider, requireCredential, noteCredentialResult } from "./index";
import { ProviderError, type Icp, type ProspectCompany, type ProspectPerson, type SearchKind } from "./types";

export interface SearchArgs {
  workspaceId: string;
  providerId: string;
  kind: SearchKind;
  icp: Icp;
  page?: number;
  perPage?: number;
  actorId?: string | null;
}

export interface SearchOutcome {
  searchId: string;
  provider: string;
  kind: SearchKind;
  inserted: number;
  total: number;
  page: number;
  hasMore: boolean;
  cursor: string | null;
  creditsUsed: number;
  /** how many of this page we already had a record for. */
  alreadyKnown: number;
  label: string;
}

function labelFor(icp: Icp): string {
  const bits = [
    icp.titles.length ? icp.titles.slice(0, 2).join(" or ") : null,
    icp.seniority.length ? `(${icp.seniority.join(", ")})` : null,
    icp.employeeRanges.length ? `at ${icp.employeeRanges.join(", ")} headcount` : null,
    icp.industries.length ? `in ${icp.industries.slice(0, 2).join(", ")}` : null,
    icp.companyLocations.length || icp.personLocations.length
      ? `in ${(icp.companyLocations[0] ?? icp.personLocations[0] ?? "").toLowerCase()}`
      : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" ") : "everyone";
}

/** asks the provider and stages the results. returns counts, never raw records. */
export async function runSearch(args: SearchArgs, database: Database = db()): Promise<SearchOutcome> {
  const provider = getProvider(args.providerId);
  const credential = requireCredential(args.workspaceId, provider.id);
  const page = Math.max(1, args.page ?? 1);
  const perPage = Math.min(100, Math.max(1, args.perPage ?? 25));

  if (args.kind === "companies" && !provider.searchCompanies) {
    throw new ProviderError({
      code: "unprocessable",
      message: `${provider.info.label} cannot search for companies. pick a provider that can, or search for people instead.`,
    });
  }

  let result: { items: Array<ProspectPerson | ProspectCompany>; total: number; page: number; hasMore: boolean; cursor: string | null; creditsUsed: number };

  try {
    result =
      args.kind === "companies"
        ? await provider.searchCompanies!({ secret: credential.secret, icp: args.icp, page, perPage })
        : await provider.searchPeople({ secret: credential.secret, icp: args.icp, page, perPage, cursor: null });
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : null;
    noteCredentialResult(args.workspaceId, provider.id, {
      ok: false,
      error: providerError?.message ?? "search failed",
    });
    // a failed search is written down so it shows in the workspace history
    recordEvent(database, {
      workspaceId: args.workspaceId,
      actorId: args.actorId,
      type: "lead_updated",
      title: "prospect search failed",
      summary: `${provider.info.label}: ${providerError?.message ?? "unknown error"}`,
      payload: { provider: provider.id, kind: args.kind, error: providerError?.toJSON() ?? null },
    });
    throw error;
  }

  noteCredentialResult(args.workspaceId, provider.id, { ok: true });

  const searchId = newProspectSearchId();
  const now = nowIso();
  const items = result.items;

  database
    .prepare(
      `INSERT INTO prospect_searches
        (id, workspace_id, provider, actor_id, kind, icp_json, query_label, status, page, per_page, cursor,
         total, returned, has_more, credits_used, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?, 'completed', ?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      searchId,
      args.workspaceId,
      provider.id,
      args.actorId ?? null,
      args.kind,
      JSON.stringify(args.icp),
      labelFor(args.icp),
      page,
      perPage,
      result.cursor,
      result.total,
      items.length,
      result.hasMore ? 1 : 0,
      result.creditsUsed,
      now,
      now,
    );

  let inserted = 0;
  let alreadyKnown = 0;

  const run = database.transaction(() => {
    for (const item of items) {
      const staged = stageCandidate(args.workspaceId, searchId, provider.id, item, database);
      if (staged) inserted++;
      if (staged && (staged as { dupe_status: string }).dupe_status !== "new") alreadyKnown++;
    }
  });
  run();

  writeLog(database, {
    workspaceId: args.workspaceId,
    kind: "prospecting",
    message: `${provider.info.label} returned ${items.length} ${args.kind}`,
    detail: { searchId, provider: provider.id, total: result.total, credits: result.creditsUsed },
  });

  return {
    searchId,
    provider: provider.id,
    kind: args.kind,
    inserted,
    total: result.total,
    page,
    hasMore: result.hasMore,
    cursor: result.cursor,
    creditsUsed: result.creditsUsed,
    alreadyKnown,
    label: labelFor(args.icp),
  };
}

interface CandidateRow {
  id: string;
  dupe_status: string;
  dupe_lead_id: string | null;
}

/**
 * stores one provider result and asks the duplicate engine what it thinks of it.
 * nothing here touches the leads table.
 */
function stageCandidate(
  workspaceId: string,
  searchId: string,
  providerId: string,
  item: ProspectPerson | ProspectCompany,
  database: Database,
): CandidateRow | null {
  const now = nowIso();
  const id = newProspectCandidateId();
  const providerRecordId = String(item.providerRecordId ?? "").slice(0, 120);
  if (!providerRecordId) return null;

  const person: ProspectPerson | null = "fullName" in item ? item : null;
  const dupe = person ? assessPerson(database, workspaceId, person) : { status: "new" as const, leadId: null, confidence: null, reason: null };

  database
    .prepare(
      `INSERT INTO prospect_candidates
        (id, workspace_id, search_id, provider, provider_record_id, full_name, job_title, company_name,
         company_domain, company_size, industry, location, email, email_status, phone, linkedin_url, x_url,
         seniority, raw_json, dupe_status, dupe_lead_id, dupe_confidence, dupe_reason, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (search_id, provider_record_id) DO UPDATE SET
         email = COALESCE(excluded.email, prospect_candidates.email),
         email_status = COALESCE(excluded.email_status, prospect_candidates.email_status),
         phone = COALESCE(excluded.phone, prospect_candidates.phone),
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      workspaceId,
      searchId,
      providerId,
      providerRecordId,
      person ? person.fullName : (item as ProspectCompany).name,
      person?.jobTitle ?? null,
      person ? person.companyName : (item as ProspectCompany).name,
      person?.companyDomain ?? (item as ProspectCompany).domain ?? null,
      person?.companySize ?? (item as ProspectCompany).sizeLabel ?? null,
      item.industry,
      person?.location ?? null,
      person?.email ?? null,
      person?.emailStatus ?? null,
      person?.phone ?? null,
      item.linkedinUrl,
      person?.xUrl ?? null,
      person?.seniority ?? null,
      JSON.stringify(item),
      dupe.status,
      dupe.leadId,
      dupe.confidence,
      dupe.reason,
      now,
      now,
    );

  const row = database.prepare(`SELECT id, dupe_status, dupe_lead_id FROM prospect_candidates WHERE search_id = ? AND provider_record_id = ?`).get(searchId, providerRecordId) as
    | CandidateRow
    | undefined;
  return row ?? null;
}

/** reuse the engine that already decides whether two records are the same person. */
export function assessPerson(
  database: Database,
  workspaceId: string,
  person: ProspectPerson,
): { status: "new" | "likely" | "exact"; leadId: string | null; confidence: number | null; reason: string | null } {
  const matches = findMatches(database, workspaceId, {
    full_name: person.fullName,
    email: person.email,
    phone: person.phone,
    linkedin_url: person.linkedinUrl,
    x_url: person.xUrl,
    website: person.companyWebsite,
  });

  const best = matches[0];
  if (!best) return { status: "new", leadId: null, confidence: null, reason: null };

  return {
    status: best.confidence >= AUTO_MERGE_CONFIDENCE ? "exact" : "likely",
    leadId: best.leadId,
    confidence: best.confidence,
    reason: best.reason,
  };
}

// ---------------------------------------------------------------- review set

export interface CandidateView {
  id: string;
  search_id: string;
  provider: string;
  provider_record_id: string;
  raw_json: string;
  full_name: string;
  job_title: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_size: string | null;
  industry: string | null;
  location: string | null;
  email: string | null;
  email_status: string | null;
  phone: string | null;
  linkedin_url: string | null;
  x_url: string | null;
  seniority: string | null;
  dupe_status: "unknown" | "new" | "likely" | "exact";
  dupe_lead_id: string | null;
  dupe_lead_name: string | null;
  dupe_confidence: number | null;
  dupe_reason: string | null;
  enrich_state: "none" | "done" | "failed" | "skipped";
  enrich_error: string | null;
  import_state: "pending" | "imported" | "skipped";
  imported_lead_id: string | null;
}

export function listCandidates(
  workspaceId: string,
  searchId: string,
  options: { onlyNew?: boolean; limit?: number } = {},
  database: Database = db(),
): CandidateView[] {
  const where = ["c.workspace_id = @ws", "c.search_id = @searchId"];
  const params: Record<string, unknown> = { ws: workspaceId, searchId };
  if (options.onlyNew) where.push(`c.dupe_status = 'new'`);
  params.limit = Math.min(500, options.limit ?? 200);

  return database
    .prepare(
      `SELECT c.*, l.full_name AS dupe_lead_name
       FROM prospect_candidates c
       LEFT JOIN leads l ON l.id = c.dupe_lead_id
       WHERE ${where.join(" AND ")}
       ORDER BY CASE c.dupe_status WHEN 'new' THEN 0 WHEN 'likely' THEN 1 ELSE 2 END, c.created_at
       LIMIT @limit`,
    )
    .all(params) as CandidateView[];
}

export interface SearchView {
  id: string;
  provider: string;
  kind: string;
  query_label: string | null;
  status: string;
  page: number;
  per_page: number;
  cursor: string | null;
  total: number;
  returned: number;
  has_more: number;
  credits_used: number;
  created_at: string;
  actor_name: string | null;
  new_count: number;
  imported_count: number;
}

export function listSearches(workspaceId: string, limit = 20, database: Database = db()): SearchView[] {
  return database
    .prepare(
      `SELECT s.*, m.name AS actor_name,
              (SELECT COUNT(*) FROM prospect_candidates c WHERE c.search_id = s.id AND c.dupe_status = 'new' AND c.import_state = 'pending') AS new_count,
              (SELECT COUNT(*) FROM prospect_candidates c WHERE c.search_id = s.id AND c.import_state = 'imported') AS imported_count
       FROM prospect_searches s
       LEFT JOIN members m ON m.id = s.actor_id
       WHERE s.workspace_id = ?
       ORDER BY s.created_at DESC LIMIT ?`,
    )
    .all(workspaceId, limit) as SearchView[];
}

export function getSearch(workspaceId: string, searchId: string, database: Database = db()): SearchView | null {
  return (
    (database
      .prepare(
        `SELECT s.*, m.name AS actor_name,
                (SELECT COUNT(*) FROM prospect_candidates c WHERE c.search_id = s.id AND c.dupe_status = 'new' AND c.import_state = 'pending') AS new_count,
                (SELECT COUNT(*) FROM prospect_candidates c WHERE c.search_id = s.id AND c.import_state = 'imported') AS imported_count
         FROM prospect_searches s LEFT JOIN members m ON m.id = s.actor_id
         WHERE s.workspace_id = ? AND s.id = ?`,
      )
      .get(workspaceId, searchId) as SearchView) ?? null
  );
}

// ---------------------------------------------------------------- enrichment

/**
 * resolves a real contact address for the people a human picked. this is the call that
 * costs credits, so it only ever runs on rows someone explicitly selected.
 */
export async function enrichCandidates(
  workspaceId: string,
  candidateIds: string[],
  actorId?: string | null,
  database: Database = db(),
): Promise<{ enriched: number; failed: number; found: number; creditsUsed: number; error?: string }> {
  if (!candidateIds.length) return { enriched: 0, failed: 0, found: 0, creditsUsed: 0 };

  const rows = database
    .prepare(`SELECT * FROM prospect_candidates WHERE workspace_id = ? AND id IN (${candidateIds.map(() => "?").join(",")})`)
    .all(workspaceId, ...candidateIds) as CandidateView[];

  // group by provider so one key is fetched once
  const byProvider = new Map<string, CandidateView[]>();
  for (const row of rows) {
    const list = byProvider.get(row.provider) ?? [];
    list.push(row);
    byProvider.set(row.provider, list);
  }

  let enriched = 0;
  let failed = 0;
  let found = 0;
  let creditsUsed = 0;
  let lastError: string | undefined;

  for (const [providerId, batch] of byProvider) {
    const provider = getProvider(providerId);
    if (!provider.revealEmail) {
      database
        .prepare(`UPDATE prospect_candidates SET enrich_state = 'skipped', enrich_error = ?, updated_at = ? WHERE id = ?`)
        .run("this provider has nothing to look up", nowIso(), batch[0].id);
      continue;
    }

    let credential: string;
    try {
      credential = requireCredential(workspaceId, providerId).secret;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      continue;
    }

    for (const row of batch) {
      const person: ProspectPerson = {
        providerRecordId: row.provider_record_id,
        fullName: row.full_name,
        jobTitle: row.job_title,
        seniority: row.seniority,
        companyName: row.company_name,
        companyDomain: row.company_domain,
        companyWebsite: row.company_domain ? `https://${row.company_domain}` : null,
        companySize: row.company_size,
        industry: row.industry,
        location: row.location,
        email: row.email,
        emailStatus: row.email_status,
        phone: row.phone,
        linkedinUrl: row.linkedin_url,
        xUrl: row.x_url,
      };

      try {
        const outcome = await provider.revealEmail({ secret: credential, person });
        if (outcome.email) {
          database
            .prepare(`UPDATE prospect_candidates SET email = ?, email_status = ?, enrich_state = 'done', enrich_error = NULL, updated_at = ? WHERE id = ?`)
            .run(outcome.email, outcome.status ?? "unverified", nowIso(), row.id);
          found++;
        } else {
          database
            .prepare(`UPDATE prospect_candidates SET enrich_state = 'done', enrich_error = ?, updated_at = ? WHERE id = ?`)
            .run(outcome.status ? `no address (${outcome.status})` : "no address", nowIso(), row.id);
        }
        enriched++;
      } catch (error) {
        failed++;
        lastError = error instanceof Error ? error.message : String(error);
        database
          .prepare(`UPDATE prospect_candidates SET enrich_state = 'failed', enrich_error = ?, updated_at = ? WHERE id = ?`)
          .run(lastError.slice(0, 300), nowIso(), row.id);
      }
    }
  }

  if (creditsUsed > 0) {
    writeLog(database, { workspaceId, kind: "prospecting", message: `resolved ${found} contact addresses`, detail: { enriched, found } });
  }

  return { enriched, failed, found, creditsUsed, error: lastError };
}

// ---------------------------------------------------------------- import

export interface ImportOutcome {
  imported: number;
  merged: number;
  skipped: number;
  duplicatesSkipped: number;
  noEmailWarning: number;
  leadIds: string[];
  errors: Array<{ candidateId: string; error: string }>;
}

/**
 * turns reviewed candidates into leads. every one of them goes through createLead, so the
 * duplicate engine, the activity log and the analytics all see it exactly as if someone
 * had typed the person in by hand.
 */
export function importCandidates(
  workspaceId: string,
  candidateIds: string[],
  options: { sourceId?: string | null; campaignId?: string | null; actorId?: string | null; includeLikelyDuplicates?: boolean } = {},
  database: Database = db(),
): ImportOutcome {
  const outcome: ImportOutcome = {
    imported: 0,
    merged: 0,
    skipped: 0,
    duplicatesSkipped: 0,
    noEmailWarning: 0,
    leadIds: [],
    errors: [],
  };
  if (!candidateIds.length) return outcome;

  const rows = database
    .prepare(`SELECT * FROM prospect_candidates WHERE workspace_id = ? AND import_state = 'pending' AND id IN (${candidateIds.map(() => "?").join(",")})`)
    .all(workspaceId, ...candidateIds) as CandidateView[];

  const run = database.transaction(() => {
    for (const row of rows) {
      // a certain duplicate never needs a human decision, the engine settles it
      if (row.dupe_status === "exact") {
        database
          .prepare(`UPDATE prospect_candidates SET import_state = 'skipped', enrich_error = ?, updated_at = ? WHERE id = ?`)
          .run(`already in the database as ${row.dupe_lead_name ?? "an existing lead"}`, nowIso(), row.id);
        outcome.duplicatesSkipped++;
        continue;
      }
      if (row.dupe_status === "likely" && !options.includeLikelyDuplicates) {
        database
          .prepare(`UPDATE prospect_candidates SET import_state = 'skipped', enrich_error = ?, updated_at = ? WHERE id = ?`)
          .run(`looks like ${row.dupe_lead_name ?? "someone we have"} — import anyway if that is wrong`, nowIso(), row.id);
        outcome.duplicatesSkipped++;
        continue;
      }

      if (!row.email) outcome.noEmailWarning++;

      try {
        const result = createLead(
          workspaceId,
          {
            full_name: row.full_name,
            email: row.email,
            phone: row.phone,
            job_title: row.job_title,
            company_name: row.company_name,
            company_website: row.company_domain ? `https://${row.company_domain}` : null,
            linkedin_url: row.linkedin_url,
            x_url: row.x_url,
            location: row.location,
            industry: row.industry,
            company_size: row.company_size,
            source_id: options.sourceId ?? null,
            campaign_id: options.campaignId ?? null,
            owner_id: options.actorId ?? null,
          },
          {
            database,
            actorId: options.actorId ?? null,
            origin: `${row.provider} prospect search`,
          },
        );

        database
          .prepare(`UPDATE prospect_candidates SET import_state = 'imported', imported_lead_id = ?, imported_at = ?, updated_at = ? WHERE id = ?`)
          .run(result.leadId, nowIso(), nowIso(), row.id);

        if (result.mergedInto) {
          outcome.merged++;
        } else {
          outcome.imported++;
          outcome.leadIds.push(result.leadId);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outcome.errors.push({ candidateId: row.id, error: message });
        database
          .prepare(`UPDATE prospect_candidates SET enrich_error = ?, updated_at = ? WHERE id = ?`)
          .run(message.slice(0, 300), nowIso(), row.id);
      }
    }
  });
  run();

  if (outcome.imported || outcome.merged) {
    writeLog(database, {
      workspaceId,
      kind: "prospecting",
      message: `imported ${outcome.imported + outcome.merged} prospects from a search`,
      detail: { imported: outcome.imported, merged: outcome.merged, skippedDuplicates: outcome.duplicatesSkipped },
    });
  }

  return outcome;
}

export function skipCandidates(workspaceId: string, candidateIds: string[], database: Database = db()): number {
  if (!candidateIds.length) return 0;
  const result = database
    .prepare(`UPDATE prospect_candidates SET import_state = 'skipped', updated_at = ? WHERE workspace_id = ? AND import_state = 'pending' AND id IN (${candidateIds.map(() => "?").join(",")})`)
    .run(nowIso(), workspaceId, ...candidateIds);
  return result.changes;
}