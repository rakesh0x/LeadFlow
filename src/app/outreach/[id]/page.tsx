import Link from "next/link";
import { db } from "@/lib/db/client";
import { requireWorkspaceId } from "@/lib/workspace";
import { formatDate, humanize } from "@/lib/db/time";
import { getCampaign } from "@/lib/queries/outreach";
import { CHANNEL_META, DELIVERY_META, OUTREACH_STATE_META, PIPELINE_STAGE_META } from "@/lib/domain";
import type { Message } from "@/lib/types";
import { Badge, Card, CardHeader, EmptyState, Icon, KeyValue } from "@/components/ui";
import { BarRow } from "@/components/charts";
import { PageHeader } from "@/components/app-shell";
import { CampaignStatus } from "@/components/campaign-status";
import { FollowUpPlanner } from "@/components/follow-up-planner";

export const dynamic = "force-dynamic";

const TONE_SOFT: Record<string, string> = {
  slate: "bg-slate-soft text-slate",
  blue: "bg-blue-soft text-blue",
  violet: "bg-violet-soft text-violet",
  amber: "bg-amber-soft text-amber",
  green: "bg-green-soft text-green",
  rose: "bg-rose-soft text-rose",
  cyan: "bg-cyan-soft text-cyan",
  stone: "bg-stone-soft text-stone",
};

const GLYPH: Record<string, string> = {
  email: "@",
  linkedin: "in",
  x: "x",
  form: "fm",
  phone: "ph",
  sms: "sms",
  meeting: "mt",
  other: "·",
};

interface CampaignLead {
  lead_id: string;
  full_name: string;
  company_name: string | null;
  pipeline_stage: string;
  outreach_state: string;
  messages: number;
  last_at: string | null;
  replied: number;
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const database = db();
  const workspaceId = requireWorkspaceId(database);

  const campaign = getCampaign(workspaceId, id, database);

  if (!campaign) {
    return (
      <div>
        <PageHeader title="campaign" />
        <Card>
          <EmptyState
            title="we couldn't find that campaign"
            hint="it may have been deleted, or the link is a little out of date."
            icon={<Icon name="alert" className="size-5" />}
            action={
              <Link href="/outreach" className="text-[12.5px] text-accent-ink hover:underline">
                back to all outreach →
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const owner = campaign.owner_id
    ? ((database.prepare(`SELECT name FROM members WHERE id = ?`).get(campaign.owner_id) as { name: string } | undefined) ?? null)
    : null;

  const totals = database
    .prepare(
      `SELECT
         COUNT(DISTINCT lead_id) AS leads,
         SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS replies,
         COUNT(DISTINCT CASE WHEN direction = 'outbound' AND delivery_state IN ('failed','bounced') THEN lead_id END) AS failed
       FROM messages WHERE campaign_id = ?`,
    )
    .get(campaign.id) as { leads: number; sent: number | null; replies: number | null; failed: number | null };

  const meetings = (database.prepare(`SELECT COUNT(*) AS n FROM meetings WHERE campaign_id = ?`).get(campaign.id) as { n: number }).n;
  const opportunities = (
    database.prepare(`SELECT COUNT(*) AS n FROM opportunities WHERE campaign_id = ?`).get(campaign.id) as { n: number }
  ).n;
  const won = (
    database.prepare(`SELECT COUNT(*) AS n FROM opportunities WHERE campaign_id = ? AND stage = 'won'`).get(campaign.id) as { n: number }
  ).n;

  const sent = totals.sent ?? 0;
  const replies = totals.replies ?? 0;
  const leads = totals.leads ?? 0;
  const replyRate = sent ? Math.round((replies / sent) * 100) : 0;
  const conversionRate = leads ? Math.round((won / leads) * 1000) / 10 : 0;

  const daily = database
    .prepare(
      `SELECT substr(COALESCE(sent_at, created_at), 1, 10) AS date,
              SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS replies
       FROM messages WHERE campaign_id = ? GROUP BY date ORDER BY date`,
    )
    .all(campaign.id) as Array<{ date: string; sent: number; replies: number }>;

  const messages = database
    .prepare(
      `SELECT m.*, l.full_name AS lead_name FROM messages m
       JOIN leads l ON l.id = m.lead_id
       WHERE m.campaign_id = ? ORDER BY COALESCE(m.sent_at, m.created_at) DESC LIMIT 120`,
    )
    .all(campaign.id) as Array<Message & { lead_name: string }>;

  const campaignLeads = database
    .prepare(
      `SELECT m.lead_id, l.full_name, l.pipeline_stage, l.outreach_state, c.name AS company_name,
              COUNT(*) AS messages,
              SUM(CASE WHEN m.direction = 'inbound' THEN 1 ELSE 0 END) AS replied,
              MAX(COALESCE(m.sent_at, m.created_at)) AS last_at
       FROM messages m
       JOIN leads l ON l.id = m.lead_id
       LEFT JOIN companies c ON c.id = l.company_id
       WHERE m.campaign_id = ?
       GROUP BY m.lead_id
       ORDER BY replied DESC, last_at DESC
       LIMIT 100`,
    )
    .all(campaign.id) as CampaignLead[];

  const channelMeta = CHANNEL_META[campaign.channel as keyof typeof CHANNEL_META] ?? CHANNEL_META.other;
  const maxDay = Math.max(...daily.map((d) => Math.max(d.sent, d.replies)), 1);

  return (
    <div>
      <PageHeader
        title="campaign"
        hint={campaign.description ?? "everything we sent under this name, in one place."}
        actions={
          <>
            <CampaignStatus campaignId={campaign.id} status={campaign.status} />
            <Link
              href={`/outreach?view=messages&campaign=${campaign.id}`}
              className="inline-flex h-7.5 items-center gap-1.5 rounded-[7px] border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-2"
            >
              <Icon name="outreach" className="size-3.5" />
              <span>see every message</span>
            </Link>
          </>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[19px] font-semibold tracking-[-0.025em] text-ink">{campaign.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
                  TONE_SOFT[channelMeta.tone]
                }`}
              >
                <span className="text-[9.5px] font-semibold">{GLYPH[campaign.channel] ?? "·"}</span>
                {channelMeta.label}
              </span>
              <span className="text-[12px] text-muted">{campaign.description ?? channelMeta.hint}</span>
            </div>
          </div>

          <div className="w-full max-w-[260px]">
            <KeyValue label="started">{campaign.started_at ? formatDate(campaign.started_at) : "not started yet"}</KeyValue>
            <KeyValue label="owner">{owner?.name ?? "nobody yet"}</KeyValue>
            <KeyValue label="made">{formatDate(campaign.created_at)}</KeyValue>
          </div>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="leads reached" value={leads} />
        <Stat label="sent" value={sent} />
        <Stat label="replies" value={replies} tone="green" />
        <Stat label="reply rate" value={replyRate} suffix="%" tone={replyRate > 10 ? "green" : "slate"} />
        <Stat label="meetings" value={meetings} tone="cyan" />
        <Stat label="opportunities" value={opportunities} tone="amber" />
        <Stat label="converted" value={won} tone="green" />
        <Stat label="conversion" value={conversionRate} suffix="%" tone="green" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="reply rate by day" hint="how much went out each day, and how much came back" />
            {daily.length === 0 ? (
              <p className="py-5 text-center text-[12.5px] text-muted">nothing has been sent yet.</p>
            ) : (
              <div className="mt-4 space-y-2.5">
                {daily.slice(-14).map((d) => (
                  <BarRow
                    key={d.date}
                    label={formatDate(d.date)}
                    value={d.sent}
                    max={maxDay}
                    tone="var(--accent)"
                    right={
                      <>
                        <span className="num text-ink">{d.sent}</span>
                        {d.sent ? <span className="ml-1.5 text-faint">{Math.round((d.replies / d.sent) * 100)}% replied</span> : null}
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </Card>

          <Card padded={false}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">everything sent here</h2>
                <p className="mt-0.5 text-[12px] text-muted">{messages.length} messages, newest first</p>
              </div>
            </div>

            {messages.length === 0 ? (
              <EmptyState
                title="nothing sent yet"
                hint="when messages go out under this campaign they will show up here with their delivery state."
                icon={<Icon name="outreach" className="size-5" />}
              />
            ) : (
              <ul className="divide-y divide-line">
                {messages.map((m) => {
                  const inbound = m.direction === "inbound";
                  const delivery = DELIVERY_META[m.delivery_state] ?? DELIVERY_META.sent;
                  return (
                    <li key={m.id} className={`flex items-start gap-2.5 px-4 py-2.5 ${inbound ? "bg-green-soft/40" : ""}`}>
                      <span
                        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-[7px] text-[9.5px] font-semibold ${
                          inbound ? "bg-green-soft text-green" : TONE_SOFT[channelMeta.tone]
                        }`}
                      >
                        {inbound ? "←" : GLYPH[campaign.channel] ?? "·"}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-1.5">
                          <Link href={`/leads/${m.lead_id}`} className="truncate text-[12.5px] font-medium text-ink hover:underline">
                            {m.lead_name}
                          </Link>
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-muted">
                          {m.subject ? <span className="text-ink-2">{m.subject} — </span> : null}
                          {(m.content ?? "no text").replace(/\s+/g, " ").slice(0, 120)}
                        </span>
                      </span>

                      <span className="flex shrink-0 items-center gap-1.5">
                        <Badge tone={delivery.tone} size="xs" title={delivery.hint}>
                          {delivery.label}
                        </Badge>
                        <span className="hidden w-20 text-right text-[11px] text-faint sm:block">{humanize(m.sent_at ?? m.created_at)}</span>
                        {!inbound ? <FollowUpPlanner messageId={m.id} followUpAt={m.next_follow_up_at} /> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <Card padded={false} className="self-start">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">who this reached</h2>
            <p className="mt-0.5 text-[12px] text-muted">{campaignLeads.length} people, most talkative first</p>
          </div>

          {campaignLeads.length === 0 ? (
            <EmptyState title="nobody yet" hint="leads show up here as soon as they are part of this campaign." />
          ) : (
            <ul className="divide-y divide-line">
              {campaignLeads.map((l) => {
                const stage = PIPELINE_STAGE_META[l.pipeline_stage as "new"] ?? PIPELINE_STAGE_META.new;
                const outreach = OUTREACH_STATE_META[l.outreach_state as "never_contacted"] ?? OUTREACH_STATE_META.never_contacted;
                return (
                  <li key={l.lead_id}>
                    <Link href={`/leads/${l.lead_id}`} className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-ink">{l.full_name}</span>
                        <span className="block truncate text-[11px] text-muted">
                          {l.company_name ?? "no company"} · {l.messages} message{l.messages === 1 ? "" : "s"}
                          {l.last_at ? ` · ${humanize(l.last_at)}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={stage.tone} size="xs">
                          {stage.label}
                        </Badge>
                        <Badge tone={outreach.tone} size="xs" title="where outreach is up to">
                          {outreach.label}
                        </Badge>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  suffix = "",
  tone = "slate",
}: {
  label: string;
  value: number;
  suffix?: string;
  tone?: "slate" | "green" | "cyan" | "amber";
}) {
  const color: Record<string, string> = {
    slate: "var(--ink)",
    green: "var(--green)",
    cyan: "var(--cyan)",
    amber: "var(--amber)",
  };
  return (
    <div className="panel p-3">
      <div className="text-[11.5px] leading-tight text-muted">{label}</div>
      <div className="mt-1.5 text-[22px] font-semibold leading-none tracking-[-0.035em] num" style={{ color: color[tone] ?? color.slate }}>
        {value}
        {suffix}
      </div>
    </div>
  );
}
