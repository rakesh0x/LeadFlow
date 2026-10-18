import Link from "next/link";
import { db } from "@/lib/db/client";
import { requireWorkspaceId, listMembers } from "@/lib/workspace";
import { daysBetween, humanize, isPast } from "@/lib/db/time";
import { PRIORITY_META, TASK_TYPES, TASK_TYPE_META } from "@/lib/domain";
import type { TaskBucket } from "@/lib/queries/tasks";
import { queryTasks, taskCounts } from "@/lib/queries/tasks";
import type { TaskView } from "@/lib/types";
import { Avatar, Badge, Card, CardHeader, EmptyState, Icon } from "@/components/ui";
import { BarRow } from "@/components/charts";
import { PageHeader } from "@/components/app-shell";
import { TaskTick } from "@/components/task-tick";
import { TaskActions } from "@/components/task-actions";
import { NewTaskButton } from "@/components/new-task";
import { NextTaskButton } from "@/components/next-task-button";

export const dynamic = "force-dynamic";

const BUCKETS: TaskBucket[] = ["today", "overdue", "upcoming", "completed", "all"];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; owner?: string; type?: string; q?: string }>;
}) {
  const params = await searchParams;
  const bucket = (BUCKETS.includes(params.bucket as TaskBucket) ? params.bucket : "today") as TaskBucket;
  const ownerId = params.owner?.trim() || undefined;
  const type = (TASK_TYPES.includes(params.type as never) ? params.type : undefined) as (typeof TASK_TYPES)[number] | undefined;
  const q = params.q?.trim() || undefined;

  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const members = listMembers(database);
  const counts = taskCounts(workspaceId, undefined, database);

  const { rows, total } = queryTasks(workspaceId, { bucket, ownerId, type, q, limit: 100 }, database);
  const groups = groupTasks(rows, bucket);

  // what today looks like, whoever is holding it
  const todayRows = queryTasks(workspaceId, { bucket: "today", limit: 200 }, database).rows;
  const typeBreakdown = TASK_TYPES.map((t) => ({
    type: t,
    count: todayRows.filter((row) => row.type === t).length,
  })).filter((row) => row.count > 0);

  const byOwner = members
    .map((member) => {
      const mine = todayRows.filter((row) => row.owner_id === member.id);
      return {
        id: member.id,
        name: member.name,
        hue: member.avatar_hue,
        total: mine.length,
        done: mine.filter((row) => row.status === "completed").length,
        overdue: mine.filter((row) => isPast(row.due_at)).length,
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  const unassigned = todayRows.filter((row) => !row.owner_id).length;

  const nextPending = rows.find((row) => row.status === "open" || row.status === "in_progress");

  return (
    <div>
      <PageHeader
        title="tasks"
        hint="the calls, emails and little follow-ups that keep things moving. everything here is just work someone agreed to do."
        actions={
          <>
            <NextTaskButton targetId={nextPending?.id ?? null} />
            <NewTaskButton members={members.map((m) => ({ id: m.id, name: m.name }))} />
          </>
        }
        tabs={
          <nav className="flex flex-wrap items-center gap-1 border-b border-line">
            {(
              [
                { value: "today", label: "today", count: counts.today },
                { value: "overdue", label: "overdue", count: counts.overdue },
                { value: "upcoming", label: "upcoming", count: counts.upcoming },
                { value: "completed", label: "done", count: counts.completed },
                { value: "all", label: "everything", count: counts.all },
              ] as Array<{ value: TaskBucket; label: string; count: number }>
            ).map((tab) => {
              const on = tab.value === bucket;
              return (
                <Link
                  key={tab.value}
                  href={`/tasks?bucket=${tab.value}`}
                  className={`-mb-px border-b-2 px-2.5 pb-2 pt-1.5 text-[12.5px] transition-colors ${
                    on ? "border-accent font-medium text-accent-ink" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {tab.label}
                  <span className={`num ml-1.5 text-[11px] ${on ? "text-accent-ink/70" : "text-faint"}`}>{tab.count}</span>
                </Link>
              );
            })}
          </nav>
        }
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TaskFilters
            bucket={bucket}
            ownerId={ownerId ?? ""}
            type={type ?? ""}
            q={q ?? ""}
            members={members.map((m) => ({ id: m.id, name: m.name }))}
          />

          <Card padded={false} className="mt-3">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">{bucketTitle(bucket)}</h2>
                <p className="mt-0.5 text-[12px] text-muted">{total} in this list{nextPending && bucket !== "completed" ? ` · the next one is at the top of the first group` : ""}</p>
              </div>
              {q || ownerId || type ? (
                <Link href={`/tasks?bucket=${bucket}`} className="text-[12px] text-accent-ink hover:underline">
                  clear filters
                </Link>
              ) : null}
            </div>

            {rows.length === 0 ? (
              <EmptyForBucket bucket={bucket} filtered={Boolean(q || ownerId || type)} />
            ) : (
              <div className="divide-y divide-line">
                {groups.map((group) => (
                  <section key={group.key}>
                    <div
                      className={`flex items-center justify-between px-4 py-1.5 ${
                        group.key === "overdue" ? "bg-rose-soft/60" : "bg-surface-2/60"
                      }`}
                    >
                      <span
                        className={`text-[11px] font-medium tracking-[0.04em] ${
                          group.key === "overdue" ? "text-rose" : "text-muted"
                        }`}
                      >
                        {group.label}
                      </span>
                      <span className="num text-[11px] text-faint">{group.rows.length}</span>
                    </div>
                    <ul className="divide-y divide-line">
                      {group.rows.map((task) => (
                        <TaskLine key={task.id} task={task} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </Card>

          {total > rows.length ? (
            <p className="mt-3 text-center text-[12px] text-faint">
              showing the first {rows.length}. there are {total - rows.length} more.
            </p>
          ) : null}
        </div>

        {/* ---- right rail ---- */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="where things stand" hint="click a card to go there" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <SummaryCard label="due today" value={counts.today} href={`/tasks?bucket=today`} tone={counts.today ? "amber" : "green"} />
              <SummaryCard label="overdue" value={counts.overdue} href={`/tasks?bucket=overdue`} tone={counts.overdue ? "rose" : "green"} />
              <SummaryCard label="later" value={counts.upcoming} href={`/tasks?bucket=upcoming`} tone="slate" />
              <SummaryCard label="done" value={counts.completed} href={`/tasks?bucket=completed`} tone="green" />
            </div>
          </Card>

          <Card>
            <CardHeader title="your day, by kind" hint={`${todayRows.length} due today across the team`} />
            <div className="mt-4 space-y-2.5">
              {typeBreakdown.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-muted">nothing due today. enjoy it.</p>
              ) : (
                typeBreakdown.map((row) => (
                  <BarRow
                    key={row.type}
                    label={TASK_TYPE_META[row.type].label}
                    value={row.count}
                    max={Math.max(...typeBreakdown.map((r) => r.count), 1)}
                    tone={`var(--${TASK_TYPE_META[row.type].tone === "stone" ? "slate" : TASK_TYPE_META[row.type].tone})`}
                    right={<span className="num text-ink">{row.count}</span>}
                    href={`/tasks?bucket=today&type=${row.type}`}
                  />
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="who is holding what" hint="tasks due today, by person" />
            <div className="mt-3 space-y-1">
              {byOwner.length === 0 && !unassigned ? (
                <p className="py-4 text-center text-[12.5px] text-muted">nobody has anything due today.</p>
              ) : null}

              {byOwner.map((row) => (
                <Link
                  key={row.id}
                  href={`/tasks?bucket=today&owner=${row.id}`}
                  className="flex items-center gap-2.5 rounded-[7px] px-1.5 py-1.5 transition-colors hover:bg-surface-2"
                >
                  <Avatar name={row.name} hue={row.hue} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{row.name}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {row.total} due today{row.overdue ? ` · ${row.overdue} late` : ""}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[13px] font-semibold text-ink">{row.total}</span>
                </Link>
              ))}

              {unassigned ? (
                <Link
                  href="/tasks?bucket=today"
                  className="flex items-center gap-2.5 rounded-[7px] px-1.5 py-1.5 transition-colors hover:bg-surface-2"
                >
                  <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-slate-soft text-[10px] font-semibold text-slate">
                    ?
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">nobody yet</span>
                    <span className="block truncate text-[11px] text-muted">waiting for an owner</span>
                  </span>
                  <span className="num shrink-0 text-[13px] font-semibold text-ink">{unassigned}</span>
                </Link>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="a small nudge" hint="no pressure, just ideas" />
            <div className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-muted">
              <p>
                overdue work loses its meaning fast. if something keeps slipping, the honest fix is usually to make it smaller or
                move it.
              </p>
              <p>nothing here today? a good use of the time is finding new people to talk to.</p>
            </div>
            <div className="mt-3 flex gap-3">
              <Link href="/generate" className="text-[12.5px] text-accent-ink hover:underline">
                find new leads →
              </Link>
              <Link href="/leads" className="text-[12.5px] text-accent-ink hover:underline">
                browse everyone →
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function TaskLine({ task }: { task: TaskView }) {
  const done = task.status === "completed" || task.status === "cancelled";
  const late = !done && isPast(task.due_at);
  const type = TASK_TYPE_META[task.type];
  const priority = PRIORITY_META[task.priority];

  return (
    <li id={`task-${task.id}`} className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/40">
      <div className="pt-0.5">
        <TaskTick taskId={task.id} done={done} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`text-[12.5px] ${done ? "text-muted line-through" : "text-ink"}`}>{task.title}</span>
          <Badge tone={type.tone} size="xs">
            {type.label}
          </Badge>
          {task.priority !== "low" && !done ? (
            <Badge tone={priority.tone} size="xs" title={priority.hint}>
              {priority.label}
            </Badge>
          ) : null}
          {task.status === "in_progress" ? (
            <Badge tone="cyan" size="xs">
              started
            </Badge>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted">
          {task.lead_id ? (
            <Link href={`/leads/${task.lead_id}`} className="truncate text-accent-ink hover:underline">
              {task.lead_name}
            </Link>
          ) : (
            <span className="text-faint">no lead attached</span>
          )}

          {task.due_at ? (
            <span className={late ? "text-rose" : ""}>{dueLabel(task.due_at, late)}</span>
          ) : null}

          {task.description ? <span className="truncate text-faint">{task.description}</span> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {task.owner_name ? (
          <span title={`owned by ${task.owner_name}`}>
            <Avatar name={task.owner_name} hue={task.owner_hue ?? undefined} size={22} />
          </span>
        ) : null}
        <TaskActions taskId={task.id} status={task.status} />
      </div>
    </li>
  );
}

function TaskFilters({
  bucket,
  ownerId,
  type,
  q,
  members,
}: {
  bucket: TaskBucket;
  ownerId: string;
  type: string;
  q: string;
  members: Array<{ id: string; name: string }>;
}) {
  return (
    <form action="/tasks" method="get" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="bucket" value={bucket} />

      <select name="owner" className="field !w-auto !py-1.5 !text-[12.5px]" defaultValue={ownerId} aria-label="filter by owner">
        <option value="">everyone</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      <select name="type" className="field !w-auto !py-1.5 !text-[12.5px]" defaultValue={type} aria-label="filter by kind">
        <option value="">every kind</option>
        {TASK_TYPES.map((t) => (
          <option key={t} value={t}>
            {TASK_TYPE_META[t].label}
          </option>
        ))}
      </select>

      <div className="relative min-w-[180px] flex-1">
        <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
        <input
          name="q"
          defaultValue={q}
          className="field !py-1.5 pl-8 !text-[12.5px]"
          placeholder="search tasks or people"
          aria-label="search tasks"
        />
      </div>

      <button type="submit" className="h-8 rounded-[7px] border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-2">
        filter
      </button>
    </form>
  );
}

function EmptyForBucket({ bucket, filtered }: { bucket: TaskBucket; filtered: boolean }) {
  if (filtered) {
    return (
      <EmptyState
        title="nothing matches that"
        hint="try fewer words, or let everyone and every kind back in."
        icon={<Icon name="search" className="size-5" />}
      />
    );
  }

  const copy: Record<TaskBucket, { title: string; hint: string; action?: React.ReactNode }> = {
    today: {
      title: "nothing due today",
      hint: "your list is clear. there is no better moment to go and find some new people.",
      action: (
        <Link href="/generate" className="text-[12.5px] text-accent-ink hover:underline">
          find new leads →
        </Link>
      ),
    },
    overdue: {
      title: "nothing is late",
      hint: "everything you owe someone is still on time. nicely done.",
      action: (
        <Link href="/tasks" className="text-[12.5px] text-accent-ink hover:underline">
          see today's work →
        </Link>
      ),
    },
    upcoming: {
      title: "nothing scheduled further out",
      hint: "when you book the next step on a lead, it will show up here.",
      action: (
        <Link href="/leads" className="text-[12.5px] text-accent-ink hover:underline">
          pick up a lead →
        </Link>
      ),
    },
    completed: {
      title: "nothing finished yet",
      hint: "tick something off on today's list and it will land here.",
      action: (
        <Link href="/tasks" className="text-[12.5px] text-accent-ink hover:underline">
          back to today →
        </Link>
      ),
    },
    all: {
      title: "no open work at all",
      hint: "that is either very good news or a sign nobody is writing anything down.",
      action: (
        <Link href="/leads" className="text-[12.5px] text-accent-ink hover:underline">
          open your leads →
        </Link>
      ),
    },
  };

  const body = copy[bucket];
  return <EmptyState title={body.title} hint={body.hint} icon={<Icon name="check" className="size-5" />} action={body.action} />;
}

function SummaryCard({
  label,
  value,
  href,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  tone: "slate" | "amber" | "rose" | "green";
}) {
  const color: Record<string, string> = {
    slate: "text-slate",
    amber: "text-amber",
    rose: "text-rose",
    green: "text-green",
  };
  return (
    <Link href={href} className="rounded-[10px] border border-line bg-surface-2/50 p-2.5 transition-colors hover:bg-surface-2">
      <div className="text-[11.5px] leading-tight text-muted">{label}</div>
      <div className={`num mt-1 text-[20px] font-semibold leading-none tracking-[-0.03em] ${color[tone]}`}>{value}</div>
    </Link>
  );
}

// ---------------------------------------------------------------- helpers

interface Group {
  key: string;
  label: string;
  rows: TaskView[];
}

function groupTasks(rows: TaskView[], bucket: TaskBucket): Group[] {
  const done = bucket === "completed";
  const groups: Group[] = done
    ? [{ key: "done", label: "finished", rows: [] }]
    : [
        { key: "overdue", label: "running late", rows: [] },
        { key: "today", label: "due today", rows: [] },
        { key: "later", label: "later", rows: [] },
        { key: "someday", label: "no date yet", rows: [] },
      ];

  for (const row of rows) {
    if (done) {
      groups[0].rows.push(row);
      continue;
    }
    if (!row.due_at) {
      groups[3].rows.push(row);
      continue;
    }
    if (isPast(row.due_at)) {
      groups[0].rows.push(row);
      continue;
    }
    if (daysBetween(new Date(), row.due_at) === 0) {
      groups[1].rows.push(row);
      continue;
    }
    groups[2].rows.push(row);
  }

  const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  for (const group of groups) {
    group.rows.sort((a, b) => {
      const p = (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
      if (p !== 0) return p;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return a.due_at.localeCompare(b.due_at);
    });
  }

  return groups.filter((group) => group.rows.length > 0);
}

function dueLabel(dueAt: string, late: boolean): string {
  const days = daysBetween(new Date(), dueAt);
  if (late) {
    const ago = Math.abs(days);
    if (ago <= 0) return "late by a few hours";
    return `${ago} day${ago === 1 ? "" : "s"} late`;
  }
  if (days === 0) return `due today · ${humanize(dueAt)}`;
  return humanize(dueAt);
}

function bucketTitle(bucket: TaskBucket): string {
  switch (bucket) {
    case "today":
      return "due today";
    case "overdue":
      return "running late";
    case "upcoming":
      return "coming up";
    case "completed":
      return "finished";
    default:
      return "all open work";
  }
}
