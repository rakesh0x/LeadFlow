/** everything you can do to a lead. */
import type { Database } from "better-sqlite3";
import { db } from "../db/client";
import { newCompanyId, newLeadId } from "../db/ids";
import { nowIso } from "../db/time";
import type { NurtureState, OutreachState, PipelineStage } from "../domain";
import type { ActivityEvent, Lead, LeadView, Meeting, Message, Opportunity, TaskView, NurtureEnrollment } from "../types";
import {
  companyDomainFromEmail,
  displayName,
  normalizeDomain,
  normalizeEmail,
  normalizeLinkedin,
  normalizePhone,
  normalizeX,
} from "../engine/normalize";
import { recordEvent, writeLog } from "../engine/events";
import { recomputeLeadStates } from "../engine/states";
import { refreshIdentifiers, scanForDuplicates } from "../engine/dedupe";
import { mergeLeads } from "../engine/merge";
import { linkAttribution } from "./sources";

export interface LeadInput {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  job_title?: string | null;
  company_name?: string | null;
  company_website?: string | null;
  linkedin_url?: string | null;
  x_url?: string | null;
  website?: string | null;
  location?: string | null;
  industry?: string | null;
  company_size?: string | null;
  notes?: string | null;
  owner_id?: string | null;
  source_id?: string | null;
  campaign_id?: string | null;
  score?: number | null;
}

/** finds or creates the company row behind a lead. */
function upsertCompany(
  database: Database,
  workspaceId: string,
  input: { company_name?: string | null; company_website?: string | null; email?: string | null },
  existingId?: string | null,
): string | null {
  const domain =
    normalizeDomain(input.company_website) ??
    normalizeDomain(input.company_name) ??
    companyDomainFromEmail(input.email);

  const name = input.company_name?.trim() || (domain ? domain.split(".")[0] : null);
  if (!name && !domain) return existingId ?? null;

  if (domain) {
    const found = database
      .prepare(`SELECT id FROM companies WHERE workspace_id = ? AND domain_normalized = ?`)
      .get(workspaceId, domain) as { id: string } | undefined;
    if (found) return found.id;
  }
  if (name) {
    const found = database
      .prepare(`SELECT id FROM companies WHERE workspace_id = ? AND lower(name) = lower(?)`)
      .get(workspaceId, name) as { id: string } | undefined;
    if (found) return found.id;
  }

  const id = newCompanyId();
  database
    .prepare(
      `INSERT INTO companies (id, workspace_id, name, domain, domain_normalized, website, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      workspaceId,
      name ?? domain!,
      domain,
      domain,
      input.company_website ?? (domain ? `https://${domain}` : null),
      nowIso(),
      nowIso(),
    );
  return id;
}

function splitName(fullName: string): { first: string | null; last: string | null } {
  const parts = fullName.trim().split(/\s+/);
  if (!parts.length) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export interface CreateLeadResult {
  /** the record that now represents this person. link everything else to this. */
  leadId: string;
  /** the row written before any merge. it is kept for the audit trail, not to be linked to. */
  createdId: string;
  /** set when the new record was folded into one we already had. */
  mergedInto?: string;
  confidence?: number;
  reviewCount: number;
}

/**
 * adds a lead. before it is stored we look for the same person arriving from somewhere
 * else, so a person is never counted twice.
 */
export function createLead(
  workspaceId: string,
  input: LeadInput,
  opts: { actorId?: string | null; database?: Database; origin?: string; skipDedupe?: boolean } = {},
): CreateLeadResult {
  const database = opts.database ?? db();

  const run = database.transaction((): CreateLeadResult => {
    const id = newLeadId();
    const now = nowIso();
    const fullName = (input.full_name ?? "").trim() || displayName(null, input.email) || "unknown";
    const { first, last } = splitName(fullName);
    const email = input.email?.trim() || null;
    const emailNorm = normalizeEmail(email);
    const phoneNorm = normalizePhone(input.phone);
    const linkedinNorm = normalizeLinkedin(input.linkedin_url);
    const xNorm = normalizeX(input.x_url);
    const companyId = upsertCompany(database, workspaceId, {
      company_name: input.company_name,
      company_website: input.company_website,
      email,
    });

    database
      .prepare(
        `INSERT INTO leads (
          id, workspace_id, company_id, full_name, first_name, last_name, email, email_normalized,
          phone, phone_normalized, job_title, linkedin_url, linkedin_normalized, x_url, x_normalized,
          website, location, industry, company_size, notes, score, pipeline_stage, outreach_state,
          nurture_state, owner_id, source_id, created_at, updated_at, is_new, last_activity_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?, 'new', 'never_contacted', 'not_enrolled', ?,?,?,?, 1, ?)`,
      )
      .run(
        id,
        workspaceId,
        companyId,
        fullName,
        first,
        last,
        email,
        emailNorm,
        input.phone ?? null,
        phoneNorm,
        input.job_title ?? null,
        input.linkedin_url ?? null,
        linkedinNorm,
        input.x_url ?? null,
        xNorm,
        input.website ?? null,
        input.location ?? null,
        input.industry ?? null,
        input.company_size ?? null,
        input.notes ?? null,
        input.score ?? 0,
        input.owner_id ?? opts.actorId ?? null,
        input.source_id ?? null,
        now,
        now,
        now,
      );

    if (input.source_id || input.campaign_id) {
      linkAttribution(database, workspaceId, id, input.source_id ?? null, input.campaign_id ?? null);
    }

    refreshIdentifiers(database, workspaceId, id, {
      full_name: fullName,
      email,
      phone: input.phone ?? null,
      linkedin_url: input.linkedin_url ?? null,
      x_url: input.x_url ?? null,
      website: input.company_website ?? input.website ?? null,
    });

    recordEvent(database, {
      workspaceId,
      leadId: id,
      actorId: opts.actorId ?? null,
      campaignId: input.campaign_id ?? null,
      type: "lead_created",
      title: "lead added",
      summary: `${fullName} arrived from ${opts.origin ?? "the workspace"}`,
      payload: { source_id: input.source_id ?? null, email },
      occurredAt: now,
    });

    let mergedInto: string | undefined;
    let confidence: number | undefined;
    let reviewCount = 0;

    if (!opts.skipDedupe) {
      const scan = scanForDuplicates(database, workspaceId, id, opts.actorId ?? null);
      if (scan.autoMerged && scan.matchedId) {
        mergedInto = scan.matchedId;
        confidence = scan.confidence;
        recomputeLeadStates(database, scan.matchedId);
      } else {
        reviewCount = scan.reviewIds.length;
      }
    }

    return { leadId: mergedInto ?? id, createdId: id, mergedInto, confidence, reviewCount };
  });

  return run();
}

export function touchLead(database: Database, leadId: string, actorId?: string | null): void {
  const now = nowIso();
  database
    .prepare(
      `UPDATE leads SET is_new = CASE WHEN first_touched_at IS NULL THEN 0 ELSE is_new END,
                        first_touched_at = COALESCE(first_touched_at, ?),
                        last_activity_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(now, now, now, leadId);
  void actorId;
}

export function bumpActivity(database: Database, leadId: string): void {
  const now = nowIso();
  database
    .prepare(
      `UPDATE leads SET last_activity_at = ?,
         outbound_count = (SELECT COUNT(*) FROM messages WHERE lead_id = ? AND direction = 'outbound'),
         reply_count    = (SELECT COUNT(*) FROM messages WHERE lead_id = ? AND direction = 'inbound'),
         last_message_at = (SELECT MAX(sent_at) FROM messages WHERE lead_id = ?),
         updated_at = ?
       WHERE id = ?`,
    )
    .run(now, leadId, leadId, leadId, now, leadId);
}

export function updateLead(
  database: Database,
  workspaceId: string,
  leadId: string,
  patch: Partial<LeadInput>,
  actorId?: string | null,
): boolean {
  const columns: Record<string, unknown> = {
    full_name: patch.full_name,
    email: patch.email,
    phone: patch.phone,
    job_title: patch.job_title,
    linkedin_url: patch.linkedin_url,
    x_url: patch.x_url,
    website: patch.website,
    location: patch.location,
    industry: patch.industry,
    company_size: patch.company_size,
    notes: patch.notes,
    owner_id: patch.owner_id,
    score: patch.score,
  };

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (patch.full_name !== undefined) {
    const { first, last } = splitName(patch.full_name ?? "");
    sets.push("first_name = ?", "last_name = ?");
    params.push(first, last);
  }
  if (patch.email !== undefined) {
    sets.push("email_normalized = ?");
    params.push(normalizeEmail(patch.email));
  }
  if (patch.phone !== undefined) {
    sets.push("phone_normalized = ?");
    params.push(normalizePhone(patch.phone));
  }
  if (patch.linkedin_url !== undefined) {
    sets.push("linkedin_normalized = ?");
    params.push(normalizeLinkedin(patch.linkedin_url));
  }
  if (patch.x_url !== undefined) {
    sets.push("x_normalized = ?");
    params.push(normalizeX(patch.x_url));
  }
  if (patch.company_name !== undefined || patch.company_website !== undefined) {
    const companyId = upsertCompany(database, workspaceId, {
      company_name: patch.company_name,
      company_website: patch.company_website,
      email: patch.email,
    });
    if (companyId) {
      sets.push("company_id = ?");
      params.push(companyId);
    }
  }

  if (!sets.length) return false;

  sets.push("first_touched_at = COALESCE(first_touched_at, ?)", "is_new = 0", "updated_at = ?");
  params.push(nowIso(), nowIso(), leadId, workspaceId);

  const result = database
    .prepare(`UPDATE leads SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ?`)
    .run(...params);

  const lead = database.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId) as Lead | undefined;
  if (lead) {
    refreshIdentifiers(database, workspaceId, leadId, {
      full_name: lead.full_name,
      email: lead.email,
      phone: lead.phone,
      linkedin_url: lead.linkedin_url,
      x_url: lead.x_url,
      website: lead.website,
    });
  }

  recordEvent(database, {
    workspaceId,
    leadId,
    actorId,
    type: "lead_updated",
    title: "lead updated",
    summary: `updated ${Object.keys(columns).filter((k) => patch[k as keyof LeadInput] !== undefined).join(", ")}`,
    payload: { fields: Object.keys(columns).filter((k) => patch[k as keyof LeadInput] !== undefined) },
  });

  touchLead(database, leadId, actorId);
  recomputeLeadStates(database, leadId);
  return result.changes > 0;
}

export function setStage(
  database: Database,
  workspaceId: string,
  leadId: string,
  stage: PipelineStage,
  actorId?: string | null,
  automatic = false,
): boolean {
  const before = database.prepare(`SELECT pipeline_stage FROM leads WHERE id = ?`).get(leadId) as { pipeline_stage: PipelineStage } | undefined;
  if (!before || before.pipeline_stage === stage) return false;

  database
    .prepare(`UPDATE leads SET pipeline_stage = ?, pipeline_stage_set_by = ?, updated_at = ? WHERE id = ?`)
    .run(stage, automatic ? "auto" : "manual", nowIso(), leadId);

  recordEvent(database, {
    workspaceId,
    leadId,
    actorId,
    type: stage === "converted" ? "converted" : "stage_changed",
    title: stage === "converted" ? "converted" : "stage changed",
    summary: `${before.pipeline_stage} → ${stage.replaceAll("_", " ")}`,
    payload: { from: before.pipeline_stage, to: stage },
  });

  if (stage === "converted" || stage === "lost" || stage === "disqualified") {
    // a closed lead needs its date recorded, and a win needs its own date
    // so the conversion rate can be measured over a period.
    database
      .prepare(
        `UPDATE leads
         SET closed_at = ?,
             converted_at = CASE WHEN ? = 'converted' THEN COALESCE(converted_at, ?) ELSE NULL END,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(nowIso(), stage, nowIso(), nowIso(), leadId);
  } else {
    database.prepare(`UPDATE leads SET closed_at = NULL, converted_at = NULL, updated_at = ? WHERE id = ?`).run(nowIso(), leadId);
  }

  touchLead(database, leadId, actorId);
  if (automatic) recomputeLeadStates(database, leadId);
  return true;
}

export function setOutreachState(
  database: Database,
  workspaceId: string,
  leadId: string,
  state: OutreachState,
  actorId?: string | null,
): boolean {
  const before = database.prepare(`SELECT outreach_state FROM leads WHERE id = ?`).get(leadId) as { outreach_state: OutreachState } | undefined;
  if (!before || before.outreach_state === state) return false;

  database.prepare(`UPDATE leads SET outreach_state = ?, outreach_state_set_by = 'manual', updated_at = ? WHERE id = ?`).run(state, nowIso(), leadId);
  recordEvent(database, {
    workspaceId,
    leadId,
    actorId,
    type: "outreach_state_changed",
    title: "outreach updated by hand",
    summary: `${before.outreach_state.replaceAll("_", " ")} → ${state.replaceAll("_", " ")}`,
    payload: { from: before.outreach_state, to: state },
  });
  return true;
}

export function setNurtureState(
  database: Database,
  workspaceId: string,
  leadId: string,
  state: NurtureState,
  actorId?: string | null,
): boolean {
  const before = database.prepare(`SELECT nurture_state FROM leads WHERE id = ?`).get(leadId) as { nurture_state: NurtureState } | undefined;
  if (!before || before.nurture_state === state) return false;

  database.prepare(`UPDATE leads SET nurture_state = ?, nurture_state_set_by = 'manual', updated_at = ? WHERE id = ?`).run(state, nowIso(), leadId);
  recordEvent(database, {
    workspaceId,
    leadId,
    actorId,
    type: "nurture_state_changed",
    title: "nurture updated by hand",
    summary: `${before.nurture_state.replaceAll("_", " ")} → ${state.replaceAll("_", " ")}`,
    payload: { from: before.nurture_state, to: state },
  });
  return true;
}

export function addNote(database: Database, workspaceId: string, leadId: string, body: string, actorId?: string | null): void {
  database
    .prepare(`UPDATE leads SET notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || char(10) || ? END, updated_at = ? WHERE id = ?`)
    .run(body, body, nowIso(), leadId);
  recordEvent(database, { workspaceId, leadId, actorId, type: "note_added", title: "note added", summary: body.slice(0, 140) });
  touchLead(database, leadId, actorId);
  recomputeLeadStates(database, leadId);
}

export function assignLead(database: Database, workspaceId: string, leadId: string, ownerId: string | null, actorId?: string | null): void {
  database.prepare(`UPDATE leads SET owner_id = ?, updated_at = ? WHERE id = ?`).run(ownerId, nowIso(), leadId);
  recordEvent(database, {
    workspaceId,
    leadId,
    actorId,
    type: "assigned",
    title: "owner changed",
    payload: { owner_id: ownerId },
  });
  touchLead(database, leadId, actorId);
  recomputeLeadStates(database, leadId);
}

export function archiveLead(database: Database, workspaceId: string, leadId: string, archived: boolean, actorId?: string | null): void {
  database.prepare(`UPDATE leads SET is_archived = ?, updated_at = ? WHERE id = ?`).run(archived ? 1 : 0, nowIso(), leadId);
  recordEvent(database, {
    workspaceId,
    leadId,
    actorId,
    type: "lead_updated",
    title: archived ? "lead archived" : "lead restored",
  });
}

export function mergeLead(
  database: Database,
  workspaceId: string,
  primaryId: string,
  secondaryId: string,
  actorId?: string | null,
  reason = "merged by hand",
) {
  const result = mergeLeads(database, workspaceId, primaryId, secondaryId, actorId, reason);
  if (result.ok) {
    recordEvent(database, {
      workspaceId,
      leadId: primaryId,
      actorId,
      type: "lead_merged",
      title: "duplicate merged",
      summary: `folded ${secondaryId} into this lead`,
      payload: { merged: secondaryId, moved: result.moved },
    });
    writeLog(database, { workspaceId, kind: "merge", message: `${secondaryId} -> ${primaryId}`, detail: result.moved });
    recomputeLeadStates(database, primaryId);
  }
  return result;
}

export function linkLeads(
  database: Database,
  workspaceId: string,
  leadId: string,
  relatedId: string,
  kind: string,
  actorId?: string | null,
): void {
  database
    .prepare(
      `INSERT OR REPLACE INTO lead_links (id, workspace_id, lead_id, related_lead_id, kind, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(`${leadId}_${relatedId}`, workspaceId, leadId, relatedId, kind, actorId ?? null, nowIso());
}

const LEAD_SELECT = `
  SELECT l.*,
         c.name AS company_name, c.domain_normalized AS company_domain,
         m.name AS owner_name, m.avatar_hue AS owner_hue,
         s.name AS source_name, s.kind AS source_kind,
         (SELECT COUNT(*) FROM tasks t WHERE t.lead_id = l.id AND t.status IN ('open','in_progress')) AS open_tasks,
         (SELECT COUNT(*) FROM tasks t WHERE t.lead_id = l.id AND t.status IN ('open','in_progress') AND t.due_at IS NOT NULL AND t.due_at <= :now) AS overdue_tasks,
         (SELECT substr(m2.content,1,120) FROM messages m2 WHERE m2.lead_id = l.id AND m2.content IS NOT NULL ORDER BY m2.sent_at DESC LIMIT 1) AS last_message_preview
  FROM leads l
  LEFT JOIN companies c ON c.id = l.company_id
  LEFT JOIN members m ON m.id = l.owner_id
  LEFT JOIN lead_sources s ON s.id = l.source_id
`;

export type LeadSort = "newest" | "oldest" | "activity" | "name" | "score" | "stage";

export interface LeadQuery {
  q?: string;
  stage?: PipelineStage | PipelineStage[] | "all" | "open" | "closed";
  outreach?: OutreachState | OutreachState[] | "all";
  nurture?: NurtureState | NurtureState[] | "all";
  sourceId?: string;
  campaignId?: string;
  ownerId?: string;
  companyId?: string;
  isNew?: boolean;
  noReply?: boolean;
  notNurtured?: boolean;
  includeArchived?: boolean;
  createdAfter?: string;
  createdBefore?: string;
  sort?: LeadSort;
  limit?: number;
  offset?: number;
}

export function queryLeads(workspaceId: string, query: LeadQuery = {}, database = db()): { rows: LeadView[]; total: number } {
  const where: string[] = ["l.workspace_id = @workspaceId", "l.merged_into_lead_id IS NULL"];
  const params: Record<string, unknown> = { workspaceId, now: nowIso() };

  if (!query.includeArchived) where.push("l.is_archived = 0");

  if (query.q) {
    where.push(`(
      l.full_name LIKE @q OR l.email LIKE @q OR l.company_id IN (
        SELECT id FROM companies WHERE name LIKE @q OR domain_normalized LIKE @q
      ) OR l.phone LIKE @q OR l.job_title LIKE @q OR l.id = @q
      OR l.linkedin_normalized LIKE @q OR l.x_normalized LIKE @q
    )`);
    params.q = `%${query.q.trim().toLowerCase()}%`;
  }

  const asArray = <T,>(v: T | T[] | "all" | undefined): T[] | null => {
    if (!v || v === "all") return null;
    return Array.isArray(v) ? v : [v];
  };

  const stages = asArray(query.stage);
  if (stages) {
    if (query.stage === "open") where.push(`l.pipeline_stage IN ('new','to_qualify','qualified','contacted','engaged','meeting_booked','opportunity')`);
    else if (query.stage === "closed") where.push(`l.pipeline_stage IN ('converted','lost','disqualified')`);
    else {
      where.push(`l.pipeline_stage IN (${stages.map((_, i) => `@stage${i}`).join(",")})`);
      stages.forEach((s, i) => (params[`stage${i}`] = s));
    }
  }

  const outreach = asArray(query.outreach);
  if (outreach) {
    where.push(`l.outreach_state IN (${outreach.map((_, i) => `@out${i}`).join(",")})`);
    outreach.forEach((s, i) => (params[`out${i}`] = s));
  }

  const nurture = asArray(query.nurture);
  if (nurture) {
    where.push(`l.nurture_state IN (${nurture.map((_, i) => `@nur${i}`).join(",")})`);
    nurture.forEach((s, i) => (params[`nur${i}`] = s));
  }

  if (query.sourceId) {
    where.push(`(l.source_id = @sourceId OR EXISTS (SELECT 1 FROM lead_attributions la WHERE la.lead_id = l.id AND la.source_id = @sourceId))`);
    params.sourceId = query.sourceId;
  }
  if (query.campaignId) {
    where.push(`EXISTS (SELECT 1 FROM lead_attributions la WHERE la.lead_id = l.id AND la.campaign_id = @campaignId)`);
    params.campaignId = query.campaignId;
  }
  if (query.ownerId === "__none__") where.push(`l.owner_id IS NULL`);
  else if (query.ownerId) {
    where.push(`l.owner_id = @ownerId`);
    params.ownerId = query.ownerId;
  }
  if (query.companyId) {
    where.push(`l.company_id = @companyId`);
    params.companyId = query.companyId;
  }
  if (query.isNew) where.push(`l.is_new = 1 AND l.first_touched_at IS NULL`);
  if (query.noReply) where.push(`l.reply_count = 0 AND l.outbound_count > 0`);
  if (query.notNurtured) where.push(`l.nurture_state = 'not_enrolled'`);
  if (query.createdAfter) {
    where.push(`l.created_at >= @createdAfter`);
    params.createdAfter = query.createdAfter;
  }
  if (query.createdBefore) {
    where.push(`l.created_at <= @createdBefore`);
    params.createdBefore = query.createdBefore;
  }

  const order: Record<LeadSort, string> = {
    newest: "l.created_at DESC",
    oldest: "l.created_at ASC",
    activity: "COALESCE(l.last_activity_at, l.created_at) DESC",
    name: "l.full_name COLLATE NOCASE ASC",
    score: "l.score DESC, l.created_at DESC",
    stage: "l.pipeline_stage ASC, l.created_at DESC",
  };

  const whereSql = where.join(" AND ");
  const total = (
    database.prepare(`SELECT COUNT(*) AS n FROM leads l WHERE ${whereSql}`).get(params) as { n: number }
  ).n;

  const limit = Math.min(query.limit ?? 50, 500);
  const offset = query.offset ?? 0;
  const rows = database
    .prepare(`${LEAD_SELECT} WHERE ${whereSql} ORDER BY ${order[query.sort ?? "newest"]} LIMIT ${limit} OFFSET ${offset}`)
    .all(params) as LeadView[];

  return { rows, total };
}

export function getLead(database: Database, workspaceId: string, leadId: string): LeadView | null {
  const row = database
    .prepare(`${LEAD_SELECT} WHERE l.workspace_id = :workspaceId AND l.id = :leadId`)
    .get({ workspaceId, leadId, now: nowIso() }) as LeadView | undefined;
  return row ?? null;
}

export function timeline(database: Database, leadId: string, limit = 100): ActivityEvent[] {
  return database
    // rowid breaks ties: several events can share a millisecond, and without a stable
    // tiebreaker sqlite is free to hand them back in any order.
    .prepare(`SELECT * FROM activity_events WHERE lead_id = ? ORDER BY occurred_at DESC, created_at DESC, rowid DESC LIMIT ?`)
    .all(leadId, limit) as ActivityEvent[];
}

export interface LeadDetail {
  lead: LeadView;
  events: ActivityEvent[];
  messages: Message[];
  tasks: TaskView[];
  meetings: Meeting[];
  opportunities: Opportunity[];
  enrollments: Array<NurtureEnrollment & { sequence_name: string }>;
  attributions: Array<{ source_name: string; source_kind: string; campaign_name: string | null; occurrences: number; first_seen_at: string; last_seen_at: string; is_primary: number }>;
  links: Array<{ id: string; related_lead_id: string; related_name: string; kind: string }>;
  merges: unknown[];
  owners: { id: string; name: string }[];
}

export function getLeadDetail(database: Database, workspaceId: string, leadId: string): LeadDetail | null {
  const lead = getLead(database, workspaceId, leadId);
  if (!lead) return null;

  const messages = database
    .prepare(`SELECT * FROM messages WHERE lead_id = ? ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 200`)
    .all(leadId) as Message[];

  const tasks = database
    .prepare(
      `SELECT t.*, m.name AS owner_name, m.avatar_hue AS owner_hue, l.full_name AS lead_name
       FROM tasks t LEFT JOIN members m ON m.id = t.owner_id LEFT JOIN leads l ON l.id = t.lead_id
       WHERE t.lead_id = ? ORDER BY
         CASE t.status WHEN 'completed' THEN 1 WHEN 'cancelled' THEN 2 ELSE 0 END,
         CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC`,
    )
    .all(leadId) as TaskView[];

  const meetings = database.prepare(`SELECT * FROM meetings WHERE lead_id = ? ORDER BY COALESCE(scheduled_at, created_at) DESC`).all(leadId) as Meeting[];
  const opportunities = database.prepare(`SELECT * FROM opportunities WHERE lead_id = ? ORDER BY created_at DESC`).all(leadId) as Opportunity[];

  const enrollments = database
    .prepare(
      `SELECT e.*, s.name AS sequence_name FROM nurture_enrollments e
       JOIN nurture_sequences s ON s.id = e.sequence_id WHERE e.lead_id = ? ORDER BY e.enrolled_at DESC`,
    )
    .all(leadId) as Array<NurtureEnrollment & { sequence_name: string }>;

  const attributions = database
    .prepare(
      `SELECT s.name AS source_name, s.kind AS source_kind, c.name AS campaign_name,
              a.occurrences, a.first_seen_at, a.last_seen_at, a.is_primary
       FROM lead_attributions a
       LEFT JOIN lead_sources s ON s.id = a.source_id
       LEFT JOIN campaigns c ON c.id = a.campaign_id
       WHERE a.lead_id = ? ORDER BY a.occurrences DESC, a.last_seen_at DESC`,
    )
    .all(leadId) as LeadDetail["attributions"];

  const links = database
    .prepare(
      `SELECT k.id, k.related_lead_id, l.full_name AS related_name, k.kind
       FROM lead_links k JOIN leads l ON l.id = k.related_lead_id WHERE k.lead_id = ?`,
    )
    .all(leadId) as LeadDetail["links"];

  const owners = database.prepare(`SELECT id, name FROM members WHERE workspace_id = ? AND is_active = 1`).all(workspaceId) as { id: string; name: string }[];

  return {
    lead,
    events: timeline(database, leadId),
    messages,
    tasks,
    meetings,
    opportunities,
    enrollments,
    attributions,
    links,
    merges: database
      .prepare(
        `SELECT m.id, m.reason, m.created_at, a.full_name AS merged_name, b.name AS actor_name
         FROM lead_merges m LEFT JOIN leads a ON a.id = m.merged_lead_id LEFT JOIN members b ON b.id = m.merged_by
         WHERE m.primary_lead_id = ? OR m.merged_lead_id = ? ORDER BY m.created_at DESC`,
      )
      .all(leadId, leadId),
    owners,
  };
}

export { linkLeads as linkLeadRecords };