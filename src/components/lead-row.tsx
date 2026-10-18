import Link from "next/link";
import { humanize } from "@/lib/db/time";
import { NURTURE_STATE_META, OUTREACH_STATE_META, PIPELINE_STAGE_META } from "@/lib/domain";
import type { LeadView } from "@/lib/types";
import { Avatar, Badge } from "./ui";

/** the standard lead line used in every list on the site. */
export function LeadRow({
  lead,
  compact = false,
  showCompany = true,
  selected = false,
}: {
  lead: LeadView;
  compact?: boolean;
  showCompany?: boolean;
  selected?: boolean;
}) {
  const stage = PIPELINE_STAGE_META[lead.pipeline_stage];
  const outreach = OUTREACH_STATE_META[lead.outreach_state];
  const nurture = NURTURE_STATE_META[lead.nurture_state];

  const subtitle = [lead.job_title, showCompany ? lead.company_name : null].filter(Boolean).join(" at ") || lead.email || "—";

  return (
    <Link
      href={`/leads/${lead.id}`}
      className={`group flex items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 transition-colors ${
        selected ? "bg-accent-soft" : "hover:bg-surface-2"
      }`}
    >
      <Avatar name={lead.full_name} hue={lead.owner_hue ?? undefined} size={compact ? 26 : 30} />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[12.5px] text-ink">{lead.full_name}</span>
          {lead.is_new === 1 && lead.first_touched_at === null ? (
            <span className="shrink-0 rounded bg-amber-soft px-1 py-px text-[9.5px] font-medium uppercase tracking-wide text-amber">new</span>
          ) : null}
        </span>
        <span className="block truncate text-[11px] text-muted">{subtitle}</span>
      </span>

      {!compact ? (
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          <Badge tone={stage.tone} size="xs">
            {stage.label}
          </Badge>
          {lead.nurture_state !== "not_enrolled" ? (
            <Badge tone={nurture.tone} size="xs" title="nurture state">
              {nurture.label}
            </Badge>
          ) : null}
        </span>
      ) : null}

      {!compact ? (
        <span className="hidden w-20 shrink-0 text-right lg:block">
          <span className="block truncate text-[11px] text-muted">{lead.owner_name ?? "unassigned"}</span>
          <span className="block text-[10.5px] text-faint">{humanize(lead.last_activity_at ?? lead.created_at)}</span>
        </span>
      ) : null}

      {!compact ? (
        <span className="hidden w-14 shrink-0 text-right md:block">
          <Badge tone={outreach.tone} size="xs">
            {outreach.label}
          </Badge>
        </span>
      ) : null}
    </Link>
  );
}