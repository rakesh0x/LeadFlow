/** the shape of every row we read or write. */

import type {
  Channel,
  DeliveryState,
  NurtureState,
  OutreachState,
  PipelineStage,
  Priority,
  SourceKind,
  TaskStatus,
  TaskType,
} from "./domain";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  timezone: string;
  week_starts_on: number;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  title: string | null;
  avatar_hue: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface LeadSource {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  kind: SourceKind;
  status: "connected" | "needs_attention" | "disconnected" | "paused";
  config_json: string;
  notes: string | null;
  is_active: number;
  last_sync_at: string | null;
  sync_cadence_hours: number;
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  domain_normalized: string | null;
  website: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  workspace_id: string;
  company_id: string | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  email_normalized: string | null;
  phone: string | null;
  phone_normalized: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  linkedin_normalized: string | null;
  x_url: string | null;
  x_normalized: string | null;
  website: string | null;
  location: string | null;
  industry: string | null;
  company_size: string | null;
  notes: string | null;
  score: number;
  pipeline_stage: PipelineStage;
  outreach_state: OutreachState;
  nurture_state: NurtureState;
  pipeline_stage_set_by: "auto" | "manual";
  outreach_state_set_by: "auto" | "manual";
  nurture_state_set_by: "auto" | "manual";
  owner_id: string | null;
  source_id: string | null;
  created_at: string;
  updated_at: string;
  first_touched_at: string | null;
  last_activity_at: string | null;
  converted_at: string | null;
  closed_at: string | null;
  next_follow_up_at: string | null;
  is_archived: number;
  is_new: number;
  last_message_at: string | null;
  last_message_direction: "outbound" | "inbound" | null;
  reply_count: number;
  outbound_count: number;
  meeting_count: number;
}

export interface Message {
  id: string;
  workspace_id: string;
  lead_id: string;
  campaign_id: string | null;
  source_id: string | null;
  owner_id: string | null;
  channel: Channel;
  direction: "outbound" | "inbound";
  thread_key: string | null;
  subject: string | null;
  content: string | null;
  delivery_state: DeliveryState;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  replied_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  duration_seconds: number | null;
  next_follow_up_at: string | null;
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  campaign_id: string | null;
  meeting_id: string | null;
  owner_id: string | null;
  title: string;
  description: string | null;
  type: TaskType;
  priority: Priority;
  status: TaskStatus;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  origin: "manual" | "automation" | "inbox" | "nurture";
  dedupe_key: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Meeting {
  id: string;
  workspace_id: string;
  lead_id: string;
  campaign_id: string | null;
  owner_id: string | null;
  title: string;
  channel: string;
  scheduled_at: string | null;
  duration_minutes: number;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  location: string | null;
  agenda: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

export interface Opportunity {
  id: string;
  workspace_id: string;
  lead_id: string;
  campaign_id: string | null;
  owner_id: string | null;
  name: string;
  amount: number;
  currency: string;
  stage: "qualifying" | "proposal" | "negotiation" | "won" | "lost";
  expected_close_at: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface ActivityEvent {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  actor_id: string | null;
  campaign_id: string | null;
  type: string;
  title: string | null;
  summary: string | null;
  payload_json: string;
  channel: string | null;
  direction: string | null;
  occurred_at: string;
  created_at: string;
  dedupe_key: string | null;
}

export interface Campaign {
  id: string;
  workspace_id: string;
  name: string;
  channel: string;
  status: "draft" | "active" | "paused" | "completed" | "archived";
  description: string | null;
  owner_id: string | null;
  template_json: string;
  stats_json: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface NurtureSequence {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  steps_json: string;
  goal: string | null;
  created_at: string;
  updated_at: string;
}

export interface NurtureEnrollment {
  id: string;
  workspace_id: string;
  lead_id: string;
  sequence_id: string;
  state: "active" | "paused" | "completed" | "reengagement_due";
  current_step: number;
  total_steps: number;
  enrolled_at: string;
  last_step_at: string | null;
  next_step_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NurtureStep {
  id: string;
  workspace_id: string;
  enrollment_id: string;
  lead_id: string;
  step_index: number;
  channel: Channel;
  subject: string | null;
  content: string | null;
  status: "pending" | "sent" | "failed" | "skipped" | "replied";
  scheduled_at: string | null;
  sent_at: string | null;
  message_id: string | null;
  error: string | null;
  created_at: string;
}

export interface AutomationRule {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  is_enabled: number;
  conditions_json: string;
  actions_json: string;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomField {
  id: string;
  workspace_id: string;
  entity: "lead" | "company";
  key: string;
  label: string;
  field_type: string;
  options_json: string;
  is_required: number;
  sort_order: number;
  created_at: string;
}

export interface CaptureForm {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  source_id: string | null;
  campaign_id: string | null;
  fields_json: string;
  status: "live" | "paused" | "archived";
  theme: string;
  submit_count: number;
  created_at: string;
  updated_at: string;
}

export interface LeadImport {
  id: string;
  workspace_id: string;
  source_id: string | null;
  name: string;
  file_name: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  total_rows: number;
  imported_rows: number;
  merged_rows: number;
  skipped_rows: number;
  error_count: number;
  mapping_json: string;
  error_json: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface Job {
  id: string;
  workspace_id: string;
  kind: string;
  payload_json: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";
  priority: number;
  run_at: string;
  attempts: number;
  max_attempts: number;
  idempotency_key: string | null;
  last_error: string | null;
  locked_by: string | null;
  locked_at: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface DupeCandidate {
  id: string;
  workspace_id: string;
  lead_id: string;
  candidate_lead_id: string;
  confidence: number;
  match_kinds: string;
  reason: string | null;
  status: "pending" | "merged" | "dismissed" | "linked";
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface DupeCandidate {
  id: string;
  workspace_id: string;
  lead_id: string;
  candidate_lead_id: string;
  confidence: number;
  match_kinds: string;
  reason: string | null;
  status: "pending" | "merged" | "dismissed" | "linked";
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface GmailAccount {
  id: string;
  workspace_id: string;
  member_id: string;
  email: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  access_token_tag: string;
  refresh_token_ciphertext: string | null;
  refresh_token_iv: string | null;
  refresh_token_tag: string | null;
  expires_at: string | null;
  scopes_json: string;
  status: "connected" | "needs_reauth" | "disconnected" | "error";
  last_error: string | null;
  last_sync_at: string | null;
  sync_cursor: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface GmailMessage {
  id: string;
  workspace_id: string;
  account_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  gmail_history_id: string | null;
  subject: string | null;
  from_email: string;
  from_name: string | null;
  to_emails_json: string;
  cc_emails_json: string;
  bcc_emails_json: string;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  direction: "inbound" | "outbound";
  is_read: number;
  is_starred: number;
  labels_json: string;
  gmail_sent_at: string | null;
  gmail_received_at: string | null;
  lead_id: string | null;
  matched_by: "email" | "thread" | "manual" | "none";
  synced_at: string;
  raw_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface GmailSyncState {
  id: string;
  workspace_id: string;
  account_id: string;
  history_id: string | null;
  last_sync_at: string | null;
  status: "idle" | "running" | "error";
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface GmailDraft {
  id: string;
  workspace_id: string;
  account_id: string;
  lead_id: string | null;
  campaign_id: string | null;
  to_emails_json: string;
  cc_emails_json: string;
  bcc_emails_json: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  status: "draft" | "approved" | "sent" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  gmail_message_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** lead rows joined with the bits of context every table needs. */
export interface LeadView extends Lead {
  company_name: string | null;
  company_domain: string | null;
  owner_name: string | null;
  owner_hue: number | null;
  source_name: string | null;
  source_kind: string | null;
  open_tasks: number;
  overdue_tasks: number;
  last_message_preview: string | null;
}

export interface TaskView extends Task {
  lead_name: string | null;
  lead_email: string | null;
  lead_stage: PipelineStage | null;
  owner_name: string | null;
  owner_hue: number | null;
}