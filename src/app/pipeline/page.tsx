import Link from "next/link";
import { db } from "@/lib/db/client";
import { requireWorkspaceId } from "@/lib/workspace";
import { daysBetween, humanize } from "@/lib/db/time";
import { overview, type Period } from "@/lib/queries/analytics";
import { queryLeads } from "@/lib/queries/leads";
import { listOpportunities, pipelineValue } from "@/lib/queries/deals";
import { CLOSED_STAGES, OPEN_STAGES, PIPELINE_STAGE_META, type PipelineStage } from "@/lib/domain";
import type { LeadView } from "@/lib/types";
import { Avatar, Card, EmptyState, Icon } from "@/components/ui";
import { PageHeader } from "@/components/app-shell";
import { StageSelect } from "@/components/stage-select";

export const dynamic = "force-dynamic";

const PERIODS: Array<{ value: string; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "all time" },
];

const CARD_LIMIT = 60;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ period?: string; closed?: string; stage?: string }> }) {
  const params = await searchParams;
  const period = (PERIODS.find((p) => p.value === params.period)?.value ?? "30d") as Period;
  const showClosed = params.closed === "1";
  const highlight = (PIPELINE_STAGE_META as Record<string, unknown>)[params.stage ?? ""] ? (params.stage as PipelineStage) : null;

  const database = db();
  const workspaceId = requireWorkspaceId(database);

  const stages: PipelineStage[] = showClosed ? [...OPEN_STAGES, ...CLOSED_STAGES] : [...OPEN_STAGES];
  const result = queryLeads(workspaceId, { stage: stages, sort: "activity", limit: 500 }, database);
  const stats = overview(workspaceId, period, undefined, undefined, database);
  const value = pipelineValue(workspaceId, database);
  const opportunities = listOpportunities(workspaceId, database);

  const valueByLead = new Map<string, number>();
  for (const opp of opportunities) {
    if (opp.stage === "won" || opp.stage === "lost") continue;
    valueByLead.set(opp.lead_id, (valueByLead.get(opp.lead_id) ?? 0) + opp.amount);
  }
  const valueByStage = new Map<PipelineStage, number>();
  for (const lead of result.rows) {
    const amount = valueByLead.get(lead.id) ?? 0;
    if (amount) valueByStage.set(lead.pipeline_stage, (valueByStage.get(lead.pipeline_stage) ?? 0) + amount);
  }

  const columns = stages.map((stage) => ({
    stage,
    meta: PIPELINE_STAGE_META[stage],
    leads: result.rows.filter((lead) => lead.pipeline_stage === stage),
  }));
  const totalCards = result.rows.length;

  return (
    <div>
      <PageHeader
        title="pipeline"
        hint="every lead that is still alive, in the order it moves. use the move control on a card to put someone a step further along."
        actions={
          <div className="flex items-center gap-1 rounded-[8px] border border-line bg-surface p-0.5">
            {PERIODS.map((p) => (
              <Link
                key={p.value}
                href={`/pipeline?period=${p.value}${showClosed ? "&closed=1" : ""}`}
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

      {/* ---- the numbers ---- */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="open pipeline value" value={money(value.open_value)} hint="live deals you are working" tone="amber" />
        <Stat label="open leads" value={result.rows.filter((l) => OPEN_STAGES.includes(l.pipeline_stage)).length} hint="not closed off yet" tone="blue" />
        <Stat label="converted" value={stats.converted} hint={`${stats.conversionRate}% of what arrived ${periodLabel(period)}`} tone="green" />
        <Stat label="won so far" value={money(value.won_value)} hint="closed in the good direction" tone="green" />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted">
          {totalCards === 0
            ? "nobody is in the pipeline right now."
            : `${totalCards} ${totalCards === 1 ? "lead is" : "leads are"} on the board${totalCards >= 500 ? " — this is everything we hold" : ""}.`}
        </p>
        <Link
          href={showClosed ? `/pipeline?period=${period}` : `/pipeline?period=${period}&closed=1`}
          className="inline-flex h-7.5 items-center gap-1.5 rounded-[7px] border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-2"
        >
          <Icon name="chevron" className={`size-3 transition-transform ${showClosed ? "rotate-90" : ""}`} />
          {showClosed ? "hide the finished ones" : "also show converted, lost and disqualified"}
        </Link>
      </div>

      {/* ---- the board ---- */}
      {totalCards === 0 ? (
        <Card className="mt-4">
          <EmptyState
            title="the pipeline is empty"
            hint="no leads are sitting in an open stage. bring some people in, or turn off the filters to see everyone."
            icon={<Icon name="pipeline" className="size-5" />}
            action={
              <div className="flex items-center gap-3">
                <Link href="/generate" className="text-[12.5px] text-accent-ink hover:underline">
                  find new leads →
                </Link>
                <Link href="/leads" className="text-[12.5px] text-muted hover:text-ink">
                  see everyone
                </Link>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="mt-3 overflow-x-auto pb-4">
          <div className="flex min-w-max items-start gap-3">
            {columns.map((column) => {
              const share = totalCards ? Math.round((column.leads.length / totalCards) * 100) : 0;
              const stageValue = valueByStage.get(column.stage) ?? 0;
              const shown = column.leads.slice(0, CARD_LIMIT);
              const hidden = column.leads.length - shown.length;

              return (
                <div key={column.stage} className="w-[260px] shrink-0">
                  <div
                    className={`sticky top-0 z-10 rounded-t-[10px] border border-b-0 border-line bg-surface px-3 py-2.5 ${
                      highlight === column.stage ? "ring-1 ring-[var(--accent)]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: `var(--${column.meta.tone === "stone" ? "slate" : column.meta.tone})` }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold tracking-[-0.01em] text-ink">{column.meta.label}</span>
                      <span className="num shrink-0 text-[12px] text-muted">{column.leads.length}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(share, 1.5)}%`, background: `var(--${column.meta.tone === "stone" ? "slate" : column.meta.tone})` }}
                        />
                      </div>
                      <span className="num w-8 shrink-0 text-right text-[10.5px] text-faint">{share}%</span>
                    </div>
                    <p className="mt-1 truncate text-[10.5px] text-faint" title={column.meta.hint}>
                      {stageValue ? `${money(stageValue)} in play · ` : ""}
                      {column.meta.hint}
                    </p>
                  </div>

                  <div className="min-h-[120px] space-y-1.5 rounded-b-[10px] border border-line bg-surface-2/40 p-1.5">
                    {shown.length === 0 ? (
                      <p className="py-6 text-center text-[11.5px] text-faint">empty</p>
                    ) : (
                      shown.map((lead) => <KanbanCard key={lead.id} lead={lead} value={valueByLead.get(lead.id) ?? 0} />)
                    )}
                    {hidden > 0 ? (
                      <Link href={`/leads?stage=${column.stage}`} className="block rounded-[8px] px-2 py-1.5 text-center text-[11.5px] text-accent-ink hover:bg-surface">
                        {hidden} more →
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function KanbanCard({ lead, value }: { lead: LeadView; value: number }) {
  const age = daysBetween(lead.created_at, new Date());
  const ageClass = age > 21 ? "text-rose bg-rose-soft" : age > 7 ? "text-amber bg-amber-soft" : "text-slate bg-slate-soft";

  return (
    <div className="group relative rounded-[9px] border border-line bg-surface p-2.5 transition-shadow hover:shadow-sm">
      <Link href={`/leads/${lead.id}`} className="block">
        <div className="flex items-start gap-2">
          <Avatar name={lead.full_name} hue={lead.owner_hue ?? undefined} size={26} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium text-ink">{lead.full_name}</div>
            <div className="truncate text-[11px] text-muted">
              {[lead.job_title, lead.company_name].filter(Boolean).join(" at ") || lead.email || "no company yet"}
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium num ${ageClass}`} title={`arrived ${humanize(lead.created_at)}`}>
            {age}d
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-faint">
          {lead.owner_name ? (
            <span className="inline-flex items-center gap-1" title={lead.owner_name}>
              <Avatar name={lead.owner_name} hue={lead.owner_hue ?? undefined} size={15} />
              <span className="max-w-[80px] truncate">{lead.owner_name.split(" ")[0]}</span>
            </span>
          ) : (
            <span>unassigned</span>
          )}
          {lead.open_tasks > 0 ? (
            <span className={lead.overdue_tasks > 0 ? "text-rose" : ""}>
              · {lead.open_tasks} {lead.open_tasks === 1 ? "task" : "tasks"}
            </span>
          ) : null}
          <span className="truncate">· {lead.source_name ?? "unattributed"}</span>
        </div>

        {value > 0 ? <div className="mt-2 text-[11px] num text-amber">{money(value)} in play</div> : null}
      </Link>

      <div className="mt-2 flex items-center justify-between border-t border-line pt-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Link href={`/leads/${lead.id}`} className="text-[11px] text-accent-ink hover:underline">
          open
        </Link>
        <StageSelect leadId={lead.id} stage={lead.pipeline_stage} label="move" />
      </div>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint: string; tone: string }) {
  const color = `var(--${tone === "stone" ? "slate" : tone})`;
  return (
    <div className="panel p-3">
      <div className="text-[11.5px] leading-tight text-muted">{label}</div>
      <div className="mt-1.5 num text-[24px] font-semibold leading-none tracking-[-0.035em]" style={{ color }}>
        {value}
      </div>
      <div className="mt-1.5 truncate text-[11px] text-faint">{hint}</div>
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
