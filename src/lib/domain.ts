/** the vocabulary. every screen and every stored value uses these exact strings. */

export const PIPELINE_STAGES = [
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
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const OUTREACH_STATES = [
  "never_contacted",
  "outreach_sent",
  "awaiting_reply",
  "replied",
  "follow_up_due",
  "follow_up_scheduled",
  "conversation_active",
  "closed",
] as const;
export type OutreachState = (typeof OUTREACH_STATES)[number];

export const NURTURE_STATES = [
  "not_enrolled",
  "nurturing",
  "nurture_paused",
  "ready_for_reengagement",
  "nurture_completed",
] as const;
export type NurtureState = (typeof NURTURE_STATES)[number];

export const CHANNELS = ["email", "linkedin", "x", "form", "phone", "sms", "meeting", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

export const TASK_TYPES = ["call", "email", "research", "follow_up", "meeting", "nurture", "other"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ["open", "in_progress", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const SOURCE_KINDS = [
  "integration",
  "import",
  "form",
  "website",
  "manual",
  "partner",
  "paid",
  "referral",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const DELIVERY_STATES = [
  "queued",
  "sent",
  "delivered",
  "opened",
  "replied",
  "failed",
  "bounced",
  "received",
  "missed",
  "connected",
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const EVENT_TYPES = [
  "lead_created",
  "lead_updated",
  "lead_merged",
  "stage_changed",
  "outreach_state_changed",
  "nurture_state_changed",
  "assigned",
  "message_sent",
  "message_delivered",
  "message_opened",
  "message_replied",
  "message_failed",
  "call_logged",
  "form_submitted",
  "import_completed",
  "source_synced",
  "meeting_booked",
  "meeting_completed",
  "meeting_cancelled",
  "opportunity_created",
  "opportunity_won",
  "opportunity_lost",
  "task_created",
  "task_completed",
  "nurture_enrolled",
  "nurture_step_sent",
  "nurture_paused",
  "nurture_completed",
  "nurture_reengagement_due",
  "follow_up_due",
  "note_added",
  "converted",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const JOB_KINDS = [
  "follow_up_sweep",
  "reply_watchdog",
  "nurture_dispatch",
  "source_sync",
  "import_process",
  "daily_digest",
  "analytics_rollup",
  "duplicate_scan",
  "message_delivery_check",
  "retry_delivery",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export type Meta = { label: string; hint: string; tone: Tone };
export type Tone = "slate" | "blue" | "violet" | "amber" | "green" | "rose" | "cyan" | "stone";

export const PIPELINE_STAGE_META: Record<PipelineStage, Meta> = {
  new: { label: "new", hint: "just arrived, not looked at yet", tone: "cyan" },
  to_qualify: { label: "to qualify", hint: "needs a first pass", tone: "slate" },
  qualified: { label: "qualified", hint: "worth our time", tone: "blue" },
  contacted: { label: "contacted", hint: "we reached out", tone: "violet" },
  engaged: { label: "engaged", hint: "they replied or showed interest", tone: "violet" },
  meeting_booked: { label: "meeting booked", hint: "a call is on the books", tone: "amber" },
  opportunity: { label: "opportunity", hint: "we are working a deal", tone: "amber" },
  converted: { label: "converted", hint: "they became a customer", tone: "green" },
  lost: { label: "lost", hint: "not going anywhere", tone: "stone" },
  disqualified: { label: "disqualified", hint: "not a fit", tone: "rose" },
};

export const OUTREACH_STATE_META: Record<OutreachState, Meta> = {
  never_contacted: { label: "never contacted", hint: "we have not reached out", tone: "slate" },
  outreach_sent: { label: "outreach sent", hint: "first message went out", tone: "blue" },
  awaiting_reply: { label: "awaiting reply", hint: "sent, no answer yet", tone: "cyan" },
  replied: { label: "replied", hint: "they answered us", tone: "green" },
  follow_up_due: { label: "follow-up due", hint: "we owe them a reply", tone: "amber" },
  follow_up_scheduled: { label: "follow-up scheduled", hint: "next step is booked", tone: "violet" },
  conversation_active: { label: "conversation active", hint: "we are talking", tone: "green" },
  closed: { label: "closed", hint: "nothing further for now", tone: "stone" },
};

export const NURTURE_STATE_META: Record<NurtureState, Meta> = {
  not_enrolled: { label: "not enrolled", hint: "not in any sequence", tone: "slate" },
  nurturing: { label: "nurturing", hint: "in an active sequence", tone: "violet" },
  nurture_paused: { label: "nurture paused", hint: "holding, will pick back up", tone: "amber" },
  ready_for_reengagement: { label: "ready for re-engagement", hint: "quiet for a while, time to reach out", tone: "cyan" },
  nurture_completed: { label: "nurture completed", hint: "sequence finished", tone: "green" },
};

export const CHANNEL_META: Record<Channel, Meta> = {
  email: { label: "email", hint: "sent from your inbox or a provider", tone: "blue" },
  linkedin: { label: "linkedin", hint: "message or connection request", tone: "cyan" },
  x: { label: "x", hint: "direct message or reply", tone: "slate" },
  form: { label: "website form", hint: "submitted through a site form", tone: "violet" },
  phone: { label: "phone call", hint: "logged manually", tone: "green" },
  sms: { label: "sms", hint: "text message", tone: "amber" },
  meeting: { label: "meeting", hint: "booked call or demo", tone: "amber" },
  other: { label: "other", hint: "any other channel", tone: "stone" },
};

export const TASK_TYPE_META: Record<TaskType, Meta> = {
  call: { label: "call", hint: "ring them", tone: "green" },
  email: { label: "email", hint: "write to them", tone: "blue" },
  research: { label: "research", hint: "look them up before you write", tone: "slate" },
  follow_up: { label: "follow-up", hint: "chase a reply", tone: "amber" },
  meeting: { label: "meeting", hint: "prep for a booked call", tone: "cyan" },
  nurture: { label: "nurture", hint: "move them along a sequence", tone: "violet" },
  other: { label: "other", hint: "anything else", tone: "stone" },
};

export const PRIORITY_META: Record<Priority, Meta> = {
  low: { label: "low", hint: "sometime this week", tone: "slate" },
  medium: { label: "medium", hint: "normal work", tone: "blue" },
  high: { label: "high", hint: "do it soon", tone: "amber" },
  urgent: { label: "urgent", hint: "do it today", tone: "rose" },
};

export const DELIVERY_META: Record<DeliveryState, Meta> = {
  queued: { label: "queued", hint: "waiting to send", tone: "slate" },
  sent: { label: "sent", hint: "handed off", tone: "blue" },
  delivered: { label: "delivered", hint: "landed in their inbox", tone: "blue" },
  opened: { label: "opened", hint: "they read it", tone: "cyan" },
  replied: { label: "replied", hint: "they answered", tone: "green" },
  failed: { label: "failed", hint: "did not send", tone: "rose" },
  bounced: { label: "bounced", hint: "address is bad", tone: "rose" },
  received: { label: "received", hint: "they reached out first", tone: "green" },
  missed: { label: "missed", hint: "no answer", tone: "amber" },
  connected: { label: "connected", hint: "call linked up", tone: "green" },
};

export const SOURCE_KIND_META: Record<SourceKind, Meta> = {
  integration: { label: "integration", hint: "connected platform", tone: "blue" },
  import: { label: "import", hint: "uploaded list", tone: "slate" },
  form: { label: "form", hint: "captured on site", tone: "violet" },
  website: { label: "website", hint: "came through the site", tone: "cyan" },
  manual: { label: "manual", hint: "added by a teammate", tone: "stone" },
  partner: { label: "partner", hint: "shared list or referral", tone: "green" },
  paid: { label: "paid", hint: "bought traffic", tone: "amber" },
  referral: { label: "referral", hint: "told by someone else", tone: "green" },
};

export const JOB_STATUS_META: Record<string, Meta> = {
  pending: { label: "pending", hint: "waiting to run", tone: "slate" },
  running: { label: "running", hint: "working on it now", tone: "blue" },
  succeeded: { label: "done", hint: "finished cleanly", tone: "green" },
  failed: { label: "failed", hint: "needs another try", tone: "rose" },
  cancelled: { label: "cancelled", hint: "will not run", tone: "stone" },
  skipped: { label: "skipped", hint: "nothing to do", tone: "stone" },
};

/** stages that mean the deal is still alive and worth chasing. */
export const OPEN_STAGES: PipelineStage[] = [
  "new",
  "to_qualify",
  "qualified",
  "contacted",
  "engaged",
  "meeting_booked",
  "opportunity",
];

export const CLOSED_STAGES: PipelineStage[] = ["converted", "lost", "disqualified"];

export const pipelineLabel = (s: PipelineStage) => PIPELINE_STAGE_META[s]?.label ?? s;
export const outreachLabel = (s: OutreachState) => OUTREACH_STATE_META[s]?.label ?? s;
export const nurtureLabel = (s: NurtureState) => NURTURE_STATE_META[s]?.label ?? s;