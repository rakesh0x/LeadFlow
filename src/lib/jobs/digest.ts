/** the daily summary. built on the server, stored, and readable as a page. */
import type { Database } from "better-sqlite3";
import { db } from "../db/client";
import { startOfDay } from "../db/time";
import { overview } from "../queries/analytics";
import { queryTasks } from "../queries/tasks";

export interface DigestLine {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "bad";
}

export interface Digest {
  date: string;
  headline: string;
  lines: DigestLine[];
  priorities: Array<{ kind: string; text: string; href: string; count: number }>;
}

export function buildDigest(workspaceId: string, date: string = startOfDay(), database = db()): Digest {
  const stats = overview(workspaceId, "30d", undefined, undefined, database);
  const today = queryTasks(workspaceId, { bucket: "today", limit: 6 }, database);
  const overdue = queryTasks(workspaceId, { bucket: "overdue", limit: 6 }, database);

  const priorities: Digest["priorities"] = [];
  if (stats.overdueFollowUps) {
    priorities.push({ kind: "overdue", text: "clear overdue follow-ups", href: "/tasks?bucket=overdue", count: stats.overdueFollowUps });
  }
  if (stats.newUnprocessed) {
    priorities.push({ kind: "inbox", text: "work through the lead inbox", href: "/inbox", count: stats.newUnprocessed });
  }
  if (stats.awaitingReply) {
    priorities.push({ kind: "replies", text: "answer the replies waiting on us", href: "/follow-ups?view=awaiting", count: stats.awaitingReply });
  }
  if (stats.readyForReengagement) {
    priorities.push({ kind: "reengage", text: "re-engage the quiet prospects", href: "/nurture?view=reengage", count: stats.readyForReengagement });
  }
  if (stats.pendingDupeReviews) {
    priorities.push({ kind: "dupes", text: "resolve duplicate matches", href: "/settings?tab=duplicates", count: stats.pendingDupeReviews });
  }

  return {
    date,
    headline:
      stats.overdueFollowUps || stats.newUnprocessed
        ? `${stats.newUnprocessed} new lead${stats.newUnprocessed === 1 ? "" : "s"} waiting and ${stats.overdueFollowUps} thing${stats.overdueFollowUps === 1 ? "" : "s"} overdue.`
        : "you are all clear. good place to go find more leads.",
    lines: [
      { label: "new leads waiting", value: String(stats.newUnprocessed), tone: stats.newUnprocessed ? "warn" : "good" },
      { label: "overdue follow-ups", value: String(stats.overdueFollowUps), tone: stats.overdueFollowUps ? "bad" : "good" },
      { label: "tasks due today", value: String(today.total) },
      { label: "replies waiting on us", value: String(stats.awaitingReply), tone: stats.awaitingReply ? "warn" : "good" },
      { label: "new this period", value: String(stats.acquiredInPeriod) },
      { label: "converted this period", value: String(stats.converted), tone: "good" },
    ],
    priorities,
  };
}

/** the digest is computed and written by the scheduler, not the browser. */
export function enqueueDigest(workspaceId: string, database = db()): void {
  const digest = buildDigest(workspaceId, startOfDay(), database);
  database
    .prepare(`UPDATE workspaces SET settings_json = json_set(settings_json, '$.last_digest', json(?)), updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(digest), new Date().toISOString(), workspaceId);
}