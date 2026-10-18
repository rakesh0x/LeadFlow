/**
 * the activity log.
 * every meaningful thing that happens to a lead is appended here first.
 * dashboards, lead states and timelines all read from this table, so if it is
 * not written, it did not happen.
 */
import type { Database } from "better-sqlite3";
import { newEventId } from "../db/ids";
import { nowIso, toIso } from "../db/time";

export interface RecordEventInput {
  workspaceId: string;
  leadId?: string | null;
  actorId?: string | null;
  campaignId?: string | null;
  type: string;
  title?: string | null;
  summary?: string | null;
  payload?: Record<string, unknown>;
  channel?: string | null;
  direction?: string | null;
  occurredAt?: string | Date | null;
  /** set this and a repeat with the same key is ignored, so retries stay safe. */
  dedupeKey?: string | null;
}

export function recordEvent(database: Database, input: RecordEventInput): string | null {
  const occurredAt = toIso(input.occurredAt) ?? nowIso();
  const id = newEventId();

  const run = database.transaction(() => {
    if (input.dedupeKey) {
      const existing = database
        .prepare(`SELECT id FROM activity_events WHERE workspace_id = ? AND dedupe_key = ?`)
        .get(input.workspaceId, input.dedupeKey) as { id: string } | undefined;
      if (existing) return null;
    }
    database
      .prepare(
        `INSERT INTO activity_events
          (id, workspace_id, lead_id, actor_id, campaign_id, type, title, summary,
           payload_json, channel, direction, occurred_at, created_at, dedupe_key)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.leadId ?? null,
        input.actorId ?? null,
        input.campaignId ?? null,
        input.type,
        input.title ?? null,
        input.summary ?? null,
        JSON.stringify(input.payload ?? {}),
        input.channel ?? null,
        input.direction ?? null,
        occurredAt,
        nowIso(),
        input.dedupeKey ?? null,
      );
    return id;
  });
  return run();
}

export interface LogLine {
  workspaceId?: string | null;
  kind: string;
  message: string;
  detail?: Record<string, unknown>;
}

export function writeLog(database: Database, line: LogLine): void {
  database
    .prepare(
      `INSERT INTO activity_log (id, workspace_id, kind, message, detail_json, created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .run(
      `log_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      line.workspaceId ?? null,
      line.kind,
      line.message,
      JSON.stringify(line.detail ?? {}),
      nowIso(),
    );
}