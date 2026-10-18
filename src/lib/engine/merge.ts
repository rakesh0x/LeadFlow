/**
 * merging two lead records.
 *
 * nothing is thrown away. every message, task, meeting, event, source and note moves to
 * the surviving record, the losing row is kept and marked, and the whole operation is
 * written down in lead_merges so it can be explained later.
 */
import type { Database } from "better-sqlite3";
import { newMergeId } from "../db/ids";
import { nowIso } from "../db/time";
import { normalizeEmail, normalizeLinkedin, normalizePhone, normalizeX } from "./normalize";

export interface MergeOutcome {
  ok: boolean;
  primaryLeadId: string;
  mergedLeadId: string;
  moved: Record<string, number>;
  filled: string[];
  error?: string;
}

/** moves every child row from `from` onto `to`, counting as it goes. */
const MOVES: Array<{ table: string; counts: string }> = [
  { table: "activity_events", counts: "events" },
  { table: "messages", counts: "messages" },
  { table: "tasks", counts: "tasks" },
  { table: "meetings", counts: "meetings" },
  { table: "opportunities", counts: "opportunities" },
  { table: "nurture_steps", counts: "nurture_steps" },
  { table: "custom_field_values", counts: "custom_fields" },
  { table: "dupe_candidates", counts: "dupe_candidates" },
];

/** sources add up rather than overwrite — a person from two sources is still one person. */
function moveAttributions(database: Database, workspaceId: string, to: string, from: string): number {
  const rows = database
    .prepare(`SELECT source_id, campaign_id, first_seen_at, last_seen_at, occurrences FROM lead_attributions WHERE lead_id = ?`)
    .all(from) as Array<{ source_id: string | null; campaign_id: string | null; first_seen_at: string; last_seen_at: string; occurrences: number }>;

  const existing = new Map<string, { occurrences: number; first_seen_at: string; last_seen_at: string }>();
  for (const r of database
    .prepare(`SELECT source_id, campaign_id, occurrences, first_seen_at, last_seen_at FROM lead_attributions WHERE lead_id = ?`)
    .all(to) as Array<{ source_id: string | null; campaign_id: string | null; occurrences: number; first_seen_at: string; last_seen_at: string }>) {
    existing.set(`${r.source_id}|${r.campaign_id}`, r);
  }

  for (const row of rows) {
    const key = `${row.source_id}|${row.campaign_id}`;
    const prior = existing.get(key);
    if (prior) {
      database
        .prepare(
          `UPDATE lead_attributions
           SET occurrences = ?, first_seen_at = ?, last_seen_at = ?
           WHERE lead_id = ? AND source_id IS ? AND campaign_id IS ?`,
        )
        .run(
          prior.occurrences + row.occurrences,
          row.first_seen_at < prior.first_seen_at ? row.first_seen_at : prior.first_seen_at,
          row.last_seen_at > prior.last_seen_at ? row.last_seen_at : prior.last_seen_at,
          to,
          row.source_id,
          row.campaign_id,
        );
      database.prepare(`DELETE FROM lead_attributions WHERE lead_id = ? AND source_id IS ? AND campaign_id IS ?`).run(from, row.source_id, row.campaign_id);
    } else {
      database
        .prepare(`UPDATE lead_attributions SET lead_id = ? WHERE lead_id = ? AND source_id IS ? AND campaign_id IS ?`)
        .run(to, from, row.source_id, row.campaign_id);
    }
  }

  void workspaceId;
  return rows.length;
}

/** the surviving record picks up any detail it was missing. */
const FILLERS: Array<{ column: string; preferIncoming: boolean }> = [
  { column: "email", preferIncoming: false },
  { column: "phone", preferIncoming: false },
  { column: "job_title", preferIncoming: false },
  { column: "linkedin_url", preferIncoming: false },
  { column: "x_url", preferIncoming: false },
  { column: "website", preferIncoming: false },
  { column: "location", preferIncoming: false },
  { column: "industry", preferIncoming: false },
  { column: "company_size", preferIncoming: false },
  { column: "company_id", preferIncoming: false },
  { column: "notes", preferIncoming: false },
];

export function mergeLeads(
  database: Database,
  workspaceId: string,
  primaryLeadId: string,
  secondaryLeadId: string,
  actorId?: string | null,
  reason?: string,
): MergeOutcome {
  if (primaryLeadId === secondaryLeadId) {
    return { ok: false, primaryLeadId, mergedLeadId: secondaryLeadId, moved: {}, filled: [], error: "cannot merge a lead into itself" };
  }

  const primary = database.prepare(`SELECT * FROM leads WHERE id = ? AND workspace_id = ?`).get(primaryLeadId, workspaceId) as Record<string, unknown> | undefined;
  const secondary = database.prepare(`SELECT * FROM leads WHERE id = ? AND workspace_id = ?`).get(secondaryLeadId, workspaceId) as Record<string, unknown> | undefined;

  if (!primary || !secondary) {
    return { ok: false, primaryLeadId, mergedLeadId: secondaryLeadId, moved: {}, filled: [], error: "lead not found" };
  }

  const moved: Record<string, number> = {};
  const filled: string[] = [];

  const run = database.transaction(() => {
    // 1. backfill anything the survivor was missing
    for (const { column, preferIncoming } of FILLERS) {
      const current = primary[column] as string | null;
      const incoming = secondary[column] as string | null;
      if (!current && incoming) {
        database.prepare(`UPDATE leads SET ${column} = ? WHERE id = ?`).run(incoming, primaryLeadId);
        filled.push(column);
      } else if (preferIncoming && incoming && current) {
        database.prepare(`UPDATE leads SET ${column} = ? WHERE id = ?`).run(incoming, primaryLeadId);
      }
    }
    // normalised columns follow their raw ones
    for (const raw of ["email", "phone", "linkedin_url", "x_url"]) {
      if (filled.includes(raw)) {
        const value = database.prepare(`SELECT ${raw} AS raw FROM leads WHERE id = ?`).get(primaryLeadId) as { raw: string | null };
        const norm =
          raw === "email" ? normalizeEmail(value.raw) : raw === "phone" ? normalizePhone(value.raw) : raw === "linkedin_url" ? normalizeLinkedin(value.raw) : normalizeX(value.raw);
        database.prepare(`UPDATE leads SET ${raw}_normalized = ? WHERE id = ?`).run(norm, primaryLeadId);
      }
    }

    // 2. keep the earliest creation date so "new vs old" stays honest
    const earliest = (primary.created_at as string) < (secondary.created_at as string) ? primary.created_at : secondary.created_at;
    database.prepare(`UPDATE leads SET created_at = ? WHERE id = ?`).run(earliest, primaryLeadId);

    // 3. move the children
    for (const { table, counts } of MOVES) {
      const result = database.prepare(`UPDATE ${table} SET lead_id = ? WHERE lead_id = ?`).run(primaryLeadId, secondaryLeadId);
      moved[counts] = result.changes;
    }

    // messages have a unique-ish thread; nothing to dedupe, but tasks can hold a dedupe key
    database.prepare(`UPDATE tasks SET dedupe_key = NULL WHERE lead_id = ? AND dedupe_key IS NOT NULL`).run(primaryLeadId);
    database.prepare(
      `DELETE FROM tasks WHERE lead_id = ? AND dedupe_key IN
       (SELECT dedupe_key FROM tasks WHERE lead_id = ? AND dedupe_key IS NOT NULL)`,
    ).run(primaryLeadId, secondaryLeadId);

    // 4. identifiers: take the unique ones, drop ones the survivor already owns
    database.prepare(
      `DELETE FROM lead_identifiers
       WHERE lead_id = ? AND value_norm IN (SELECT value_norm FROM lead_identifiers WHERE lead_id = ?)`,
    ).run(secondaryLeadId, primaryLeadId);
    database.prepare(`UPDATE lead_identifiers SET lead_id = ? WHERE lead_id = ?`).run(primaryLeadId, secondaryLeadId);

    // 5. custom fields: fill blanks only
    database.prepare(
      `UPDATE OR IGNORE custom_field_values SET value_text = (
         SELECT value_text FROM custom_field_values s
         WHERE s.lead_id = ? AND s.field_id = custom_field_values.field_id AND s.value_text IS NOT NULL AND s.value_text <> ''
       ) WHERE lead_id = ?`,
    ).run(secondaryLeadId, secondaryLeadId);
    database.prepare(
      `INSERT OR IGNORE INTO custom_field_values (id, workspace_id, lead_id, field_id, value_text, created_at, updated_at)
       SELECT id, workspace_id, ?, field_id, value_text, created_at, updated_at
       FROM custom_field_values WHERE lead_id = ?`,
    ).run(primaryLeadId, secondaryLeadId);
    database.prepare(`DELETE FROM custom_field_values WHERE lead_id = ?`).run(secondaryLeadId);

    // 6. source attributions add up
    moved.sources = moveAttributions(database, workspaceId, primaryLeadId, secondaryLeadId);

    // 7. links and merge history
    database.prepare(`UPDATE lead_links SET lead_id = ? WHERE lead_id = ?`).run(primaryLeadId, secondaryLeadId);
    database.prepare(`UPDATE lead_links SET related_lead_id = ? WHERE related_lead_id = ?`).run(primaryLeadId, secondaryLeadId);
    database.prepare(`DELETE FROM lead_links WHERE related_lead_id = lead_id`).run();

    // 8. nurture enrollments — one person can only sit in a sequence once
    database.prepare(
      `DELETE FROM nurture_enrollments WHERE lead_id = ? AND sequence_id IN
       (SELECT sequence_id FROM nurture_enrollments WHERE lead_id = ?)`,
    ).run(secondaryLeadId, primaryLeadId);
    database.prepare(`UPDATE nurture_enrollments SET lead_id = ? WHERE lead_id = ?`).run(primaryLeadId, secondaryLeadId);
    database.prepare(`DELETE FROM nurture_enrollments WHERE lead_id = ?`).run(secondaryLeadId);

    // 9. retry queue: never leave a job pointing at the retired row
    database.prepare(`UPDATE jobs SET status = 'skipped', last_error = 'lead merged', updated_at = ? WHERE payload_json LIKE ? AND status = 'pending'`).run(
      nowIso(),
      `%"leadId":"${secondaryLeadId}"%`,
    );

    // 10. refresh the survivor's counters and earliest activity
    database
      .prepare(
        `UPDATE leads SET
           outbound_count = (SELECT COUNT(*) FROM messages WHERE lead_id = ? AND direction = 'outbound'),
           reply_count    = (SELECT COUNT(*) FROM messages WHERE lead_id = ? AND direction = 'inbound'),
           meeting_count  = (SELECT COUNT(*) FROM meetings WHERE lead_id = ?),
           is_new = 0,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(primaryLeadId, primaryLeadId, primaryLeadId, nowIso(), primaryLeadId);

    database
      .prepare(
        `UPDATE leads SET
           last_activity_at = MAX(COALESCE(last_activity_at, ''), COALESCE((SELECT MAX(occurred_at) FROM activity_events WHERE lead_id = ?), '')),
           first_touched_at = MIN(COALESCE(first_touched_at, '9999'), COALESCE((SELECT MIN(occurred_at) FROM activity_events WHERE lead_id = ?), '9999')),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(primaryLeadId, primaryLeadId, nowIso(), primaryLeadId);

    // 11. retire the old row without deleting it
    database
      .prepare(
        `UPDATE leads SET merged_into_lead_id = ?, is_archived = 1, is_new = 0, updated_at = ? WHERE id = ?`,
      )
      .run(primaryLeadId, nowIso(), secondaryLeadId);

    database
      .prepare(
        `INSERT INTO lead_merges (id, workspace_id, primary_lead_id, merged_lead_id, snapshot_json, merged_by, reason, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        newMergeId(),
        workspaceId,
        primaryLeadId,
        secondaryLeadId,
        JSON.stringify({ lead: secondary, moved, filled }),
        actorId ?? null,
        reason ?? null,
        nowIso(),
      );
  });

  run();
  return { ok: true, primaryLeadId, mergedLeadId: secondaryLeadId, moved, filled };
}

export function mergeHistory(database: Database, workspaceId: string, leadId: string) {
  return database
    .prepare(
      `SELECT m.*, a.full_name AS merged_name, a.email AS merged_email, b.name AS actor_name
       FROM lead_merges m
       LEFT JOIN leads a ON a.id = m.merged_lead_id
       LEFT JOIN members b ON b.id = m.merged_by
       WHERE m.workspace_id = ? AND (m.primary_lead_id = ? OR m.merged_lead_id = ?)
       ORDER BY m.created_at DESC`,
    )
    .all(workspaceId, leadId, leadId);
}