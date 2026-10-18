import Link from "next/link";
import { db } from "@/lib/db/client";
import { requireWorkspaceId } from "@/lib/workspace";
import { humanize, isPast, nowIso } from "@/lib/db/time";
import { queryTasks } from "@/lib/queries/tasks";
import { quietOutreach } from "@/lib/queries/outreach";
import { CHANNEL_META, OUTREACH_STATE_META, PRIORITY_META } from "@/lib/domain";
import type { Channel, OutreachState, Priority } from "@/lib/domain";
import type { Message } from "@/lib/types";
import { Badge, Card, CardHeader, EmptyState, Icon } from "@/components/ui";
import { PageHeader, Tabs } from "@/components/app-shell";
import { TaskTick } from "@/components/task-tick";
import { ComposeMessage } from "@/components/compose-message";
import { FollowUpPlanner, GiveUpButton } from "@/components/follow-up-planner";

export const dynamic = "force-dynamic";

const VIEWS = ["awaiting", "overdue", "no-reply", "quiet", "scheduled"] as const;
type View = (typeof VIEWS)[number];

const QUIET_DAYS = 14;

interface AwaitingRow extends Message {
  lead_full_name: string;
  outreach_state: string;
  lead_email: string | null;
}

interface ScheduledRow extends Message {
  lead_full_name: string;
  outreach_state: string;
}

/** quietOutreach does select the lead's outreach state, the type just does not say so. */
type QuietRow = ReturnType<typeof quietOutreach>[number] & { outreach_state: string };

function preview(text: string | null, max = 160): string {
  if (!text) return "no text";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function outreachMeta(state: string) {
  return OUTREACH_STATE_META[state as OutreachState] ?? OUTREACH_STATE_META.never_contacted;
}

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const view = (VIEWS.find((v) => v === params.view) ?? "awaiting") as View;

  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const now = nowIso();

  /** they wrote, we never answered. */
  const awaiting = database
    .prepare(
      `SELECT m.*, l.full_name AS lead_full_name, l.outreach_state, l.email AS lead_email
       FROM messages m
       JOIN leads l ON l.id = m.lead_id
       WHERE m.workspace_id = ? AND m.direction = 'inbound' AND l.merged_into_lead_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM messages o
           WHERE o.lead_id = m.lead_id AND o.channel = m.channel AND o.direction = 'outbound'
             AND COALESCE(o.sent_at, o.created_at) > COALESCE(m.sent_at, m.created_at)
         )
       ORDER BY COALESCE(m.sent_at, m.created_at) DESC LIMIT 60`,
    )
    .all(workspaceId) as AwaitingRow[];

  const overdue = queryTasks(workspaceId, { bucket: "overdue", limit: 60 }, database);

  /** sent, nothing back, nothing queued. */
  const quiet = quietOutreach(workspaceId, 80, database) as QuietRow[];
  const quietCutoff = new Date(Date.now() - QUIET_DAYS * 86_400_000).toISOString();
  const goneQuiet = quiet.filter((r) => (r.sent_at ?? r.created_at) < quietCutoff);

  const scheduled = database
    .prepare(
      `SELECT m.*, l.full_name AS lead_full_name, l.outreach_state
       FROM messages m
       JOIN leads l ON l.id = m.lead_id
       WHERE m.workspace_id = ? AND m.next_follow_up_at IS NOT NULL AND m.next_follow_up_at > ?
         AND l.merged_into_lead_id IS NULL
       ORDER BY m.next_follow_up_at ASC LIMIT 60`,
    )
    .all(workspaceId, now) as ScheduledRow[];

  const tabs = [
    { label: "waiting on us", value: "awaiting", count: awaiting.length },
    { label: "overdue", value: "overdue", count: overdue.total },
    { label: "no reply", value: "no-reply", count: quiet.length },
    { label: "gone quiet", value: "quiet", count: goneQuiet.length },
    { label: "scheduled", value: "scheduled", count: scheduled.length },
  ];

  const tiles = [
    { label: "replies we owe", value: awaiting.length, view: "awaiting", tone: "amber", sub: "they wrote, we stayed quiet" },
    { label: "overdue work", value: overdue.total, view: "overdue", tone: "rose", sub: "past the time we set" },
    { label: "no reply yet", value: quiet.length, view: "no-reply", tone: "cyan", sub: "we reached out, heard nothing" },
    { label: "scheduled", value: scheduled.length, view: "scheduled", tone: "violet", sub: "a nudge is already booked" },
  ] as const;

  return (
    <div>
      <PageHeader
        title="follow-ups"
        hint="two different things need us. people are waiting for a reply from us, and people we rang have gone quiet. they are not the same job."
        tabs={<Tabs items={tabs} active={view} basePath="/follow-ups" />}
      />

      <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.view} href={`/follow-ups?view=${t.view}`} className="panel block p-3 transition-shadow hover:shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[11.5px] leading-tight text-muted">{t.label}</span>
              {t.value > 0 ? <span className="size-2 shrink-0 rounded-full bg-current" style={{ color: `var(--${t.tone})` }} /> : null}
            </div>
            <div className="mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.035em] num" style={{ color: `var(--${t.tone})` }}>
              {t.value}
            </div>
            <div className="mt-1.5 truncate text-[11px] text-faint">{t.sub}</div>
          </Link>
        ))}
      </div>

      {view === "awaiting" ? <AwaitingView rows={awaiting} /> : null}
      {view === "overdue" ? <OverdueView rows={overdue.rows} /> : null}
      {view === "no-reply" ? <NoReplyView rows={quiet} /> : null}
      {view === "quiet" ? <QuietView rows={goneQuiet} /> : null}
      {view === "scheduled" ? <ScheduledView rows={scheduled} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- awaiting

function AwaitingView({ rows }: { rows: AwaitingRow[] }) {
  return (
    <Card padded={false}>
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">they wrote, we never answered</h2>
        <p className="mt-0.5 text-[12px] text-muted">every one of these is a person waiting on us. the oldest is at the top of the list on the overview.</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="nobody is waiting on us"
          hint="every reply that came in has had an answer after it. that is a good place to be."
          icon={<Icon name="check" className="size-5" />}
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const state = outreachMeta(row.outreach_state);
            const waiting = humanize(row.sent_at ?? row.created_at);
            return (
              <li key={row.id} className="bg-green-soft/40 px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-[7px] bg-green-soft text-[12px] font-semibold text-green">
                    ←
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={`/leads/${row.lead_id}`} className="truncate text-[12.5px] font-medium text-ink hover:underline">
                        {row.lead_full_name}
                      </Link>
                      <Badge tone={state.tone} size="xs" title={state.hint}>
                        {state.label}
                      </Badge>
                      <span className="text-[11.5px] text-amber">waiting {waiting}</span>
                    </div>

                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{preview(row.content)}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <ComposeMessage
                        leadId={row.lead_id}
                        leadName={row.lead_full_name}
                        channel={row.channel}
                        replyToMessageId={row.id}
                        subject={row.subject ? `re: ${row.subject.replace(/^re:\s*/i, "")}` : ""}
                        label="reply"
                        variant="primary"
                        size="xs"
                      />
                      <ComposeMessage
                        leadId={row.lead_id}
                        leadName={row.lead_full_name}
                        channel={row.channel}
                        mode="log_reply"
                        label="log what they said"
                        variant="ghost"
                        size="xs"
                      />
                      <Link href={`/leads/${row.lead_id}`} className="text-[11.5px] text-accent-ink hover:underline">
                        open the lead
                      </Link>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- overdue

function OverdueView({ rows }: { rows: ReturnType<typeof queryTasks>["rows"] }) {
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">work that has gone past its time</h2>
          <p className="mt-0.5 text-[12px] text-muted">these were due before now. tick one off when it is done.</p>
        </div>
        <Link href="/tasks?bucket=overdue" className="text-[12px] text-accent-ink hover:underline">
          all tasks
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="nothing is late"
          hint="every task we set is still inside its time. enjoy it while it lasts."
          icon={<Icon name="check" className="size-5" />}
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((task) => {
            const priority = PRIORITY_META[task.priority as Priority] ?? PRIORITY_META.medium;
            return (
              <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                <TaskTick taskId={task.id} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-ink">{task.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    {task.lead_id ? (
                      <Link href={`/leads/${task.lead_id}`} className="truncate text-accent-ink hover:underline">
                        {task.lead_name}
                      </Link>
                    ) : (
                      <span>no lead attached</span>
                    )}
                    {task.due_at ? <span className="text-rose">late by {humanize(task.due_at).replace(" ago", "")}</span> : null}
                    <span className="text-faint">{task.owner_name ?? "unassigned"}</span>
                  </span>
                </span>
                <Badge tone={priority.tone} size="xs" title={priority.hint}>
                  {priority.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- no reply

function NoReplyView({ rows }: { rows: QuietRow[] }) {
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">we reached out and heard nothing</h2>
          <p className="mt-0.5 text-[12px] text-muted">sent, never answered, and nothing is queued. one nudge, or let them go.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="everyone we wrote to has written back"
          hint="there is nothing sitting in silence right now."
          icon={<Icon name="check" className="size-5" />}
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const state = outreachMeta(row.outreach_state);
            return (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                <Link href={`/leads/${row.lead_id}`} className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[12.5px] font-medium text-ink">{row.lead_full_name}</span>
                    <span className="text-[11px] text-muted">
                      {CHANNEL_META[row.channel as Channel]?.label ?? row.channel}
                    </span>
                    <Badge tone={state.tone} size="xs" title={state.hint}>
                      {state.label}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-muted">
                    last thing we sent {humanize(row.sent_at ?? row.created_at)} · {preview(row.subject ?? row.content, 70)}
                  </span>
                </Link>

                <span className="flex shrink-0 items-center gap-1.5">
                  <ComposeMessage leadId={row.lead_id} leadName={row.lead_full_name} channel={row.channel} label="nudge" size="xs" />
                  <FollowUpPlanner messageId={row.id} followUpAt={row.next_follow_up_at} />
                  <GiveUpButton leadId={row.lead_id} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- gone quiet

function QuietView({ rows }: { rows: QuietRow[] }) {
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">has gone quiet</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            we said something more than two weeks ago and never heard back, with nothing queued either.
          </p>
        </div>
        <Link href="/follow-ups?view=no-reply" className="text-[12px] text-accent-ink hover:underline">
          everything with no reply
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="nothing has gone quiet"
          hint="nothing we sent has been sitting unanswered for two weeks."
          icon={<Icon name="check" className="size-5" />}
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const days = Math.max(0, Math.round((Date.now() - new Date(row.sent_at ?? row.created_at).getTime()) / 86_400_000));
            return (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={`num w-14 shrink-0 text-right text-[13px] font-semibold tracking-[-0.02em] ${
                    days >= 30 ? "text-rose" : days >= QUIET_DAYS ? "text-amber" : "text-muted"
                  }`}
                >
                  {days}d
                </span>

                <Link href={`/leads/${row.lead_id}`} className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[12.5px] font-medium text-ink">{row.lead_full_name}</span>
                    <span className="text-[11px] text-muted">{CHANNEL_META[row.channel as Channel]?.label ?? row.channel}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-muted">{preview(row.content, 80)}</span>
                </Link>

                <span className="flex shrink-0 items-center gap-1.5">
                  <ComposeMessage leadId={row.lead_id} leadName={row.lead_full_name} channel={row.channel} label="nudge" size="xs" />
                  <FollowUpPlanner messageId={row.id} followUpAt={row.next_follow_up_at} />
                  <GiveUpButton leadId={row.lead_id} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- scheduled

function ScheduledView({ rows }: { rows: ScheduledRow[] }) {
  return (
    <Card padded={false}>
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">already booked</h2>
        <p className="mt-0.5 text-[12px] text-muted">we said we would come back to these people. here is when.</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="nothing is booked"
          hint="when you set a follow-up on a message, or ask to be reminded, it turns up here with a countdown."
          icon={<Icon name="clock" className="size-5" />}
          action={
            <Link href="/outreach?view=messages" className="text-[12.5px] text-accent-ink hover:underline">
              go to the send log →
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const state = outreachMeta(row.outreach_state);
            return (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={`num w-24 shrink-0 text-right text-[12px] font-semibold ${
                    isPast(row.next_follow_up_at) ? "text-rose" : "text-ink"
                  }`}
                >
                  {row.next_follow_up_at ? humanize(row.next_follow_up_at) : "—"}
                </span>

                <Link href={`/leads/${row.lead_id}`} className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[12.5px] font-medium text-ink">{row.lead_full_name}</span>
                    <span className="text-[11px] text-muted">{CHANNEL_META[row.channel as Channel]?.label ?? row.channel}</span>
                    <Badge tone={state.tone} size="xs" title={state.hint}>
                      {state.label}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-muted">{preview(row.subject ?? row.content, 80)}</span>
                </Link>

                <span className="flex shrink-0 items-center gap-1.5">
                  <ComposeMessage leadId={row.lead_id} leadName={row.lead_full_name} channel={row.channel} label="write now" size="xs" />
                  <FollowUpPlanner messageId={row.id} followUpAt={row.next_follow_up_at} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
