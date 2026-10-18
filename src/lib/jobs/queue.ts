/**
 * the job queue.
 *
 * reminders, nurture steps, imports and digests all run here. jobs are rows, not
 * in-memory timers, so they survive a restart. every job carries an idempotency key,
 * and a job that fails is retried with backoff until it runs out of attempts.
 */
import type { Database } from "better-sqlite3";
import { db, openDb } from "../db/client";
import { newJobId } from "../db/ids";
import { nowIso, toIso } from "../db/time";
import { writeLog } from "../engine/events";

export interface EnqueueInput {
  workspaceId: string;
  kind: string;
  payload?: Record<string, unknown>;
  runAt?: string | Date;
  priority?: number;
  maxAttempts?: number;
  /** repeat runs of the same logical job collapse into one row. */
  idempotencyKey?: string | null;
}

export function enqueue(input: EnqueueInput, database = db()): string | null {
  const runAt = toIso(input.runAt) ?? nowIso();
  const id = newJobId();

  if (input.idempotencyKey) {
    // a finished job does not need re-running for the same key
    const done = database
      .prepare(`SELECT id FROM jobs WHERE workspace_id = ? AND idempotency_key = ? AND status IN ('succeeded','running')`)
      .get(input.workspaceId, input.idempotencyKey) as { id: string } | undefined;
    if (done) return done.id;

    const pending = database
      .prepare(`SELECT id FROM jobs WHERE workspace_id = ? AND idempotency_key = ? AND status = 'pending'`)
      .get(input.workspaceId, input.idempotencyKey) as { id: string } | undefined;
    if (pending) {
      // bring the pending run forward if we are asking for a sooner slot
      database.prepare(`UPDATE jobs SET run_at = MIN(run_at, ?), priority = MIN(priority, ?), payload_json = ?, updated_at = ? WHERE id = ?`).run(
        runAt,
        input.priority ?? 5,
        JSON.stringify(input.payload ?? {}),
        nowIso(),
        pending.id,
      );
      return pending.id;
    }
  }

  const now = nowIso();
  database
    .prepare(
      `INSERT INTO jobs (id, workspace_id, kind, payload_json, status, priority, run_at, max_attempts, idempotency_key, created_at, updated_at)
       VALUES (?,?,?,?, 'pending', ?,?,?,?,?,?)`,
    )
    .run(id, input.workspaceId, input.kind, JSON.stringify(input.payload ?? {}), input.priority ?? 5, runAt, input.maxAttempts ?? 5, input.idempotencyKey ?? null, now, now);

  return id;
}

/** backoff grows with the attempt number, capped so nothing waits hours. */
export function backoffMs(attempt: number): number {
  const base = Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);
  const jitter = Math.floor(base * 0.2 * Math.random());
  return base + jitter;
}

export interface ClaimedJob {
  id: string;
  workspace_id: string;
  kind: string;
  payload_json: string;
  attempts: number;
  max_attempts: number;
}

function claim(database: Database, workerId: string, kinds?: string[]): ClaimedJob | null {
  const kindClause = kinds?.length ? `AND kind IN (${kinds.map(() => "?").join(",")})` : "";
  const now = nowIso();

  const run = database.transaction((): ClaimedJob | null => {
    const job = database
      .prepare(
        `SELECT id, workspace_id, kind, payload_json, attempts, max_attempts
         FROM jobs
         WHERE status = 'pending' AND run_at <= ? ${kindClause}
         ORDER BY priority ASC, run_at ASC LIMIT 1`,
      )
      .get(now, ...(kinds ?? [])) as ClaimedJob | undefined;
    if (!job) return null;

    const updated = database
      .prepare(`UPDATE jobs SET status = 'running', locked_by = ?, locked_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'`)
      .run(workerId, now, now, job.id);
    if (!updated.changes) return null;

    return { ...job, attempts: job.attempts + 1 };
  });
  return run();
}

export interface JobHandlerResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  retryable?: boolean;
  /** set when there was genuinely nothing to do — not a failure. */
  skipped?: boolean;
}

export type JobHandler = (job: ClaimedJob & { payload: Record<string, unknown> }, database: Database) => Promise<JobHandlerResult> | JobHandlerResult;

const handlers = new Map<string, JobHandler>();

export function registerHandler(kind: string, handler: JobHandler): void {
  handlers.set(kind, handler);
}

export function registeredKinds(): string[] {
  return [...handlers.keys()];
}

function finish(database: Database, job: ClaimedJob, outcome: JobHandlerResult): void {
  const now = nowIso();
  const attempt = job.attempts;

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO job_runs (id, job_id, workspace_id, attempt, status, error, created_at) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(newJobId(), job.id, job.workspace_id, attempt, outcome.ok ? "ok" : "error", outcome.error ?? null, now);

    if (outcome.ok || outcome.skipped) {
      database
        .prepare(`UPDATE jobs SET status = ?, result_json = ?, last_error = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?`)
        .run(outcome.skipped ? "skipped" : "succeeded", JSON.stringify(outcome.result ?? {}), null, now, job.id);
      return;
    }

    const retryable = outcome.retryable !== false;
    if (retryable && attempt < job.max_attempts) {
      database
        .prepare(`UPDATE jobs SET status = 'pending', run_at = ?, last_error = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?`)
        .run(new Date(Date.now() + backoffMs(attempt)).toISOString(), outcome.error ?? "unknown error", now, job.id);
    } else {
      database
        .prepare(`UPDATE jobs SET status = 'failed', last_error = ?, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?`)
        .run(outcome.error ?? "gave up", now, job.id);
      writeLog(database, {
        workspaceId: job.workspace_id,
        kind: "job",
        message: `job ${job.kind} failed after ${attempt} attempts`,
        detail: { jobId: job.id, error: outcome.error },
      });
    }
  });
  run();
}

/** runs one job if one is due. safe to call from many places. */
export async function runOne(workerId: string, kinds?: string[], database = db()): Promise<boolean> {
  const job = claim(database, workerId, kinds);
  if (!job) return false;

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(job.payload_json) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const handler = handlers.get(job.kind);
  if (!handler) {
    finish(database, job, { ok: false, error: `no handler registered for "${job.kind}"`, retryable: false });
    return true;
  }

  try {
    const outcome = await handler({ ...job, payload }, database);
    finish(database, job, outcome);
  } catch (error) {
    finish(database, job, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}

export function runDue(limit = 20, kinds?: string[]): Promise<number> {
  const database = openDb();
  const workerId = `worker_${process.pid}_${Date.now().toString(36)}`;
  let ran = 0;
  return (async () => {
    for (let i = 0; i < limit; i++) {
      const did = await runOne(workerId, kinds, database);
      if (!did) break;
      ran++;
    }
    return ran;
  })();
}

/** jobs whose worker died mid-run go back in the queue. */
export function requeueStalled(olderThanSeconds = 300, database = db()): number {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
  const result = database
    .prepare(`UPDATE jobs SET status = 'pending', locked_by = NULL, locked_at = NULL, updated_at = ? WHERE status = 'running' AND locked_at < ?`)
    .run(nowIso(), cutoff);
  return result.changes;
}

export interface JobSummary {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
  oldestPendingMinutes: number;
}

export function jobSummary(workspaceId: string, database = db()): JobSummary {
  const row = database
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
         SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
         MIN(CASE WHEN status = 'pending' THEN run_at END) AS oldest
       FROM jobs WHERE workspace_id = ?`,
    )
    .get(workspaceId) as { pending: number | null; running: number | null; succeeded: number | null; failed: number | null; skipped: number | null; oldest: string | null };

  return {
    pending: row.pending ?? 0,
    running: row.running ?? 0,
    succeeded: row.succeeded ?? 0,
    failed: row.failed ?? 0,
    skipped: row.skipped ?? 0,
    oldestPendingMinutes: row.oldest ? Math.round((Date.now() - new Date(row.oldest).getTime()) / 60_000) : 0,
  };
}

export function listJobs(workspaceId: string, limit = 40, database = db()) {
  return database
    .prepare(`SELECT * FROM jobs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(workspaceId, limit) as Array<{
    id: string;
    kind: string;
    status: string;
    run_at: string;
    attempts: number;
    max_attempts: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
    idempotency_key: string | null;
    result_json: string | null;
  }>;
}

export function retryJob(database: Database, workspaceId: string, jobId: string): boolean {
  return database
    .prepare(`UPDATE jobs SET status = 'pending', attempts = 0, last_error = NULL, run_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND status IN ('failed','cancelled')`)
    .run(nowIso(), nowIso(), jobId, workspaceId).changes > 0;
}

export function cancelJob(database: Database, workspaceId: string, jobId: string): boolean {
  return database
    .prepare(`UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'pending'`)
    .run(nowIso(), jobId, workspaceId).changes > 0;
}