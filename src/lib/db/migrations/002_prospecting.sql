-- real prospect discovery.
-- searches and their results are staged here first, reviewed by a human,
-- and only then turned into leads.

PRAGMA foreign_keys = ON;

-- api keys live here, encrypted. the raw value is never returned by any action.
CREATE TABLE provider_credentials (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,
  label            TEXT,
  secret_ciphertext TEXT NOT NULL,
  secret_iv        TEXT NOT NULL,
  secret_tag       TEXT NOT NULL,
  key_hint         TEXT,
  -- providers mask contact data on some plans. we record the plan so the
  -- interface can be honest about what an email address is worth.
  plan             TEXT,
  extra_json       TEXT NOT NULL DEFAULT '{}',
  is_active        INTEGER NOT NULL DEFAULT 1,
  last_verified_at TEXT,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (workspace_id, provider)
);

CREATE TABLE prospect_searches (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  actor_id      TEXT REFERENCES members(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL DEFAULT 'people' CHECK (kind IN ('people','companies')),
  icp_json      TEXT NOT NULL DEFAULT '{}',
  query_label   TEXT,
  status        TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','failed')),
  page          INTEGER NOT NULL DEFAULT 1,
  per_page      INTEGER NOT NULL DEFAULT 25,
  cursor        TEXT,
  total         INTEGER NOT NULL DEFAULT 0,
  returned      INTEGER NOT NULL DEFAULT 0,
  has_more      INTEGER NOT NULL DEFAULT 0,
  credits_used  REAL NOT NULL DEFAULT 0,
  error_json    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_searches_ws ON prospect_searches(workspace_id, created_at DESC);

CREATE TABLE prospect_candidates (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  search_id          TEXT NOT NULL REFERENCES prospect_searches(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL,
  provider_record_id TEXT NOT NULL,
  full_name          TEXT NOT NULL,
  job_title          TEXT,
  company_name       TEXT,
  company_domain     TEXT,
  company_size       TEXT,
  industry           TEXT,
  location           TEXT,
  email              TEXT,
  email_status       TEXT,
  phone              TEXT,
  linkedin_url       TEXT,
  x_url              TEXT,
  seniority          TEXT,
  raw_json           TEXT NOT NULL DEFAULT '{}',
  -- what our duplicate engine thinks about this person
  dupe_status        TEXT NOT NULL DEFAULT 'unknown' CHECK (dupe_status IN ('unknown','new','likely','exact')),
  dupe_lead_id       TEXT REFERENCES leads(id) ON DELETE SET NULL,
  dupe_confidence    REAL,
  dupe_reason        TEXT,
  enrich_state       TEXT NOT NULL DEFAULT 'none' CHECK (enrich_state IN ('none','done','failed','skipped')),
  enrich_error       TEXT,
  import_state       TEXT NOT NULL DEFAULT 'pending' CHECK (import_state IN ('pending','imported','skipped')),
  imported_lead_id   TEXT REFERENCES leads(id) ON DELETE SET NULL,
  imported_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (search_id, provider_record_id)
);
CREATE INDEX idx_candidates_search ON prospect_candidates(search_id, created_at);
CREATE INDEX idx_candidates_state ON prospect_candidates(workspace_id, import_state);