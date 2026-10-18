/**
 * drains the job queue from the command line.
 * useful for seeing what the background worker did without waiting for a tick.
 *
 *   npm run jobs:run                 # run everything that is due
 *   npm run jobs:run -- --follow_up_sweep --follow_up_sweep
 */
import { openDb } from "../src/lib/db/client";
import { nowIso } from "../src/lib/db/time";
import { backoffMs, enqueue, requeueStalled, runOne } from "../src/lib/jobs/queue";
import { ensureRecurringJobs } from "../src/lib/jobs/scheduler";
import { registeredKinds } from "../src/lib/jobs/queue";
import "../src/lib/jobs/handlers";

async function main() {
  const database = openDb();
  const workspace = database.prepare(`SELECT id, name FROM workspaces LIMIT 1`).get() as { id: string; name: string } | undefined;
  if (!workspace) {
    console.log("no workspace. run `npm run db:seed` first.");
    return;
  }

  const kinds = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const workerId = `cli_${process.pid}`;

  requeueStalled(300, database);
  ensureRecurringJobs(workspace.id, database);

  let ran = 0;
  for (let i = 0; i < 50; i++) {
    const did = await runOne(workerId, kinds.length ? kinds : undefined, database);
    if (!did) break;
    ran++;
  }

  const rows = database
    .prepare(
      `SELECT kind, status, attempts, max_attempts, run_at, last_error FROM jobs
       WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 12`,
    )
    .all(workspace.id) as Array<{ kind: string; status: string; attempts: number; max_attempts: number; run_at: string; last_error: string | null }>;

  console.log(`\nran ${ran} job${ran === 1 ? "" : "s"} for "${workspace.name}"`);
  console.log(`handlers registered: ${registeredKinds().join(", ")}\n`);
  for (const row of rows) {
    const detail = row.last_error ? ` — ${row.last_error}` : "";
    const retry = row.status === "pending" && row.attempts > 0 ? ` (next try ${new Date(row.run_at).toISOString().slice(11, 19)}z)` : "";
    console.log(`  ${row.status.padEnd(10)} ${row.kind.padEnd(22)} attempt ${row.attempts}/${row.max_attempts}${retry}${detail}`);
  }

  // show what the backoff actually looks like, since retries are the thing people doubt
  console.log("\nbackoff schedule for a failing job:");
  for (let attempt = 1; attempt <= 5; attempt++) {
    const ms = backoffMs(attempt);
    console.log(`  attempt ${attempt} -> retry in ${Math.round(ms / 1000)}s`);
  }
  console.log(`\nat ${nowIso()}`);
}

void enqueue;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});