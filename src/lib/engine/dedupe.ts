/**
 * duplicate detection.
 *
 * we only ever act on a match we are certain about. anything ambiguous goes to the
 * review queue so a human decides. merging is reversible because nothing is deleted.
 */
import type { Database } from "better-sqlite3";
import { newDupeId } from "../db/ids";
import { nowIso } from "../db/time";
import {
  companyDomainFromEmail,
  nameKey,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedin,
  normalizePhone,
  normalizeUrl,
  normalizeX,
} from "./normalize";
import { mergeLeads } from "./merge";
import { recordEvent, writeLog } from "./events";

/** at or above this we are sure it is the same person. */
export const AUTO_MERGE_CONFIDENCE = 0.9;
/** below this it is not worth a human's time. */
export const REVIEW_FLOOR = 0.45;

export interface LeadIdentity {
  id?: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  x_url?: string | null;
  website?: string | null;
  company_id?: string | null;
  company_domain?: string | null;
  job_title?: string | null;
}

export interface Match {
  leadId: string;
  fullName: string;
  email: string | null;
  confidence: number;
  kinds: string[];
  reason: string;
}

export interface Identifiers {
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  x: string | null;
  domain: string | null;
  nameKey: string;
}

export function identify(lead: LeadIdentity): Identifiers {
  return {
    email: normalizeEmail(lead.email),
    phone: normalizePhone(lead.phone),
    linkedin: normalizeLinkedin(lead.linkedin_url),
    x: normalizeX(lead.x_url),
    domain: companyDomainFromEmail(lead.email) ?? normalizeDomain(lead.website ?? lead.company_domain),
    nameKey: nameKey(lead.full_name),
  };
}

/** keeps lead_identifiers in step with the lead row. */
export function refreshIdentifiers(database: Database, workspaceId: string, leadId: string, lead: LeadIdentity): void {
  const ids = identify(lead);
  const pairs: Array<[string, string | null, string | null]> = [
    ["email", ids.email, lead.email ?? null],
    ["phone", ids.phone, lead.phone ?? null],
    ["linkedin", ids.linkedin, lead.linkedin_url ?? null],
    ["x", ids.x, lead.x_url ?? null],
    ["domain", ids.domain, lead.website ?? null],
    ["name_company", ids.domain && ids.nameKey ? `${ids.nameKey}@${ids.domain}` : null, lead.full_name ?? null],
  ];

  database.prepare(`DELETE FROM lead_identifiers WHERE lead_id = ?`).run(leadId);
  const insert = database.prepare(
    `INSERT OR IGNORE INTO lead_identifiers (id, workspace_id, lead_id, kind, value_raw, value_norm, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  );
  for (const [kind, norm, raw] of pairs) {
    if (!norm) continue;
    insert.run(`${leadId}_${kind}`, workspaceId, leadId, kind, raw, norm, nowIso());
  }
}

/** scores one stored lead against an incoming identity. */
function scorePair(
  target: LeadIdentity & { id: string; full_name: string; company_domain?: string | null },
  incoming: Identifiers,
): Pick<Match, "confidence" | "kinds" | "reason"> | null {
  const other = identify(target);
  const kinds: string[] = [];
  let best = 0;
  const reasons: string[] = [];

  if (incoming.email && other.email) {
    if (incoming.email === other.email) {
      kinds.push("email");
      reasons.push("same email address");
      best = Math.max(best, 0.97);
    } else {
      const a = incoming.email.split("@");
      const b = other.email.split("@");
      if (a[1] === b[1] && a[0] !== b[0]) {
        kinds.push("email_domain");
        reasons.push("same email domain, different inbox");
        best = Math.max(best, 0.3);
      }
    }
  }
  if (incoming.linkedin && other.linkedin && incoming.linkedin === other.linkedin) {
    kinds.push("linkedin");
    reasons.push("same linkedin profile");
    best = Math.max(best, 0.92);
  }
  if (incoming.phone && other.phone && incoming.phone === other.phone) {
    kinds.push("phone");
    reasons.push("same phone number");
    best = Math.max(best, 0.85);
  }
  if (incoming.x && other.x && incoming.x === other.x) {
    kinds.push("x");
    reasons.push("same x handle");
    best = Math.max(best, 0.7);
  }
  if (incoming.domain && other.domain && incoming.domain === other.domain && incoming.nameKey && other.nameKey) {
    if (incoming.nameKey === other.nameKey) {
      kinds.push("name_domain");
      reasons.push(`same name at ${incoming.domain}`);
      best = Math.max(best, 0.78);
    } else {
      kinds.push("domain");
      reasons.push(`same company (${incoming.domain})`);
      best = Math.max(best, 0.28);
    }
  }

  if (!best) return null;

  // a second agreeing signal nudges us up, but never past certainty
  if (kinds.length > 1) best = Math.min(0.99, best + 0.04 * (kinds.length - 1));
  return { confidence: Number(best.toFixed(3)), kinds, reason: reasons.join(" and ") };
}

/** every lead in the workspace that could be the same person. */
export function findMatches(database: Database, workspaceId: string, incoming: LeadIdentity, excludeIds: string[] = []): Match[] {
  const ids = identify(incoming);
  if (!ids.email && !ids.linkedin && !ids.phone && !ids.x && !ids.nameKey) return [];

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (ids.email) {
    clauses.push(`(l.email_normalized = ?)`);
    params.push(ids.email);
  }
  if (ids.linkedin) {
    clauses.push(`(l.linkedin_normalized = ?)`);
    params.push(ids.linkedin);
  }
  if (ids.phone) {
    clauses.push(`(l.phone_normalized = ?)`);
    params.push(ids.phone);
  }
  if (ids.x) {
    clauses.push(`(l.x_normalized = ?)`);
    params.push(ids.x);
  }
  if (ids.domain && ids.nameKey) {
    // same company and same first+last name, even if the email changed.
    // name_company keys are written by refreshIdentifiers, so the comparison
    // uses exactly the same normalisation as every other signal.
    clauses.push(`EXISTS (
                   SELECT 1 FROM lead_identifiers li
                   WHERE li.lead_id = l.id AND li.kind = 'name_company' AND li.value_norm = ?
                 )`);
    params.push(`${ids.nameKey}@${ids.domain}`);
  }
  if (!clauses.length) return [];

  const rows = database
    .prepare(
      `SELECT l.id, l.full_name, l.email, l.phone, l.linkedin_url, l.x_url, l.website, l.company_id,
              l.job_title, c.domain_normalized AS company_domain
       FROM leads l
       LEFT JOIN companies c ON c.id = l.company_id
       WHERE l.workspace_id = ? AND l.merged_into_lead_id IS NULL AND (${clauses.join(" OR ")})`,
    )
    .all(workspaceId, ...params) as Array<LeadIdentity & { id: string; full_name: string; company_domain?: string | null }>;

  const seen = new Set(excludeIds);
  const matches: Match[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    const scored = scorePair(row, ids);
    if (!scored || scored.confidence < REVIEW_FLOOR) continue;
    seen.add(row.id);
    matches.push({ ...scored, leadId: row.id, fullName: row.full_name, email: row.email ?? null });
  }
  return matches.sort((a, b) => b.confidence - a.confidence);
}

export interface ScanOutcome {
  matchedId: string | null;
  confidence: number;
  autoMerged: boolean;
  reviewIds: string[];
  matches: Match[];
}

/**
 * runs after a lead is written. certain matches are merged right away, the rest
 * are parked in the review queue.
 */
export function scanForDuplicates(
  database: Database,
  workspaceId: string,
  leadId: string,
  actorId?: string | null,
): ScanOutcome {
  const lead = database
    .prepare(
      `SELECT l.*, c.domain_normalized AS company_domain FROM leads l
       LEFT JOIN companies c ON c.id = l.company_id WHERE l.id = ?`,
    )
    .get(leadId) as LeadIdentity & { id: string; full_name: string; company_domain?: string | null } | undefined;

  if (!lead) return { matchedId: null, confidence: 0, autoMerged: false, reviewIds: [], matches: [] };

  // the row we are scanning is in the table too — it must never match itself
  const matches = findMatches(database, workspaceId, lead, [leadId]);
  if (!matches.length) return { matchedId: null, confidence: 0, autoMerged: false, reviewIds: [], matches: [] };

  const best = matches[0];
  const reviewIds: string[] = [];

  if (best.confidence >= AUTO_MERGE_CONFIDENCE) {
    // the incoming record is the newer, thinner one, so it folds into the existing record
    mergeLeads(database, workspaceId, best.leadId, leadId, actorId ?? null, `same ${best.kinds[0]}`);
    writeLog(database, {
      workspaceId,
      kind: "merge",
      message: `merged ${leadId} into ${best.leadId}`,
      detail: { confidence: best.confidence, kinds: best.kinds },
    });
    return {
      matchedId: best.leadId,
      confidence: best.confidence,
      autoMerged: true,
      reviewIds: [],
      matches,
    };
  }

  const insert = database.prepare(
    `INSERT INTO dupe_candidates (id, workspace_id, lead_id, candidate_lead_id, confidence, match_kinds, reason, status, created_at)
     VALUES (?,?,?,?,?,?,?,'pending',?)
     ON CONFLICT(lead_id, candidate_lead_id) DO UPDATE SET confidence = excluded.confidence, match_kinds = excluded.match_kinds`,
  );

  for (const m of matches.slice(0, 5)) {
    // one row per pair. resolveDupe finds the other direction on its own, so
    // storing both would just show the same pair twice in the review queue.
    insert.run(`${leadId}_${m.leadId}`, workspaceId, leadId, m.leadId, m.confidence, JSON.stringify(m.kinds), m.reason, nowIso());
    if (!reviewIds.includes(m.leadId)) reviewIds.push(m.leadId);
  }

  return { matchedId: best.leadId, confidence: best.confidence, autoMerged: false, reviewIds, matches };
}

export function resolveDupe(
  database: Database,
  workspaceId: string,
  candidateId: string,
  decision: "merge" | "dismiss" | "link",
  actorId?: string | null,
): { ok: boolean; primaryLeadId?: string } {
  const row = database
    .prepare(`SELECT * FROM dupe_candidates WHERE id = ? AND workspace_id = ?`)
    .get(candidateId, workspaceId) as
    | { id: string; lead_id: string; candidate_lead_id: string; status: string }
    | undefined;
  if (!row) return { ok: false };

  // both rows point at the same pair; resolve them together
  const twin = database
    .prepare(`SELECT id FROM dupe_candidates WHERE lead_id = ? AND candidate_lead_id = ?`)
    .get(row.candidate_lead_id, row.lead_id) as { id: string } | undefined;

  const finish = database.transaction(() => {
    const ids = twin ? [row.id, twin.id] : [row.id];
    const placeholders = ids.map(() => "?").join(",");
    database
      .prepare(
        `UPDATE dupe_candidates SET status = ?, resolved_by = ?, resolved_at = ?
         WHERE id IN (${placeholders})`,
      )
      .run(decision === "link" ? "linked" : decision === "merge" ? "merged" : "dismissed", actorId ?? null, nowIso(), ...ids);
  });
  finish();

  if (decision === "merge") {
    mergeLeads(database, workspaceId, row.lead_id, row.candidate_lead_id, actorId ?? null, "resolved from review");
    recordEvent(database, {
      workspaceId,
      leadId: row.lead_id,
      actorId,
      type: "lead_merged",
      title: "merged a duplicate",
      summary: `merged ${row.candidate_lead_id} into this lead`,
      payload: { mergedLeadId: row.candidate_lead_id },
    });
    return { ok: true, primaryLeadId: row.lead_id };
  }

  if (decision === "link") {
    database
      .prepare(
        `INSERT OR IGNORE INTO lead_links (id, workspace_id, lead_id, related_lead_id, kind, created_by, created_at)
         VALUES (?,?,?,?,'related',?,?)`,
      )
      .run(`${row.lead_id}__${row.candidate_lead_id}`, workspaceId, row.lead_id, row.candidate_lead_id, actorId ?? null, nowIso());
  }

  return { ok: true };
}