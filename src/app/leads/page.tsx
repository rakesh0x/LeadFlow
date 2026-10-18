import Link from "next/link";
import { db } from "@/lib/db/client";
import { listMembers, requireWorkspaceId } from "@/lib/workspace";
import { humanize } from "@/lib/db/time";
import { listSources } from "@/lib/queries/sources";
import { queryLeads, type LeadSort } from "@/lib/queries/leads";
import {
  NURTURE_STATES,
  NURTURE_STATE_META,
  OUTREACH_STATES,
  OUTREACH_STATE_META,
  PIPELINE_STAGES,
  PIPELINE_STAGE_META,
  type NurtureState,
  type OutreachState,
  type PipelineStage,
} from "@/lib/domain";
import type { LeadView } from "@/lib/types";
import { Avatar, Badge, Card, EmptyState, Icon, StateBadge } from "@/components/ui";
import { PageHeader } from "@/components/app-shell";
import { FilterChips, type FilterChip } from "@/components/filter-chips";

export const dynamic = "force-dynamic";

const LIMIT = 25;

const SORTS: Array<{ value: LeadSort; label: string }> = [
  { value: "newest", label: "newest first" },
  { value: "oldest", label: "oldest first" },
  { value: "activity", label: "last activity" },
  { value: "name", label: "name a to z" },
  { value: "score", label: "highest score" },
  { value: "stage", label: "stage" },
];

const STAGE_GROUPS = [
  { value: "all", label: "all" },
  { value: "open", label: "open" },
  { value: "closed", label: "closed" },
];

/** one set of widths for the header labels and the rows, so the columns line up. */
const CELL = {
  lead: "flex min-w-0 flex-1 items-center gap-2.5",
  company: "hidden w-36 shrink-0 truncate lg:block",
  stage: "hidden w-26 shrink-0 md:block",
  nurture: "hidden w-28 shrink-0 xl:block",
  outreach: "hidden w-30 shrink-0 md:block",
  owner: "hidden w-7 shrink-0 sm:block",
  activity: "hidden w-22 shrink-0 text-right lg:block",
  tasks: "w-11 shrink-0 text-right",
};

type Search = Record<string, string | undefined>;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const database = db();
  const workspaceId = requireWorkspaceId(database);

  const sources = listSources(workspaceId, database);
  const members = listMembers(database);

  const flat = (value: string | string[] | undefined): string[] => {
    if (value === undefined) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  };

  const stageValues = flat(params.stage);
  const selectedStages = stageValues.filter((s): s is PipelineStage => (PIPELINE_STAGES as readonly string[]).includes(s));
  const stageGroup = stageValues.find((s) => s === "open" || s === "closed");

  const outreach = flat(params.outreach)[0] as OutreachState | undefined;
  const nurture = flat(params.nurture)[0] as NurtureState | undefined;
  const sourceId = flat(params.source)[0];
  const owner = flat(params.owner)[0];
  const q = flat(params.q)[0] ?? "";
  const sort = (flat(params.sort)[0] as LeadSort) ?? "newest";
  const include = flat(params.include)[0] === "1";
  const offset = Math.max(0, Number(flat(params.offset)[0] ?? "0") || 0);

  const result = queryLeads(
    workspaceId,
    {
      q: q || undefined,
      stage: stageGroup ?? (selectedStages.length ? selectedStages : "all"),
      outreach: outreach && (OUTREACH_STATES as readonly string[]).includes(outreach) ? outreach : "all",
      nurture: nurture && (NURTURE_STATES as readonly string[]).includes(nurture) ? nurture : "all",
      sourceId,
      ownerId: owner,
      includeArchived: include,
      sort,
      limit: LIMIT,
      offset,
    },
    database,
  );

  const current: Search = {
    q: q || undefined,
    stage: stageValues.length ? stageValues.join(",") : undefined,
    outreach,
    nurture,
    source: sourceId,
    owner,
    sort: sort === "newest" ? undefined : sort,
    include: include ? "1" : undefined,
  };

  const sourceName = sources.find((s) => s.id === sourceId)?.name;
  const ownerName = members.find((m) => m.id === owner)?.name ?? (owner === "__none__" ? "nobody" : undefined);

  const chips: FilterChip[] = [];
  if (q) chips.push({ key: "q", label: `“${q}”`, href: href({ ...current, q: undefined }) });
  for (const stage of selectedStages) {
    chips.push({
      key: `stage-${stage}`,
      label: PIPELINE_STAGE_META[stage].label,
      href: href({ ...current, stage: stageValues.filter((s) => s !== stage).join(",") }),
    });
  }
  if (stageGroup) chips.push({ key: "stage-group", label: stageGroup, href: href({ ...current, stage: undefined }) });
  if (outreach) chips.push({ key: "outreach", label: OUTREACH_STATE_META[outreach].label, href: href({ ...current, outreach: undefined }) });
  if (nurture) chips.push({ key: "nurture", label: NURTURE_STATE_META[nurture].label, href: href({ ...current, nurture: undefined }) });
  if (sourceName) chips.push({ key: "source", label: sourceName, href: href({ ...current, source: undefined }) });
  if (ownerName) chips.push({ key: "owner", label: ownerName, href: href({ ...current, owner: undefined }) });
  if (include) chips.push({ key: "include", label: "including archived", href: href({ ...current, include: undefined }) });
  if (sort !== "newest") chips.push({ key: "sort", label: `sorted by ${SORTS.find((s) => s.value === sort)?.label}`, href: href({ ...current, sort: undefined }) });

  const from = offset + 1;
  const to = Math.min(offset + LIMIT, result.total);
  const hasPrev = offset > 0;
  const hasNext = offset + LIMIT < result.total;

  return (
    <div>
      <PageHeader
        title="all leads"
        hint="everyone we know about, and every way to narrow them down."
        actions={
          <Link
            href="/inbox"
            className="inline-flex h-7.5 items-center rounded-[7px] border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-2"
          >
            lead inbox
          </Link>
        }
      />

      {/* ---- filters ---- */}
      <Card>
        <form action="/leads" method="get" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
              <input name="q" defaultValue={q} className="field !pl-8" placeholder="search a name, an email, a company or a job title" />
            </div>
            <button type="submit" className="inline-flex h-8 items-center rounded-[7px] bg-accent px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover">
              search
            </button>
            {chips.length > 0 ? (
              <Link href="/leads" className="text-[12px] text-muted hover:text-ink">
                clear filters
              </Link>
            ) : null}
          </div>

          {/* stage chips — each one carries the next selection, so it works with no javascript */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-[11.5px] text-faint">stage</span>
            {STAGE_GROUPS.map((group) => {
              const on = group.value === "all" ? !selectedStages.length && !stageGroup : stageGroup === group.value;
              return (
                <button
                  key={group.value}
                  type="submit"
                  name="stage"
                  value={group.value === "all" ? "" : group.value}
                  className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    on ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-ink"
                  }`}
                >
                  {group.label}
                </button>
              );
            })}
            <span className="mx-1 h-4 w-px bg-line" />
            {PIPELINE_STAGES.map((stage) => {
              const on = selectedStages.includes(stage);
              const next = on ? selectedStages.filter((s) => s !== stage) : [...selectedStages, stage];
              return (
                <button
                  key={stage}
                  type="submit"
                  name="stage"
                  value={next.join(",")}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                    on ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-ink"
                  }`}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: `var(--${PIPELINE_STAGE_META[stage].tone === "stone" ? "slate" : PIPELINE_STAGE_META[stage].tone})` }}
                  />
                  {PIPELINE_STAGE_META[stage].label}
                </button>
              );
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-faint">outreach</span>
              <select name="outreach" defaultValue={outreach ?? ""} className="field !py-1.5 !text-[12.5px]">
                <option value="">any</option>
                {OUTREACH_STATES.map((state) => (
                  <option key={state} value={state}>
                    {OUTREACH_STATE_META[state].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11.5px] text-faint">nurture</span>
              <select name="nurture" defaultValue={nurture ?? ""} className="field !py-1.5 !text-[12.5px]">
                <option value="">any</option>
                {NURTURE_STATES.map((state) => (
                  <option key={state} value={state}>
                    {NURTURE_STATE_META[state].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11.5px] text-faint">source</span>
              <select name="source" defaultValue={sourceId ?? ""} className="field !py-1.5 !text-[12.5px]">
                <option value="">any</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11.5px] text-faint">owner</span>
              <select name="owner" defaultValue={owner ?? ""} className="field !py-1.5 !text-[12.5px]">
                <option value="">anyone</option>
                <option value="__none__">nobody yet</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11.5px] text-faint">sort</span>
              <select name="sort" defaultValue={sort} className="field !py-1.5 !text-[12.5px]">
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <label className="inline-flex items-center gap-2 text-[12px] text-muted">
              <input type="checkbox" name="include" value="1" defaultChecked={include} className="size-3.5 accent-[var(--accent)]" />
              show archived leads too
            </label>
            <button type="submit" className="rounded-[7px] border border-line-strong bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2">
              apply
            </button>
          </div>
        </form>
      </Card>

      {/* ---- results ---- */}
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-ink-2">
            <span className="num font-semibold text-ink">{result.total}</span> {result.total === 1 ? "lead" : "leads"}
            {chips.length > 0 ? <span className="text-muted"> match your filters</span> : <span className="text-muted"> in the database</span>}
          </p>
          <FilterChips chips={chips} />
        </div>

        <Card padded={false}>
          <div className="hidden items-center gap-3 border-b border-line px-4 py-2 text-[11px] text-faint md:flex">
            <span className={CELL.lead}>lead</span>
            <span className={CELL.company}>company</span>
            <span className={CELL.stage}>stage</span>
            <span className={CELL.nurture}>nurture</span>
            <span className={CELL.outreach}>outreach</span>
            <span className={CELL.owner} />
            <span className={CELL.activity}>last activity</span>
            <span className={CELL.tasks}>tasks</span>
          </div>

          {result.rows.length === 0 ? (
            <EmptyState
              title="no leads match that"
              hint="try fewer filters, or clear them and start again. if the database is empty you can add people from the website or an import."
              icon={<Icon name="leads" className="size-5" />}
              action={
                <div className="flex items-center gap-3">
                  <Link href="/leads" className="text-[12.5px] text-accent-ink hover:underline">
                    clear the filters
                  </Link>
                  <Link href="/generate" className="text-[12.5px] text-muted hover:text-ink">
                    find new leads
                  </Link>
                </div>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {result.rows.map((lead) => (
                <LeadLine key={lead.id} lead={lead} />
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-muted">
            {result.total === 0 ? "nothing to show" : `showing ${from}–${to} of ${result.total}`}
          </p>
          <div className="flex items-center gap-1.5">
            <PagingLink href={href({ ...current, offset: String(Math.max(0, offset - LIMIT)) })} disabled={!hasPrev} label="← previous" />
            <PagingLink href={href({ ...current, offset: String(offset + LIMIT) })} disabled={!hasNext} label="next →" />
          </div>
        </div>
      </div>
    </div>
  );
}

function LeadLine({ lead }: { lead: LeadView }) {
  const stage = PIPELINE_STAGE_META[lead.pipeline_stage];
  const outreach = OUTREACH_STATE_META[lead.outreach_state];
  const nurture = NURTURE_STATE_META[lead.nurture_state];

  return (
    <li>
      <Link href={`/leads/${lead.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
        <span className={CELL.lead}>
          <Avatar name={lead.full_name} hue={lead.owner_hue ?? undefined} size={28} />
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] text-ink">{lead.full_name}</span>
            <span className="block truncate text-[11px] text-muted">{lead.email ?? "no email yet"}</span>
          </span>
        </span>

        <span className={`${CELL.company} text-[12px] text-muted`}>{lead.company_name ?? "—"}</span>

        <span className={CELL.stage}>
          <StateBadge meta={stage} size="xs" />
        </span>

        <span className={CELL.nurture}>
          {lead.nurture_state === "not_enrolled" ? <span className="text-[11px] text-faint">not in a sequence</span> : <StateBadge meta={nurture} size="xs" />}
        </span>

        <span className={CELL.outreach}>
          <Badge tone={outreach.tone} size="xs">
            {outreach.label}
          </Badge>
        </span>

        <span className={CELL.owner} title={lead.owner_name ?? "unassigned"}>
          {lead.owner_name ? <Avatar name={lead.owner_name} hue={lead.owner_hue ?? undefined} size={22} /> : <Icon name="leads" className="size-3.5 text-faint" />}
        </span>

        <span className={`${CELL.activity} text-[11.5px] text-muted`}>{humanize(lead.last_activity_at ?? lead.created_at)}</span>

        <span className={`${CELL.tasks} text-[11.5px] num`}>
          {lead.open_tasks > 0 ? (
            <span className={lead.overdue_tasks > 0 ? "text-rose" : "text-muted"}>{lead.open_tasks}</span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </span>
      </Link>
    </li>
  );
}

function PagingLink({ href: to, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled) {
    return <span className="rounded-[7px] border border-line bg-surface px-2.5 py-1.5 text-[12px] text-faint">{label}</span>;
  }
  return (
    <Link href={to} className="rounded-[7px] border border-line-strong bg-surface px-2.5 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-surface-2">
      {label}
    </Link>
  );
}

/** builds a /leads link, always resetting the page offset unless we set it. */
function href(params: Search): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/leads?${qs}` : "/leads";
}
