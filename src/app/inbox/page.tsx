import Link from "next/link";
import { db } from "@/lib/db/client";
import { requireWorkspaceId } from "@/lib/workspace";
import { daysAgoIso, daysBetween, humanize, startOfDay } from "@/lib/db/time";
import { overview, trends } from "@/lib/queries/analytics";
import { queryLeads } from "@/lib/queries/leads";
import { Avatar, Card, CardHeader, EmptyState, Icon, Progress } from "@/components/ui";
import { Sparkline } from "@/components/charts";
import { PageHeader } from "@/components/app-shell";
import { InboxActions } from "@/components/inbox-actions";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const database = db();
  const workspaceId = requireWorkspaceId(database);

  const inbox = queryLeads(workspaceId, { isNew: true, sort: "oldest", limit: 100 }, database);
  const stats = overview(workspaceId, "30d", undefined, undefined, database);

  const arrivedToday = queryLeads(workspaceId, { isNew: true, createdAfter: startOfDay(), limit: 1 }, database).total;
  const arrivedThisWeek = queryLeads(workspaceId, { isNew: true, createdAfter: daysAgoIso(7), limit: 1 }, database).total;
  const waitingAWeek = queryLeads(workspaceId, { isNew: true, createdBefore: daysAgoIso(7), limit: 1 }, database).total;

  const recent = trends(workspaceId, "30d", undefined, database).slice(-21);

  const total = inbox.total;
  const waiting = inbox.rows.length;
  const oldest = inbox.rows[0];
  const oldestDays = oldest ? daysBetween(oldest.created_at, new Date()) : 0;

  const stillNewInPeriod = queryLeads(workspaceId, { isNew: true, createdAfter: stats.from, limit: 1 }, database).total;
  const periodTotal = stats.acquiredInPeriod;
  const worked = Math.max(0, periodTotal - stillNewInPeriod);
  const progress = periodTotal ? (worked / periodTotal) * 100 : 0;

  const peak = recent.reduce((max, p) => Math.max(max, p.acquired), 0);

  const sourceMap = new Map<string, { name: string; id: string; count: number }>();
  for (const lead of inbox.rows) {
    if (!lead.source_id) continue;
    const found = sourceMap.get(lead.source_id);
    if (found) found.count += 1;
    else sourceMap.set(lead.source_id, { name: lead.source_name ?? "unattributed", id: lead.source_id, count: 1 });
  }
  const sourceCounts = [...sourceMap.values()].sort((a, b) => b.count - a.count).slice(0, 5);

  return (
    <div>
      <PageHeader
        title="lead inbox"
        hint="everyone here arrived and nobody has looked at them yet. the oldest are first, because those are the ones going cold."
        actions={
          <>
            <Link
              href="/leads"
              className="inline-flex h-7.5 items-center rounded-[7px] border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-2"
            >
              all leads
            </Link>
            <Link
              href="/generate"
              className="inline-flex h-7.5 items-center rounded-[7px] border border-transparent bg-accent px-2.5 text-[12.5px] font-medium text-white shadow-[0_1px_2px_rgba(20,20,30,0.12)] transition-colors hover:bg-accent-hover"
            >
              find more leads
            </Link>
          </>
        }
      />

      {/* ---- the big number ---- */}
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-6 px-5 py-4">
          <div>
            <div className="text-[11.5px] text-muted">waiting to be looked at</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="num text-[42px] font-semibold leading-none tracking-[-0.04em] text-ink">{total}</span>
              <span className="text-[13px] text-muted">{total === 1 ? "lead" : "leads"}</span>
            </div>
            <p className="mt-2 max-w-xs text-[12.5px] leading-snug text-muted">
              {oldest
                ? oldestDays > 0
                  ? `the oldest has been waiting ${oldestDays} ${oldestDays === 1 ? "day" : "days"}.`
                  : "the newest of them arrived this morning."
                : "nothing is waiting. that is a good problem to have."}
            </p>
          </div>

          <div className="w-full max-w-[320px]">
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="text-ink-2">
                {worked} of {periodTotal} worked through
              </span>
              <span className="num text-muted">last 30 days</span>
            </div>
            <div className="mt-2">
              <Progress value={progress} tone={progress >= 50 ? "green" : "accent"} />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <Bucket label="today" value={arrivedToday} tone="cyan" />
              <Bucket label="this week" value={arrivedThisWeek} tone="blue" />
              <Bucket label="over a week" value={waitingAWeek} tone={waitingAWeek ? "rose" : "slate"} />
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card padded={false}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">oldest first</h2>
                <p className="mt-0.5 text-[12px] text-muted">click a name to open the full record</p>
              </div>
              {total > waiting ? (
                <span className="shrink-0 text-[11.5px] text-faint">showing {waiting} of {total}</span>
              ) : null}
            </div>

            {waiting === 0 ? (
              <EmptyState
                title="the inbox is empty"
                hint="every lead that arrived has been looked at. go and find some more people, or work the pipeline instead."
                icon={<Icon name="inbox" className="size-5" />}
                action={
                  <div className="flex items-center gap-3">
                    <Link href="/generate" className="text-[12.5px] text-accent-ink hover:underline">
                      find new leads →
                    </Link>
                    <Link href="/pipeline" className="text-[12.5px] text-muted hover:text-ink">
                      open the pipeline
                    </Link>
                  </div>
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {inbox.rows.map((lead) => {
                  const age = daysBetween(lead.created_at, new Date());
                  const ageTone: Record<string, string> = {
                    rose: "text-rose bg-rose-soft",
                    amber: "text-amber bg-amber-soft",
                    slate: "text-slate bg-slate-soft",
                  };
                  const badgeClass = age > 7 ? ageTone.rose : age > 3 ? ageTone.amber : ageTone.slate;

                  return (
                    <li key={lead.id} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2">
                      <Link href={`/leads/${lead.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
                        <Avatar name={lead.full_name} hue={lead.owner_hue ?? undefined} size={30} />

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-ink">{lead.full_name}</span>
                          <span className="block truncate text-[11px] text-muted">
                            {[lead.job_title, lead.company_name].filter(Boolean).join(" at ") || lead.email || "no company yet"}
                          </span>
                        </span>

                        <span className="hidden w-28 shrink-0 truncate text-[11px] text-muted sm:block">
                          {lead.source_name ?? "unattributed"}
                        </span>

                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap ${badgeClass}`}>
                          {age > 0 ? `${age}d` : "today"}
                        </span>

                        <span className="hidden w-20 shrink-0 text-right text-[11px] text-faint lg:block">
                          {humanize(lead.created_at)}
                        </span>
                      </Link>

                      <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <InboxActions leadId={lead.id} leadName={lead.full_name} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {total > waiting ? (
              <div className="border-t border-line px-4 py-2.5 text-center">
                <Link href="/leads?sort=newest" className="text-[12px] text-accent-ink hover:underline">
                  {total - waiting} more waiting — see them in all leads
                </Link>
              </div>
            ) : null}
          </Card>
        </div>

        {/* ---- the right rail ---- */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="new leads per day" hint="the last 21 days" />
            <div className="mt-4">
              {peak === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-muted">no new leads in the last three weeks.</p>
              ) : (
                <>
                  <Sparkline points={recent.map((p) => p.acquired)} height={46} stroke="var(--accent)" />
                  <div className="mt-2 flex items-baseline justify-between text-[11px] text-faint">
                    <span>
                      {new Date(recent[0].date)
                        .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
                        .toLowerCase()}
                    </span>
                    <span className="num text-muted">busiest day: {peak}</span>
                    <span>today</span>
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="how they arrived" hint="leads still sitting in the inbox" />
            <div className="mt-4 space-y-2.5">
              <BucketLine label="today" value={arrivedToday} max={Math.max(arrivedToday, arrivedThisWeek, waitingAWeek, 1)} tone="var(--cyan)" />
              <BucketLine label="this week" value={arrivedThisWeek} max={Math.max(arrivedToday, arrivedThisWeek, waitingAWeek, 1)} tone="var(--blue)" />
              <BucketLine
                label="over a week"
                value={waitingAWeek}
                max={Math.max(arrivedToday, arrivedThisWeek, waitingAWeek, 1)}
                tone={waitingAWeek ? "var(--rose)" : "var(--slate)"}
              />
            </div>
            <p className="mt-3 border-t border-line pt-2.5 text-[11.5px] leading-snug text-muted">
              anything over three days old starts to go cold. work the top of the list first.
            </p>
          </Card>

          <Card>
            <CardHeader title="where they came from" hint="the leads you have not touched" />
            <div className="mt-3 space-y-1">
              {sourceCounts.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-muted">nothing waiting.</p>
              ) : (
                sourceCounts.map((row) => (
                  <Link
                    key={row.name}
                    href={`/leads?source=${encodeURIComponent(row.id)}`}
                    className="flex items-center gap-2 rounded-[7px] px-1.5 py-1.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{row.name}</span>
                    <span className="num shrink-0 text-[11.5px] text-muted">{row.count}</span>
                  </Link>
                ))
              )}
            </div>
            <Link href="/sources" className="mt-2 block text-center text-[12px] text-accent-ink hover:underline">
              add or fix a source
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Bucket({ label, value, tone }: { label: string; value: number; tone: "cyan" | "blue" | "rose" | "slate" }) {
  const text = tone === "cyan" ? "text-cyan" : tone === "blue" ? "text-blue" : tone === "rose" ? "text-rose" : "text-slate";
  const soft = tone === "cyan" ? "bg-cyan-soft" : tone === "blue" ? "bg-blue-soft" : tone === "rose" ? "bg-rose-soft" : "bg-slate-soft";
  return (
    <div className={`rounded-[8px] px-2.5 py-2 ${soft}`}>
      <div className={`num text-[17px] font-semibold leading-none tracking-[-0.02em] ${text}`}>{value}</div>
      <div className="mt-1 truncate text-[10.5px] text-muted">{label}</div>
    </div>
  );
}

function BucketLine({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[12.5px] text-ink">{label}</span>
        <span className="num shrink-0 text-[12px] text-ink">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(pct, 2)}%`, background: tone }} />
      </div>
    </div>
  );
}
