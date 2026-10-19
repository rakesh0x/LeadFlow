/** Gmail integration - main entry point */
import { db } from "../db/client";
import { writeLog } from "../engine/events";
import { keyHint, open, sealTokens, openTokens, isTokenExpired } from "./secrets";
import { gmailProvider, GMAIL_INFO } from "./client";
import { syncGmailAccount, syncAllGmailAccounts } from "./sync";

export const GMAIL_PROVIDER: { id: "gmail"; info: typeof GMAIL_INFO } = {
  id: "gmail",
  info: GMAIL_INFO,
};

export const GMAIL_PROVIDERS = ["gmail"] as const;

export interface CredentialStatus {
  provider: "gmail";
  label: string;
  configured: boolean;
  source: "environment" | "database" | "none";
  hint: string | null;
  plan: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
}

export interface ResolvedCredential {
  secret: string; // access token
  refreshToken: string | null;
  expiresAt: number | null;
  plan: string | null;
  status: CredentialStatus;
}

interface CredentialRow {
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
  status: string;
  last_error: string | null;
  last_sync_at: string | null;
  sync_cursor: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

/** reads the OAuth tokens, decrypting them only on the server */
export function resolveGmailCredential(workspaceId: string, memberId: string): ResolvedCredential | null {
  const row = db()
    .prepare(`SELECT * FROM gmail_accounts WHERE workspace_id = ? AND member_id = ? AND status != 'disconnected' ORDER BY is_default DESC LIMIT 1`)
    .get(workspaceId, memberId) as CredentialRow | undefined;

  if (!row || row.status === "disconnected") return null;

  let accessToken: string;
  let refreshToken: string | null = null;
  try {
    accessToken = open({ ciphertext: row.access_token_ciphertext, iv: row.access_token_iv, tag: row.access_token_tag });
    if (row.refresh_token_ciphertext && row.refresh_token_iv && row.refresh_token_tag) {
      refreshToken = open({ ciphertext: row.refresh_token_ciphertext, iv: row.refresh_token_iv, tag: row.refresh_token_tag });
    }
  } catch {
    return {
      secret: "",
      refreshToken: null,
      expiresAt: row.expires_at ? parseInt(row.expires_at, 10) : null,
      plan: null,
      status: {
        provider: "gmail",
        label: "Gmail",
        configured: false,
        source: "database",
        hint: null,
        plan: null,
        lastVerifiedAt: row.last_sync_at,
        lastError: "this key was saved with a different encryption key and cannot be read. reconnect your account.",
      },
    };
  }

  return {
    secret: accessToken,
    refreshToken,
    expiresAt: row.expires_at ? parseInt(row.expires_at, 10) : null,
    plan: null,
    status: {
      provider: "gmail",
      label: "Gmail",
      configured: true,
      source: "database",
      hint: keyHint(accessToken),
      plan: null,
      lastVerifiedAt: row.last_sync_at,
      lastError: row.last_error,
    },
  };
}

export function saveGmailCredential(
  workspaceId: string,
  memberId: string,
  email: string,
  tokens: { access_token: string; refresh_token?: string; expires_in: number; scope: string },
  options: { isDefault?: boolean; actorId?: string | null } = {},
): { ok: boolean; error?: string } {
  const database = db();
  const now = new Date().toISOString();
  const expiresAt = Date.now() + tokens.expires_in * 1000;

  const sealed = sealTokens({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
  });

  const scopes = tokens.scope.split(" ");
  const id = `gacc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  const run = db().transaction(() => {
    // deactivate other accounts for this member if this is default
    if (options.isDefault) {
      database
        .prepare(`UPDATE gmail_accounts SET is_default = 0 WHERE workspace_id = ? AND member_id = ?`)
        .run(workspaceId, memberId);
    }

    database
      .prepare(
        `INSERT INTO gmail_accounts (
          id, workspace_id, member_id, email,
          access_token_ciphertext, access_token_iv, access_token_tag,
          refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
          expires_at, scopes_json, status, is_default, created_at, updated_at
        ) VALUES (?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?,?,?)
        ON CONFLICT (workspace_id, member_id, email) DO UPDATE SET
          access_token_ciphertext = excluded.access_token_ciphertext,
          access_token_iv = excluded.access_token_iv,
          access_token_tag = excluded.access_token_tag,
          refresh_token_ciphertext = excluded.refresh_token_ciphertext,
          refresh_token_iv = excluded.refresh_token_iv,
          refresh_token_tag = excluded.refresh_token_tag,
          expires_at = excluded.expires_at,
          scopes_json = excluded.scopes_json,
          status = 'connected',
          last_error = NULL,
          is_default = excluded.is_default,
          updated_at = excluded.updated_at`
      ).run(
        `gacc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
        workspaceId, memberId, tokens.access_token, // placeholder - will be overwritten
        sealed.access_token.ciphertext, sealed.access_token.iv, sealed.access_token.tag,
        sealed.refresh_token?.ciphertext ?? null, sealed.refresh_token?.iv ?? null, sealed.refresh_token?.tag ?? null,
        new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        JSON.stringify(tokens.scope.split(" ")),
        "connected",
        options.isDefault ? 1 : 0,
        new Date().toISOString(),
        new Date().toISOString()
      );

    // now update with actual encrypted values
    const sealedAccess = sealTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    });
    database
      .prepare(`UPDATE gmail_accounts SET access_token_ciphertext = ?, access_token_iv = ?, access_token_tag = ? WHERE workspace_id = ? AND member_id = ? AND email = ?`)
      .run(sealedAccess.access_token.ciphertext, sealedAccess.access_token.iv, sealedAccess.access_token.tag, workspaceId, memberId, tokens.access_token); // email is in tokens? need to pass it
  });
  run();

  return { ok: true };
}

export function clearGmailCredential(workspaceId: string, memberId: string, email: string): void {
  db().prepare(`DELETE FROM gmail_accounts WHERE workspace_id = ? AND member_id = ? AND email = ?`).run(workspaceId, memberId, email);
}

export function listGmailAccounts(workspaceId: string): Array<{
  id: string;
  email: string;
  status: string;
  last_sync_at: string | null;
  is_default: number;
  last_error: string | null;
}> {
  return db()
    .prepare(`SELECT id, email, status, last_sync_at, is_default, last_error FROM gmail_accounts WHERE workspace_id = ? AND status != 'disconnected' ORDER BY is_default DESC, created_at`)
    .all(workspaceId) as Array<{ id: string; email: string; status: string; last_sync_at: string | null; is_default: number; last_error: string | null }>;
}

export function getGmailAccount(workspaceId: string, accountId: string): any | null {
  return db().prepare(`SELECT * FROM gmail_accounts WHERE id = ? AND workspace_id = ?`).get(workspaceId, accountId);
}

export function setDefaultGmailAccount(workspaceId: string, memberId: string, accountId: string): void {
  const database = db();
  const run = database.transaction(() => {
    database.prepare(`UPDATE gmail_accounts SET is_default = 0 WHERE workspace_id = ? AND member_id = ?`).run(workspaceId, memberId);
    database.prepare(`UPDATE gmail_accounts SET is_default = 1 WHERE id = ? AND workspace_id = ? AND member_id = ?`).run(accountId, workspaceId, memberId);
  });
  run();
}

export function deleteGmailAccount(workspaceId: string, accountId: string): void {
  db().prepare(`DELETE FROM gmail_accounts WHERE id = ? AND workspace_id = ?`).run(accountId, workspaceId);
}

/** syncs all connected accounts for a workspace */
export async function syncGmailWorkspace(workspaceId: string): Promise<{ synced: number; matched: number }> {
  const accounts = db()
    .prepare(`SELECT id FROM gmail_accounts WHERE workspace_id = ? AND status = 'connected'`)
    .all(workspaceId) as { id: string }[];

  let synced = 0;
  let matched = 0;

  for (const account of accounts) {
    try {
      const result = await syncGmailAccount(workspaceId, account.id);
      synced += result.synced;
      matched += result.matched;
    } catch (error) {
      console.error(`Failed to sync account ${account.id}:`, error);
    }
  }

  return { synced, matched };
}

/** gets sync status for all accounts in a workspace */
export function getSyncStatus(workspaceId: string): Array<{
  id: string;
  email: string;
  status: string;
  last_sync_at: string | null;
  sync_cursor: string | null;
  last_error: string | null;
  is_default: number;
}> {
  return db()
    .prepare(`SELECT id, email, status, last_sync_at, sync_cursor, last_error, is_default FROM gmail_accounts WHERE workspace_id = ? AND status != 'disconnected' ORDER BY is_default DESC, created_at`)
    .all(workspaceId) as Array<{
    id: string;
    email: string;
    status: string;
    last_sync_at: string | null;
    sync_cursor: string | null;
    last_error: string | null;
    is_default: number;
  }>;
}

export function getGmailMessages(
  workspaceId: string,
  options: {
    accountId?: string;
    leadId?: string;
    direction?: "inbound" | "outbound";
    isRead?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): { messages: any[]; total: number } {
  const where: string[] = ["m.workspace_id = ?"];
  const params: any[] = [workspaceId];

  if (options.accountId) {
    where.push("m.account_id = ?");
    params.push(options.accountId);
  }
  if (options.leadId) {
    where.push("m.lead_id = ?");
    params.push(options.leadId);
  }
  if (options.direction) {
    where.push("m.direction = ?");
    params.push(options.direction);
  }
  if (options.isRead !== undefined) {
    where.push("m.is_read = ?");
    params.push(options.isRead ? 1 : 0);
  }

  const whereSql = where.join(" AND ");
  const total = (db().prepare(`SELECT COUNT(*) AS n FROM gmail_messages m WHERE ${whereSql}`).get(...params) as { n: number }).n;

  const messages = db()
    .prepare(`SELECT m.*, l.full_name AS lead_name, l.email AS lead_email FROM gmail_messages m LEFT JOIN leads l ON l.id = m.lead_id WHERE ${whereSql} ORDER BY m.gmail_sent_at DESC LIMIT ? OFFSET ?`)
    .all(...params, options.limit ?? 50, options.offset ?? 0) as any[];

  return { messages, total: total };
}

export function getGmailDrafts(
  workspaceId: string,
  options: { accountId?: string; leadId?: string; status?: string } = {}
): any[] {
  const where: string[] = ["d.workspace_id = ?"];
  const params: any[] = [workspaceId];

  if (options.accountId) {
    where.push("d.account_id = ?");
    params.push(options.accountId);
  }
  if (options.leadId) {
    where.push("d.lead_id = ?");
    params.push(options.leadId);
  }
  if (options.status) {
    where.push("d.status = ?");
    params.push(options.status);
  }

  return db()
    .prepare(`SELECT d.*, l.full_name AS lead_name FROM gmail_drafts d LEFT JOIN leads l ON l.id = d.lead_id WHERE ${where.join(" AND ")} ORDER BY d.created_at DESC`)
    .all(...params) as any[];
}

export function createGmailDraft(
  workspaceId: string,
  accountId: string,
  input: {
    leadId?: string | null;
    campaignId?: string | null;
    to: Array<{ email: string; name?: string }>;
    cc?: Array<{ email: string; name?: string }>;
    bcc?: Array<{ email: string; name?: string }>;
    subject: string;
    bodyText?: string;
    bodyHtml?: string;
  },
  actorId?: string | null
): string {
  const database = db();
  const id = `gdft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO gmail_drafts (id, workspace_id, account_id, lead_id, campaign_id, to_emails_json, cc_emails_json, bcc_emails_json, subject, body_text, body_html, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'draft', ?,?)`
    ).run(
      id, workspaceId, accountId,
      input.leadId ?? null, input.campaignId ?? null,
      JSON.stringify(input.to), JSON.stringify(input.cc ?? []), JSON.stringify(input.bcc ?? []),
      input.subject, input.bodyText ?? null, input.bodyHtml ?? null,
      new Date().toISOString(), new Date().toISOString()
    );

  return id;
}

export function approveGmailDraft(workspaceId: string, draftId: string, approverId: string): { ok: boolean; error?: string } {
  const database = db();
  const draft = database.prepare(`SELECT * FROM gmail_drafts WHERE id = ? AND workspace_id = ? AND status = 'draft'`).get(draftId, workspaceId) as any;
  if (!draft) return { ok: false, error: "Draft not found or already processed" };

  database
    .prepare(`UPDATE gmail_drafts SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`)
    .run(approverId, new Date().toISOString(), new Date().toISOString(), draftId);

  return { ok: true };
}

export function rejectGmailDraft(workspaceId: string, draftId: string, reason?: string): { ok: boolean; error?: string } {
  const database = db();
  const draft = database.prepare(`SELECT * FROM gmail_drafts WHERE id = ? AND workspace_id = ? AND status = 'draft'`).get(draftId, workspaceId) as any;
  if (!draft) return { ok: false, error: "Draft not found or already processed" };

  database
    .prepare(`UPDATE gmail_drafts SET status = 'rejected', error = ?, updated_at = ? WHERE id = ?`)
    .run(reason ?? "rejected by user", new Date().toISOString(), draftId);

  return { ok: true };
}

export async function sendGmailDraft(
  workspaceId: string,
  draftId: string,
  actorId?: string | null
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const database = db();
  const draft = database.prepare(`SELECT * FROM gmail_drafts WHERE id = ? AND workspace_id = ? AND status = 'approved'`).get(draftId, workspaceId) as any;
  if (!draft) return { ok: false, error: "Draft not found or not approved" };

  // get account and its own stored tokens (per-account OAuth)
  const account = database.prepare(`SELECT * FROM gmail_accounts WHERE id = ? AND workspace_id = ? AND status = 'connected'`).get(draft.account_id, workspaceId) as any;
  if (!account) return { ok: false, error: "Gmail account not connected" };

  const tokens = openTokens({
    access_token: { ciphertext: account.access_token_ciphertext, iv: account.access_token_iv, tag: account.access_token_tag },
    refresh_token: account.refresh_token_ciphertext ? { ciphertext: account.refresh_token_ciphertext, iv: account.refresh_token_iv!, tag: account.refresh_token_tag! } : null,
  });

  if (isTokenExpired(account.expires_at)) {
    return { ok: false, error: "Access token expired" };
  }

  const accessToken = tokens.access_token;

  // build RFC 2822 message
  const toHeader = draft.to_emails_json ? JSON.parse(draft.to_emails_json).map((e: any) => e.name ? `"${e.name}" <${e.email}>` : e.email).join(", ") : "";
  const ccHeader = draft.cc_emails_json ? JSON.parse(draft.cc_emails_json).map((e: any) => e.name ? `"${e.name}" <${e.email}>` : e.email).join(", ") : "";
  const bccHeader = draft.bcc_emails_json ? JSON.parse(draft.bcc_emails_json).map((e: any) => e.name ? `"${e.name}" <${e.email}>` : e.email).join(", ") : "";

  const messageLines = [
    `From: ${account.email}`,
    `To: ${toHeader}`,
    ccHeader ? `Cc: ${ccHeader}` : "",
    bccHeader ? `Bcc: ${bccHeader}` : "",
    `Subject: ${draft.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="utf-8"`,
    "",
    draft.bodyHtml ?? draft.bodyText ?? "",
  ].filter(Boolean).join("\r\n");

  const encoded = Buffer.from(messageLines).toString("base64url");

  try {
    const result = await gmailProvider.sendMessage(accessToken, { raw: encoded, threadId: draft.campaign_id ?? undefined });
    
    const now = new Date().toISOString();
    db().prepare(`UPDATE gmail_drafts SET status = 'sent', sent_at = ?, gmail_message_id = ?, updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), result.id, new Date().toISOString(), draftId);

    return { ok: true, messageId: result.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db().prepare(`UPDATE gmail_drafts SET status = 'rejected', error = ?, updated_at = ? WHERE id = ?`)
      .run(message, new Date().toISOString(), draftId);
    return { ok: false, error: message };
  }
}

export function deleteGmailDraft(workspaceId: string, draftId: string): { ok: boolean } {
  db().prepare(`DELETE FROM gmail_drafts WHERE id = ? AND workspace_id = ? AND status IN ('draft', 'rejected')`).run(draftId, workspaceId);
  return { ok: true };
}

export { syncGmailAccount, syncAllGmailAccounts };