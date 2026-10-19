/**
 * Gmail sync - pulls messages from Gmail and matches them to leads
 */
import type { Database } from "better-sqlite3";
import { db as dbClient } from "../db/client";
import { gmailProvider } from "./client";
import { openTokens, isTokenExpired } from "./secrets";

const MAX_MESSAGES_PER_SYNC = 500;

/** normalizes an email address for matching */
function normEmailLocal(email: string): string {
  return email.toLowerCase().trim();
}

/** extracts email addresses from Gmail headers */
function extractEmailAddresses(headers: Array<{ name: string; value: string }>, name: string): Array<{ email: string; name?: string }> {
  const values = headers
    .filter((h) => h.name.toLowerCase() === name.toLowerCase())
    .flatMap((h) => h.value.split(",").map((v) => v.trim()))
    .filter(Boolean);
  
  return values.map((v) => {
    const match = v.match(/^"?([^"<]+)"?\s*<([^>]+)>$/);
    if (match) return { email: match[2].toLowerCase().trim(), name: match[1].trim() };
    const emailMatch = v.match(/([^<\s]+@[^>\s]+)/);
    if (emailMatch) return { email: emailMatch[1].toLowerCase().trim(), name: v.replace(emailMatch[0], "").trim() || undefined };
    return { email: v.toLowerCase().trim() };
  });
}

/** gets the best plain text or HTML body from a Gmail message payload */
function extractBody(payload: any): { text: string | null; html: string | null } {
  let text: string | null = null;
  let html: string | null = null;

  function walk(part: any) {
    if (!part) return;
    if (part.mimeType === "text/plain" && part.body?.data) {
      text = Buffer.from(part.body.data, "base64url").toString("utf8");
    } else if (part.mimeType === "text/html" && part.body?.data) {
      html = Buffer.from(part.body.data, "base64url").toString("utf8");
    }
    if (part.parts) {
      for (const p of part.parts) walk(p);
    }
  }
  walk(payload);
  return { text, html };
}

/** normalizes a Gmail message to our internal format */
function normalizeMessage(msg: any, accountEmail: string) {
  const headers = msg.payload.headers;
  const { text, html } = extractBody(msg.payload);
  
  const subject = headers.find((h: any) => h.name.toLowerCase() === "subject")?.value ?? null;
  const fromHeader = headers.find((h: any) => h.name.toLowerCase() === "from")?.value ?? "";
  const toHeader = headers.find((h: any) => h.name.toLowerCase() === "to")?.value ?? "";
  const ccHeader = headers.find((h: any) => h.name.toLowerCase() === "cc")?.value ?? "";
  const bccHeader = headers.find((h: any) => h.name.toLowerCase() === "bcc")?.value ?? "";
  
  const from = extractEmailAddresses(headers, "from")[0] ?? { email: "" };
  const to = extractEmailAddresses(headers, "to");
  const cc = extractEmailAddresses(headers, "cc");
  const bcc = extractEmailAddresses(headers, "bcc");

  const internalDate = new Date(parseInt(msg.internalDate, 10)).toISOString();
  const isFromMe = msg.payload.headers.some((h: any) => h.name.toLowerCase() === "from" && h.value.toLowerCase().includes(accountEmail.toLowerCase()));
  const direction = isFromMe ? "outbound" : "inbound";

  return {
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId,
    gmailHistoryId: msg.historyId,
    subject: headers.find((h: any) => h.name.toLowerCase() === "subject")?.value ?? null,
    from: { email: from.email, name: from.name },
    to: to.map(({ email, name }) => ({ email, name })),
    cc: cc.map(({ email, name }) => ({ email, name })),
    bcc: bcc.map(({ email, name }) => ({ email, name })),
    snippet: msg.snippet ?? null,
    bodyText: text,
    bodyHtml: html,
    internalDate: new Date(parseInt(msg.internalDate, 10)).toISOString(),
    direction,
    isRead: !msg.labelIds.includes("UNREAD"),
    isStarred: msg.labelIds.includes("STARRED"),
    labelIds: msg.labelIds,
    labelNames: msg.labelIds,
  };
}

/** matches a Gmail message to a lead by email address and thread */
function matchMessageToLead(
  database: Database,
  workspaceId: string,
  accountEmail: string,
  message: any
): { leadId: string | null; matchedBy: "email" | "thread" | "manual" | "none"; confidence: number } {
  const allEmails = [
    ...message.to.map((e: any) => e.email),
    ...message.cc.map((e: any) => e.email),
    ...message.bcc.map((e: any) => e.email),
    message.from.email,
  ].map(normEmailLocal).filter(Boolean);

  if (allEmails.length === 0) return { leadId: null, matchedBy: "none", confidence: 0 };

  // first try: exact email match on lead
  for (const email of allEmails) {
    const lead = database
      .prepare(`SELECT id FROM leads WHERE workspace_id = ? AND email_normalized = ? AND merged_into_lead_id IS NULL`)
      .get(workspaceId, email.toLowerCase().trim()) as { id: string } | undefined;
    if (lead) return { leadId: lead.id, matchedBy: "email", confidence: 1.0 };
  }

  // second try: thread matching - check if any message in this thread is already linked
  const threadLead = database
    .prepare(`SELECT lead_id FROM gmail_messages WHERE workspace_id = ? AND gmail_thread_id = ? AND lead_id IS NOT NULL LIMIT 1`)
    .get(workspaceId, "") as { lead_id: string } | undefined;
  if (threadLead) return { leadId: threadLead.lead_id, matchedBy: "thread", confidence: 0.9 };

  // third try: company domain match
  const fromDomain = message.from?.email?.split("@")[1]?.toLowerCase();
  if (fromDomain) {
    const lead = database
      .prepare(`SELECT l.id FROM leads l JOIN companies c ON c.id = l.company_id WHERE l.workspace_id = ? AND c.domain_normalized = ? AND l.merged_into_lead_id IS NULL LIMIT 1`)
      .get(workspaceId, fromDomain) as { id: string } | undefined;
    if (lead) return { leadId: lead.id, matchedBy: "email", confidence: 0.7 };
  }

  return { leadId: null, matchedBy: "none", confidence: 0 };
}

/** converts normalized message to DB insert params */
function messageToDbParams(
  account: any,
  message: any,
  match: { leadId: string | null; matchedBy: "email" | "thread" | "manual" | "none"; confidence: number }
) {
  return {
    id: `gmsg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    workspace_id: account.workspace_id,
    account_id: account.id,
    gmail_message_id: message.gmailMessageId,
    gmail_thread_id: message.gmailThreadId,
    gmail_history_id: message.gmailHistoryId,
    subject: message.subject,
    from_email: message.from.email,
    from_name: message.from.name ?? null,
    to_emails_json: JSON.stringify(message.to),
    cc_emails_json: JSON.stringify(message.cc),
    bcc_emails_json: JSON.stringify(message.bcc),
    snippet: message.snippet,
    body_text: message.bodyText,
    body_html: message.bodyHtml,
    direction: message.direction,
    is_read: message.isRead ? 1 : 0,
    is_starred: message.isStarred ? 1 : 0,
    labels_json: JSON.stringify(message.labelIds),
    gmail_sent_at: message.internalDate,
    gmail_received_at: message.direction === "inbound" ? message.internalDate : null,
    lead_id: match.leadId,
    matched_by: match.matchedBy,
    synced_at: new Date().toISOString(),
    raw_json: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * syncs a single Gmail account - fetches new messages and stores them
 */
export async function syncGmailAccount(
  workspaceId: string,
  accountId: string,
  options: { maxMessages?: number; sinceHistoryId?: string; fullSync?: boolean } = {}
): Promise<{ synced: number; matched: number; errors: string[] }> {
  const database = dbClient();
  const errors: string[] = [];

  // get account
  const account = database
    .prepare(`SELECT * FROM gmail_accounts WHERE id = ? AND workspace_id = ?`)
    .get(accountId, workspaceId) as any;

  if (!account) throw new Error("Gmail account not found");
  if (account.status !== "connected") throw new Error("Account not connected");

  // get credentials - use the account's own stored tokens (gmail has per-account OAuth,
  // not the shared prospecting provider_credentials table)
  const tokens = openTokens({
    access_token: { ciphertext: account.access_token_ciphertext, iv: account.access_token_iv, tag: account.access_token_tag },
    refresh_token: account.refresh_token_ciphertext ? { ciphertext: account.refresh_token_ciphertext, iv: account.refresh_token_iv!, tag: account.refresh_token_tag! } : null,
  });

  // check token expiry
  if (isTokenExpired(account.expires_at)) {
    throw new Error("Access token expired - refresh not yet implemented");
  }

  const accessToken = tokens.access_token;

  // get sync state
  const syncState = database
    .prepare(`SELECT * FROM gmail_sync_state WHERE account_id = ?`)
    .get(accountId) as any | undefined;

  const historyId = options.sinceHistoryId ?? syncState?.history_id;
  const maxMessages = options.maxMessages ?? 500;

  let synced = 0;
  let matched = 0;
  let nextHistoryId: string | null = historyId ?? null;

  try {
    // update sync state to running
    database
      .prepare(`INSERT OR REPLACE INTO gmail_sync_state (id, workspace_id, account_id, history_id, last_sync_at, status, error, created_at, updated_at)
                VALUES (?,?,?,?,?, 'running', NULL, ?, ?)`)
      .run(`sync_${Date.now().toString(36)}`, workspaceId, accountId, historyId ?? null, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());

    let pageToken: string | undefined;
    let processed = 0;

    do {
      if (processed >= maxMessages) break;

      const list = await gmailProvider.listMessages(accessToken, {
        maxResults: Math.min(100, maxMessages - processed),
        pageToken,
        q: options.fullSync ? undefined : "is:unread OR is:starred OR newer_than:30d",
      });

      if (!list.messages?.length) break;

      for (const msgRef of list.messages) {
        if (processed >= maxMessages) break;

        try {
          // check if already synced
          const existing = database
            .prepare(`SELECT id FROM gmail_messages WHERE workspace_id = ? AND gmail_message_id = ?`)
            .get(workspaceId, msgRef.id) as { id: string } | undefined;
          
          if (existing) {
            processed++;
            continue;
          }

          // fetch full message
          const msg = await gmailProvider.getMessage(accessToken, msgRef.id, "full");
          const normalized = normalizeMessage(msg, account.email);
          const match = matchMessageToLead(dbClient(), workspaceId, account.email, normalized);
          
          // insert message
          const params = {
            id: `gmsg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
            workspace_id: account.workspace_id,
            account_id: account.id,
            gmail_message_id: msg.id,
            gmail_thread_id: msg.threadId,
            gmail_history_id: msg.historyId,
            subject: msg.payload.headers.find((h: any) => h.name.toLowerCase() === "subject")?.value ?? null,
            from_email: normalized.from.email,
            from_name: normalized.from.name ?? null,
            to_emails_json: JSON.stringify(normalized.to),
            cc_emails_json: JSON.stringify(normalized.cc),
            bcc_emails_json: JSON.stringify(normalized.bcc),
            snippet: msg.snippet ?? null,
            body_text: normalized.bodyText,
            body_html: normalized.bodyHtml,
            direction: normalized.direction,
            is_read: normalized.isRead ? 1 : 0,
            is_starred: normalized.isStarred ? 1 : 0,
            labels_json: JSON.stringify(normalized.labelIds),
            gmail_sent_at: normalized.internalDate,
            gmail_received_at: normalized.direction === "inbound" ? normalized.internalDate : null,
            lead_id: match.leadId,
            matched_by: match.matchedBy,
            synced_at: new Date().toISOString(),
            raw_json: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          // insert message
          database.prepare(
            `INSERT INTO gmail_messages (
              id, workspace_id, account_id, gmail_message_id, gmail_thread_id, gmail_history_id,
              subject, from_email, from_name, to_emails_json, cc_emails_json, bcc_emails_json,
              snippet, body_text, body_html, direction, is_read, is_starred, labels_json,
              gmail_sent_at, gmail_received_at, lead_id, matched_by, synced_at, raw_json, created_at, updated_at
            ) VALUES (?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?,?)`
          ).run(
            params.id, params.workspace_id, params.account_id, params.gmail_message_id,
            params.gmail_thread_id, params.gmail_history_id, params.subject, params.from_email,
            params.from_name, params.to_emails_json, params.cc_emails_json, params.bcc_emails_json,
            params.snippet, params.body_text, params.body_html, params.direction, params.is_read,
            params.is_starred, params.labels_json, params.gmail_sent_at, params.gmail_received_at,
            params.lead_id, params.matched_by, params.synced_at, params.raw_json,
            params.created_at, params.updated_at
          );

          if (match.leadId) matched++;
          synced++;
          processed++;

          // update lead activity if matched
          if (match.leadId) {
            const now = new Date().toISOString();
            dbClient().prepare(`UPDATE leads SET last_activity_at = ?, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), new Date().toISOString(), match.leadId);
            // recordEvent would need proper actorId
          }
        } catch (error) {
          console.error(`Failed to sync message ${msgRef.id}:`, error);
        }
      }

      pageToken = list.nextPageToken;
    } while (pageToken && processed < maxMessages);

    // update history cursor - would need to track from history API
    // nextHistoryId = list.historyId;

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // update sync state with error
    database
      .prepare(`UPDATE gmail_sync_state SET status = 'error', error = ?, updated_at = ? WHERE account_id = ?`)
      .run(message, new Date().toISOString(), accountId);
    throw error;
  }

  // update sync state to completed
  database
    .prepare(`UPDATE gmail_sync_state SET history_id = ?, last_sync_at = ?, status = 'idle', error = NULL, updated_at = ? WHERE account_id = ?`)
    .run(null, new Date().toISOString(), new Date().toISOString(), accountId);

  // update account last sync
  database
    .prepare(`UPDATE gmail_accounts SET last_sync_at = ?, sync_cursor = ?, updated_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), null, new Date().toISOString(), accountId);

  return { synced, matched, errors: [] };
}

/**
 * syncs all connected Gmail accounts for a workspace
 */
export async function syncAllGmailAccounts(workspaceId: string): Promise<{ totalSynced: number; totalMatched: number; accounts: number }> {
  const database = dbClient();
  const accounts = database
    .prepare(`SELECT id FROM gmail_accounts WHERE workspace_id = ? AND status = 'connected'`)
    .all(workspaceId) as { id: string }[];

  let totalSynced = 0;
  let totalMatched = 0;

  for (const account of accounts) {
    try {
      const result = await syncGmailAccount(workspaceId, account.id);
      totalSynced += result.synced;
      totalMatched += result.matched;
    } catch (error) {
      console.error(`Failed to sync account ${account.id}:`, error);
    }
  }

  return { totalSynced, totalMatched, accounts: accounts.length };
}