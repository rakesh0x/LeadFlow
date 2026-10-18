-- leadflow :: initial schema
-- every table is scoped to a workspace. ids are prefixed text so a row id tells you what it is.

PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  domain        TEXT,
  timezone      TEXT NOT NULL DEFAULT 'utc',
  week_starts_on INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE members (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  title        TEXT,
  avatar_hue   INTEGER NOT NULL DEFAULT 210,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (workspace_id, email)
);

CREATE TABLE lead_sources (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('integration','import','form','website','manual','partner','paid','referral')),
  status         TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','needs_attention','disconnected','paused')),
  config_json    TEXT NOT NULL DEFAULT '{}',
  notes          TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  last_sync_at   TEXT,
  sync_cadence_hours INTEGER NOT NULL DEFAULT 24,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (workspace_id, slug)
);

CREATE TABLE companies (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  domain            TEXT,
  domain_normalized TEXT,
  website           TEXT,
  industry          TEXT,
  size              TEXT,
  location          TEXT,
  description       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_companies_ws ON companies(workspace_id);
CREATE UNIQUE INDEX idx_companies_domain ON companies(workspace_id, domain_normalized) WHERE domain_normalized IS NOT NULL;

CREATE TABLE leads (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id        TEXT REFERENCES companies(id) ON DELETE SET NULL,

  full_name         TEXT NOT NULL,
  first_name        TEXT,
  last_name         TEXT,
  email             TEXT,
  email_normalized  TEXT,
  phone             TEXT,
  phone_normalized  TEXT,
  job_title         TEXT,
  linkedin_url      TEXT,
  linkedin_normalized TEXT,
  x_url             TEXT,
  x_normalized      TEXT,
  website           TEXT,
  location          TEXT,
  industry          TEXT,
  company_size      TEXT,

  notes             TEXT,
  score             INTEGER NOT NULL DEFAULT 0,

  -- the three independent relationship states
  pipeline_stage    TEXT NOT NULL DEFAULT 'new'
                    CHECK (pipeline_stage IN ('new','to_qualify','qualified','contacted','engaged','meeting_booked','opportunity','converted','lost','disqualified')),
  outreach_state    TEXT NOT NULL DEFAULT 'never_contacted'
                    CHECK (outreach_state IN ('never_contacted','outreach_sent','awaiting_reply','replied','follow_up_due','follow_up_scheduled','conversation_active','closed')),
  nurture_state     TEXT NOT NULL DEFAULT 'not_enrolled'
                    CHECK (nurture_state IN ('not_enrolled','nurturing','nurture_paused','ready_for_reengagement','nurture_completed')),
  -- a manual correction sticks until someone hands control back to automation
  pipeline_stage_set_by TEXT NOT NULL DEFAULT 'auto' CHECK (pipeline_stage_set_by IN ('auto','manual')),
  outreach_state_set_by  TEXT NOT NULL DEFAULT 'auto' CHECK (outreach_state_set_by IN ('auto','manual')),
  nurture_state_set_by   TEXT NOT NULL DEFAULT 'auto' CHECK (nurture_state_set_by IN ('auto','manual')),

  owner_id          TEXT REFERENCES members(id) ON DELETE SET NULL,
  source_id         TEXT REFERENCES lead_sources(id) ON DELETE SET NULL,

  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  first_touched_at  TEXT,
  last_activity_at  TEXT,
  converted_at      TEXT,
  closed_at         TEXT,
  next_follow_up_at TEXT,
  is_archived       INTEGER NOT NULL DEFAULT 0,
  is_new            INTEGER NOT NULL DEFAULT 1,
  -- set when this record was folded into another one. the row is kept so the
  -- history stays readable, but it is no longer a lead of its own.
  merged_into_lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,

  -- denormalised for fast list sorting/filtering
  last_message_at   TEXT,
  last_message_direction TEXT,
  reply_count       INTEGER NOT NULL DEFAULT 0,
  outbound_count    INTEGER NOT NULL DEFAULT 0,
  meeting_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_leads_ws ON leads(workspace_id);
CREATE INDEX idx_leads_stage ON leads(workspace_id, pipeline_stage);
CREATE INDEX idx_leads_outreach ON leads(workspace_id, outreach_state);
CREATE INDEX idx_leads_nurture ON leads(workspace_id, nurture_state);
CREATE INDEX idx_leads_created ON leads(workspace_id, created_at DESC);
CREATE INDEX idx_leads_owner ON leads(workspace_id, owner_id);
CREATE INDEX idx_leads_source ON leads(workspace_id, source_id);
CREATE INDEX idx_leads_company ON leads(company_id);
CREATE INDEX idx_leads_follow_up ON leads(workspace_id, next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX idx_leads_last_activity ON leads(workspace_id, last_activity_at DESC);

-- every identifier we can match a person on
CREATE TABLE lead_identifiers (
  id          TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id     TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('email','phone','linkedin','x','domain','name_company','website','external_id')),
  value_raw   TEXT,
  value_norm  TEXT NOT NULL,
  source_id   TEXT REFERENCES lead_sources(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_identifiers_unique ON lead_identifiers(workspace_id, kind, value_norm);
CREATE INDEX idx_identifiers_lead ON lead_identifiers(lead_id);

-- a lead can arrive from many sources; we keep every touch
CREATE TABLE lead_attributions (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  source_id     TEXT REFERENCES lead_sources(id) ON DELETE SET NULL,
  campaign_id   TEXT,
  is_primary    INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  occurrences   INTEGER NOT NULL DEFAULT 1,
  detail        TEXT
);
CREATE UNIQUE INDEX idx_attribution_unique ON lead_attributions(lead_id, source_id, campaign_id);
CREATE INDEX idx_attribution_source ON lead_attributions(workspace_id, source_id);

-- links (not merges) between two records kept deliberately separate
CREATE TABLE lead_links (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  related_lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'related' CHECK (kind IN ('related','same_company','household','referrer')),
  note          TEXT,
  created_by    TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_links_a ON lead_links(lead_id);
CREATE INDEX idx_links_b ON lead_links(related_lead_id);

CREATE TABLE lead_merges (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  primary_lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  merged_lead_id  TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  merged_by     TEXT REFERENCES members(id) ON DELETE SET NULL,
  reason        TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_merges_primary ON lead_merges(primary_lead_id);

-- matches we are not confident enough about
CREATE TABLE dupe_candidates (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id          TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  candidate_lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  confidence       REAL NOT NULL DEFAULT 0,
  match_kinds      TEXT NOT NULL DEFAULT '[]',
  reason           TEXT,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','merged','dismissed','linked')),
  resolved_by      TEXT REFERENCES members(id) ON DELETE SET NULL,
  resolved_at      TEXT,
  created_at       TEXT NOT NULL,
  UNIQUE (lead_id, candidate_lead_id)
);
CREATE INDEX idx_dupe_ws ON dupe_candidates(workspace_id, status);

CREATE TABLE campaigns (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'email',
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','archived')),
  description   TEXT,
  owner_id      TEXT REFERENCES members(id) ON DELETE SET NULL,
  template_json TEXT NOT NULL DEFAULT '{}',
  stats_json    TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  started_at    TEXT,
  ended_at      TEXT
);
CREATE INDEX idx_campaigns_ws ON campaigns(workspace_id, status);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id         TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id     TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  source_id       TEXT REFERENCES lead_sources(id) ON DELETE SET NULL,
  owner_id        TEXT REFERENCES members(id) ON DELETE SET NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('email','linkedin','x','form','phone','sms','meeting','other')),
  direction       TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
  thread_key      TEXT,
  subject         TEXT,
  content         TEXT,
  delivery_state  TEXT NOT NULL DEFAULT 'queued'
                  CHECK (delivery_state IN ('queued','sent','delivered','opened','replied','failed','bounced','received','missed','connected')),
  sent_at         TEXT,
  delivered_at    TEXT,
  opened_at       TEXT,
  replied_at      TEXT,
  failed_at       TEXT,
  failure_reason  TEXT,
  duration_seconds INTEGER,
  next_follow_up_at TEXT,
  external_id     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_messages_lead ON messages(lead_id, sent_at DESC);
CREATE INDEX idx_messages_ws ON messages(workspace_id, sent_at DESC);
CREATE INDEX idx_messages_campaign ON messages(campaign_id);
CREATE INDEX idx_messages_follow_up ON messages(workspace_id, next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX idx_messages_dir ON messages(workspace_id, direction, replied_at);

CREATE TABLE meetings (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id   TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  owner_id      TEXT REFERENCES members(id) ON DELETE SET NULL,
  title         TEXT NOT NULL DEFAULT 'meeting',
  channel       TEXT NOT NULL DEFAULT 'meeting',
  scheduled_at  TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  location      TEXT,
  agenda        TEXT,
  outcome       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_meetings_lead ON meetings(lead_id, scheduled_at DESC);
CREATE INDEX idx_meetings_ws ON meetings(workspace_id, scheduled_at DESC);

CREATE TABLE opportunities (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id   TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  owner_id      TEXT REFERENCES members(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  amount        INTEGER NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'usd',
  stage         TEXT NOT NULL DEFAULT 'qualifying' CHECK (stage IN ('qualifying','proposal','negotiation','won','lost')),
  expected_close_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  closed_at     TEXT
);
CREATE INDEX idx_opps_lead ON opportunities(lead_id);
CREATE INDEX idx_opps_ws ON opportunities(workspace_id, stage);

CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id       TEXT REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id   TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  meeting_id    TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  owner_id      TEXT REFERENCES members(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  type          TEXT NOT NULL DEFAULT 'follow_up' CHECK (type IN ('call','email','research','follow_up','meeting','nurture','other')),
  priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
  due_at        TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  created_by    TEXT REFERENCES members(id) ON DELETE SET NULL,
  origin        TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','automation','inbox','nurture')),
  dedupe_key    TEXT,
  completed_by  TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_tasks_ws_status ON tasks(workspace_id, status, due_at);
CREATE INDEX idx_tasks_lead ON tasks(lead_id);
CREATE UNIQUE INDEX idx_tasks_dedupe ON tasks(workspace_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE nurture_sequences (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  steps_json    TEXT NOT NULL DEFAULT '[]',
  goal          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_sequences_ws ON nurture_sequences(workspace_id, status);

CREATE TABLE nurture_enrollments (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sequence_id   TEXT NOT NULL REFERENCES nurture_sequences(id) ON DELETE CASCADE,
  state         TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused','completed','reengagement_due')),
  current_step  INTEGER NOT NULL DEFAULT 0,
  total_steps   INTEGER NOT NULL DEFAULT 0,
  enrolled_at   TEXT NOT NULL,
  last_step_at  TEXT,
  next_step_at  TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (lead_id, sequence_id)
);
CREATE INDEX idx_enrollments_next ON nurture_enrollments(workspace_id, state, next_step_at);
CREATE INDEX idx_enrollments_lead ON nurture_enrollments(lead_id);

CREATE TABLE nurture_steps (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  enrollment_id TEXT NOT NULL REFERENCES nurture_enrollments(id) ON DELETE CASCADE,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  step_index    INTEGER NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'email',
  subject       TEXT,
  content       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped','replied')),
  scheduled_at  TEXT,
  sent_at       TEXT,
  message_id    TEXT REFERENCES messages(id) ON DELETE SET NULL,
  error         TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (enrollment_id, step_index)
);
CREATE INDEX idx_nurture_steps_due ON nurture_steps(status, scheduled_at);

-- the append-only activity log. dashboard numbers and lead states are derived from this.
CREATE TABLE activity_events (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id       TEXT REFERENCES leads(id) ON DELETE CASCADE,
  actor_id      TEXT REFERENCES members(id) ON DELETE SET NULL,
  campaign_id   TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  type          TEXT NOT NULL,
  title         TEXT,
  summary       TEXT,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  channel       TEXT,
  direction     TEXT,
  occurred_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  dedupe_key    TEXT
);
CREATE INDEX idx_events_lead ON activity_events(lead_id, occurred_at DESC);
CREATE INDEX idx_events_ws_type ON activity_events(workspace_id, type, occurred_at DESC);
CREATE INDEX idx_events_time ON activity_events(workspace_id, occurred_at DESC);
CREATE UNIQUE INDEX idx_events_dedupe ON activity_events(workspace_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE automation_rules (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  trigger_type  TEXT NOT NULL,
  is_enabled    INTEGER NOT NULL DEFAULT 1,
  conditions_json TEXT NOT NULL DEFAULT '{}',
  actions_json  TEXT NOT NULL DEFAULT '[]',
  run_count     INTEGER NOT NULL DEFAULT 0,
  last_run_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_rules_ws ON automation_rules(workspace_id, is_enabled);

CREATE TABLE custom_fields (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity        TEXT NOT NULL DEFAULT 'lead' CHECK (entity IN ('lead','company')),
  key           TEXT NOT NULL,
  label         TEXT NOT NULL,
  field_type    TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','long_text','number','date','select','multi_select','boolean','url','email')),
  options_json  TEXT NOT NULL DEFAULT '[]',
  is_required   INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  UNIQUE (workspace_id, entity, key)
);

CREATE TABLE custom_field_values (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id       TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field_id      TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value_text    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (lead_id, field_id)
);

CREATE TABLE capture_forms (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  source_id     TEXT REFERENCES lead_sources(id) ON DELETE SET NULL,
  campaign_id   TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  fields_json   TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','paused','archived')),
  theme         TEXT NOT NULL DEFAULT 'default',
  submit_count INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (workspace_id, slug)
);

CREATE TABLE lead_imports (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_id     TEXT REFERENCES lead_sources(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  file_name     TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  total_rows    INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  merged_rows   INTEGER NOT NULL DEFAULT 0,
  skipped_rows  INTEGER NOT NULL DEFAULT 0,
  error_count   INTEGER NOT NULL DEFAULT 0,
  mapping_json  TEXT NOT NULL DEFAULT '{}',
  error_json    TEXT NOT NULL DEFAULT '[]',
  created_by    TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  finished_at   TEXT
);
CREATE INDEX idx_imports_ws ON lead_imports(workspace_id, created_at DESC);

-- background jobs. real queue, real retries, unique idempotency keys.
CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  payload_json    TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','cancelled','skipped')),
  priority        INTEGER NOT NULL DEFAULT 5,
  run_at          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  idempotency_key TEXT,
  last_error      TEXT,
  locked_by       TEXT,
  locked_at       TEXT,
  result_json     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_jobs_idem ON jobs(workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_jobs_poll ON jobs(status, run_at, priority);
CREATE INDEX idx_jobs_ws ON jobs(workspace_id, created_at DESC);

CREATE TABLE job_runs (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  attempt     INTEGER NOT NULL,
  status      TEXT NOT NULL,
  error       TEXT,
  duration_ms INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_job_runs_job ON job_runs(job_id, attempt DESC);

CREATE TABLE activity_log (
  id          TEXT PRIMARY KEY,
  workspace_id TEXT,
  kind        TEXT NOT NULL,
  message     TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_activity_log_time ON activity_log(created_at DESC);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id    TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX idx_sessions_token ON sessions(token);