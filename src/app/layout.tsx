import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { db } from "@/lib/db/client";
import { getWorkspaceRow } from "@/lib/workspace";
import { AppShell } from "@/components/app-shell";
import { NotificationsMenu, type Alert } from "@/components/notifications";
import { listSources } from "@/lib/queries/sources";
import { taskCounts, queryTasks } from "@/lib/queries/tasks";
import { queryLeads } from "@/lib/queries/leads";
import { overview } from "@/lib/queries/analytics";
import { nurtureBoard } from "@/lib/queries/nurture";
import { quietOutreach } from "@/lib/queries/outreach";
import { startWorker } from "@/lib/jobs/scheduler";
import type { Database } from "better-sqlite3";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "leadflow",
  description: "one workspace for every lead, conversation, task and conversion",
};

// the background worker lives in the server process, not in the browser
if (process.env.NEXT_PHASE !== "phase-production-build") startWorker();

function buildCounts(database?: Database): Record<string, number> {
  const databaseOrDefault = database ?? db();
  const workspace = getWorkspaceRow(databaseOrDefault);
  if (!workspace) return {};
  const ws = workspace.id;

  const tasks = taskCounts(ws, undefined, databaseOrDefault);
  const inbox = queryLeads(ws, { isNew: true, limit: 1 }, databaseOrDefault);
  const stats = overview(ws, "30d", undefined, undefined, databaseOrDefault);
  const duplicates = (
    databaseOrDefault.prepare(`SELECT COUNT(*) AS n FROM dupe_candidates WHERE workspace_id = ? AND status = 'pending'`).get(ws) as { n: number }
  ).n;
  const awaiting = quietOutreach(ws, 1, database).length > 0 ? stats.awaitingReply : 0;
  const reengage = (
    databaseOrDefault.prepare(`SELECT COUNT(*) AS n FROM leads WHERE workspace_id = ? AND nurture_state = 'ready_for_reengagement' AND is_archived = 0`).get(ws) as {
      n: number;
    }
  ).n;

  return {
    "/overview": tasks.today + tasks.overdue,
    "/inbox": inbox.total,
    "/leads": stats.totalLeads,
    "/pipeline": stats.totalLeads - stats.converted - stats.lost - stats.disqualified,
    "/tasks": tasks.all - tasks.completed,
    "/outreach": 0,
    "/follow-ups": stats.awaitingReply + tasks.overdue,
    "/nurture": reengage,
    "/sources": 0,
    "/generate": 0,
    "/analytics": 0,
    "/settings": duplicates,
  };
}

function buildAlerts(database?: Database): Alert[] {
  const databaseOrDefault = database ?? db();
  const workspace = getWorkspaceRow(database);
  if (!workspace) return [];
  const ws = workspace.id;
  const tasks = taskCounts(ws, undefined, databaseOrDefault);
  const stats = overview(ws, "30d", undefined, undefined, databaseOrDefault);
  const duplicates = (
    databaseOrDefault.prepare(`SELECT COUNT(*) AS n FROM dupe_candidates WHERE workspace_id = ? AND status = 'pending'`).get(ws) as { n: number }
  ).n;
  const reengage = (
    databaseOrDefault.prepare(`SELECT COUNT(*) AS n FROM leads WHERE workspace_id = ? AND nurture_state = 'ready_for_reengagement' AND is_archived = 0`).get(ws) as {
      n: number;
    }
  ).n;
  const quiet = queryTasks(ws, { bucket: "overdue", limit: 1 }, databaseOrDefault).total;

  const alerts: Alert[] = [];
  if (tasks.overdue) {
    const first = queryTasks(ws, { bucket: "overdue", limit: 1 }, database).rows[0];
    alerts.push({
      id: "overdue",
      kind: "overdue",
      title: "overdue follow-ups",
      detail: first ? `“${first.title}” is past its time` : "work that has slipped",
      count: tasks.overdue,
      href: "/tasks?bucket=overdue",
      tone: "rose",
    });
  }
  if (stats.newUnprocessed) {
    alerts.push({
      id: "inbox",
      kind: "inbox",
      title: "leads nobody has looked at",
      detail: "sitting in the inbox since they arrived",
      count: stats.newUnprocessed,
      href: "/inbox",
      tone: "amber",
    });
  }
  if (stats.awaitingReply) {
    alerts.push({
      id: "replies",
      kind: "replies",
      title: "replies waiting on us",
      detail: "someone answered and we have not written back",
      count: stats.awaitingReply,
      href: "/follow-ups?view=awaiting",
      tone: "violet",
    });
  }
  if (reengage) {
    alerts.push({
      id: "reengage",
      kind: "reengage",
      title: "quiet prospects worth another look",
      detail: "nurture finished and nothing has happened since",
      count: reengage,
      href: "/nurture?view=reengage",
      tone: "blue",
    });
  }
  if (duplicates) {
    alerts.push({
      id: "dupes",
      kind: "dupes",
      title: "possible duplicates",
      detail: "we are not sure these are different people",
      count: duplicates,
      href: "/settings?tab=duplicates",
      tone: "slate",
    });
  }
  void quiet;
  void nurtureBoard;
  return alerts.sort((a, b) => b.count - a.count);
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const database = db();
  const workspace = getWorkspaceRow(database);
  const counts = buildCounts(database);
  const alerts = buildAlerts(database);
  const alertCount = alerts.reduce((sum, a) => sum + a.count, 0);

  let memberName = "there";
  let memberHue = 210;
  if (workspace) {
    const member = database
      .prepare(`SELECT name, avatar_hue FROM members WHERE workspace_id = ? ORDER BY role = 'owner' DESC, created_at LIMIT 1`)
      .get(workspace.id) as { name: string; avatar_hue: number } | undefined;
    if (member) {
      memberName = member.name;
      memberHue = member.avatar_hue;
    }
  }

  let sources: Array<{ id: string; name: string }> = [];
  if (workspace) {
    sources = listSources(workspace.id, database)
      .slice(0, 30)
      .map((s) => ({ id: s.id, name: s.name }));
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`}>
        <AppShell
          counts={counts}
          memberName={memberName}
          memberHue={memberHue}
          workspaceName={workspace?.name ?? "leadflow"}
          alertCount={alertCount}
          alerts={alerts}
          sources={sources}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
