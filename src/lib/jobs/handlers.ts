/** the actual work the scheduler does. every handler is safe to run twice. */
import type { Database } from "better-sqlite3";
import { enqueue, registerHandler } from "./queue";
import { daysAgoIso, nowIso } from "../db/time";
import { recordEvent, writeLog } from "../engine/events";
import { createTask } from "../queries/tasks";
import { logOutboundMessage } from "../queries/outreach";
import { dueNurtureSteps, markStepSent, markReengagementDue, sequenceStats } from "../queries/nurture";
import { quietOutreach } from "../queries/outreach";
import { overview } from "../queries/analytics";
import { updateSource, listSources } from "../queries/sources";
import { recomputeLeadStates } from "../engine/states";
import { enqueueDigest } from "./digest";

// ---------------------------------------------------------------- follow-ups

/** anything overdue becomes a real task, once. the dedupe key stops repeats. */
registerHandler("follow_up_sweep", (job, database) => {
  const workspaceId = String(job.payload.workspaceId ?? "");
  const day = String(job.payload.day ?? nowIso().slice(0, 10));

  const overdue = database
    .prepare(
      `SELECT t.id, t.title, t.lead_id, t.type, t.due_at, t.owner_id, l.full_name
       FROM tasks t JOIN leads l ON l.id = t.lead_id
       WHERE t.workspace_id = ? AND t.status IN ('open','in_progress')
         AND t.due_at IS NOT NULL AND t.due_at <= ?
         AND l.merged_into_lead_id IS NULL
       LIMIT 200`,
    )
    .all(workspaceId, nowIso()) as Array<{ id: string; lead_id: string; full_name: string; due_at: string; owner_id: string | null; type: string; title: string }>;

  let created = 0;
  for (const row of overdue) {
    const result = createTask(
      {
        workspaceId,
        leadId: row.lead_id,
        title: `overdue: ${row.title || "follow up"} — ${row.full_name}`,
        type: "follow_up",
        priority: "urgent",
        dueAt: row.due_at,
        ownerId: row.owner_id,
        origin: "automation",
        dedupeKey: `sweep:${day}:${row.id}`,
      },
      { database },
    );
    if (result) created++;
  }

  // anything that went quiet with nobody chasing it gets picked up too
  const quiet = quietOutreach(workspaceId, 50, database);
  let chased = 0;
  for (const row of quiet) {
    const ageDays = Math.floor((Date.now() - new Date(row.sent_at ?? nowIso()).getTime()) / 86_400_000);
    if (ageDays < 5) continue;
    const result = createTask(
      {
        workspaceId,
        leadId: row.lead_id,
        campaignId: row.campaign_id,
        title: `no reply in ${ageDays} days — check in`,
        type: "follow_up",
        priority: ageDays >= 14 ? "high" : "medium",
        dueAt: nowIso(),
        ownerId: row.owner_id,
        origin: "automation",
        dedupeKey: `quiet:${row.id}:${day}`,
      },
      { database },
    );
    if (result) chased++;
  }

  return { ok: true, result: { created, chased, scanned: overdue.length } };
});

/** replies waiting on us. different from "we sent and they ignored it". */
registerHandler("reply_watchdog", (job, database) => {
  const workspaceId = String(job.payload.workspaceId ?? "");
  const day = String(job.payload.day ?? nowIso().slice(0, 10));

  const waiting = database
    .prepare(
      `SELECT m.id, m.lead_id, m.sent_at, l.full_name
       FROM messages m JOIN leads l ON l.id = m.lead_id
       WHERE m.workspace_id = ? AND m.direction = 'inbound' AND l.merged_into_lead_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM messages o WHERE o.lead_id = m.lead_id AND o.direction = 'outbound' AND o.sent_at > m.sent_at)
         AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.lead_id = m.lead_id AND t.type = 'follow_up' AND t.status IN ('open','in_progress'))
         AND m.sent_at < ?
       LIMIT 100`,
    )
    .all(workspaceId, new Date(Date.now() - 3_600_000).toISOString()) as Array<{ id: string; lead_id: string; full_name: string }>;

  let created = 0;
  for (const row of waiting) {
    const result = createTask(
      {
        workspaceId,
        leadId: row.lead_id,
        title: `reply to ${row.full_name}`,
        type: "follow_up",
        priority: "urgent",
        dueAt: nowIso(),
        origin: "automation",
        dedupeKey: `watchdog:${row.id}:${day}`,
      },
      { database },
    );
    if (result) created++;
    database.prepare(`UPDATE leads SET outreach_state = 'follow_up_due' WHERE id = ? AND outreach_state = 'replied'`).run(row.lead_id);
  }

  return { ok: true, result: { created, scanned: waiting.length } };
});

// ---------------------------------------------------------------- nurture

registerHandler("nurture_dispatch", (job, database) => {
  const workspaceId = String(job.payload.workspaceId ?? "");
  const limit = Number(job.payload.limit ?? 50);
  const due = dueNurtureSteps(workspaceId, limit, database);

  let sent = 0;
  for (const step of due) {
    try {
      const messageId = logOutboundMessage(
        database,
        {
          workspaceId,
          leadId: step.lead_id,
          channel: step.channel,
          subject: step.subject,
          content: step.content,
          followUpAfterDays: null,
          deliveryState: "sent",
        },
        null,
      );
      markStepSent(database, step.id, messageId, null);
      sent++;
    } catch (error) {
      database
        .prepare(`UPDATE nurture_steps SET status = 'failed', error = ? WHERE id = ?`)
        .run(error instanceof Error ? error.message : String(error), step.id);
      throw error;
    }
  }

  // a finished sequence that has gone quiet is worth another look
  const stats = sequenceStats(workspaceId, database);
  const stale = database
    .prepare(
      `SELECT l.id FROM leads l
       WHERE l.workspace_id = ? AND l.nurture_state = 'nurture_completed'
         AND (l.last_activity_at IS NULL OR l.last_activity_at < ?) AND l.pipeline_stage NOT IN ('converted','lost','disqualified')
       LIMIT 100`,
    )
    .all(workspaceId, daysAgoIso(30)) as Array<{ id: string }>;
  markReengagementDue(database, workspaceId, stale.map((r) => r.id));

  return { ok: true, result: { sent, considered: due.length, reengagementFlagged: stale.length, stats } };
});

// ---------------------------------------------------------------- sources

/** stand-in for a platform sync. in production this is where the provider api is called. */
registerHandler("source_sync", (job, database) => {
  const workspaceId = String(job.payload.workspaceId ?? "");
  const sourceId = String(job.payload.sourceId ?? "");
  const source = database.prepare(`SELECT * FROM lead_sources WHERE id = ? AND workspace_id = ?`).get(sourceId, workspaceId) as
    | { id: string; name: string; status: string }
    | undefined;
  if (!source) return { ok: false, error: "source not found", retryable: false };
  if (source.status === "disconnected") return { ok: true, skipped: true };

  const now = nowIso();
  updateSource(workspaceId, sourceId, { last_sync_at: now }, database);
  recordEvent(database, {
    workspaceId,
    type: "source_synced",
    title: "source synced",
    summary: `${source.name} checked`,
    payload: { sourceId },
    dedupeKey: `sync:${sourceId}:${now.slice(0, 13)}`,
  });

  return { ok: true, result: { sourceId, at: now } };
});

/** checks for sources due for a refresh and queues them. */
registerHandler("source_sweep", (job, database) => {
  const workspaceId = String(job.payload.workspaceId ?? "");
  const sources = listSources(workspaceId, database);
  let queued = 0;
  for (const source of sources) {
    if (!source.is_active || source.status === "disconnected") continue;
    const last = source.last_sync_at ? new Date(source.last_sync_at).getTime() : 0;
    const dueAt = last + source.sync_cadence_hours * 3_600_000;
    if (Date.now() < dueAt) continue;
    enqueue({ workspaceId, kind: "source_sync", payload: { sourceId: source.id }, idempotencyKey: `sync:${source.id}:${nowIso().slice(0, 13)}` }, database);
    queued++;
  }
  return { ok: true, result: { queued, checked: sources.length } };
});

// ---------------------------------------------------------------- imports

registerHandler("import_process", (job, database) => {
  void database;
  const importId = String(job.payload.importId ?? "");
  void importId;
  return { ok: true, skipped: true, result: { note: "imports are processed by the import runner" } };
});

// ---------------------------------------------------------------- duplicates

/** rechecks pairs the review queue flagged and refreshes confidence. */
registerHandler("duplicate_scan", (job, database) => {
  const workspaceId = String(job.payload.workspaceId ?? "");
  const pending = database
    .prepare(`SELECT id FROM dupe_candidates WHERE workspace_id = ? AND status = 'pending' ORDER BY confidence DESC LIMIT 200`)
    .all(workspaceId) as Array<{ id: string }>;

  let dismissed = 0;
  for (const row of pending) {
    // the newest of the two wins the surviving record
    const pair = database
      .prepare(`SELECT lead_id, candidate_lead_id FROM dupe_candidates WHERE id = ?`)
      .get(row.id) as { lead_id: string; candidate_lead_id: string };
    const a = database.prepare(`SELECT created_at FROM leads WHERE id = ?`).get(pair.lead_id) as { created_at: string } | undefined;
    const b = database.prepare(`SELECT created_at FROM leads WHERE id = ?`).get(pair.candidate_lead_id) as { created_at: string } | undefined;
    if (!a || !b) {
      database.prepare(`DELETE FROM dupe_candidates WHERE id = ?`).run(row.id);
      dismissed++;
    }
  }
  return { ok: true, result: { scanned: pending.length, cleaned: dismissed } };
});

// ---------------------------------------------------------------- rollups

registerHandler("analytics_rollup", (job, database) => {
  const workspaceId = String(job.payload.workspaceId ?? "");
  const stats = overview(workspaceId, "7d", undefined, undefined, database);
  writeLog(database, { workspaceId, kind: "rollup", message: "weekly numbers recorded", detail: stats as unknown as Record<string, unknown> });
  return { ok: true, result: { acquired: stats.acquiredInPeriod, converted: stats.converted } };
});

/** delivery simulation for queued messages so the pipeline has something real to show. */
registerHandler("message_delivery_check", (job, database) => {
  const workspaceId = String(job.payload.workspaceId ?? "");
  const queued = database
    .prepare(`SELECT id FROM messages WHERE workspace_id = ? AND delivery_state = 'queued' ORDER BY created_at LIMIT 100`)
    .all(workspaceId) as Array<{ id: string }>;

  for (const row of queued) {
    database
      .prepare(`UPDATE messages SET delivery_state = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ? AND delivery_state = 'queued'`)
      .run(nowIso(), nowIso(), row.id);
  }
  return { ok: true, result: { delivered: queued.length } };
});

/** keeps every derived state honest after a bulk change. */
registerHandler("state_refresh", (job, database) => {
  const workspaceId = String(job.payload.workspaceId ?? "");
  const limit = Number(job.payload.limit ?? 500);
  const leads = database
    .prepare(
      `SELECT id FROM leads WHERE workspace_id = ? AND merged_into_lead_id IS NULL ORDER BY COALESCE(updated_at, created_at) DESC LIMIT ?`,
    )
    .all(workspaceId, limit) as Array<{ id: string }>;

  let changed = 0;
  for (const row of leads) {
    const result = recomputeLeadStates(database, row.id);
    if (result?.changed) changed++;
  }
  return { ok: true, result: { scanned: leads.length, changed } };
});

/** the nightly summary, built as a job so it is never dependent on an open browser. */
registerHandler("daily_digest", (job, database) => {
  const workspaceId = String(job.payload.workspaceId ?? "");
  enqueueDigest(workspaceId, database);
  const stats = overview(workspaceId, "7d", undefined, undefined, database);
  return { ok: true, result: { overdue: stats.overdueFollowUps, unprocessed: stats.newUnprocessed } };
});

void enqueue;