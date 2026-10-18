import Link from "next/link";
import { db } from "@/lib/db/client";
import { requireWorkspaceId } from "@/lib/workspace";
import { humanize, isPast } from "@/lib/db/time";
import { listCampaigns, listConversations, queryMessages } from "@/lib/queries/outreach";
import { channelPerformance } from "@/lib/queries/analytics";
import { CHANNEL_META, DELIVERY_META, OUTREACH_STATE_META } from "@/lib/domain";
import type { Channel } from "@/lib/domain";
import type { Message } from "@/lib/types";
import { Badge, Button, Card, CardHeader, EmptyState, Icon } from "@/components/ui";
import { BarRow } from "@/components/charts";
import { PageHeader, Tabs } from "@/components/app-shell";
import { CampaignStatusBadge } from "@/components/campaign-status";
import { NewCampaign } from "@/components/new-campaign";
import { LogCallButton } from "@/components/compose-message";
import { FollowUpPlanner } from "@/components/follow-up-planner";

export const dynamic = "force-dynamic";

const VIEWS = ["campaigns", "messages", "conversations", "calls"] as const;
type View = (typeof VIEWS)[number];

const FILTER_CHANNELS: Channel[] = ["email", "linkedin", "x", "form", "phone", "sms", "other"];

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

function ChannelMark({ channel }: { channel: Channel }) {
  const meta = CHANNEL_META[channel] ?? CHANNEL_META.other;
  return (
    <span
      title={meta.hint}
      className={`grid size-5 shrink-0 place-items-center rounded-[6px] text-[9.5px] font-semibold ${
        TONE_SOFT[meta.tone] ?? TONE_SOFT.slate
      }`}
    >
      {GLYPH[channel] ?? "·"}
    </span>
  );
}

function preview(text: string | null, max = 110): string {
  if (!text) return "no text";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; channel?: string; direction?: string; campaign?: string; q?: string }>;
}) {
  const params = await searchParams;
  const view = (VIEWS.find((v) => v === params.view) ?? "campaigns") as View;
  const channel = (FILTER_CHANNELS.find((c) => c === params.channel) ?? "all") as Channel | "all";
  const direction = (["outbound", "inbound"].find((d) => d === params.direction) ?? "all") as "outbound" | "inbound" | "all";
  const campaignId = params.campaign ?? "";
  const q = params.q ?? "";

  const database = db();
  const workspaceId = requireWorkspaceId(database);

  const campaigns = listCampaigns(workspaceId, database);
  const campaignNames = new Map(campaigns.map((c) => [c.id, c.name]));
  const channelStats = channelPerformance(workspaceId, "30d", undefined, database);

  const messages = queryMessages(
    workspaceId,
    { channel, direction, campaignId: campaignId || undefined, q: q || undefined, limit: 60 },
    database,
  );
  const calls = queryMessages(workspaceId, { channel: "phone", direction: "outbound", limit: 60 }, database);
  const conversations = listConversations(workspaceId, { channel, limit: 60 }, database);

  const leadNames = new Map(
    (
      database.prepare(`SELECT id, full_name FROM leads WHERE workspace_id = ?`).all(workspaceId) as Array<{
        id: string;
        full_name: string;
      }>
    ).map((l) => [l.id, l.full_name]),
  );

  const threadCounts = new Map<string, number>();
  for (const row of database
    .prepare(`SELECT lead_id, channel, COUNT(*) AS n FROM messages WHERE workspace_id = ? GROUP BY lead_id, channel`)
    .all(workspaceId) as Array<{ lead_id: string; channel: string; n: number }>) {
    threadCounts.set(`${row.lead_id}:${row.channel}`, row.n);
  }

  const owners = new Map(
    (
      database.prepare(`SELECT id, name FROM members WHERE workspace_id = ?`).all(workspaceId) as Array<{ id: string; name: string }>
    ).map((m) => [m.id, m.name]),
  );

  const outreachStates = new Map(
    (
      database.prepare(`SELECT id, outreach_state FROM leads WHERE workspace_id = ?`).all(workspaceId) as Array<{
        id: string;
        outreach_state: string;
      }>
    ).map((l) => [l.id, l.outreach_state]),
  );

  const dialList = [...leadNames.entries()].map(([id, name]) => ({ id, name })).slice(0, 200);

  const tabs = [
    { label: "campaigns", value: "campaigns", count: campaigns.length },
    { label: "messages", value: "messages", count: messages.total },
    { label: "conversations", value: "conversations", count: conversations.length },
    { label: "calls", value: "calls", count: calls.total },
  ];

  return (
    <div>
      <PageHeader
        title="outreach"
        hint="everything we send out, and everything that comes back. one place to keep an eye on it all."
        actions={
          <>
            <Button href="/follow-ups" variant="secondary" size="sm">
              <Icon name="followups" className="size-3.5" />
              <span>follow-ups</span>
            </Button>
            <NewCampaign />
          </>
        }
        tabs={<Tabs items={tabs} active={view} basePath="/outreach" />}
      />

      {/* ---- how each channel is doing ---- */}
      <Card className="mb-4">
        <CardHeader title="outreach by channel" hint="what went out and what came back in the last 30 days" />
        {channelStats.length === 0 ? (
          <p className="py-5 text-center text-[12.5px] text-muted">nothing has gone out yet.</p>
        ) : (
          <div className="mt-4 grid gap-x-8 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {channelStats.map((c) => (
              <BarRow
                key={c.channel}
                label={CHANNEL_META[c.channel as Channel]?.label ?? c.channel}
                value={c.sent}
                max={Math.max(...channelStats.map((x) => x.sent), 1)}
                tone={`var(--${CHANNEL_META[c.channel as Channel]?.tone ?? "slate"})`}
                right={
                  <>
                    <span className="num text-ink">{c.sent}</span>
                    <span className="ml-1.5 text-faint">{c.sent ? `${c.rate}% replied` : "nothing sent"}</span>
                  </>
                }
                href={`/outreach?view=messages&channel=${c.channel}`}
              />
            ))}
          </div>
        )}
      </Card>

      {view === "campaigns" ? <CampaignsView campaigns={campaigns} owners={owners} /> : null}
      {view === "messages" ? (
        <MessagesView
          rows={messages.rows}
          total={messages.total}
          leadNames={leadNames}
          campaignNames={campaignNames}
          channel={channel}
          direction={direction}
          campaignId={campaignId}
          campaignName={campaignNames.get(campaignId)}
          q={q}
        />
      ) : null}
      {view === "conversations" ? (
        <ConversationsView rows={conversations} threadCounts={threadCounts} outreachStates={outreachStates} channel={channel} />
      ) : null}
      {view === "calls" ? <CallsView rows={calls.rows} leadNames={leadNames} campaignNames={campaignNames} dialList={dialList} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- campaigns

function CampaignsView({
  campaigns,
  owners,
}: {
  campaigns: ReturnType<typeof listCampaigns>;
  owners: Map<string, string>;
}) {
  if (campaigns.length === 0) {
    return (
      <Card>
        <EmptyState
          title="no campaigns yet"
          hint="a campaign is just a name for a batch of messages. make one and everything you send with it gets counted together."
          icon={<Icon name="outreach" className="size-5" />}
          action={<NewCampaign />}
        />
      </Card>
    );
  }

  const maxSent = Math.max(...campaigns.map((c) => c.sent_count), 1);

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {campaigns.map((c) => (
        <Card key={c.id} className="flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/outreach/${c.id}`} className="block truncate text-[14px] font-semibold tracking-[-0.015em] text-ink hover:underline">
                {c.name}
              </Link>
              <p className="mt-0.5 truncate text-[11.5px] text-muted">
                {c.description ?? `sent through ${CHANNEL_META[c.channel as Channel]?.label ?? c.channel}`}
              </p>
            </div>
            <CampaignStatusBadge status={c.status} />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <ChannelMark channel={c.channel as Channel} />
            <span className="text-[12px] text-ink-2">{CHANNEL_META[c.channel as Channel]?.label ?? c.channel}</span>
            <span className="text-[11.5px] text-faint">· {c.owner_id ? (owners.get(c.owner_id) ?? "someone") : "no owner"}</span>
          </div>

          <div className="mt-3">
            <BarRow
              label="sent"
              value={c.sent_count}
              max={maxSent}
              tone="var(--accent)"
              right={
                <>
                  <span className="num text-ink">{c.sent_count}</span>
                  <span className="ml-1.5 text-faint">{c.sent_count ? `${c.reply_rate}% replied` : "nothing sent"}</span>
                </>
              }
            />
          </div>

          <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
            <Figure label="sent" value={c.sent_count} />
            <Figure label="replies" value={c.reply_count} tone="green" />
            <Figure label="leads" value={c.lead_count} />
          </dl>

          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="text-[11px] text-faint">{c.sent_count ? `${c.reply_rate}% reply rate` : "no sends yet"}</span>
            <Link href={`/outreach?view=messages&campaign=${c.id}`} className="text-[12px] text-accent-ink hover:underline">
              see the messages →
            </Link>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: "green" }) {
  return (
    <div>
      <dd className={`num text-[17px] font-semibold leading-none tracking-[-0.03em] ${tone === "green" ? "text-green" : "text-ink"}`}>
        {value}
      </dd>
      <dt className="mt-1 text-[11px] text-faint">{label}</dt>
    </div>
  );
}

// ---------------------------------------------------------------- messages

function MessagesView({
  rows,
  total,
  leadNames,
  campaignNames,
  channel,
  direction,
  campaignId,
  campaignName,
  q,
}: {
  rows: Message[];
  total: number;
  leadNames: Map<string, string>;
  campaignNames: Map<string, string>;
  channel: Channel | "all";
  direction: "outbound" | "inbound" | "all";
  campaignId: string;
  campaignName?: string;
  q: string;
}) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">the send log</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {total} message{total === 1 ? "" : "s"}
            {campaignName ? ` in ${campaignName}` : ""}
            {channel !== "all" ? ` over ${CHANNEL_META[channel].label}` : ""}
          </p>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value="messages" />
          {campaignId ? <input type="hidden" name="campaign" value={campaignId} /> : null}
          <label className="block">
            <span className="mb-0.5 block text-[10.5px] text-faint">channel</span>
            <select name="channel" defaultValue={channel} className="field w-auto py-1 text-[12px]">
              <option value="all">everything</option>
              {FILTER_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_META[c].label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10.5px] text-faint">who sent it</span>
            <select name="direction" defaultValue={direction} className="field w-auto py-1 text-[12px]">
              <option value="all">both ways</option>
              <option value="outbound">we sent</option>
              <option value="inbound">they wrote</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10.5px] text-faint">search</span>
            <input name="q" defaultValue={q} placeholder="a name or a word" className="field w-[150px] py-1 text-[12px]" />
          </label>
          <Button type="submit" variant="secondary" size="xs">
            filter
          </Button>
          {campaignId || q || channel !== "all" || direction !== "all" ? (
            <Link href="/outreach?view=messages" className="text-[11.5px] text-muted hover:text-ink">
              clear
            </Link>
          ) : null}
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="nothing here"
          hint="no messages match those filters. try widening them, or go and write to someone new."
          icon={<Icon name="outreach" className="size-5" />}
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((m) => (
            <MessageLine key={m.id} message={m} leadName={leadNames.get(m.lead_id) ?? "unknown lead"} campaignName={m.campaign_id ? campaignNames.get(m.campaign_id) : null} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function MessageLine({
  message,
  leadName,
  campaignName,
  showPlanner = true,
}: {
  message: Message;
  leadName: string;
  campaignName?: string | null;
  showPlanner?: boolean;
}) {
  const inbound = message.direction === "inbound";
  const delivery = DELIVERY_META[message.delivery_state] ?? DELIVERY_META.sent;

  return (
    <li className={`flex items-start gap-2.5 px-4 py-2.5 ${inbound ? "bg-green-soft/40" : ""}`}>
      <span
        title={inbound ? "they wrote to us" : "we wrote to them"}
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-[7px] text-[12px] font-semibold ${
          inbound ? "bg-green-soft text-green" : "bg-accent-soft text-accent-ink"
        }`}
      >
        {inbound ? "←" : "→"}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <Link href={`/leads/${message.lead_id}`} className="truncate text-[12.5px] font-medium text-ink hover:underline">
            {leadName}
          </Link>
          <ChannelMark channel={message.channel} />
          {campaignName ? (
            <Link href={`/outreach?view=messages&campaign=${message.campaign_id}`} className="truncate text-[11px] text-accent-ink hover:underline">
              {campaignName}
            </Link>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted">
          {message.subject ? <span className="text-ink-2">{message.subject} — </span> : null}
          {preview(message.content)}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1.5">
        {message.next_follow_up_at ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${
              isPast(message.next_follow_up_at) ? "bg-rose-soft text-rose" : "bg-amber-soft text-amber"
            }`}
            title="we said we would chase this"
          >
            <Icon name="clock" className="size-2.5" />
            {humanize(message.next_follow_up_at)}
          </span>
        ) : null}
        <Badge tone={delivery.tone} size="xs" title={delivery.hint}>
          {delivery.label}
        </Badge>
        <span className="hidden w-20 text-right text-[11px] text-faint sm:block">{humanize(message.sent_at ?? message.created_at)}</span>
        {showPlanner && !inbound ? <FollowUpPlanner messageId={message.id} followUpAt={message.next_follow_up_at} /> : null}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------- conversations

function ConversationsView({
  rows,
  threadCounts,
  outreachStates,
  channel,
}: {
  rows: ReturnType<typeof listConversations>;
  threadCounts: Map<string, number>;
  outreachStates: Map<string, string>;
  channel: Channel | "all";
}) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">conversations</h2>
          <p className="mt-0.5 text-[12px] text-muted">the latest message for each person, per channel</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Link
            href="/outreach?view=conversations"
            className={`rounded-[6px] px-2 py-1 text-[12px] ${channel === "all" ? "bg-accent-soft font-medium text-accent-ink" : "text-muted hover:text-ink"}`}
          >
            everything
          </Link>
          {FILTER_CHANNELS.slice(0, 6).map((c) => (
            <Link
              key={c}
              href={`/outreach?view=conversations&channel=${c}`}
              className={`rounded-[6px] px-2 py-1 text-[12px] ${channel === c ? "bg-accent-soft font-medium text-accent-ink" : "text-muted hover:text-ink"}`}
            >
              {CHANNEL_META[c].label}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="no conversations yet"
          hint="a conversation appears once you and someone have exchanged messages."
          icon={<Icon name="leads" className="size-5" />}
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => {
            const inbound = row.direction === "inbound";
            const count = threadCounts.get(`${row.lead_id}:${row.channel}`) ?? 1;
            const outreach = OUTREACH_STATE_META[(outreachStates.get(row.lead_id) ?? "never_contacted") as "never_contacted"];
            return (
              <li key={row.id} className={`flex items-center gap-2.5 px-4 py-2.5 ${inbound ? "bg-green-soft/40" : ""}`}>
                <span className={`grid size-6 shrink-0 place-items-center rounded-[7px] text-[12px] font-semibold ${inbound ? "bg-green-soft text-green" : "bg-accent-soft text-accent-ink"}`}>
                  {inbound ? "←" : "→"}
                </span>

                <Link href={`/leads/${row.lead_id}`} className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-1.5">
                    <span className="truncate text-[12.5px] font-medium text-ink">{row.lead_full_name}</span>
                    <ChannelMark channel={row.channel} />
                    <span className="text-[11px] text-faint">
                      {count} message{count === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted">
                    {row.subject ? <span className="text-ink-2">{row.subject} — </span> : null}
                    {preview(row.content)}
                  </span>
                </Link>

                <span className="hidden shrink-0 text-right sm:block">
                  <Badge tone={outreach.tone} size="xs" title={outreach.hint}>
                    {outreach.label}
                  </Badge>
                  <span className="mt-1 block text-[11px] text-faint">{humanize(row.sent_at ?? row.created_at)}</span>
                </span>

                <Link href={`/leads/${row.lead_id}`} className="shrink-0 text-[11.5px] text-accent-ink hover:underline">
                  open
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- calls

function CallsView({
  rows,
  leadNames,
  campaignNames,
  dialList,
}: {
  rows: Message[];
  leadNames: Map<string, string>;
  campaignNames: Map<string, string>;
  dialList: Array<{ id: string; name: string }>;
}) {
  const connected = rows.filter((r) => r.delivery_state === "connected").length;
  const missed = rows.filter((r) => r.delivery_state === "missed").length;
  const totalMinutes = Math.round(rows.reduce((sum, r) => sum + (r.duration_seconds ?? 0), 0) / 60);

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">calls</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {rows.length} logged · {connected} spoke · {missed} no answer · {totalMinutes} minutes on the phone
          </p>
        </div>
        <LogCallButton leads={dialList} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="no calls logged yet"
          hint="log a call when you ring someone. it keeps the timeline honest and shows up in their record."
          icon={<Icon name="leads" className="size-5" />}
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((m) => {
            const spoke = m.delivery_state === "connected";
            const minutes = Math.round((m.duration_seconds ?? 0) / 60);
            return (
              <li key={m.id} className="flex items-center gap-2.5 px-4 py-2.5">
                <span className={`grid size-6 shrink-0 place-items-center rounded-[7px] text-[9.5px] font-semibold ${TONE_SOFT.green}`}>ph</span>

                <Link href={`/leads/${m.lead_id}`} className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-1.5">
                    <span className="truncate text-[12.5px] font-medium text-ink">{leadNames.get(m.lead_id) ?? "unknown lead"}</span>
                    {m.campaign_id && campaignNames.get(m.campaign_id) ? (
                      <span className="truncate text-[11px] text-accent-ink">{campaignNames.get(m.campaign_id)}</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted">{preview(m.content)}</span>
                </Link>

                <span className="flex shrink-0 items-center gap-2">
                  <span className={`num text-[12px] ${minutes ? "text-ink" : "text-faint"}`}>{minutes ? `${minutes} min` : "no time logged"}</span>
                  <Badge tone={spoke ? "green" : "amber"} size="xs">
                    {spoke ? "spoke" : "no answer"}
                  </Badge>
                  <span className="hidden w-20 text-right text-[11px] text-faint sm:block">{humanize(m.sent_at ?? m.created_at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
