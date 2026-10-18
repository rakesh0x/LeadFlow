/** outreach: campaigns, everything we send, and everything that comes back. */
import type { Database } from "better-sqlite3";
import { db } from "../db/client";
import { newCampaignId, newMessageId } from "../db/ids";
import { nowIso, toIso } from "../db/time";
import type { Campaign, Message } from "../types";
import type { Channel, DeliveryState } from "../domain";
import { recordEvent } from "../engine/events";
import { bumpActivity, setStage, touchLead } from "./leads";
import { recomputeLeadStates } from "../engine/states";
import { createTask } from "./tasks";

const CHANNEL_LABEL: Record<string, string> = {
  email: "email",
  linkedin: "linkedin message",
  x: "x message",
  form: "website form",
  phone: "call",
  sms: "text",
  meeting: "meeting note",
  other: "message",
};

// ---------------------------------------------------------------- campaigns

export function listCampaigns(workspaceId: string, database = db()): Array<Campaign & { sent_count: number; reply_count: number; lead_count: number; reply_rate: number }> {
  return database
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.direction = 'outbound') AS sent_count,
              (SELECT COUNT(*) FROM messages m WHERE m.campaign_id = c.id AND m.direction = 'inbound')  AS reply_count,
              (SELECT COUNT(DISTINCT m.lead_id) FROM messages m WHERE m.campaign_id = c.id) AS lead_count
       FROM campaigns c WHERE c.workspace_id = ? ORDER BY c.created_at DESC`,
    )
    .all(workspaceId)
    .map((c) => {
      const row = c as Campaign & { sent_count: number; reply_count: number; lead_count: number };
      return { ...row, reply_rate: row.sent_count ? Math.round((row.reply_count / row.sent_count) * 100) : 0 };
    }) as Array<Campaign & { sent_count: number; reply_count: number; lead_count: number; reply_rate: number }>;
}

export function getCampaign(workspaceId: string, campaignId: string, database = db()): Campaign | null {
  return (database.prepare(`SELECT * FROM campaigns WHERE id = ? AND workspace_id = ?`).get(campaignId, workspaceId) as Campaign) ?? null;
}

export function createCampaign(
  workspaceId: string,
  input: { name: string; channel?: Channel; description?: string | null; owner_id?: string | null; template?: Record<string, unknown>; status?: Campaign["status"] },
  database = db(),
): string {
  const id = newCampaignId();
  const now = nowIso();
  database
    .prepare(
      `INSERT INTO campaigns (id, workspace_id, name, channel, status, description, owner_id, template_json, created_at, updated_at, started_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      workspaceId,
      input.name,
      input.channel ?? "email",
      input.status ?? "draft",
      input.description ?? null,
      input.owner_id ?? null,
      JSON.stringify(input.template ?? {}),
      now,
      now,
      input.status === "active" ? now : null,
    );
  return id;
}

export function updateCampaign(workspaceId: string, campaignId: string, patch: Partial<Campaign>, database = db()): boolean {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const f of ["name", "channel", "status", "description", "owner_id"] as const) {
    if (patch[f] === undefined) continue;
    sets.push(`${f} = ?`);
    params.push(patch[f]);
  }
  if (patch.status === "active") {
    sets.push("started_at = COALESCE(started_at, ?)");
    params.push(nowIso());
  }
  if (patch.status === "completed" || patch.status === "archived") {
    sets.push("ended_at = ?");
    params.push(nowIso());
  }
  if (!sets.length) return false;
  sets.push("updated_at = ?");
  params.push(nowIso(), campaignId, workspaceId);
  return database.prepare(`UPDATE campaigns SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ?`).run(...params).changes > 0;
}

// ---------------------------------------------------------------- messages

export interface SendMessageInput {
  workspaceId: string;
  leadId: string;
  channel?: Channel;
  subject?: string | null;
  content?: string | null;
  campaign_id?: string | null;
  owner_id?: string | null;
  sentAt?: string | null;
  followUpAfterDays?: number | null;
  durationSeconds?: number | null;
  deliveryState?: DeliveryState;
}

/**
 * records something we sent. sending is not a reply — the lead's outreach state
 * moves to "outreach sent"/"awaiting reply", never to "replied".
 */
export function logOutboundMessage(database: Database, input: SendMessageInput, actorId?: string | null): string {
  const id = newMessageId();
  const now = nowIso();
  const sentAt = toIso(input.sentAt) ?? now;
  const followUp = input.followUpAfterDays ? new Date(Date.now() + input.followUpAfterDays * 86_400_000).toISOString() : null;
  const channel = input.channel ?? "email";
  const delivery = input.deliveryState ?? "sent";

  const threadKey = database
    .prepare(`SELECT thread_key FROM messages WHERE lead_id = ? AND channel = ? AND thread_key IS NOT NULL ORDER BY created_at DESC LIMIT 1`)
    .get(input.leadId, channel) as { thread_key: string } | undefined;

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO messages (id, workspace_id, lead_id, campaign_id, owner_id, channel, direction, thread_key,
          subject, content, delivery_state, sent_at, delivered_at, duration_seconds, next_follow_up_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?, 'outbound', ?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.leadId,
        input.campaign_id ?? null,
        input.owner_id ?? null,
        channel,
        threadKey?.thread_key ?? `th_${input.leadId}_${channel}`,
        input.subject ?? null,
        input.content ?? null,
        delivery,
        sentAt,
        delivery === "sent" || delivery === "delivered" || delivery === "opened" ? sentAt : null,
        input.durationSeconds ?? null,
        followUp,
        now,
        now,
      );

    recordEvent(database, {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      actorId,
      campaignId: input.campaign_id ?? null,
      type: channel === "phone" || channel === "meeting" ? "call_logged" : "message_sent",
      title: channel === "phone" ? "call logged" : `${CHANNEL_LABEL[channel]} sent`,
      summary: input.subject ?? (input.content ?? "").slice(0, 140) ?? null,
      payload: { messageId: id, channel },
      channel,
      direction: "outbound",
      occurredAt: sentAt,
      dedupeKey: `sent:${id}`,
    });

    if (followUp) {
      database.prepare(`UPDATE leads SET next_follow_up_at = ? WHERE id = ?`).run(followUp, input.leadId);
    }

    bumpActivity(database, input.leadId);
    touchLead(database, input.leadId, actorId);
    setStage(database, input.workspaceId, input.leadId, "contacted", actorId, true);
    recomputeLeadStates(database, input.leadId);
  });
  run();

  return id;
}

export interface RecordReplyInput {
  workspaceId: string;
  leadId: string;
  channel?: Channel;
  subject?: string | null;
  content?: string;
  receivedAt?: string | null;
  campaign_id?: string | null;
  /** marks the earlier outbound message in this thread as answered. */
  inReplyToMessageId?: string | null;
}

/** records something the lead said. this is the only thing that counts as a reply. */
export function logInboundMessage(database: Database, input: RecordReplyInput, actorId?: string | null): string {
  const id = newMessageId();
  const now = nowIso();
  const receivedAt = toIso(input.receivedAt) ?? now;
  const channel = input.channel ?? "email";

  const threadKey = database
    .prepare(`SELECT thread_key FROM messages WHERE lead_id = ? AND channel = ? AND thread_key IS NOT NULL ORDER BY created_at DESC LIMIT 1`)
    .get(input.leadId, channel) as { thread_key: string } | undefined;

  const run = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO messages (id, workspace_id, lead_id, campaign_id, channel, direction, thread_key,
          subject, content, delivery_state, sent_at, replied_at, created_at, updated_at)
         VALUES (?,?,?,?,?, 'inbound', ?,?,?, 'received', ?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.leadId,
        input.campaign_id ?? null,
        channel,
        threadKey?.thread_key ?? `th_${input.leadId}_${channel}`,
        input.subject ?? null,
        input.content ?? null,
        receivedAt,
        receivedAt,
        now,
        now,
      );

    if (input.inReplyToMessageId) {
      database
        .prepare(`UPDATE messages SET delivery_state = 'replied', replied_at = ?, updated_at = ? WHERE id = ?`)
        .run(receivedAt, now, input.inReplyToMessageId);
    }

    recordEvent(database, {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      actorId,
      campaignId: input.campaign_id ?? null,
      type: "message_replied",
      title: "replied",
      summary: input.content?.slice(0, 200) ?? input.subject ?? null,
      payload: { messageId: id, channel },
      channel,
      direction: "inbound",
      occurredAt: receivedAt,
      dedupeKey: `reply:${id}`,
    });

    // they answered — the clock on our side stops here
    database.prepare(`UPDATE leads SET next_follow_up_at = NULL WHERE id = ?`).run(input.leadId);
    database.prepare(`UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ?, completed_by = ? WHERE lead_id = ? AND type = 'follow_up' AND status IN ('open','in_progress')`).run(receivedAt, now, actorId ?? null, input.leadId);

    bumpActivity(database, input.leadId);
    touchLead(database, input.leadId, actorId);
    setStage(database, input.workspaceId, input.leadId, "engaged", actorId, true);
    recomputeLeadStates(database, input.leadId);
  });
  run();

  return id;
}

export function updateDelivery(
  database: Database,
  messageId: string,
  state: DeliveryState,
  patch: { failure_reason?: string | null; opened_at?: string; delivered_at?: string; replied_at?: string } = {},
  actorId?: string | null,
): boolean {
  const row = database.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId) as Message | undefined;
  if (!row) return false;
  const now = nowIso();

  const typeForState: Record<DeliveryState, string | null> = {
    delivered: "message_delivered",
    opened: "message_opened",
    failed: "message_failed",
    bounced: "message_failed",
    replied: "message_replied",
    received: "message_replied",
    sent: "message_sent",
    queued: null,
    connected: null,
    missed: null,
  };

  const run = database.transaction(() => {
    database
      .prepare(
        `UPDATE messages SET delivery_state = ?,
            delivered_at = COALESCE(?, delivered_at),
            opened_at = COALESCE(?, opened_at),
            replied_at = COALESCE(?, replied_at),
            failed_at = CASE WHEN ? IN ('failed','bounced') THEN ? ELSE failed_at END,
            failure_reason = ?,
            updated_at = ?
         WHERE id = ?`,
      )
      .run(
        state,
        patch.delivered_at ?? (state === "delivered" || state === "opened" ? now : null),
        patch.opened_at ?? (state === "opened" ? now : null),
        patch.replied_at ?? (state === "replied" ? now : null),
        state,
        now,
        patch.failure_reason ?? null,
        now,
        messageId,
      );

    const eventType = typeForState[state];
    if (eventType) {
      recordEvent(database, {
        workspaceId: row.workspace_id,
        leadId: row.lead_id,
        actorId,
        type: eventType,
        title: state.replaceAll("_", " "),
        summary: `${CHANNEL_LABEL[row.channel]} ${row.direction}`,
        payload: { messageId, state },
        channel: row.channel,
        direction: row.direction,
        dedupeKey: `${state}:${messageId}`,
      });
    }
    bumpActivity(database, row.lead_id);
    recomputeLeadStates(database, row.lead_id);
  });
  run();
  return true;
}

export function setMessageFollowUp(
  database: Database,
  messageId: string,
  followUpAt: string | null,
  opts: { createTask?: boolean; ownerId?: string | null; actorId?: string | null; title?: string } = {},
): void {
  const row = database.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId) as Message | undefined;
  if (!row) return;
  const now = nowIso();
  const run = database.transaction(() => {
    database.prepare(`UPDATE messages SET next_follow_up_at = ?, updated_at = ? WHERE id = ?`).run(followUpAt, now, messageId);
    database.prepare(`UPDATE leads SET next_follow_up_at = ?, updated_at = ? WHERE id = ?`).run(followUpAt, now, row.lead_id);
    if (opts.createTask && followUpAt) {
      createTask(
        {
          workspaceId: row.workspace_id,
          leadId: row.lead_id,
          campaignId: row.campaign_id,
          title: opts.title ?? `follow up with ${row.direction === "outbound" ? "the last message sent" : "their reply"}`,
          type: "follow_up",
          priority: "medium",
          dueAt: followUpAt,
          ownerId: opts.ownerId ?? row.owner_id,
          origin: "manual",
        },
        { actorId: opts.actorId ?? null, database },
      );
    }
    recordEvent(database, {
      workspaceId: row.workspace_id,
      leadId: row.lead_id,
      actorId: opts.actorId ?? null,
      type: followUpAt ? "follow_up_due" : "lead_updated",
      title: followUpAt ? "follow-up set" : "follow-up cleared",
      summary: followUpAt ? `due ${new Date(followUpAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : null,
      payload: { messageId, followUpAt },
    });
    recomputeLeadStates(database, row.lead_id);
  });
  run();
}

export interface MessageQuery {
  channel?: Channel | "all";
  direction?: "outbound" | "inbound" | "all";
  campaignId?: string;
  leadId?: string;
  q?: string;
  awaiting?: boolean;
  limit?: number;
  offset?: number;
}

export function queryMessages(workspaceId: string, query: MessageQuery = {}, database = db()): { rows: Message[]; total: number } {
  const where: string[] = ["m.workspace_id = @ws", "l.merged_into_lead_id IS NULL"];
  const params: Record<string, unknown> = { ws: workspaceId };

  if (query.channel && query.channel !== "all") {
    where.push(`m.channel = @channel`);
    params.channel = query.channel;
  }
  if (query.direction && query.direction !== "all") {
    where.push(`m.direction = @direction`);
    params.direction = query.direction;
  }
  if (query.campaignId) {
    where.push(`m.campaign_id = @campaignId`);
    params.campaignId = query.campaignId;
  }
  if (query.leadId) {
    where.push(`m.lead_id = @leadId`);
    params.leadId = query.leadId;
  }
  if (query.q) {
    where.push(`(l.full_name LIKE @q OR l.email LIKE @q OR m.subject LIKE @q OR m.content LIKE @q)`);
    params.q = `%${query.q.trim()}%`;
  }
  if (query.awaiting) where.push(`m.direction = 'outbound' AND m.next_follow_up_at IS NOT NULL AND m.next_follow_up_at <= @now`);
  params.now = nowIso();

  const whereSql = where.join(" AND ");
  const total = (
    database.prepare(`SELECT COUNT(*) AS n FROM messages m JOIN leads l ON l.id = m.lead_id WHERE ${whereSql}`).get(params) as { n: number }
  ).n;
  const rows = database
    .prepare(
      `SELECT m.* FROM messages m JOIN leads l ON l.id = m.lead_id
       WHERE ${whereSql} ORDER BY COALESCE(m.sent_at, m.created_at) DESC LIMIT ${Math.min(query.limit ?? 50, 300)} OFFSET ${query.offset ?? 0}`,
    )
    .all(params) as Message[];

  return { rows, total };
}

export interface ConversationRow extends Message {
  lead_full_name: string;
  lead_email: string | null;
  lead_pipeline_stage: string;
  company_name: string | null;
}

/** a thread view: latest message per lead+channel with counts. */
export function listConversations(workspaceId: string, options: { channel?: Channel | "all"; limit?: number } = {}, database = db()) {
  const channelClause = options.channel && options.channel !== "all" ? `AND m.channel = '${options.channel.replace(/'/g, "")}'` : "";
  return database
    .prepare(
      `SELECT m.*, l.full_name AS lead_full_name, l.email AS lead_email, l.pipeline_stage AS lead_pipeline_stage,
              c.name AS company_name
       FROM messages m
       JOIN leads l ON l.id = m.lead_id
       LEFT JOIN companies c ON c.id = l.company_id
       WHERE m.workspace_id = ? AND l.merged_into_lead_id IS NULL ${channelClause}
         AND m.id = (
           SELECT m2.id FROM messages m2 WHERE m2.lead_id = m.lead_id AND m2.channel = m.channel
           ORDER BY COALESCE(m2.sent_at, m2.created_at) DESC LIMIT 1
         )
       ORDER BY COALESCE(m.sent_at, m.created_at) DESC
       LIMIT ${Math.min(options.limit ?? 60, 200)}`,
    )
    .all(workspaceId) as ConversationRow[];
}

/** everything that needs us to act. used by follow-ups and the overview. */
export function quietOutreach(workspaceId: string, limit = 100, database = db()) {
  return database
    .prepare(
      `SELECT m.*, l.full_name AS lead_full_name, l.email AS lead_email, l.pipeline_stage, l.outreach_state,
              l.company_id, c.name AS company_name
       FROM messages m
       JOIN leads l ON l.id = m.lead_id
       LEFT JOIN companies c ON c.id = l.company_id
       WHERE m.workspace_id = ?
         AND m.direction = 'outbound'
         AND m.delivery_state NOT IN ('failed','bounced')
         AND l.merged_into_lead_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM messages r WHERE r.lead_id = m.lead_id AND r.direction = 'inbound'
             AND r.channel = m.channel AND r.sent_at > m.sent_at
         )
         AND NOT EXISTS (
           SELECT 1 FROM tasks t WHERE t.lead_id = m.lead_id AND t.status IN ('open','in_progress')
         )
       ORDER BY m.sent_at ASC LIMIT ?`,
    )
    .all(workspaceId, limit) as Array<ConversationRow & { pipeline_stage: string }>;
}