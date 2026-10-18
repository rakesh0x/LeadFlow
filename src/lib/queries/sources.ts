/** lead sources: connected platforms, imports, forms and attribution. */
import type { Database } from "better-sqlite3";
import { db } from "../db/client";
import { newFormId, newImportId, newSourceId } from "../db/ids";
import { nowIso } from "../db/time";
import type { SourceKind } from "../domain";
import { slugify } from "../engine/normalize";
import { recordEvent, writeLog } from "../engine/events";
import type { CaptureForm, LeadImport, LeadSource } from "../types";

export function listSources(workspaceId: string, database = db()): Array<LeadSource & { lead_count: number; converted_count: number }> {
  return database
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM leads l WHERE l.source_id = s.id AND l.merged_into_lead_id IS NULL) AS lead_count,
              (SELECT COUNT(*) FROM leads l WHERE l.source_id = s.id AND l.pipeline_stage = 'converted') AS converted_count
       FROM lead_sources s WHERE s.workspace_id = ? ORDER BY s.kind, s.name`,
    )
    .all(workspaceId) as Array<LeadSource & { lead_count: number; converted_count: number }>;
}

export function getSource(workspaceId: string, sourceId: string, database = db()): LeadSource | null {
  return (
    (database.prepare(`SELECT * FROM lead_sources WHERE id = ? AND workspace_id = ?`).get(sourceId, workspaceId) as LeadSource) ?? null
  );
}

export function createSource(
  workspaceId: string,
  input: { name: string; kind: SourceKind; notes?: string | null; status?: LeadSource["status"]; config?: Record<string, unknown>; sync_cadence_hours?: number },
  database = db(),
): string {
  const id = newSourceId();
  const base = slugify(input.name);
  let slug = base;
  let n = 2;
  while (database.prepare(`SELECT 1 FROM lead_sources WHERE workspace_id = ? AND slug = ?`).get(workspaceId, slug)) {
    slug = `${base}-${n++}`;
  }
  const now = nowIso();
  database
    .prepare(
      `INSERT INTO lead_sources (id, workspace_id, name, slug, kind, status, config_json, notes, sync_cadence_hours, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      workspaceId,
      input.name,
      slug,
      input.kind,
      input.status ?? "connected",
      JSON.stringify(input.config ?? {}),
      input.notes ?? null,
      input.sync_cadence_hours ?? 24,
      now,
      now,
    );
  writeLog(database, { workspaceId, kind: "source", message: `connected source "${input.name}"`, detail: { kind: input.kind } });
  return id;
}

export function updateSource(workspaceId: string, sourceId: string, patch: Partial<LeadSource> & { config?: Record<string, unknown> }, database = db()): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];
  const fields: Array<keyof LeadSource> = ["name", "status", "notes", "is_active", "sync_cadence_hours", "last_sync_at"];
  for (const f of fields) {
    if (patch[f] === undefined) continue;
    sets.push(`${f} = ?`);
    params.push(patch[f]);
  }
  if (patch.config) {
    sets.push("config_json = ?");
    params.push(JSON.stringify(patch.config));
  }
  if (!sets.length) return false;
  sets.push("updated_at = ?");
  params.push(nowIso(), sourceId, workspaceId);
  return database.prepare(`UPDATE lead_sources SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ?`).run(...params).changes > 0;
}

export function sourcePerformance(workspaceId: string, database = db()) {
  return database
    .prepare(
      `SELECT s.id, s.name, s.kind, s.status, s.last_sync_at,
              COUNT(l.id)                                                   AS total,
              SUM(CASE WHEN l.pipeline_stage NOT IN ('new') THEN 1 ELSE 0 END) AS touched,
              SUM(CASE WHEN l.pipeline_stage IN ('qualified','engaged','meeting_booked','opportunity','converted') THEN 1 ELSE 0 END) AS qualified,
              SUM(CASE WHEN l.pipeline_stage = 'converted' THEN 1 ELSE 0 END) AS converted,
              SUM(CASE WHEN l.reply_count > 0 THEN 1 ELSE 0 END)             AS replied
       FROM lead_sources s
       LEFT JOIN leads l ON (l.source_id = s.id OR EXISTS (SELECT 1 FROM lead_attributions la WHERE la.lead_id = l.id AND la.source_id = s.id))
                         AND l.merged_into_lead_id IS NULL AND l.is_archived = 0
       WHERE s.workspace_id = ?
       GROUP BY s.id ORDER BY total DESC`,
    )
    .all(workspaceId) as Array<{
    id: string;
    name: string;
    kind: string;
    status: string;
    last_sync_at: string | null;
    total: number;
    touched: number;
    qualified: number;
    converted: number;
    replied: number;
  }>;
}

/** records that a lead also turned up through another source. keeps every source credited. */
export function linkAttribution(
  database: Database,
  workspaceId: string,
  leadId: string,
  sourceId: string | null,
  campaignId: string | null,
  at = nowIso(),
): void {
  if (!sourceId && !campaignId) return;
  database
    .prepare(
      `INSERT INTO lead_attributions (id, workspace_id, lead_id, source_id, campaign_id, is_primary, first_seen_at, last_seen_at, occurrences)
       VALUES (?,?,?,?,?,?,?,?,1)
       ON CONFLICT(lead_id, source_id, campaign_id) DO UPDATE SET
         occurrences = occurrences + 1,
         last_seen_at = excluded.last_seen_at`,
    )
    .run(
      `attr_${leadId}_${sourceId ?? "none"}_${campaignId ?? "none"}`,
      workspaceId,
      leadId,
      sourceId,
      campaignId,
      sourceId ? 1 : 0,
      at,
      at,
    );
}

// ---------------------------------------------------------------- forms

export function listForms(workspaceId: string, database = db()): Array<CaptureForm & { source_name: string | null; campaign_name: string | null }> {
  return database
    .prepare(
      `SELECT f.*, s.name AS source_name, c.name AS campaign_name
       FROM capture_forms f LEFT JOIN lead_sources s ON s.id = f.source_id LEFT JOIN campaigns c ON c.id = f.campaign_id
       WHERE f.workspace_id = ? ORDER BY f.created_at DESC`,
    )
    .all(workspaceId) as Array<CaptureForm & { source_name: string | null; campaign_name: string | null }>;
}

export function getForm(workspaceId: string, slug: string, database = db()): CaptureForm | null {
  return (
    (database.prepare(`SELECT * FROM capture_forms WHERE workspace_id = ? AND slug = ?`).get(workspaceId, slug) as CaptureForm) ?? null
  );
}

export function createForm(
  workspaceId: string,
  input: { name: string; source_id?: string | null; campaign_id?: string | null; fields?: Array<{ key: string; label: string; required?: boolean }> },
  database = db(),
): string {
  const id = newFormId();
  let slug = slugify(input.name);
  let n = 2;
  while (database.prepare(`SELECT 1 FROM capture_forms WHERE workspace_id = ? AND slug = ?`).get(workspaceId, slug)) {
    slug = `${slugify(input.name)}-${n++}`;
  }
  const now = nowIso();
  const fields = input.fields?.length
    ? input.fields
    : [
        { key: "full_name", label: "your name", required: true },
        { key: "email", label: "your email", required: true },
        { key: "company_name", label: "your company", required: false },
      ];
  database
    .prepare(
      `INSERT INTO capture_forms (id, workspace_id, name, slug, source_id, campaign_id, fields_json, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?, 'live', ?,?)`,
    )
    .run(id, workspaceId, input.name, slug, input.source_id ?? null, input.campaign_id ?? null, JSON.stringify(fields), now, now);
  return id;
}

export function bumpFormSubmit(database: Database, formId: string): void {
  database.prepare(`UPDATE capture_forms SET submit_count = submit_count + 1, updated_at = ? WHERE id = ?`).run(nowIso(), formId);
}

// ---------------------------------------------------------------- imports

export function listImports(workspaceId: string, database = db()): Array<LeadImport & { source_name: string | null }> {
  return database
    .prepare(
      `SELECT i.*, s.name AS source_name FROM lead_imports i
       LEFT JOIN lead_sources s ON s.id = i.source_id
       WHERE i.workspace_id = ? ORDER BY i.created_at DESC LIMIT 50`,
    )
    .all(workspaceId) as Array<LeadImport & { source_name: string | null }>;
}

export function createImport(
  workspaceId: string,
  input: { name: string; source_id?: string | null; file_name?: string | null; mapping?: Record<string, string>; created_by?: string | null },
  database = db(),
): string {
  const id = newImportId();
  const now = nowIso();
  database
    .prepare(
      `INSERT INTO lead_imports (id, workspace_id, source_id, name, file_name, status, mapping_json, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?, 'pending', ?,?,?,?)`,
    )
    .run(id, workspaceId, input.source_id ?? null, input.name, input.file_name ?? null, JSON.stringify(input.mapping ?? {}), input.created_by ?? null, now, now);
  return id;
}

export function logImportEvent(workspaceId: string, importId: string, message: string, database = db()): void {
  writeLog(database, { workspaceId, kind: "import", message, detail: { importId } });
}