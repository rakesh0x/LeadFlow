import Link from "next/link";
import { db } from "@/lib/db/client";
import { getWorkspaceId } from "@/lib/workspace";
import { humanize } from "@/lib/db/time";
import {
  acquisitionOverTime,
  channelPerformance,
  conversionFunnel,
  overview,
  quickAnswers,
  stageBreakdown,
  trends,
  type Period,
} from "@/lib/queries/analytics";
import { queryTasks, taskCounts } from "@/lib/queries/tasks";
import { queryLeads } from "@/lib/queries/leads";
import { nurtureBoard } from "@/lib/queries/nurture";
import { listOpportunities } from "@/lib/queries/deals";
import { quietOutreach } from "@/lib/queries/outreach";
import { buildDigest } from "@/lib/jobs/digest";
import { NURTURE_STATE_META, OUTREACH_STATE_META, PIPELINE_STAGE_META } from "@/lib/domain";
import { Badge, Card, CardHeader, EmptyState, Icon } from "@/components/ui";
import { BarRow, FunnelChart, Sparkline, TrendChart } from "@/components/charts";
import { PageHeader } from "@/components/app-shell";
import { LeadRow } from "@/components/lead-row";
import { TaskTick } from "@/components/task-tick";

export const dynamic = "force-dynamic";

const PERIODS: Array<{ value: string; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "all time" },
];

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const period = (PERIODS.find((p) => p.value === params.period)?.value ?? "30d") as Period;
  const database = db();
  const workspaceId = getWorkspaceId(database);

  if (!workspaceId) {
    return (
      <div>
        <PageHeader title="overview" hint="your workspace is getting ready" />
        <Card>
          <EmptyState
            title="workspace is starting up"
            hint="your database is fresh — add some leads or run the seed to see your overview."
            icon={<Icon name="inbox" />}
          />
          <div className="mt-3 text-center">
            <Link href="/leads" className="text-[12px] text-accent-ink hover:underline">
              go to leads →
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const stats = overview(workspaceId, period, undefined, undefined, database);
  const stages = stageBreakdown(workspaceId, period, undefined, database);
  const funnel = conversionFunnel(workspaceId, period, undefined, database);
  const trendPoints = trends(workspaceId, period, undefined, database);
  const channels = channelPerformance(workspaceId, period, undefined, database);
  const answers = quickAnswers(workspaceId, period, database);
  const tasks = taskCounts(workspaceId, undefined, database);
  const digest = buildDigest(workspaceId, undefined, database);

  const todayTasks = queryTasks(workspaceId, { bucket: "today", limit: 7 }, database);
  const inbox = queryLeads(workspaceId, { isNew: true, sort: "oldest", limit: 5 }, database);
  const quiet = quietOutreach(workspaceId, 5, database);
  const opportunities = listOpportunities(workspaceId, database)
    .filter((o) => o.stage !== "won" && o.stage !== "lost")
    .slice(0, 5);
  const reengage = nurtureBoard(workspaceId, database)
    .filter((r) => r.nurture_state === "ready_for_reengagement")
    .slice(0, 5);
  const acquisitions = acquisitionOverTime(workspaceId, period, undefined, database);
  const previous = stats.acquiredPreviousPeriod;
  const change = previous > 0 ? Math.round(((stats.acquiredInPeriod - previous) / previous) * 100) : 0;

  const sourceTotals = new Map<string, number>();
  for (const row of acquisitions) sourceTotals.set(row.source, (sourceTotals.get(row.source) ?? 0) + row.n);
  const topSources = [...sourceTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxSource = topSources[0]?.[1] ?? 1;

  const sourceColors = ["var(--accent)", "var(--blue)", "var(--violet)", "var(--cyan)", "var(--amber)", "var(--green)"];

  return (
    <div>
      <PageHeader
        title="overview"
        hint={digest.headline}
        actions={
          <div className="flex items-center gap-1 rounded-[8px] border border-line bg-surface p-0.5">
            {PERIODS.map((p) => (
              <Link
                key={p.value}
                href={`/overview?period=${p.value}`}
                className={`rounded-[6px] px-2 py-1 text-[12px] transition-colors ${
                  period === p.value ? "bg-accent-soft font-medium text-accent-ink" : "text-muted hover:text-ink"
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>
        }
      />

      {/* ---- the numbers, in the order a founder asks for them ---- */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <Stat
          label="total leads"
          value={stats.totalLeads}
          href="/leads"
          spark={trendPoints.map((p) => p.acquired)}
          sub={`${stats.acquiredInPeriod} new ${periodLabel(period)}`}
          delta={change}
        />
        <Stat label="new, untouched" value={stats.newUnprocessed} href="/inbox" tone={stats.newUnprocessed ? "amber" : "slate"} sub="waiting in the inbox" />
        <Stat label="qualified" value={stats.qualified} href="/leads?stage=qualified" sub="worth our time" />
        <Stat label="contacted" value={stats.contacted} href="/outreach" sub={`${stats.replied} replied`} tone="blue" />
        <Stat label="awaiting a reply" value={stats.awaitingReply} href="/follow-ups?view=awaiting" sub="we are waiting on them" tone="cyan" />
        <Stat
          label="overdue follow-ups"
          value={stats.overdueFollowUps}
          href="/tasks?bucket=overdue"
          tone={stats.overdueFollowUps ? "rose" : "green"}
          sub={stats.overdueFollowUps ? "past their time" : "all clear"}
        />
        <Stat label="being nurtured" value={stats.nurturing} href="/nurture" sub={`${stats.readyForReengagement} ready to re-engage`} tone="violet" />
        <Stat label="meetings booked" value={stats.meetingsBooked} href="/pipeline?stage=meeting_booked" sub={`${stats.meetingsUpcoming} coming up`} tone="amber" />
        <Stat label="opportunities" value={stats.opportunities} href="/analytics" sub={money(stats.openOpportunityValue)} tone="amber" />
        <Stat
          label="converted"
          value={stats.converted}
          href="/leads?stage=converted"
          tone="green"
          sub={`${stats.conversionRate}% of the ${stats.acquiredInPeriod} that arrived`}
        />
        <Stat label="no reply yet" value={stats.noReplyEver} href="/follow-ups?view=no-reply" sub="we reached out, nothing back" tone="stone" />
        <Stat label="never nurtured" value={stats.notNurtured} href="/nurture?view=not-enrolled" sub="not in any sequence" tone="slate" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* ---- today ---- */}
        <div className="space-y-4 lg:col-span-2">
          <Card padded={false}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em]">today's priorities</h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  {tasks.overdue ? `${tasks.overdue} overdue · ` : ""}
                  {tasks.today} due today · {tasks.upcoming} coming up
                </p>
              </div>
              <Link href="/tasks" className="text-[12px] text-accent-ink hover:underline">
                all tasks
              </Link>
            </div>

            {digest.priorities.length ? (
              <ul className="border-b border-line bg-surface-2/40 px-2 py-2">
                {digest.priorities.slice(0, 4).map((p) => (
                  <li key={p.kind}>
                    <Link
                      href={p.href}
                      className="group flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 transition-colors hover:bg-surface"
                    >
                      <span className="grid size-5 shrink-0 place-items-center rounded-md bg-accent-soft text-[10.5px] font-semibold num text-accent-ink">
                        {p.count}
                      </span>
                      <span className="flex-1 truncate text-[12.5px] text-ink">{p.text}</span>
                      <Icon name="chevron" className="size-3 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            {todayTasks.rows.length === 0 ? (
              <EmptyState
                title="nothing due today"
                hint="a good moment to go and find some new leads instead."
                icon={<Icon name="check" className="size-5" />}
                action={
                  <Link href="/generate" className="text-[12.5px] text-accent-ink hover:underline">
                    find new leads →
                  </Link>
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {todayTasks.rows.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                    <TaskTick taskId={task.id} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{task.title}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                        {task.lead_id ? (
                          <Link href={`/leads/${task.lead_id}`} className="truncate text-accent-ink hover:underline">
                            {task.lead_name}
                          </Link>
                        ) : (
                          <span>no lead attached</span>
                        )}
                        {task.due_at ? (
                          <span className={task.due_at < new Date().toISOString() ? "text-rose" : ""}>{humanize(task.due_at)}</span>
                        ) : null}
                      </span>
                    </span>
                    <Badge tone={PRIORITY_TONE[task.priority]} size="xs">
                      {task.priority}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="how leads move"
              hint={`every lead acquired ${periodLabel(period)}, and how far it got`}
              action={
                <Link href="/analytics" className="text-[12px] text-accent-ink hover:underline">
                  full numbers
                </Link>
              }
            />
            <div className="mt-4">
              <FunnelChart steps={funnel} />
            </div>
          </Card>

          <Card>
            <CardHeader title="movement over time" hint="new leads, outreach, replies and wins, day by day" />
            <div className="mt-4">
              <TrendChart points={trendPoints} />
            </div>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader title="new and not looked at yet" hint="the lead inbox, oldest first" />
              <div className="mt-3 space-y-1">
                {inbox.rows.length === 0 ? (
                  <p className="py-6 text-center text-[12.5px] text-muted">the inbox is empty. nice.</p>
                ) : (
                  inbox.rows.map((lead) => (
                    <LeadRow key={lead.id} lead={lead} compact />
                  ))
                )}
              </div>
              {inbox.total > inbox.rows.length ? (
                <Link href="/inbox" className="mt-2 block text-center text-[12px] text-accent-ink hover:underline">
                  {inbox.total - inbox.rows.length} more waiting
                </Link>
              ) : null}
            </Card>

            <Card>
              <CardHeader title="outreach that went quiet" hint="sent, heard nothing, nothing queued" />
              <div className="mt-3 space-y-1">
                {quiet.length === 0 ? (
                  <p className="py-6 text-center text-[12.5px] text-muted">nothing has gone quiet.</p>
                ) : (
                  quiet.map((row) => (
                    <Link
                      key={row.id}
                      href={`/leads/${row.lead_id}`}
                      className="flex items-center gap-2.5 rounded-[7px] px-1.5 py-1.5 transition-colors hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-ink">{row.lead_full_name}</span>
                        <span className="block truncate text-[11px] text-muted">
                          {row.channel} · no reply since {humanize(row.sent_at)}
                        </span>
                      </span>
                      <Badge tone="amber" size="xs">
                        chase
                      </Badge>
                    </Link>
                  ))
                )}
              </div>
              <Link href="/follow-ups?view=no-reply" className="mt-2 block text-center text-[12px] text-accent-ink hover:underline">
                see everyone who has gone quiet
              </Link>
            </Card>
          </div>
        </div>

        {/* ---- right rail ---- */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="ask the workspace" hint="every answer is a live count over your records" />
            <ul className="mt-3 space-y-0.5">
              {answers.map((a) => (
                <li key={a.question}>
                  <Link
                    href={a.href}
                    className="group flex items-start gap-2.5 rounded-[7px] px-1.5 py-2 transition-colors hover:bg-surface-2"
                  >
                    <span className="num mt-px w-7 shrink-0 text-right text-[15px] font-semibold tracking-[-0.02em] text-ink">
                      {a.count}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] leading-snug text-ink-2">{a.question}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted">{a.answer}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="where everyone sits" hint="share of live leads by stage" />
            <div className="mt-4 space-y-2.5">
              {stages
                .filter((s) => s.count > 0)
                .map((s) => (
                  <BarRow
                    key={s.stage}
                    label={PIPELINE_STAGE_META[s.stage].label}
                    value={s.count}
                    max={Math.max(...stages.map((x) => x.count), 1)}
                    tone={`var(--${PIPELINE_STAGE_META[s.stage].tone === "slate" || PIPELINE_STAGE_META[s.stage].tone === "stone" ? "slate" : PIPELINE_STAGE_META[s.stage].tone})`}
                    right={
                      <>
                        <span className="num text-ink">{s.count}</span>
                        <span className="ml-1.5 text-faint">{s.share}%</span>
                      </>
                    }
                    href={`/leads?stage=${s.stage}`}
                  />
                ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="outreach by channel" hint={`${periodLabel(period)}`} />
            <div className="mt-4 space-y-2.5">
              {channels.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-muted">nothing sent yet.</p>
              ) : (
                channels.map((c) => (
                  <BarRow
                    key={c.channel}
                    label={c.channel}
                    value={c.sent}
                    max={Math.max(...channels.map((x) => x.sent), 1)}
                    tone={`var(--${["email", "linkedin", "x", "form", "phone", "sms"].includes(c.channel) ? "blue" : "slate"})`}
                    right={
                      <>
                        <span className="num text-ink">{c.sent}</span>
                        {c.sent ? <span className="ml-1.5 text-faint">{c.rate}% replied</span> : null}
                      </>
                    }
                  />
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="open opportunities" hint={money(stats.openOpportunityValue)} />
            <div className="mt-3 space-y-1">
              {opportunities.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-muted">no live deals right now.</p>
              ) : (
                opportunities.map((o) => (
                  <Link
                    key={o.id}
                    href={`/leads/${o.lead_id}`}
                    className="flex items-center gap-2.5 rounded-[7px] px-1.5 py-1.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{o.name}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {o.lead_full_name}
                        {o.company_name ? ` · ${o.company_name}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[12px] num text-ink">{money(o.amount)}</span>
                      <span className="block text-[10.5px] text-faint">{o.stage}</span>
                    </span>
                  </Link>
                ))
              )}
            </div>
            {stats.wonValue > 0 ? (
              <div className="mt-3 flex items-baseline justify-between border-t border-line pt-2.5">
                <span className="text-[11.5px] text-muted">won so far</span>
                <span className="text-[14px] font-semibold num text-green">{money(stats.wonValue)}</span>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="ready for another look" hint="nurture ran out, nothing happened since" />
            <div className="mt-3 space-y-1">
              {reengage.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-muted">nobody is waiting to be re-engaged.</p>
              ) : (
                reengage.map((r) => (
                  <Link
                    key={r.lead_id}
                    href={`/leads/${r.lead_id}`}
                    className="flex items-center gap-2.5 rounded-[7px] px-1.5 py-1.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{r.full_name}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {r.sequence_name ?? NURTURE_STATE_META[r.nurture_state as "nurture_completed"].label}
                        {r.last_activity_at ? ` · quiet ${humanize(r.last_activity_at)}` : ""}
                      </span>
                    </span>
                    <Badge tone={OUTREACH_STATE_META.replied.tone} size="xs">
                      reach out
                    </Badge>
                  </Link>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="where leads came from" hint={`${periodLabel(period)}`} />
            <div className="mt-4 space-y-2.5">
              {topSources.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-muted">no leads acquired yet.</p>
              ) : (
                topSources.map(([name, count], i) => (
                  <BarRow
                    key={name}
                    label={name}
                    value={count}
                    max={maxSource}
                    tone={sourceColors[i % sourceColors.length]}
                    right={<span className="num text-ink">{count}</span>}
                    href={`/leads?source=${encodeURIComponent(name)}`}
                  />
                ))
              )}
            </div>
            <Link href="/analytics" className="mt-3 block text-center text-[12px] text-accent-ink hover:underline">
              which sources actually convert
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}

function periodLabel(period: string): string {
  return period === "all" ? "all time" : `in the last ${period.replace("d", " days")}`;
}

function money(value: number): string {
  if (!value) return "$0";
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `$${value}`;
}

const PRIORITY_TONE: Record<string, "slate" | "amber" | "blue" | "rose"> = {
  low: "slate",
  medium: "slate",
  high: "amber",
  urgent: "rose",
};

function Stat({
  label,
  value,
  sub,
  href,
  tone = "slate",
  spark,
  delta,
}: {
  label: string;
  value: number;
  sub?: string;
  href?: string;
  tone?: string;
  spark?: number[];
  delta?: number;
}) {
  const accent: Record<string, string> = {
    slate: "var(--ink)",
    green: "var(--green)",
    rose: "var(--rose)",
    amber: "var(--amber)",
    blue: "var(--blue)",
    violet: "var(--violet)",
    cyan: "var(--cyan)",
    stone: "var(--stone)",
  };
  const color = accent[tone] ?? accent.slate;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11.5px] leading-tight text-muted">{label}</span>
        {delta !== undefined && delta !== 0 ? (
          <span className={`num text-[10.5px] font-medium ${delta > 0 ? "text-green" : "text-rose"}`}>
            {delta > 0 ? "↑" : "↓"} {Math.abs(delta)}%
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 text-[26px] font-semibold leading-none tracking-[-0.035em] num" style={{ color }}>
        {value}
      </div>
      {sub ? <div className="mt-1.5 truncate text-[11px] text-faint">{sub}</div> : null}
      {spark && spark.length > 1 ? (
        <div className="mt-2 -mb-1">
          <Sparkline points={spark} height={22} stroke={color} />
        </div>
      ) : null}
    </>
  );

  return (
    <div className="panel overflow-hidden p-3 transition-shadow hover:shadow-sm">
      {href ? (
        <Link href={href} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

