/** nurture: sequences, enrollments and the step queue the background worker drains. */
import type { Database } from "better-sqlite3";
import { db } from "../db/client";
import { newEnrollmentId, newSequenceId, newStepId } from "../db/ids";
import { nowIso } from "../db/time";
import type { Channel } from "../domain";
import type { NurtureEnrollment, NurtureSequence, NurtureStep } from "../types";
import { recordEvent } from "../engine/events";
import { recomputeLeadStates } from "../engine/states";

export interface SequenceStep {
  name: string;
  channel?: Channel;
  subject?: string;
  content?: string;
  waitDays?: number;
}

export function listSequences(workspaceId: string, database = db()) {
  return database
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM nurture_enrollments e WHERE e.sequence_id = s.id AND e.state = 'active') AS active_enrollments,
              (SELECT COUNT(*) FROM nurture_enrollments e WHERE e.sequence_id = s.id) AS total_enrollments,
              (SELECT COUNT(*) FROM nurture_steps n JOIN nurture_enrollments e2 ON e2.id = n.enrollment_id WHERE e2.sequence_id = s.id AND n.status = 'sent') AS steps_sent
       FROM nurture_sequences s WHERE s.workspace_id = ? ORDER BY s.created_at DESC`,
    )
    .all(workspaceId) as Array<NurtureSequence & { active_enrollments: number; total_enrollments: number; steps_sent: number }>;
}

export function getSequence(workspaceId: string, sequenceId: string, database = db()): NurtureSequence | null {
  return (
    (database.prepare(`SELECT * FROM nurture_sequences WHERE id = ? AND workspace_id = ?`).get(sequenceId, workspaceId) as NurtureSequence) ?? null
  );
}

export function createSequence(
  workspaceId: string,
  input: { name: string; description?: string | null; goal?: string | null; steps: SequenceStep[] },
  database = db(),
): string {
  const id = newSequenceId();
  const now = nowIso();
  database
    .prepare(
      `INSERT INTO nurture_sequences (id, workspace_id, name, description, status, steps_json, goal, created_at, updated_at)
       VALUES (?,?,?,?, 'active', ?,?,?,?)`,
    )
    .run(id, workspaceId, input.name, input.description ?? null, JSON.stringify(input.steps), input.goal ?? null, now, now);
  return id;
}

export function enrollLead(
  database: Database,
  workspaceId: string,
  leadId: string,
  sequenceId: string,
  opts: { actorId?: string | null; startDelayDays?: number } = {},
): string | null {
  const sequence = getSequence(workspaceId, sequenceId, database);
  if (!sequence) return null;
  let steps: SequenceStep[] = [];
  try {
    steps = JSON.parse(sequence.steps_json) as SequenceStep[];
  } catch {
    steps = [];
  }
  if (!steps.length) return null;

  const existing = database
    .prepare(`SELECT id, state FROM nurture_enrollments WHERE lead_id = ? AND sequence_id = ?`)
    .get(leadId, sequenceId) as { id: string; state: string } | undefined;
  if (existing && existing.state !== "completed") return existing.id;

  const id = existing?.id ?? newEnrollmentId();
  const now = nowIso();
  let offsetDays = opts.startDelayDays ?? 0;
  for (const step of steps) {
    offsetDays += step.waitDays ?? 0;
  }
  void offsetDays;

  const run = database.transaction(() => {
    if (existing) {
      database
        .prepare(`UPDATE nurture_enrollments SET state = 'active', current_step = 0, completed_at = NULL, next_step_at = ?, updated_at = ? WHERE id = ?`)
        .run(new Date(Date.now() + (opts.startDelayDays ?? 0) * 86_400_000).toISOString(), now, id);
      database.prepare(`DELETE FROM nurture_steps WHERE enrollment_id = ? AND status = 'pending'`).run(id);
    } else {
      database
        .prepare(
          `INSERT INTO nurture_enrollments (id, workspace_id, lead_id, sequence_id, state, current_step, total_steps, enrolled_at, next_step_at, created_at, updated_at)
           VALUES (?,?,?,?, 'active', 0, ?,?,?,?,?)`,
        )
        .run(id, workspaceId, leadId, sequenceId, steps.length, now, new Date(Date.now() + (opts.startDelayDays ?? 0) * 86_400_000).toISOString(), now, now);
    }

    let cursor = Date.now() + (opts.startDelayDays ?? 0) * 86_400_000;
    const insert = database.prepare(
      `INSERT INTO nurture_steps (id, workspace_id, enrollment_id, lead_id, step_index, channel, subject, content, status, scheduled_at, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'pending', ?, ?)`,
    );
    steps.forEach((step, index) => {
      cursor += (step.waitDays ?? 0) * 86_400_000;
      insert.run(
        newStepId(),
        workspaceId,
        id,
        leadId,
        index,
        step.channel ?? "email",
        step.subject ?? `${sequence.name} — step ${index + 1}`,
        step.content ?? "",
        new Date(cursor).toISOString(),
        now,
      );
    });

    recordEvent(database, {
      workspaceId,
      leadId,
      actorId: opts.actorId ?? null,
      type: "nurture_enrolled",
      title: "enrolled in a sequence",
      summary: `${sequence.name} — ${steps.length} steps`,
      payload: { sequenceId, enrollmentId: id },
      dedupeKey: `enroll:${id}`,
    });
  });
  run();

  recomputeLeadStates(database, leadId);
  return id;
}

export function pauseEnrollment(database: Database, workspaceId: string, enrollmentId: string, paused: boolean, actorId?: string | null): boolean {
  const row = database
    .prepare(`SELECT * FROM nurture_enrollments WHERE id = ? AND workspace_id = ?`)
    .get(enrollmentId, workspaceId) as NurtureEnrollment | undefined;
  if (!row) return false;

  database
    .prepare(`UPDATE nurture_enrollments SET state = ?, next_step_at = ?, updated_at = ? WHERE id = ?`)
    .run(paused ? "paused" : "active", paused ? null : nowIso(), nowIso(), enrollmentId);

  recordEvent(database, {
    workspaceId,
    leadId: row.lead_id,
    actorId,
    type: "nurture_paused",
    title: paused ? "sequence paused" : "sequence resumed",
    summary: paused ? "we are holding off" : "picking back up",
    payload: { enrollmentId },
  });
  recomputeLeadStates(database, row.lead_id);
  return true;
}

export function completeEnrollment(database: Database, workspaceId: string, enrollmentId: string, actorId?: string | null): boolean {
  const row = database
    .prepare(`SELECT * FROM nurture_enrollments WHERE id = ? AND workspace_id = ?`)
    .get(enrollmentId, workspaceId) as NurtureEnrollment | undefined;
  if (!row) return false;
  const now = nowIso();
  database
    .prepare(`UPDATE nurture_enrollments SET state = 'completed', completed_at = ?, next_step_at = NULL, updated_at = ? WHERE id = ?`)
    .run(now, now, enrollmentId);
  database.prepare(`UPDATE nurture_steps SET status = 'skipped' WHERE enrollment_id = ? AND status = 'pending'`).run(enrollmentId);

  recordEvent(database, {
    workspaceId,
    leadId: row.lead_id,
    actorId,
    type: "nurture_completed",
    title: "sequence finished",
    payload: { enrollmentId },
  });
  recomputeLeadStates(database, row.lead_id);
  return true;
}

export function markReengagementDue(database: Database, workspaceId: string, leadIds: string[]): number {
  if (!leadIds.length) return 0;
  const run = database.transaction(() => {
    const update = database.prepare(`UPDATE nurture_enrollments SET state = 'reengagement_due', updated_at = ? WHERE lead_id = ? AND state IN ('completed','active')`);
    let n = 0;
    for (const leadId of leadIds) {
      n += update.run(nowIso(), leadId).changes;
      recomputeLeadStates(database, leadId);
    }
    return n;
  });
  return run();
}

export interface NurtureBoardRow {
  lead_id: string;
  full_name: string;
  email: string | null;
  company_name: string | null;
  nurture_state: string;
  pipeline_stage: string;
  enrollment_id: string | null;
  sequence_name: string | null;
  sequence_status: string | null;
  state: string | null;
  current_step: number | null;
  total_steps: number | null;
  next_step_at: string | null;
  last_step_at: string | null;
  enrolled_at: string | null;
  last_activity_at: string | null;
  reply_count: number;
}

export function nurtureBoard(workspaceId: string, database = db()): NurtureBoardRow[] {
  return database
    .prepare(
      `SELECT l.id AS lead_id, l.full_name, l.email, c.name AS company_name, l.nurture_state, l.pipeline_stage,
              l.last_activity_at, l.reply_count,
              e.id AS enrollment_id, s.name AS sequence_name, s.status AS sequence_status,
              e.state, e.current_step, e.total_steps, e.next_step_at, e.last_step_at, e.enrolled_at
       FROM leads l
       LEFT JOIN companies c ON c.id = l.company_id
       LEFT JOIN nurture_enrollments e ON e.lead_id = l.id
       LEFT JOIN nurture_sequences s ON s.id = e.sequence_id
       WHERE l.workspace_id = ? AND l.merged_into_lead_id IS NULL AND l.is_archived = 0
       ORDER BY CASE l.nurture_state WHEN 'nurturing' THEN 0 WHEN 'ready_for_reengagement' THEN 1
                                     WHEN 'nurture_paused' THEN 2 WHEN 'nurture_completed' THEN 3 ELSE 4 END,
                l.last_activity_at DESC NULLS LAST, l.created_at DESC`,
    )
    .all(workspaceId) as NurtureBoardRow[];
}

export function sequenceSteps(database: Database, enrollmentId: string): NurtureStep[] {
  return database.prepare(`SELECT * FROM nurture_steps WHERE enrollment_id = ? ORDER BY step_index`).all(enrollmentId) as NurtureStep[];
}

export function dueNurtureSteps(workspaceId: string, limit = 50, database = db()): Array<NurtureStep & { sequence_name: string; lead_full_name: string }> {
  return database
    .prepare(
      `SELECT n.*, s.name AS sequence_name, l.full_name AS lead_full_name
       FROM nurture_steps n
       JOIN nurture_enrollments e ON e.id = n.enrollment_id AND e.state = 'active'
       JOIN nurture_sequences s ON s.id = e.sequence_id
       JOIN leads l ON l.id = n.lead_id
       WHERE n.workspace_id = ? AND n.status = 'pending' AND n.scheduled_at IS NOT NULL AND n.scheduled_at <= ?
       ORDER BY n.scheduled_at ASC LIMIT ?`,
    )
    .all(workspaceId, nowIso(), limit) as Array<NurtureStep & { sequence_name: string; lead_full_name: string }>;
}

export function markStepSent(database: Database, stepId: string, messageId: string | null, actorId?: string | null): void {
  const step = database.prepare(`SELECT * FROM nurture_steps WHERE id = ?`).get(stepId) as NurtureStep | undefined;
  if (!step) return;
  const now = nowIso();

  const run = database.transaction(() => {
    database
      .prepare(`UPDATE nurture_steps SET status = 'sent', sent_at = ?, message_id = ?, error = NULL WHERE id = ?`)
      .run(now, messageId, stepId);
    database
      .prepare(`UPDATE nurture_enrollments SET current_step = step_index + 1, last_step_at = ?, updated_at = ? WHERE id = ?`)
      .run(now, now, step.enrollment_id);
    const next = database
      .prepare(`SELECT MIN(scheduled_at) AS next_at FROM nurture_steps WHERE enrollment_id = ? AND status = 'pending'`)
      .get(step.enrollment_id) as { next_at: string | null } | undefined;
    database.prepare(`UPDATE nurture_enrollments SET next_step_at = ?, updated_at = ? WHERE id = ?`).run(next?.next_at ?? null, now, step.enrollment_id);

    recordEvent(database, {
      workspaceId: step.workspace_id,
      leadId: step.lead_id,
      actorId,
      type: "nurture_step_sent",
      title: "nurture step sent",
      summary: step.subject,
      payload: { stepId, stepIndex: step.step_index },
      channel: step.channel,
      direction: "outbound",
      dedupeKey: `nurstep:${stepId}`,
    });
  });
  run();
  recomputeLeadStates(database, step.lead_id);
}

export function sequenceStats(workspaceId: string, database = db()) {
  return database
    .prepare(
      `SELECT
         SUM(CASE WHEN l.nurture_state = 'nurturing' THEN 1 ELSE 0 END) AS nurturing,
         SUM(CASE WHEN l.nurture_state = 'ready_for_reengagement' THEN 1 ELSE 0 END) AS reengage,
         SUM(CASE WHEN l.nurture_state = 'nurture_paused' THEN 1 ELSE 0 END) AS paused,
         SUM(CASE WHEN l.nurture_state = 'nurture_completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN l.nurture_state = 'not_enrolled' THEN 1 ELSE 0 END) AS not_enrolled
       FROM leads l WHERE l.workspace_id = ? AND l.merged_into_lead_id IS NULL AND l.is_archived = 0`,
    )
    .get(workspaceId) as { nurturing: number | null; reengage: number | null; paused: number | null; completed: number | null; not_enrolled: number | null };
}

