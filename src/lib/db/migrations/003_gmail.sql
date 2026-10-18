-- gmail integration
-- stores connected Gmail accounts, synced messages, and sync state

PRAGMA foreign_keys = ON;

-- connected Gmail accounts (one per workspace member who connects)
CREATE TABLE gmail_accounts (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_id     TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  -- encrypted OAuth tokens
  access_token_ciphertext  TEXT NOT NULL,
  access_token_iv          TEXT NOT NULL,
  access_token_tag         TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  refresh_token_iv         TEXT,
  refresh_token_tag        TEXT,
  -- token expiry
  expires_at      TEXT,
  -- scopes granted
  scopes_json     TEXT NOT NULL DEFAULT '[]',
  -- connection state
  status          TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','needs_reauth','disconnected','error')),
  last_error      TEXT,
  last_sync_at    TEXT,
  sync_cursor     TEXT, -- Gmail historyId cursor for incremental sync
  is_default      INTEGER NOT NULL DEFAULT 0, -- default sending account for this member
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (workspace_id, member_id, email)
);
CREATE INDEX idx_gmail_accounts_ws ON gmail_accounts(workspace_id);
CREATE INDEX idx_gmail_accounts_member ON gmail_accounts(member_id);

-- synced Gmail messages
CREATE TABLE gmail_messages (
  id                 TEXT PRIMARY KEY, -- our internal id
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id         TEXT NOT NULL REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  gmail_message_id   TEXT NOT NULL, -- Gmail's message ID
  gmail_thread_id    TEXT NOT NULL, -- Gmail's thread ID
  gmail_history_id   TEXT, -- Gmail history ID for incremental sync
  
  -- message metadata
  subject            TEXT,
  from_email         TEXT NOT NULL,
  from_name          TEXT,
  to_emails_json     TEXT NOT NULL DEFAULT '[]', -- array of {email, name}
  cc_emails_json     TEXT NOT NULL DEFAULT '[]',
  bcc_emails_json    TEXT NOT NULL DEFAULT '[]',
  
  -- content
  snippet            TEXT, -- Gmail snippet
  body_text          TEXT,
  body_html          TEXT,
  
  -- direction and state
  direction          TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  is_read            INTEGER NOT NULL DEFAULT 0,
  is_starred         INTEGER NOT NULL DEFAULT 0,
  labels_json        TEXT NOT NULL DEFAULT '[]', -- Gmail labels
  
  -- timestamps
  gmail_sent_at      TEXT, -- when Gmail says it was sent
  gmail_received_at  TEXT, -- when Gmail received it (for inbound)
  
  -- lead matching
  lead_id            TEXT REFERENCES leads(id) ON DELETE SET NULL,
  matched_by         TEXT CHECK (matched_by IN ('email','thread','manual','none')),
  
  -- sync metadata
  synced_at          TEXT NOT NULL,
  raw_json           TEXT, -- full Gmail message payload for debugging
  
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX idx_gmail_messages_ws ON gmail_messages(workspace_id);
CREATE INDEX idx_gmail_messages_account ON gmail_messages(account_id);
CREATE INDEX idx_gmail_messages_lead ON gmail_messages(lead_id);
CREATE INDEX idx_gmail_messages_gmail_id ON gmail_messages(gmail_message_id);
CREATE INDEX idx_gmail_messages_thread ON gmail_messages(gmail_thread_id);
CREATE INDEX idx_gmail_messages_history ON gmail_messages(gmail_history_id);
CREATE INDEX idx_gmail_messages_direction ON gmail_messages(direction, gmail_sent_at DESC);

-- sync state for incremental sync
CREATE TABLE gmail_sync_state (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  history_id    TEXT, -- last processed historyId
  last_sync_at  TEXT,
  status        TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','error')),
  error         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (account_id)
);
CREATE INDEX idx_gmail_sync_account ON gmail_sync_state(account_id);

-- draft emails waiting for approval
CREATE TABLE gmail_drafts (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id      TEXT NOT NULL REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  lead_id         TEXT REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id     TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  to_emails_json  TEXT NOT NULL DEFAULT '[]',
  cc_emails_json  TEXT NOT NULL DEFAULT '[]',
  bcc_emails_json TEXT NOT NULL DEFAULT '[]',
  subject         TEXT,
  body_text       TEXT,
  body_html       TEXT,
  -- approval
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','rejected')),
  approved_by     TEXT REFERENCES members(id) ON DELETE SET NULL,
  approved_at     TEXT,
  -- sent result
  sent_at         TEXT,
  gmail_message_id TEXT,
  error           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_gmail_drafts_ws ON gmail_drafts(workspace_id);
CREATE INDEX idx_gmail_drafts_account ON gmail_drafts(account_id);
CREATE INDEX idx_gmail_drafts_lead ON gmail_drafts(lead_id);
CREATE INDEX idx_gmail_drafts_status ON gmail_drafts(status);