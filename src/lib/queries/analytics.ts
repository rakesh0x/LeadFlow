/**
 * analytics.
 * every figure here is a count over real rows. there is no cached "stat" column
 * to drift out of date — if a number is on the dashboard, you can go and find the leads.
 */
import type { Database } from "better-sqlite3";
import { db } from "../db/client";
import { daysAgoIso, nowIso } from "../db/time";
import type { Channel, PipelineStage } from "../domain";

export type Period = "7d" | "30d" | "90d" | "all" | "custom";

export const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "all": 3650 };

export function periodStart(period: Period, from?: string, to?: string): string {
  if (period === "custom" && from) return from;
  const days = PERIOD_DAYS[period] ?? 30;
  return daysAgoIso(days);
}

const BASE = `FROM leads l WHERE l.workspace_id = @ws AND l.merged_into_lead_id IS NULL AND l.is_archived = 0`;

export interface Overview {
  period: Period;
  from: string;
  to: string;
  totalLeads: number;
  acquiredInPeriod: number;
  acquiredPreviousPeriod: number;
  newUnprocessed: number;
  qualified: number;
  contacted: number;
  replied: number;
  awaitingReply: number;
  noReplyEver: number;
  overdueFollowUps: number;
  nurturing: number;
  notNurtured: number;
  readyForReengagement: number;
  meetingsBooked: number;
  meetingsUpcoming: number;
  opportunities: number;
  openOpportunityValue: number;
  wonValue: number;
  converted: number;
  conversionRate: number;
  conversionRatePrevious: number;
  lost: number;
  disqualified: number;
  duplicatesMerged: number;
  pendingDupeReviews: number;
}

export function overview(workspaceId: string, period: Period = "30d", from?: string, to?: string, database = db()): Overview {
  const start = periodStart(period, from);
  const end = to ?? nowIso();
  const startDate = new Date(start).getTime();
  const spanMs = Math.max(86_400_000, new Date(end).getTime() - startDate);
  const prevStart = new Date(startDate - spanMs).toISOString();

  const params = { ws: workspaceId, start, end, prevStart, prevEnd: start };

  const totals = database
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN l.created_at >= @start AND l.created_at <= @end THEN 1 ELSE 0 END) AS acquired,
         SUM(CASE WHEN l.created_at >= @prevStart AND l.created_at < @prevEnd THEN 1 ELSE 0 END) AS acquired_prev,
         SUM(CASE WHEN l.is_new = 1 AND l.first_touched_at IS NULL THEN 1 ELSE 0 END) AS unprocessed,
         SUM(CASE WHEN l.pipeline_stage IN ('qualified','engaged','meeting_booked','opportunity','converted') THEN 1 ELSE 0 END) AS qualified,
         SUM(CASE WHEN l.outbound_count > 0 THEN 1 ELSE 0 END) AS contacted,
         SUM(CASE WHEN l.reply_count > 0 THEN 1 ELSE 0 END) AS replied,
         SUM(CASE WHEN l.outbound_count > 0 AND l.reply_count = 0 THEN 1 ELSE 0 END) AS no_reply,
         SUM(CASE WHEN l.outreach_state = 'awaiting_reply' THEN 1 ELSE 0 END) AS awaiting,
         SUM(CASE WHEN l.nurture_state = 'nurturing' THEN 1 ELSE 0 END) AS nurturing,
         SUM(CASE WHEN l.nurture_state = 'not_enrolled' THEN 1 ELSE 0 END) AS not_nurtured,
         SUM(CASE WHEN l.nurture_state = 'ready_for_reengagement' THEN 1 ELSE 0 END) AS reengage,
         SUM(CASE WHEN l.pipeline_stage = 'converted' THEN 1 ELSE 0 END) AS converted,
         SUM(CASE WHEN l.converted_at >= @start THEN 1 ELSE 0 END) AS converted_in_period,
         SUM(CASE WHEN l.pipeline_stage = 'lost' THEN 1 ELSE 0 END) AS lost,
         SUM(CASE WHEN l.pipeline_stage = 'disqualified' THEN 1 ELSE 0 END) AS disqualified
       ${BASE}`,
    )
    .get(params) as Record<string, number | null>;

  const overdue = (
    database
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks t JOIN leads l ON l.id = t.lead_id
         WHERE t.workspace_id = @ws AND t.status IN ('open','in_progress')
           AND t.due_at IS NOT NULL AND t.due_at < @end AND l.merged_into_lead_id IS NULL`,
      )
      .get({ ws: workspaceId, end }) as { n: number }
  ).n;

  const meetings = database
    .prepare(
      `SELECT
         SUM(CASE WHEN m.created_at >= @start THEN 1 ELSE 0 END) AS booked,
         SUM(CASE WHEN m.scheduled_at > @end AND m.status = 'scheduled' THEN 1 ELSE 0 END) AS upcoming
       FROM meetings m JOIN leads l ON l.id = m.lead_id
       WHERE m.workspace_id = @ws AND l.merged_into_lead_id IS NULL`,
    )
    .get({ ws: workspaceId, start, end }) as { booked: number | null; upcoming: number | null };

  const opps = database
    .prepare(
      `SELECT
         SUM(CASE WHEN o.created_at >= @start THEN 1 ELSE 0 END) AS created,
         COALESCE(SUM(CASE WHEN o.stage IN ('qualifying','proposal','negotiation') THEN o.amount ELSE 0 END), 0) AS open_value,
         COALESCE(SUM(CASE WHEN o.stage = 'won' THEN o.amount ELSE 0 END), 0) AS won_value
       FROM opportunities o JOIN leads l ON l.id = o.lead_id
       WHERE o.workspace_id = @ws AND l.merged_into_lead_id IS NULL`,
    )
    .get({ ws: workspaceId, start }) as { created: number | null; open_value: number; won_value: number };

  const merges = (
    database.prepare(`SELECT COUNT(*) AS n FROM lead_merges WHERE workspace_id = ?`).get(workspaceId) as { n: number }
  ).n;
  const pendingDupes = (
    database.prepare(`SELECT COUNT(*) AS n FROM dupe_candidates WHERE workspace_id = ? AND status = 'pending'`).get(workspaceId) as { n: number }
  ).n;

  const acquired = totals.acquired ?? 0;
  const convertedInPeriod = totals.converted_in_period ?? 0;

  return {
    period,
    from: start,
    to: end,
    totalLeads: totals.total ?? 0,
    acquiredInPeriod: acquired,
    acquiredPreviousPeriod: totals.acquired_prev ?? 0,
    newUnprocessed: totals.unprocessed ?? 0,
    qualified: totals.qualified ?? 0,
    contacted: totals.contacted ?? 0,
    replied: totals.replied ?? 0,
    awaitingReply: totals.awaiting ?? 0,
    noReplyEver: totals.no_reply ?? 0,
    overdueFollowUps: overdue,
    nurturing: totals.nurturing ?? 0,
    notNurtured: totals.not_nurtured ?? 0,
    readyForReengagement: totals.reengage ?? 0,
    meetingsBooked: meetings.booked ?? 0,
    meetingsUpcoming: meetings.upcoming ?? 0,
    opportunities: opps.created ?? 0,
    openOpportunityValue: opps.open_value,
    wonValue: opps.won_value,
    converted: totals.converted ?? 0,
    conversionRate: acquired ? Math.round((convertedInPeriod / acquired) * 1000) / 10 : 0,
    conversionRatePrevious: totals.acquired_prev ? Math.round(((totals.converted ?? 0) / totals.acquired_prev) * 1000) / 10 : 0,
    lost: totals.lost ?? 0,
    disqualified: totals.disqualified ?? 0,
    duplicatesMerged: merges,
    pendingDupeReviews: pendingDupes,
  };
}

export interface StageCount {
  stage: PipelineStage;
  count: number;
  share: number;
}

/** where everyone sits right now, plus how many arrived in the window. */
export function stageBreakdown(workspaceId: string, period: Period = "30d", from?: string, database = db()): StageCount[] {
  const start = periodStart(period, from);
  const rows = database
    .prepare(
      `SELECT l.pipeline_stage AS stage, COUNT(*) AS count,
              SUM(CASE WHEN l.created_at >= @start THEN 1 ELSE 0 END) AS new_in_period
       ${BASE} GROUP BY l.pipeline_stage`,
    )
    .all({ ws: workspaceId, start }) as Array<{ stage: PipelineStage; count: number; new_in_period: number }>;

  const total = rows.reduce((sum, r) => sum + r.count, 0) || 1;
  const order: PipelineStage[] = [
    "new",
    "to_qualify",
    "qualified",
    "contacted",
    "engaged",
    "meeting_booked",
    "opportunity",
    "converted",
    "lost",
    "disqualified",
  ];
  return order.map((stage) => {
    const found = rows.find((r) => r.stage === stage);
    const count = found?.count ?? 0;
    return { stage, count, share: Math.round((count / total) * 1000) / 10 };
  });
}

/** conversion rate measured from acquisition through to each stage. */
export function conversionFunnel(workspaceId: string, period: Period = "30d", from?: string, database = db()) {
  const start = periodStart(period, from);
  const row = database
    .prepare(
      `SELECT
         COUNT(*) AS acquired,
         SUM(CASE WHEN l.outbound_count > 0 THEN 1 ELSE 0 END) AS contacted,
         SUM(CASE WHEN l.reply_count > 0 THEN 1 ELSE 0 END) AS replied,
         SUM(CASE WHEN l.meeting_count > 0 THEN 1 ELSE 0 END) AS met,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM opportunities o WHERE o.lead_id = l.id) THEN 1 ELSE 0 END) AS opp,
         SUM(CASE WHEN l.pipeline_stage = 'converted' THEN 1 ELSE 0 END) AS converted
       ${BASE} AND l.created_at >= @start`,
    )
    .get({ ws: workspaceId, start }) as Record<string, number | null>;

  const acquired = row.acquired ?? 0;
  const steps = [
    { key: "acquired", label: "acquired", count: acquired },
    { key: "contacted", label: "contacted", count: row.contacted ?? 0 },
    { key: "replied", label: "replied", count: row.replied ?? 0 },
    { key: "met", label: "met", count: row.met ?? 0 },
    { key: "opportunity", label: "opportunity", count: row.opp ?? 0 },
    { key: "converted", label: "converted", count: row.converted ?? 0 },
  ];
  return steps.map((s) => ({ ...s, rate: acquired ? Math.round((s.count / acquired) * 1000) / 10 : 0 }));
}

export interface TrendPoint {
  date: string;
  acquired: number;
  contacted: number;
  replied: number;
  converted: number;
}

/** daily counts so the dashboard can show movement, not just a snapshot. */
export function trends(workspaceId: string, period: Period = "30d", from?: string, database = db()): TrendPoint[] {
  const days = period === "all" ? 90 : (PERIOD_DAYS[period] ?? 30);
  const windowStart = from ?? daysAgoIso(days);
  // the chart always covers the last `days` days ending today, whatever `from` is
  const endMs = Date.now();
  const startMs = from ? new Date(from).getTime() : endMs - days * 86_400_000;
  const count = Math.max(2, Math.min(days, Math.round((endMs - startMs) / 86_400_000) + 1));

  const acquired = database
    .prepare(`SELECT substr(l.created_at,1,10) AS date, COUNT(*) AS n ${BASE} AND l.created_at >= @start GROUP BY date`)
    .all({ ws: workspaceId, start: windowStart }) as Array<{ date: string; n: number }>;

  const events = database
    .prepare(
      `SELECT substr(e.occurred_at,1,10) AS date,
              SUM(CASE WHEN e.type = 'message_sent' THEN 1 ELSE 0 END) AS contacted,
              SUM(CASE WHEN e.type = 'message_replied' THEN 1 ELSE 0 END) AS replied,
              SUM(CASE WHEN e.type IN ('opportunity_won','converted') THEN 1 ELSE 0 END) AS converted
       FROM activity_events e JOIN leads l ON l.id = e.lead_id
       WHERE e.workspace_id = @ws AND e.occurred_at >= @start AND l.merged_into_lead_id IS NULL
       GROUP BY date`,
    )
    .all({ ws: workspaceId, start: windowStart }) as Array<{ date: string; contacted: number; replied: number; converted: number }>;

  const acquiredMap = new Map(acquired.map((r) => [r.date, r.n]));
  const eventMap = new Map(events.map((r) => [r.date, r]));

  const points: TrendPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(startMs + (count - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const ev = eventMap.get(date);
    points.push({
      date,
      acquired: acquiredMap.get(date) ?? 0,
      contacted: ev?.contacted ?? 0,
      replied: ev?.replied ?? 0,
      converted: ev?.converted ?? 0,
    });
  }
  return points;
}

export interface ChannelStat {
  channel: Channel | "none";
  sent: number;
  replied: number;
  rate: number;
}

export function channelPerformance(workspaceId: string, period: Period = "30d", from?: string, database = db()) {
  const start = periodStart(period, from);
  const rows = database
    .prepare(
      `SELECT m.channel AS channel,
              SUM(CASE WHEN m.direction = 'outbound' THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN m.direction = 'inbound' THEN 1 ELSE 0 END) AS replied
       FROM messages m JOIN leads l ON l.id = m.lead_id
       WHERE m.workspace_id = @ws AND m.sent_at >= @start AND l.merged_into_lead_id IS NULL
       GROUP BY m.channel ORDER BY sent DESC`,
    )
    .all({ ws: workspaceId, start }) as Array<{ channel: Channel; sent: number; replied: number }>;

  return rows.map((r) => ({ ...r, rate: r.sent ? Math.round((r.replied / r.sent) * 1000) / 10 : 0 })) as ChannelStat[];
}

export interface CampaignStat {
  id: string;
  name: string;
  channel: string;
  status: string;
  sent: number;
  replies: number;
  leads: number;
  meetings: number;
  opportunities: number;
  converted: number;
  replyRate: number;
  conversionRate: number;
}

export function campaignPerformance(workspaceId: string, database = db()): CampaignStat[] {
  const rows = database
    .prepare(
      `SELECT c.id, c.name, c.channel, c.status,
              (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.direction = 'outbound') AS sent,
              (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.direction = 'inbound') AS replies,
              (SELECT COUNT(DISTINCT m.lead_id) FROM messages m WHERE m.campaign_id = c.id) AS leads,
              (SELECT COUNT(*) FROM meetings mt WHERE mt.campaign_id = c.id) AS meetings,
              (SELECT COUNT(*) FROM opportunities o WHERE o.campaign_id = c.id) AS opps,
              (SELECT COUNT(*) FROM opportunities o WHERE o.campaign_id = c.id AND o.stage = 'won') AS converted
       FROM campaigns c WHERE c.workspace_id = ? ORDER BY c.created_at DESC`,
    )
    .all(workspaceId) as Array<Omit<CampaignStat, "replyRate" | "conversionRate">>;

  return rows.map((r) => ({
    ...r,
    replyRate: r.sent ? Math.round((r.replies / r.sent) * 1000) / 10 : 0,
    conversionRate: r.leads ? Math.round((r.converted / r.leads) * 1000) / 10 : 0,
  }));
}

export interface SourceStat {
  id: string;
  name: string;
  kind: string;
  total: number;
  replied: number;
  qualified: number;
  converted: number;
  replyRate: number;
  conversionRate: number;
}

export function sourcePerformance(workspaceId: string, database = db()): SourceStat[] {
  const rows = database
    .prepare(
      `SELECT s.id, s.name, s.kind,
              COUNT(DISTINCT l.id) AS total,
              COUNT(DISTINCT CASE WHEN l.reply_count > 0 THEN l.id END) AS replied,
              COUNT(DISTINCT CASE WHEN l.pipeline_stage IN ('qualified','engaged','meeting_booked','opportunity','converted') THEN l.id END) AS qualified,
              COUNT(DISTINCT CASE WHEN l.pipeline_stage = 'converted' THEN l.id END) AS converted
       FROM lead_sources s
       JOIN lead_attributions a ON a.source_id = s.id
       JOIN leads l ON l.id = a.lead_id AND l.merged_into_lead_id IS NULL
       WHERE s.workspace_id = ? GROUP BY s.id ORDER BY total DESC`,
    )
    .all(workspaceId) as Array<Omit<SourceStat, "replyRate" | "conversionRate">>;

  return rows.map((r) => ({
    ...r,
    replyRate: r.total ? Math.round((r.replied / r.total) * 1000) / 10 : 0,
    conversionRate: r.total ? Math.round((r.converted / r.total) * 1000) / 10 : 0,
  }));
}

export interface OwnerStat {
  id: string;
  name: string;
  avatar_hue: number;
  total: number;
  contacted: number;
  replied: number;
  converted: number;
  openTasks: number;
  overdueTasks: number;
}

/** how the team is doing. */
export function ownerPerformance(workspaceId: string, database = db()): OwnerStat[] {
  return database
    .prepare(
      `SELECT m.id, m.name, m.avatar_hue,
              COUNT(DISTINCT l.id) AS total,
              COUNT(DISTINCT CASE WHEN l.outbound_count > 0 THEN l.id END) AS contacted,
              COUNT(DISTINCT CASE WHEN l.reply_count > 0 THEN l.id END) AS replied,
              COUNT(DISTINCT CASE WHEN l.pipeline_stage = 'converted' THEN l.id END) AS converted,
              (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = m.id AND t.status IN ('open','in_progress')) AS open_tasks,
              (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = m.id AND t.status IN ('open','in_progress') AND t.due_at IS NOT NULL AND t.due_at < @now) AS overdue_tasks
       FROM members m LEFT JOIN leads l ON l.owner_id = m.id AND l.merged_into_lead_id IS NULL AND l.is_archived = 0
       WHERE m.workspace_id = @ws GROUP BY m.id ORDER BY converted DESC, total DESC`,
    )
    .all({ ws: workspaceId, now: nowIso() }) as OwnerStat[];
}

export interface ActivityBucket {
  label: string;
  leads: number;
}

/** where leads came from over the last few weeks. */
export function acquisitionOverTime(workspaceId: string, period: Period = "30d", from?: string, database = db()) {
  const start = periodStart(period, from);
  return database
    .prepare(
      `SELECT substr(l.created_at,1,10) AS date, COALESCE(s.name,'unattributed') AS source, COUNT(*) AS n
       ${BASE.replace("FROM leads l", "FROM leads l LEFT JOIN lead_sources s ON s.id = l.source_id")}
       AND l.created_at >= @start GROUP BY date, source ORDER BY date`,
    )
    .all({ ws: workspaceId, start }) as Array<{ date: string; source: string; n: number }>;
}

export interface QuickAnswer {
  question: string;
  answer: string;
  count: number;
  href: string;
}

/**
 * the questions the product promises to answer instantly.
 * each one is a live count with a link to the records behind it.
 */
export function quickAnswers(workspaceId: string, period: Period = "30d", database = db()): QuickAnswer[] {
  const stats = overview(workspaceId, period, undefined, undefined, database);
  const open = database
    .prepare(
      `SELECT COUNT(*) AS n ${BASE} AND l.pipeline_stage NOT IN ('converted','lost','disqualified')`,
    )
    .get({ ws: workspaceId }) as { n: number };

  return [
    { question: "how many leads do we have?", answer: `${stats.totalLeads} in total`, count: stats.totalLeads, href: "/leads" },
    {
      question: "how many are new?",
      answer: `${stats.acquiredInPeriod} in this period, ${stats.newUnprocessed} not looked at yet`,
      count: stats.acquiredInPeriod,
      href: "/inbox",
    },
    {
      question: "which leads are new and not converted yet?",
      answer: `${open.n} still open in the pipeline`,
      count: open.n,
      href: "/pipeline",
    },
    { question: "which leads haven't replied to us?", answer: `${stats.noReplyEver} reached out, no reply`, count: stats.noReplyEver, href: "/follow-ups?view=no-reply" },
    { question: "which leads haven't been nurtured?", answer: `${stats.notNurtured} never enrolled`, count: stats.notNurtured, href: "/nurture?view=not-enrolled" },
    { question: "what's overdue?", answer: `${stats.overdueFollowUps} tasks past their time`, count: stats.overdueFollowUps, href: "/tasks?bucket=overdue" },
    { question: "how many have converted?", answer: `${stats.converted} converted, ${stats.conversionRate}% of this period`, count: stats.converted, href: "/leads?stage=converted" },
    { question: "who is waiting on us?", answer: `${stats.awaitingReply} replies we still owe`, count: stats.awaitingReply, href: "/follow-ups?view=awaiting" },
  ];
}