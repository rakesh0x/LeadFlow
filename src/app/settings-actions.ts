"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { newFieldId, newMemberId, newRuleId } from "@/lib/db/ids";
import { nowIso } from "@/lib/db/time";
import { requireWorkspaceId } from "@/lib/workspace";

type Result = { ok: boolean; message?: string; error?: string; id?: string };

function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

// ---------------------------------------------------------------- team

export async function createMemberAction(input: {
  name: string;
  email: string;
  role?: string;
  title?: string | null;
}): Promise<Result> {
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() ?? "";
  if (!name) return { ok: false, error: "they need a name" };
  if (!email || !email.includes("@")) return { ok: false, error: "that email does not look right" };

  const database = db();
  const workspaceId = requireWorkspaceId(database);

  const existing = database
    .prepare(`SELECT name FROM members WHERE workspace_id = ? AND email = ?`)
    .get(workspaceId, email) as { name: string } | undefined;
  if (existing) return { ok: false, error: `${existing.name} is already in the workspace` };

  const id = newMemberId();
  const role = input.role === "admin" || input.role === "owner" ? input.role : "member";
  const now = nowIso();
  database
    .prepare(
      `INSERT INTO members (id, workspace_id, name, email, role, title, avatar_hue, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,1,?,?)`,
    )
    .run(id, workspaceId, name, email, role, input.title?.trim() || null, hueFor(email), now, now);

  revalidatePath("/settings");
  return { ok: true, id, message: `${name} is in. they can pick up work now.` };
}

export async function setMemberActiveAction(memberId: string, active: boolean): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  database
    .prepare(`UPDATE members SET is_active = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(active ? 1 : 0, nowIso(), memberId, workspaceId);
  revalidatePath("/settings");
  return { ok: true, message: active ? "back in the workspace" : "paused. they keep their history" };
}

// ---------------------------------------------------------------- custom fields

export async function addCustomFieldAction(input: {
  label: string;
  entity?: string;
  field_type?: string;
  options?: string[];
}): Promise<Result> {
  const label = input.label?.trim() ?? "";
  if (!label) return { ok: false, error: "the field needs a name" };

  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const entity = input.entity === "company" ? "company" : "lead";
  const allowed = ["text", "long_text", "number", "date", "select", "multi_select", "boolean", "url", "email"];
  const fieldType = allowed.includes(input.field_type ?? "") ? (input.field_type as string) : "text";
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `field_${Date.now()}`;

  const clash = database
    .prepare(`SELECT 1 FROM custom_fields WHERE workspace_id = ? AND entity = ? AND key = ?`)
    .get(workspaceId, entity, key);
  if (clash) return { ok: false, error: "there is already a field with that name" };

  const id = newFieldId();
  const nextOrder = (
    database.prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM custom_fields WHERE workspace_id = ? AND entity = ?`).get(workspaceId, entity) as {
      n: number;
    }
  ).n;

  database
    .prepare(
      `INSERT INTO custom_fields (id, workspace_id, entity, key, label, field_type, options_json, is_required, sort_order, created_at)
       VALUES (?,?,?,?,?,?,?,0,?,?)`,
    )
    .run(id, workspaceId, entity, key, label, fieldType, JSON.stringify(input.options ?? []), nextOrder, nowIso());

  revalidatePath("/settings");
  return { ok: true, id, message: "field added. it will show up on every new lead." };
}

export async function deleteCustomFieldAction(fieldId: string): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  database.prepare(`DELETE FROM custom_fields WHERE id = ? AND workspace_id = ?`).run(fieldId, workspaceId);
  revalidatePath("/settings");
  return { ok: true, message: "field removed" };
}

// ---------------------------------------------------------------- automation rules

const TRIGGERS = [
  "lead_created",
  "reply_received",
  "no_reply",
  "stage_changed",
  "meeting_booked",
  "task_overdue",
  "nurture_step_sent",
];

export async function addRuleAction(input: { name: string; trigger_type?: string; description?: string | null }): Promise<Result> {
  const name = input.name?.trim() ?? "";
  if (!name) return { ok: false, error: "the rule needs a name" };

  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const trigger = TRIGGERS.includes(input.trigger_type ?? "") ? (input.trigger_type as string) : "lead_created";
  const id = newRuleId();
  const now = nowIso();

  database
    .prepare(
      `INSERT INTO automation_rules (id, workspace_id, name, description, trigger_type, is_enabled, conditions_json, actions_json, run_count, created_at, updated_at)
       VALUES (?,?,?,?,?,0,'{}','[]',0,?,?)`,
    )
    .run(id, workspaceId, name, input.description?.trim() || null, trigger, now, now);

  revalidatePath("/settings");
  return { ok: true, id, message: "rule added, turned off. switch it on when you are ready." };
}

export async function deleteRuleAction(ruleId: string): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  database.prepare(`DELETE FROM automation_rules WHERE id = ? AND workspace_id = ?`).run(ruleId, workspaceId);
  revalidatePath("/settings");
  return { ok: true, message: "rule removed" };
}

// ---------------------------------------------------------------- sources

export async function reconnectSourceAction(sourceId: string): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const now = nowIso();
  database
    .prepare(`UPDATE lead_sources SET status = 'connected', last_sync_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(now, now, sourceId, workspaceId);
  revalidatePath("/settings");
  revalidatePath("/sources");
  return { ok: true, message: "connected again. it will sync on its normal schedule." };
}

export async function setSourceCadenceAction(sourceId: string, hours: number): Promise<Result> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const value = [1, 6, 12, 24, 72, 168].includes(hours) ? hours : 24;
  database
    .prepare(`UPDATE lead_sources SET sync_cadence_hours = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(value, nowIso(), sourceId, workspaceId);
  revalidatePath("/settings");
  return { ok: true, message: `checking every ${cadenceLabel(value)}` };
}

function cadenceLabel(hours: number): string {
  if (hours === 1) return "hour";
  if (hours === 24) return "day";
  if (hours === 72) return "three days";
  if (hours === 168) return "week";
  return `${hours} hours`;
}
