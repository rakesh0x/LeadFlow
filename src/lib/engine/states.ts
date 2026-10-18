/**
 * state derivation.
 *
 * the three relationship states are never set by hand in the places that record activity —
 * they are recomputed from the lead's own timeline. a human can pin any state by hand;
 * while a state is pinned we leave it alone and only touch the other two.
 *
 * rules that matter:
 *  - only an inbound message can make a lead "replied". sending is not a reply.
 *  - pipeline stages only move forward on their own. going back is a human decision.
 *  - nurture is independent of outreach. a lead can be nurturing and replied at once.
 */
import type { Database } from "better-sqlite3";
import type { NurtureState, OutreachState, PipelineStage } from "../domain";
import { nowIso } from "../db/time";

const REENGAGE_AFTER_DAYS = 30;

export interface AutoStateResult {
  pipelineStage: PipelineStage;
  outreachState: OutreachState;
  nurtureState: NurtureState;
  changed: boolean;
  notes: string[];
}

/** a lead never walks itself backwards through the funnel. */
const STAGE_ORDER: PipelineStage[] = [
  "new",
  "to_qualify",
  "qualified",
  "contacted",
  "engaged",
  "meeting_booked",
  "opportunity",
  "converted",
];

function stageRank(stage: PipelineStage): number {
  if (stage === "lost" || stage === "disqualified") return -1;
  return STAGE_ORDER.indexOf(stage);
}

function higherStage(a: PipelineStage, b: PipelineStage): PipelineStage {
  return stageRank(b) > stageRank(a) ? b : a;
}

interface MessageFacts {
  lastOutbound: string | null;
  lastInbound: string | null;
  outboundCount: number;
  inboundCount: number;
  followUpAt: string | null;
}

interface TaskFacts {
  dueFollowUp: boolean;
  scheduledFollowUp: string | null;
}

interface NurtureFacts {
  state: "active" | "paused" | "completed" | null;
  reengageDue: boolean;
  lastStepAt: string | null;
}

export function deriveStates(
  lead: {
    id: string;
    pipeline_stage: PipelineStage;
    outreach_state: OutreachState;
    nurture_state: NurtureState;
    pipeline_stage_set_by: string;
    outreach_state_set_by: string;
    nurture_state_set_by: string;
    last_activity_at: string | null;
  },
  messages: MessageFacts,
  tasks: TaskFacts,
  nurture: NurtureFacts,
  now: string = nowIso(),
): AutoStateResult {
  const notes: string[] = [];
  let pipelineStage: PipelineStage = lead.pipeline_stage;
  let outreachState: OutreachState = lead.outreach_state;
  let nurtureState: NurtureState = lead.nurture_state;

  // ---------- pipeline stage ----------
  if (lead.pipeline_stage_set_by !== "manual") {
    let next: PipelineStage = pipelineStage;

    // a lead with real work queued against it has at least been looked at
    if (tasks.dueFollowUp && stageRank(next) < stageRank("to_qualify")) next = "to_qualify";
    if (messages.outboundCount > 0) next = higherStage(next, "contacted");
    if (messages.inboundCount > 0) next = higherStage(next, "engaged");
    if (nurture.state === "active" && messages.outboundCount === 0 && stageRank(next) < stageRank("to_qualify")) {
      next = "to_qualify";
    }
    if (next !== pipelineStage) notes.push(`stage: ${pipelineStage} -> ${next}`);
    pipelineStage = next;
  }

  // ---------- outreach state ----------
  if (lead.outreach_state_set_by !== "manual") {
    let next: OutreachState;

    if (messages.outboundCount === 0 && messages.inboundCount === 0) {
      // a brand new person. if someone is nurturing them we have "contacted" them via a sequence.
      next = nurture.state === "active" ? "outreach_sent" : "never_contacted";
    } else {
      const lastOutboundTs = messages.lastOutbound ? Date.parse(messages.lastOutbound) : 0;
      const lastInboundTs = messages.lastInbound ? Date.parse(messages.lastInbound) : 0;
      // ties go to the reply: if someone answers in the same instant we sent,
      // they spoke last. being wrong this way never turns our own message into a reply.
      const inboundIsNewest = lastInboundTs > 0 && lastInboundTs >= lastOutboundTs;

      if (inboundIsNewest) {
        // they spoke last. one reply means replied, several means we are talking.
        const exchanges = messages.inboundCount;
        next = exchanges >= 2 ? "conversation_active" : "replied";
      } else {
        if (tasks.dueFollowUp) {
          next = "follow_up_due";
        } else if (tasks.scheduledFollowUp && Date.parse(tasks.scheduledFollowUp) > Date.now()) {
          next = "follow_up_scheduled";
        } else if (messages.followUpAt && Date.parse(messages.followUpAt) > Date.now()) {
          next = "follow_up_scheduled";
        } else {
          next = "awaiting_reply";
        }
      }
    }

    if (next !== outreachState) notes.push(`outreach: ${outreachState} -> ${next}`);
    outreachState = next;
  }

  // ---------- nurture state ----------
  if (lead.nurture_state_set_by !== "manual") {
    let next: NurtureState;
    if (!nurture.state) {
      next = "not_enrolled";
    } else if (nurture.state === "active") {
      next = "nurturing";
    } else if (nurture.state === "paused") {
      next = "nurture_paused";
    } else {
      const lastTouch = nurture.lastStepAt ?? lead.last_activity_at;
      const quietDays = lastTouch ? (Date.parse(now) - Date.parse(lastTouch)) / 86_400_000 : Infinity;
      next = nurture.reengageDue || quietDays >= REENGAGE_AFTER_DAYS ? "ready_for_reengagement" : "nurture_completed";
    }
    if (next !== nurtureState) notes.push(`nurture: ${nurtureState} -> ${next}`);
    nurtureState = next;
  }

  const changed =
    pipelineStage !== lead.pipeline_stage ||
    outreachState !== lead.outreach_state ||
    nurtureState !== lead.nurture_state;

  return { pipelineStage, outreachState, nurtureState, changed, notes };
}

/** reads everything the derivation needs, then writes the result back. */
export function recomputeLeadStates(database: Database, leadId: string, actorId?: string | null): AutoStateResult | null {
  const lead = database
    .prepare(
      `SELECT id, pipeline_stage, outreach_state, nurture_state,
              pipeline_stage_set_by, outreach_state_set_by, nurture_state_set_by, last_activity_at
       FROM leads WHERE id = ?`,
    )
    .get(leadId) as
    | {
        id: string;
        pipeline_stage: PipelineStage;
        outreach_state: OutreachState;
        nurture_state: NurtureState;
        pipeline_stage_set_by: string;
        outreach_state_set_by: string;
        nurture_state_set_by: string;
        last_activity_at: string | null;
      }
    | undefined;
  if (!lead) return null;

  const msg = database
    .prepare(
      `SELECT
         MAX(CASE WHEN direction = 'outbound' AND sent_at IS NOT NULL THEN sent_at END) AS last_outbound,
         MAX(CASE WHEN direction = 'inbound'  AND sent_at IS NOT NULL THEN sent_at END) AS last_inbound,
         SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outbound_count,
         SUM(CASE WHEN direction = 'inbound'  THEN 1 ELSE 0 END) AS inbound_count,
         MIN(CASE WHEN next_follow_up_at IS NOT NULL AND next_follow_up_at > ? THEN next_follow_up_at END) AS follow_up_at
       FROM messages WHERE lead_id = ? AND delivery_state NOT IN ('failed','bounced')`,
    )
    .get(nowIso(), leadId) as
    | {
        last_outbound: string | null;
        last_inbound: string | null;
        outbound_count: number | null;
        inbound_count: number | null;
        follow_up_at: string | null;
      }
    | undefined;

  const taskRow = database
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at <= ? THEN 1 ELSE 0 END) AS due_now,
         MIN(CASE WHEN status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at > ? THEN due_at END) AS next_due
       FROM tasks WHERE lead_id = ?`,
    )
    .get(nowIso(), nowIso(), leadId) as { due_now: number | null; next_due: string | null } | undefined;

  const nurtureRow = database
    .prepare(
      `SELECT state, MAX(last_step_at) AS last_step_at, COUNT(*) AS n
       FROM nurture_enrollments WHERE lead_id = ?`,
    )
    .get(leadId) as { state: string | null; last_step_at: string | null; n: number } | undefined;

  let nurtureState: "active" | "paused" | "completed" | null = null;
  if (nurtureRow?.n) {
    const states = database
      .prepare(`SELECT DISTINCT state FROM nurture_enrollments WHERE lead_id = ?`)
      .all(leadId) as { state: string }[];
    if (states.some((s) => s.state === "active")) nurtureState = "active";
    else if (states.some((s) => s.state === "reengagement_due")) nurtureState = "active";
    else if (states.some((s) => s.state === "paused")) nurtureState = "paused";
    else nurtureState = "completed";
  }

  const messages: MessageFacts = {
    lastOutbound: msg?.last_outbound ?? null,
    lastInbound: msg?.last_inbound ?? null,
    outboundCount: msg?.outbound_count ?? 0,
    inboundCount: msg?.inbound_count ?? 0,
    followUpAt: msg?.follow_up_at ?? null,
  };
  const tasks: TaskFacts = {
    dueFollowUp: (taskRow?.due_now ?? 0) > 0,
    scheduledFollowUp: taskRow?.next_due ?? null,
  };
  const nurture: NurtureFacts = {
    state: nurtureState,
    reengageDue: nurtureRow?.state === "reengagement_due",
    lastStepAt: nurtureRow?.last_step_at ?? null,
  };

  const result = deriveStates(lead, messages, tasks, nurture);
  if (!result.changed) return result;

  database
    .prepare(
      `UPDATE leads
       SET pipeline_stage = ?, outreach_state = ?, nurture_state = ?,
           converted_at = CASE
             WHEN ? = 'converted' AND converted_at IS NULL THEN ?
             WHEN ? <> 'converted' THEN NULL ELSE converted_at END,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      result.pipelineStage,
      result.outreachState,
      result.nurtureState,
      result.pipelineStage,
      nowIso(),
      result.pipelineStage,
      nowIso(),
      leadId,
    );

  if (actorId) {
    database
      .prepare(`UPDATE activity_events SET actor_id = ? WHERE lead_id = ? AND actor_id IS NULL AND occurred_at >= ?`)
      .run(actorId, leadId, new Date(Date.now() - 60_000).toISOString());
  }

  return result;
}

/** used by the "let automation handle this" button on a lead. */
export function releaseState(
  database: Database,
  leadId: string,
  axis: "pipeline" | "outreach" | "nurture",
): void {
  const column = `${axis}_state_set_by`;
  database.prepare(`UPDATE leads SET ${column} = 'auto' WHERE id = ?`).run(leadId);
  recomputeLeadStates(database, leadId);
}