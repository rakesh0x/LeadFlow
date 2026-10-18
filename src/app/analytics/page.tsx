import Link from "next/link";
import { db } from "@/lib/db/client";
import { requireWorkspaceId } from "@/lib/workspace";
import {
  campaignPerformance,
  channelPerformance,
  conversionFunnel,
  ownerPerformance,
  overview,
  quickAnswers,
  sourcePerformance,
  stageBreakdown,
  trends,
  type Period,
} from "@/lib/queries/analytics";
import { PIPELINE_STAGE_META } from "@/lib/domain";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { BarRow, Donut, FunnelChart, TrendChart } from "@/components/charts";
import { PageHeader } from "@/components/app-shell";

export const dynamic = "force-dynamic";

const PERIODS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "all time" },
];

const STAGE_COLORS: Record<string, string> = {
  new: "var(--cyan)",
  to_qualify: "var(--slate)",
  qualified: "var(--blue)",
  contacted: "var(--violet)",
  engaged: "var(--violet)",
  meeting_booked: "var(--amber)",
  opportunity: "var(--amber)",
  converted: "var(--green)",
  lost: "var(--stone)",
  disqualified: "var(--rose)",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const period = (PERIODS.find((p) => p.value === params.period)?.value ?? "30d") as Period;
  const database = db();
  const workspaceId = requireWorkspaceId(database);

  const stats = overview(workspaceId, period, undefined, undefined, database);
  const stages = stageBreakdown(workspaceId, period, undefined, database);
  const funnel = conversionFunnel(workspaceId, period, undefined, database);
  const points = trends(workspaceId, period, undefined, database);
  const channels = channelPerformance(workspaceId, period, undefined, database);
  const campaigns = campaignPerformance(workspaceId, database);
  const sources = sourcePerformance(workspaceId, database);
  const owners = ownerPerformance(workspaceId, database);
  const answers = quickAnswers(workspaceId, period, database);
  const weekly = database
    .prepare(
      `SELECT strftime('%Y-%W', l.created_at) AS week,
              COUNT(*) AS acquired,
              SUM(CASE WHEN l.pipeline_stage = 'converted' THEN 1 ELSE 0 END) AS converted
       FROM leads l WHERE l.workspace_id = ? AND l.merged_into_lead_id IS NULL AND l.is_archived = 0
       GROUP BY week ORDER BY week DESC LIMIT 8`,
    )
    .all(workspaceId) as Array<{ week: string; acquired: number; converted: number }>;

  const revenue = database
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN o.stage = 'won' THEN o.amount ELSE 0 END), 0) AS won,
         COALESCE(SUM(CASE WHEN o.stage IN ('qualifying','proposal','negotiation') THEN o.amount ELSE 0 END), 0) AS open,
         COUNT(DISTINCT CASE WHEN o.stage = 'won' THEN o.lead_id END) AS customers
       FROM opportunities o JOIN leads l ON l.id = o.lead_id
       WHERE o.workspace_id = ? AND l.merged_into_lead_id IS NULL`,
    )
    .get(workspaceId) as { won: number; open: number; customers: number };

  const responseTimes = database
    .prepare(
      `SELECT CAST((julianday(r.sent_at) - julianday(o.sent_at)) AS INTEGER) AS days
       FROM messages r JOIN messages o ON o.lead_id = r.lead_id
       WHERE r.workspace_id = ? AND r.direction = 'inbound' AND o.direction = 'outbound'
         AND o.sent_at < r.sent_at
       ORDER BY o.sent_at DESC LIMIT 300`,
    )
    .all(workspaceId) as Array<{ days: number }>;

  const responseBuckets = [
    { label: "same day", max: 1, count: 0 },
    { label: "1–3 days", max: 3, count: 0 },
    { label: "4–7 days", max: 7, count: 0 },
    { label: "over a week", max: 9999, count: 0 },
  ];
  for (const row of responseTimes) {
    const days = Math.max(0, row.days ?? 0);
    const bucket = responseBuckets.find((b) => days <= b.max && (b === responseBuckets[0] || days > responseBuckets[responseBuckets.indexOf(b) - 1].max));
    if (bucket) bucket.count++;
  }
  const totalResponses = responseTimes.length;

  const liveStages = stages.filter((s) => s.count > 0 && s.stage !== "lost" && s.stage !== "disqualified");
  const donutMax = Math.max(...liveStages.map((s) => s.count), 1);

  const label = period === "all" ? "all time" : `last ${period.replace("d", " days")}`;

  return (
    <div>
      <PageHeader
        title="analytics"
        hint={`how leads turn into revenue over ${label}. every figure is counted from the records themselves.`}
        actions={
          <div className="flex items-center gap-1 rounded-[8px] border border-line bg-surface p-0.5">
            {PERIODS.map((p) => (
              <Link
                key={p.value}
                href={`/analytics?period=${p.value}`}
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

      {/* headline figures */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 xl:grid-cols-6">
        <Metric label="leads acquired" value={stats.acquiredInPeriod} sub={`${label}${stats.acquiredPreviousPeriod ? ` · ${change(stats.acquiredInPeriod, stats.acquiredPreviousPeriod)} on last period` : ""}`} />
        <Metric label="converted" value={stats.converted} sub={`${stats.conversionRate}% of acquired`} tone="green" />
        <Metric label="reply rate" value={`${replyRate(stats)}%`} sub="of everyone we reached out to" tone="blue" />
        <Metric label="meetings booked" value={stats.meetingsBooked} sub={`${stats.meetingsUpcoming} still to come`} tone="amber" />
        <Metric label="open pipeline" value={money(stats.openOpportunityValue)} sub="value of live deals" tone="amber" />
        <Metric label="won to date" value={money(stats.wonValue)} sub={`${revenue.customers} customers`} tone="green" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="movement over time" hint="acquisition, outreach, replies and wins, day by day" />
            <div className="mt-4">
              <TrendChart points={points} height={190} />
            </div>
          </Card>

          <Card>
            <CardHeader title="from first contact to revenue" hint={`everyone acquired ${label}`} />
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <FunnelChart steps={funnel} />
              <div className="space-y-3">
                <div>
                  <p className="eyebrow mb-2">where people get stuck</p>
                  <div className="space-y-2.5">
                    {funnel.slice(1, -1).map((step, i) => {
                      const next = funnel[i + 2];
                      const drop = step.count > 0 ? Math.round(((step.count - next.count) / step.count) * 100) : 0;
                      return (
                        <div key={step.key} className="flex items-baseline justify-between gap-2 text-[12px]">
                          <span className="text-ink-2">
                            {step.label} → {next.label}
                          </span>
                          <span className={`num ${drop > 60 ? "text-rose" : drop > 35 ? "text-amber" : "text-muted"}`}>{drop}% drop off</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-[8px] border border-line bg-surface-2/50 p-3">
                  <p className="text-[11.5px] leading-relaxed text-muted">
                    {stuckInsight(funnel)}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          <Card padded={false}>
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-[13.5px] font-semibold">by source</h2>
              <p className="mt-0.5 text-[12px] text-muted">
                every source that has brought a lead in. a person arriving twice is counted once here but credited to both sources.
              </p>
            </div>
            {sources.length === 0 ? (
              <EmptyState title="no sources yet" hint="connect one and the numbers start filling in." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="px-4 py-2 text-[11px] font-medium text-faint">source</th>
                      <th className="px-2 py-2 text-right text-[11px] font-medium text-faint">leads</th>
                      <th className="px-2 py-2 text-right text-[11px] font-medium text-faint">replied</th>
                      <th className="px-2 py-2 text-right text-[11px] font-medium text-faint">qualified</th>
                      <th className="px-2 py-2 text-right text-[11px] font-medium text-faint">converted</th>
                      <th className="px-4 py-2 text-right text-[11px] font-medium text-faint">conversion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {sources.map((s) => (
                      <tr key={s.id} className="transition-colors hover:bg-surface-2/50">
                        <td className="px-4 py-2">
                          <Link href="/sources" className="text-ink hover:underline">
                            {s.name}
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-right num text-ink-2">{s.total}</td>
                        <td className="px-2 py-2 text-right num text-ink-2">
                          {s.replied}
                          <span className="ml-1 text-faint">{s.replyRate}%</span>
                        </td>
                        <td className="px-2 py-2 text-right num text-ink-2">{s.qualified}</td>
                        <td className="px-2 py-2 text-right num text-ink-2">{s.converted}</td>
                        <td className="px-4 py-2 text-right">
                          <span className={`num font-medium ${s.conversionRate >= 15 ? "text-green" : s.conversionRate >= 5 ? "text-ink" : "text-muted"}`}>
                            {s.conversionRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card padded={false}>
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-[13.5px] font-semibold">by campaign</h2>
              <p className="mt-0.5 text-[12px] text-muted">what each piece of outreach actually returned.</p>
            </div>
            {campaigns.length === 0 ? (
              <EmptyState title="no campaigns yet" hint="start one from the outreach page." action={<Link href="/outreach" className="text-[12.5px] text-accent-ink hover:underline">go to outreach →</Link>} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line text-left">
                      <th className="px-4 py-2 text-[11px] font-medium text-faint">campaign</th>
                      <th className="px-2 py-2 text-right text-[11px] font-medium text-faint">sent</th>
                      <th className="px-2 py-2 text-right text-[11px] font-medium text-faint">replies</th>
                      <th className="px-2 py-2 text-right text-[11px] font-medium text-faint">reply rate</th>
                      <th className="px-2 py-2 text-right text-[11px] font-medium text-faint">meetings</th>
                      <th className="px-2 py-2 text-right text-[11px] font-medium text-faint">won</th>
                      <th className="px-4 py-2 text-right text-[11px] font-medium text-faint">conversion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {campaigns.map((c) => (
                      <tr key={c.id} className="transition-colors hover:bg-surface-2/50">
                        <td className="px-4 py-2">
                          <Link href={`/outreach/${c.id}`} className="flex items-center gap-1.5 text-ink hover:underline">
                            {c.name}
                            <Badge size="xs" tone={c.status === "active" ? "green" : c.status === "draft" ? "slate" : "amber"}>
                              {c.status}
                            </Badge>
                          </Link>
                        </td>
                        <td className="px-2 py-2 text-right num text-ink-2">{c.sent}</td>
                        <td className="px-2 py-2 text-right num text-ink-2">{c.replies}</td>
                        <td className="px-2 py-2 text-right num text-ink-2">{c.replyRate}%</td>
                        <td className="px-2 py-2 text-right num text-ink-2">{c.meetings}</td>
                        <td className="px-2 py-2 text-right num text-ink-2">{c.converted}</td>
                        <td className="px-4 py-2 text-right num text-ink-2">{c.conversionRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card padded={false}>
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-[13.5px] font-semibold">by channel</h2>
              <p className="mt-0.5 text-[12px] text-muted">what each channel gets you back for the effort.</p>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {channels.length === 0 ? (
                <EmptyState title="nothing sent yet" />
              ) : (
                channels.map((c) => (
                  <div key={c.channel} className="rounded-[8px] border border-line p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12.5px] text-ink">{c.channel}</span>
                      <span className={`num text-[13px] font-semibold ${c.rate >= 20 ? "text-green" : "text-ink"}`}>{c.rate}%</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted">
                      {c.sent} sent · {c.replied} replied
                    </div>
                    <BarRow label="" value={c.replied} max={Math.max(...channels.map((x) => x.replied), 1)} tone="var(--green)" className="mt-2" />
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        {/* right rail */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="the pipeline right now" hint="every live lead, by stage" />
            <div className="mt-4 flex items-center gap-4">
              <Donut
                size={104}
                segments={liveStages.map((s) => ({ label: s.stage, value: s.count, color: STAGE_COLORS[s.stage] }))}
              />
              <ul className="min-w-0 flex-1 space-y-1.5">
                {liveStages.map((s) => (
                  <li key={s.stage} className="flex items-center gap-2 text-[11.5px]">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: STAGE_COLORS[s.stage] }} />
                    <span className="min-w-0 flex-1 truncate text-ink-2">{PIPELINE_STAGE_META[s.stage].label}</span>
                    <span className="num shrink-0 text-ink">{s.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4 space-y-2.5 border-t border-line pt-3">
              {liveStages.map((s) => (
                <BarRow
                  key={s.stage}
                  label={PIPELINE_STAGE_META[s.stage].label}
                  value={s.count}
                  max={donutMax}
                  tone={STAGE_COLORS[s.stage]}
                  href={`/leads?stage=${s.stage}`}
                />
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="how long people take to answer" hint={`based on ${totalResponses} replies`} />
            <div className="mt-4 space-y-2.5">
              {responseBuckets.map((b) => (
                <BarRow
                  key={b.label}
                  label={b.label}
                  value={b.count}
                  max={Math.max(...responseBuckets.map((x) => x.count), 1)}
                  tone="var(--blue)"
                  right={
                    <>
                      <span className="num text-ink">{b.count}</span>
                      <span className="ml-1.5 text-faint">{totalResponses ? Math.round((b.count / totalResponses) * 100) : 0}%</span>
                    </>
                  }
                />
              ))}
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
              {totalResponses === 0
                ? "no replies recorded yet, so there is nothing to learn from here."
                : `most people answer within ${fastestBucket(responseBuckets, totalResponses)}. that is worth knowing when you decide whether to chase them.`}
            </p>
          </Card>

          <Card>
            <CardHeader title="week by week" hint="acquired and converted" />
            <div className="mt-4 space-y-2.5">
              {weekly.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-muted">no data yet.</p>
              ) : (
                weekly.map((w) => (
                  <div key={w.week} className="rounded-[8px] border border-line p-2.5">
                    <div className="flex items-baseline justify-between text-[11.5px]">
                      <span className="text-ink-2">week {w.week.split("-")[1]}</span>
                      <span className="num text-muted">
                        <span className="num text-ink">{w.acquired}</span> in · <span className="num text-green">{w.converted}</span> out
                      </span>
                    </div>
                    <BarRow label="" value={w.acquired} max={Math.max(...weekly.map((x) => x.acquired), 1)} tone="var(--accent)" className="mt-2" />
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="the team" hint="who is moving what" />
            <div className="mt-3 space-y-3">
              {owners.map((o) => (
                <div key={o.id}>
                  <div className="flex items-center gap-2">
                    <span
                      className="grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: `linear-gradient(140deg, oklch(0.68 0.13 ${o.avatar_hue}), oklch(0.55 0.16 ${(o.avatar_hue + 28) % 360}))` }}
                    >
                      {o.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{o.name}</span>
                    {o.overdueTasks > 0 ? (
                      <Badge tone="rose" size="xs">
                        {o.overdueTasks} overdue
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 pl-8 text-[11px] text-muted">
                    <span>
                      <span className="num text-ink-2">{o.total}</span> leads
                    </span>
                    <span>
                      <span className="num text-ink-2">{o.replied}</span> replies
                    </span>
                    <span>
                      <span className="num text-green">{o.converted}</span> converted
                    </span>
                    <span>
                      <span className="num text-ink-2">{o.openTasks}</span> open tasks
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="ask the workspace" hint="live counts, click through to the records" />
            <ul className="mt-3 space-y-0.5">
              {answers.map((a) => (
                <li key={a.question}>
                  <Link href={a.href} className="group flex items-start gap-2.5 rounded-[7px] px-1.5 py-1.5 transition-colors hover:bg-surface-2">
                    <span className="num mt-px w-7 shrink-0 text-right text-[14px] font-semibold tracking-[-0.02em] text-ink">{a.count}</span>
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
            <CardHeader title="what to do next" hint="the biggest wins available right now" />
            <ul className="mt-3 space-y-2">
              {recommendations(stats, sources, channels).map((rec) => (
                <li key={rec.text} className="flex items-start gap-2.5">
                  <span className={`mt-1 size-1.5 shrink-0 rounded-full ${rec.tone}`} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] text-ink">{rec.text}</span>
                    <Link href={rec.href} className="text-[11px] text-accent-ink hover:underline">
                      {rec.action}
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- helpers

function Metric({ label, value, sub, tone = "slate" }: { label: string; value: string | number; sub?: string; tone?: string }) {
  const colors: Record<string, string> = {
    slate: "var(--ink)",
    green: "var(--green)",
    blue: "var(--blue)",
    amber: "var(--amber)",
  };
  return (
    <div className="panel p-3">
      <div className="text-[11.5px] leading-tight text-muted">{label}</div>
      <div className="mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.035em] num" style={{ color: colors[tone] ?? colors.slate }}>
        {value}
      </div>
      {sub ? <div className="mt-1.5 truncate text-[11px] text-faint">{sub}</div> : null}
    </div>
  );
}

function change(current: number, previous: number): string {
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

function replyRate(stats: ReturnType<typeof overview>): number {
  if (!stats.contacted) return 0;
  return Math.round((stats.replied / stats.contacted) * 100);
}

function money(value: number): string {
  if (!value) return "$0";
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `$${value}`;
}

function fastestBucket(buckets: Array<{ label: string; count: number }>, total: number): string {
  const sorted = [...buckets].sort((a, b) => b.count - a.count);
  return sorted[0].label;
}

function stuckInsight(funnel: Array<{ label: string; count: number; rate: number }>): string {
  const acquired = funnel[0]?.count ?? 0;
  const contacted = funnel[1]?.count ?? 0;
  const replied = funnel[2]?.count ?? 0;
  if (!acquired) return "no leads acquired in this window yet.";
  if (replied / Math.max(1, contacted) < 0.2 && contacted > 3) {
    return "people are replying less than one time in five. that usually means the first message is about us rather than them.";
  }
  if (replied > 0 && (funnel[3]?.count ?? 0) / replied < 0.4) {
    return "lots of replies, but they are not turning into meetings. try asking for a specific time rather than 'worth a chat'.";
  }
  if (contacted / acquired < 0.6) {
    return "a good chunk of new leads have never been contacted. the lead inbox is the cheapest win available.";
  }
  return "the numbers look reasonable. the next thing worth testing is the first line of your outreach.";
}

function recommendations(
  stats: ReturnType<typeof overview>,
  sources: Array<{ name: string; total: number; conversionRate: number }>,
  channels: Array<{ channel: string; sent: number; rate: number }>,
): Array<{ text: string; action: string; href: string; tone: string }> {
  const out: Array<{ text: string; action: string; href: string; tone: string }> = [];

  if (stats.newUnprocessed > 0) {
    out.push({ text: `${stats.newUnprocessed} new leads nobody has looked at`, action: "work through the inbox →", href: "/inbox", tone: "bg-amber" });
  }
  if (stats.overdueFollowUps > 0) {
    out.push({ text: `${stats.overdueFollowUps} follow-ups are past their time`, action: "clear them →", href: "/tasks?bucket=overdue", tone: "bg-rose" });
  }
  if (stats.noReplyEver > 0) {
    out.push({ text: `${stats.noReplyEver} people have not answered us`, action: "chase them →", href: "/follow-ups?view=no-reply", tone: "bg-amber" });
  }
  if (stats.notNurtured > stats.totalLeads * 0.4 && stats.totalLeads > 5) {
    out.push({ text: "most of your leads have never been nurtured", action: "put some on a sequence →", href: "/nurture", tone: "bg-violet" });
  }

  const bestSource = [...sources].filter((s) => s.total >= 3).sort((a, b) => b.conversionRate - a.conversionRate)[0];
  if (bestSource && bestSource.conversionRate > 0) {
    out.push({ text: `${bestSource.name} is your best converting source`, action: "send more your way →", href: "/sources", tone: "bg-green" });
  }

  const bestChannel = [...channels].filter((c) => c.sent >= 3).sort((a, b) => b.rate - a.rate)[0];
  if (bestChannel && bestChannel.rate > 0) {
    out.push({ text: `${bestChannel.channel} gets the best response (${bestChannel.rate}%)`, action: "put more effort in →", href: "/analytics", tone: "bg-blue" });
  }

  if (out.length === 0) {
    out.push({ text: "nothing is stuck right now. a good time to find more leads.", action: "go and build a list →", href: "/generate", tone: "bg-green" });
  }
  return out.slice(0, 6);
}
