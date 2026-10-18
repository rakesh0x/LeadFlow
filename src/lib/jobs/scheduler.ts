/**
 * the scheduler.
 *
 * recurring work is expressed as rows that re-enqueue themselves, so it keeps
 * running across restarts. the loop lives in the server process — nothing here
 * depends on a browser being open.
 */
import { db, openDb } from "../db/client";
import { nowIso } from "../db/time";
import { writeLog } from "../engine/events";
import { enqueue, requeueStalled, runOne } from "./queue";
import "./handlers";

const TICK_MS = 15_000;

/** makes sure each recurring job has a pending row. keyed, so calling it twice is harmless. */
export function ensureRecurringJobs(workspaceId: string, database = db()): void {
  const at = nowIso();
  const hourly = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  const plan: Array<{ kind: string; runAt: string; key: string; payload?: Record<string, unknown> }> = [
    { kind: "follow_up_sweep", runAt: hourly(1), key: `rec:follow_up_sweep:${at.slice(0, 13)}`, payload: { workspaceId, day: at.slice(0, 10) } },
    { kind: "reply_watchdog", runAt: hourly(2), key: `rec:reply_watchdog:${at.slice(0, 13)}`, payload: { workspaceId, day: at.slice(0, 10) } },
    { kind: "nurture_dispatch", runAt: hourly(3), key: `rec:nurture_dispatch:${at.slice(0, 13)}`, payload: { workspaceId } },
    { kind: "source_sweep", runAt: hourly(4), key: `rec:source_sweep:${at.slice(0, 13)}`, payload: { workspaceId } },
    { kind: "duplicate_scan", runAt: hourly(6), key: `rec:duplicate_scan:${at.slice(0, 13)}`, payload: { workspaceId } },
    { kind: "state_refresh", runAt: hourly(8), key: `rec:state_refresh:${at.slice(0, 13)}`, payload: { workspaceId } },
    {
      kind: "daily_digest",
      runAt: new Date(new Date().setUTCHours(7, 0, 0, 0)).toISOString(),
      key: `rec:daily_digest:${at.slice(0, 10)}`,
      payload: { workspaceId },
    },
    {
      kind: "analytics_rollup",
      runAt: new Date(new Date().setUTCHours(8, 0, 0, 0)).toISOString(),
      key: `rec:analytics_rollup:${at.slice(0, 10)}`,
      payload: { workspaceId },
    },
  ];

  for (const job of plan) {
    enqueue({ workspaceId, kind: job.kind, runAt: job.runAt, payload: job.payload, idempotencyKey: job.key, priority: 5 }, database);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __leadflow_worker: NodeJS.Timeout | undefined;
}

/** starts the worker loop. safe to call more than once. */
export function startWorker(): void {
  if (globalThis.__leadflow_worker) return;
  if (process.env.LEADFLOW_NO_WORKER === "1") return;

  const database = openDb();
  const workerId = `worker_${process.pid}`;
  let ticks = 0;

  const tick = async () => {
    try {
      if (ticks % 20 === 0) requeueStalled(300, database);
      for (let i = 0; i < 10; i++) {
        const ran = await runOne(workerId, undefined, database);
        if (!ran) break;
      }
    } catch (error) {
      writeLog(database, {
        kind: "worker",
        message: `worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      ticks++;
    }
  };

  // run one immediately so a freshly seeded workspace is not waiting a whole tick
  void tick();
  globalThis.__leadflow_worker = setInterval(tick, TICK_MS);
  globalThis.__leadflow_worker.unref?.();
}

export function stopWorker(): void {
  if (globalThis.__leadflow_worker) {
    clearInterval(globalThis.__leadflow_worker);
    globalThis.__leadflow_worker = undefined;
  }
}