/** meetings and opportunities — the two things that turn a lead into revenue. */
import type { Database } from "better-sqlite3";
import { db } from "../db/client";
import { newMeetingId, newOppId } from "../db/ids";
import { nowIso, toIso } from "../db/time";
import type { Meeting, Opportunity } from "../types";
import { recordEvent } from "../engine/events";
import { recomputeLeadStates } from "../engine/states";
import { bumpActivity, setStage, touchLead } from "./leads";
import { createTask } from "./tasks";

export interface BookMeetingInput {
  workspaceId: string;
  leadId: string;
  title?: string;
  scheduledAt: string;
  durationMinutes?: number;
  location?: string | null;
  agenda?: string | null;
  ownerId?: string | null;
  campaignId?: string | null;
  createPrepTask?: boolean;
}

export function bookMeeting(database: Database, input: BookMeetingInput, actorId?: string | null): string {
  const id = newMeetingId();
  const now = nowIso();
  const scheduledAt = toIso(input.scheduledAt) ?? now;

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO meetings (id, workspace_id, lead_id, campaign_id, owner_id, title, channel, scheduled_at,
          duration_minutes, status, location, agenda, created_at, updated_at)
         VALUES (?,?,?,?,?,?, 'meeting', ?,?, 'scheduled', ?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.leadId,
        input.campaignId ?? null,
        input.ownerId ?? null,
        input.title ?? "meeting",
        scheduledAt,
        input.durationMinutes ?? 30,
        input.location ?? null,
        input.agenda ?? null,
        now,
        now,
      );

    recordEvent(database, {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      actorId,
      campaignId: input.campaignId ?? null,
      type: "meeting_booked",
      title: "meeting booked",
      summary: `${input.title ?? "meeting"} on ${new Date(scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`,
      payload: { meetingId: id, scheduledAt },
      channel: "meeting",
      dedupeKey: `meeting:${id}`,
    });

    if (input.createPrepTask !== false) {
      createTask(
        {
          workspaceId: input.workspaceId,
          leadId: input.leadId,
          meetingId: id,
          campaignId: input.campaignId ?? null,
          title: `prepare for the meeting`,
          description: "look them over, note what to ask",
          type: "research",
          priority: "high",
          dueAt: new Date(new Date(scheduledAt).getTime() - 3600_000).toISOString(),
          ownerId: input.ownerId ?? actorId ?? null,
        },
        { actorId, database },
      );
    }

    database.prepare(`UPDATE leads SET meeting_count = meeting_count + 1 WHERE id = ?`).run(input.leadId);
    bumpActivity(database, input.leadId);
    touchLead(database, input.leadId, actorId);
    setStage(database, input.workspaceId, input.leadId, "meeting_booked", actorId, true);
    recomputeLeadStates(database, input.leadId);
  });
  run();
  return id;
}

export function updateMeeting(
  database: Database,
  workspaceId: string,
  meetingId: string,
  patch: Partial<{ status: Meeting["status"]; outcome: string | null; scheduled_at: string; title: string }>,
  actorId?: string | null,
): boolean {
  const meeting = database.prepare(`SELECT * FROM meetings WHERE id = ? AND workspace_id = ?`).get(meetingId, workspaceId) as Meeting | undefined;
  if (!meeting) return false;
  const now = nowIso();

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    params.push(v);
  }
  if (!sets.length) return false;
  sets.push("updated_at = ?");
  params.push(now, meetingId, workspaceId);

  database.prepare(`UPDATE meetings SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ?`).run(...params);

  if (patch.status === "completed") {
    database
      .prepare(`UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE meeting_id = ? AND status IN ('open','in_progress')`)
      .run(now, now, meetingId);
  }

  recordEvent(database, {
    workspaceId,
    leadId: meeting.lead_id,
    actorId,
    type: patch.status === "cancelled" ? "meeting_cancelled" : "meeting_completed",
    title: patch.status === "cancelled" ? "meeting cancelled" : "meeting done",
    summary: patch.outcome ?? meeting.title,
    payload: { meetingId, status: patch.status },
    channel: "meeting",
    dedupeKey: `meetingstatus:${meetingId}:${patch.status}`,
  });

  bumpActivity(database, meeting.lead_id);
  recomputeLeadStates(database, meeting.lead_id);
  return true;
}

export function listMeetings(workspaceId: string, limit = 50, database = db()): Array<Meeting & { lead_full_name: string; company_name: string | null }> {
  return database
    .prepare(
      `SELECT m.*, l.full_name AS lead_full_name, c.name AS company_name
       FROM meetings m JOIN leads l ON l.id = m.lead_id LEFT JOIN companies c ON c.id = l.company_id
       WHERE m.workspace_id = ? AND l.merged_into_lead_id IS NULL
       ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC LIMIT ?`,
    )
    .all(workspaceId, limit) as Array<Meeting & { lead_full_name: string; company_name: string | null }>;
}

// ---------------------------------------------------------------- opportunities

export function createOpportunity(
  database: Database,
  input: {
    workspaceId: string;
    leadId: string;
    name: string;
    amount?: number;
    currency?: string;
    stage?: Opportunity["stage"];
    expectedCloseAt?: string | null;
    ownerId?: string | null;
    campaignId?: string | null;
  },
  actorId?: string | null,
): string {
  const id = newOppId();
  const now = nowIso();

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO opportunities (id, workspace_id, lead_id, campaign_id, owner_id, name, amount, currency, stage, expected_close_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.leadId,
        input.campaignId ?? null,
        input.ownerId ?? null,
        input.name,
        input.amount ?? 0,
        input.currency ?? "usd",
        input.stage ?? "qualifying",
        toIso(input.expectedCloseAt),
        now,
        now,
      );

    recordEvent(database, {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      actorId,
      campaignId: input.campaignId ?? null,
      type: "opportunity_created",
      title: "opportunity created",
      summary: `${input.name}${input.amount ? ` — ${input.currency?.toUpperCase()} ${input.amount.toLocaleString()}` : ""}`,
      payload: { opportunityId: id, amount: input.amount },
      dedupeKey: `opp:${id}`,
    });

    bumpActivity(database, input.leadId);
    touchLead(database, input.leadId, actorId);
    setStage(database, input.workspaceId, input.leadId, "opportunity", actorId, true);
    recomputeLeadStates(database, input.leadId);
  });
  run();
  return id;
}

export function updateOpportunity(
  database: Database,
  workspaceId: string,
  opportunityId: string,
  patch: Partial<{ stage: Opportunity["stage"]; amount: number; expected_close_at: string | null; name: string }>,
  actorId?: string | null,
): boolean {
  const opp = database.prepare(`SELECT * FROM opportunities WHERE id = ? AND workspace_id = ?`).get(opportunityId, workspaceId) as Opportunity | undefined;
  if (!opp) return false;
  const now = nowIso();

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?`);
    params.push(v);
  }
  if (patch.stage === "won" || patch.stage === "lost") sets.push("closed_at = ?"), params.push(now);
  if (!sets.length) return false;
  sets.push("updated_at = ?");
  params.push(now, opportunityId, workspaceId);

  database.prepare(`UPDATE opportunities SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ?`).run(...params);

  if (patch.stage === "won") {
    recordEvent(database, {
      workspaceId,
      leadId: opp.lead_id,
      actorId,
      type: "opportunity_won",
      title: "deal won",
      summary: `${opp.name}${opp.amount ? ` — ${opp.currency.toUpperCase()} ${opp.amount.toLocaleString()}` : ""}`,
      payload: { opportunityId, amount: opp.amount },
      dedupeKey: `oppwon:${opportunityId}`,
    });
    database
      .prepare(`UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE lead_id = ? AND status IN ('open','in_progress') AND type != 'research'`)
      .run(now, now, opp.lead_id);
    setStage(database, workspaceId, opp.lead_id, "converted", actorId, true);
  } else if (patch.stage === "lost") {
    recordEvent(database, {
      workspaceId,
      leadId: opp.lead_id,
      actorId,
      type: "opportunity_lost",
      title: "deal lost",
      summary: opp.name,
      payload: { opportunityId },
      dedupeKey: `opplost:${opportunityId}`,
    });
  }

  bumpActivity(database, opp.lead_id);
  recomputeLeadStates(database, opp.lead_id);
  return true;
}

export function listOpportunities(workspaceId: string, database = db()) {
  return database
    .prepare(
      `SELECT o.*, l.full_name AS lead_full_name, l.email AS lead_email, c.name AS company_name, m.name AS owner_name
       FROM opportunities o JOIN leads l ON l.id = o.lead_id
       LEFT JOIN companies c ON c.id = l.company_id LEFT JOIN members m ON m.id = o.owner_id
       WHERE o.workspace_id = ? AND l.merged_into_lead_id IS NULL
       ORDER BY CASE o.stage WHEN 'negotiation' THEN 0 WHEN 'proposal' THEN 1 WHEN 'qualifying' THEN 2 ELSE 3 END, o.amount DESC`,
    )
    .all(workspaceId) as Array<Opportunity & { lead_full_name: string; lead_email: string | null; company_name: string | null; owner_name: string | null }>;
}

export function pipelineValue(workspaceId: string, database = db()) {
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN stage IN ('qualifying','proposal','negotiation') THEN amount ELSE 0 END), 0) AS open_value,
              COALESCE(SUM(CASE WHEN stage = 'won' THEN amount ELSE 0 END), 0) AS won_value
       FROM opportunities WHERE workspace_id = ?`,
    )
    .get(workspaceId) as { open_value: number; won_value: number };
  return row;
}