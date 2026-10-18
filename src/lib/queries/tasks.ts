/** tasks and follow-ups. every reminder in the app comes from a real row here. */
import type { Database } from "better-sqlite3";
import { db } from "../db/client";
import { newTaskId } from "../db/ids";
import { nowIso, toIso } from "../db/time";
import type { Priority, TaskStatus, TaskType } from "../domain";
import type { Task, TaskView } from "../types";
import { recordEvent } from "../engine/events";
import { recomputeLeadStates } from "../engine/states";

export interface CreateTaskInput {
  workspaceId: string;
  leadId?: string | null;
  campaignId?: string | null;
  meetingId?: string | null;
  title: string;
  description?: string | null;
  type?: TaskType;
  priority?: Priority;
  dueAt?: string | null;
  ownerId?: string | null;
  origin?: Task["origin"];
  /** a repeated job must not create the same task twice. */
  dedupeKey?: string | null;
}

export function createTask(input: CreateTaskInput, opts: { actorId?: string | null; database?: Database } = {}): string | null {
  const database = opts.database ?? db();
  const id = newTaskId();
  const now = nowIso();

  if (input.dedupeKey) {
    const existing = database
      .prepare(`SELECT id FROM tasks WHERE workspace_id = ? AND dedupe_key = ?`)
      .get(input.workspaceId, input.dedupeKey) as { id: string } | undefined;
    if (existing) return existing.id;
  }

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO tasks (id, workspace_id, lead_id, campaign_id, meeting_id, owner_id, title, description,
          type, priority, status, due_at, created_by, origin, dedupe_key, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'open', ?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.leadId ?? null,
        input.campaignId ?? null,
        input.meetingId ?? null,
        input.ownerId ?? null,
        input.title,
        input.description ?? null,
        input.type ?? "follow_up",
        input.priority ?? "medium",
        toIso(input.dueAt),
        opts.actorId ?? null,
        input.origin ?? "manual",
        input.dedupeKey ?? null,
        now,
        now,
      );

    if (input.leadId) {
      recordEvent(database, {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        actorId: opts.actorId ?? null,
        campaignId: input.campaignId ?? null,
        type: "task_created",
        title: "task added",
        summary: input.title,
        payload: { taskId: id, type: input.type ?? "follow_up", dueAt: toIso(input.dueAt) },
        dedupeKey: input.dedupeKey ? `task:${input.dedupeKey}` : null,
      });
      database
        .prepare(`UPDATE leads SET first_touched_at = COALESCE(first_touched_at, ?), is_new = 0, updated_at = ? WHERE id = ?`)
        .run(now, now, input.leadId);
    }
  });
  run();

  // a new task can flip the lead to "follow-up due", so states are refreshed here too
  if (input.leadId) recomputeLeadStates(database, input.leadId);
  return id;
}

export function completeTask(
  database: Database,
  workspaceId: string,
  taskId: string,
  actorId?: string | null,
): boolean {
  const task = database.prepare(`SELECT * FROM tasks WHERE id = ? AND workspace_id = ?`).get(taskId, workspaceId) as TaskView | undefined;
  if (!task || task.status === "completed") return false;
  const now = nowIso();

  const run = database.transaction(() => {
    database
      .prepare(`UPDATE tasks SET status = 'completed', completed_at = ?, completed_by = ?, updated_at = ? WHERE id = ?`)
      .run(now, actorId ?? null, now, taskId);

    if (task.lead_id) {
      recordEvent(database, {
        workspaceId,
        leadId: task.lead_id,
        actorId,
        type: "task_completed",
        title: "task done",
        summary: task.title,
        payload: { taskId, type: task.type },
        dedupeKey: `taskdone:${taskId}`,
      });
      // finishing the work means we have touched this person
      database
        .prepare(`UPDATE leads SET first_touched_at = COALESCE(first_touched_at, ?), is_new = 0, updated_at = ? WHERE id = ?`)
        .run(now, now, task.lead_id);
    }
  });
  run();

  if (task.lead_id) recomputeLeadStates(database, task.lead_id);
  return true;
}

export function reopenTask(database: Database, workspaceId: string, taskId: string, actorId?: string | null): boolean {
  const result = database
    .prepare(`UPDATE tasks SET status = 'open', completed_at = NULL, completed_by = NULL, updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'completed'`)
    .run(nowIso(), taskId, workspaceId);
  const task = database.prepare(`SELECT lead_id, title FROM tasks WHERE id = ?`).get(taskId) as { lead_id: string | null; title: string } | undefined;
  if (result.changes && task?.lead_id) {
    recordEvent(database, {
      workspaceId,
      leadId: task.lead_id,
      actorId,
      type: "lead_updated",
      title: "task reopened",
      summary: task.title,
    });
    recomputeLeadStates(database, task.lead_id);
  }
  return result.changes > 0;
}

export function updateTask(
  database: Database,
  workspaceId: string,
  taskId: string,
  patch: Partial<{ title: string; description: string | null; type: TaskType; priority: Priority; status: TaskStatus; due_at: string | null; owner_id: string | null; lead_id: string | null }>,
  actorId?: string | null,
): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (patch.status === "completed") {
    sets.push("completed_at = ?", "completed_by = ?");
    params.push(nowIso(), actorId ?? null);
  }
  if (patch.status === "in_progress") {
    sets.push("started_at = COALESCE(started_at, ?)");
    params.push(nowIso());
  }
  if (!sets.length) return false;
  sets.push("updated_at = ?");
  params.push(nowIso(), taskId, workspaceId);

  const ok = database.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ?`).run(...params).changes > 0;
  if (ok) {
    const task = database.prepare(`SELECT lead_id FROM tasks WHERE id = ?`).get(taskId) as { lead_id: string | null } | undefined;
    if (task?.lead_id) recomputeLeadStates(database, task.lead_id);
  }
  return ok;
}

export function deleteTask(database: Database, workspaceId: string, taskId: string): boolean {
  return database.prepare(`DELETE FROM tasks WHERE id = ? AND workspace_id = ?`).run(taskId, workspaceId).changes > 0;
}

export type TaskBucket = "today" | "overdue" | "upcoming" | "completed" | "all";

export interface TaskQuery {
  bucket?: TaskBucket;
  ownerId?: string;
  leadId?: string;
  campaignId?: string;
  type?: TaskType | "all";
  q?: string;
  limit?: number;
  offset?: number;
}

const TASK_SELECT = `
  SELECT t.*, l.full_name AS lead_name, l.email AS lead_email, l.pipeline_stage AS lead_stage,
         m.name AS owner_name, m.avatar_hue AS owner_hue, c.name AS company_name
  FROM tasks t
  LEFT JOIN leads l ON l.id = t.lead_id
  LEFT JOIN companies c ON c.id = l.company_id
  LEFT JOIN members m ON m.id = t.owner_id
`;

export function queryTasks(workspaceId: string, query: TaskQuery = {}, database = db()): { rows: TaskView[]; total: number } {
  const where: string[] = ["t.workspace_id = @ws"];
  const params: Record<string, unknown> = { ws: workspaceId, now: nowIso(), todayEnd: endOfTodayIso() };

  switch (query.bucket) {
    case "today":
      where.push(`t.status IN ('open','in_progress') AND t.due_at IS NOT NULL AND t.due_at <= @todayEnd`);
      break;
    case "overdue":
      where.push(`t.status IN ('open','in_progress') AND t.due_at IS NOT NULL AND t.due_at < @now`);
      break;
    case "upcoming":
      where.push(`t.status IN ('open','in_progress') AND (t.due_at IS NULL OR t.due_at > @todayEnd)`);
      break;
    case "completed":
      where.push(`t.status IN ('completed','cancelled')`);
      break;
    default:
      where.push(`t.status IN ('open','in_progress')`);
  }

  if (query.ownerId) {
    where.push(`t.owner_id = @ownerId`);
    params.ownerId = query.ownerId;
  }
  if (query.leadId) {
    where.push(`t.lead_id = @leadId`);
    params.leadId = query.leadId;
  }
  if (query.campaignId) {
    where.push(`t.campaign_id = @campaignId`);
    params.campaignId = query.campaignId;
  }
  if (query.type && query.type !== "all") {
    where.push(`t.type = @type`);
    params.type = query.type;
  }
  if (query.q) {
    where.push(`(t.title LIKE @q OR t.description LIKE @q OR l.full_name LIKE @q)`);
    params.q = `%${query.q}%`;
  }

  const whereSql = where.join(" AND ");
  const total = (
    database.prepare(`SELECT COUNT(*) AS n FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id WHERE ${whereSql}`).get(params) as { n: number }
  ).n;
  const rows = database
    .prepare(`${TASK_SELECT} WHERE ${whereSql} ORDER BY
        CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,
        t.due_at ASC,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
      LIMIT ${Math.min(query.limit ?? 100, 300)} OFFSET ${query.offset ?? 0}`)
    .all(params) as TaskView[];

  return { rows, total };
}

function endOfTodayIso(): string {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

export interface TaskCounts {
  today: number;
  overdue: number;
  upcoming: number;
  completed: number;
  all: number;
}

export function taskCounts(workspaceId: string, ownerId?: string, database = db()): TaskCounts {
  const ownerClause = ownerId ? `AND owner_id = '${ownerId.replace(/'/g, "")}'` : "";
  const row = database
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at <= :end THEN 1 ELSE 0 END) AS today,
         SUM(CASE WHEN status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < :now THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN status IN ('open','in_progress') AND (due_at IS NULL OR due_at > :end) THEN 1 ELSE 0 END) AS upcoming,
         SUM(CASE WHEN status IN ('completed','cancelled') THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open_count
       FROM tasks WHERE workspace_id = :ws ${ownerClause}`,
    )
    .get({ ws: workspaceId, now: nowIso(), end: endOfTodayIso() }) as Record<string, number | null>;

  const today = row.today ?? 0;
  const overdue = row.overdue ?? 0;
  return {
    today,
    overdue,
    upcoming: row.upcoming ?? 0,
    completed: row.completed ?? 0,
    all: (row.open_count ?? 0) + (row.completed ?? 0),
  };
}

/** the next thing to do on a lead, so "keep going" is one click. */
export function nextTaskForLead(database: Database, leadId: string): TaskView | null {
  return (
    (database
      .prepare(
        `${TASK_SELECT} WHERE t.lead_id = ? AND t.status IN ('open','in_progress')
         ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC, t.created_at ASC LIMIT 1`,
      )
      .get(leadId) as TaskView) ?? null
  );
}