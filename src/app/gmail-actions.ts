"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { currentMemberSync, requireWorkspaceId } from "@/lib/workspace";
import {
  saveGmailCredential,
  clearGmailCredential,
  listGmailAccounts,
  getSyncStatus,
  createGmailDraft,
  approveGmailDraft,
  rejectGmailDraft,
  sendGmailDraft,
  deleteGmailDraft,
  syncGmailAccount,
  syncAllGmailAccounts,
  getGmailDrafts,
  getGmailMessages,
  setDefaultGmailAccount,
  deleteGmailAccount,
} from "@/lib/gmail";

type Result = { ok: boolean; error?: string; message?: string; url?: string };

function toResult(error: unknown): { ok: boolean; error?: string; code?: string; detail?: string | null; retryable?: boolean } {
  if (error instanceof Error) {
    return { ok: false, error: error.message };
  }
  if (error && typeof error === "object" && "code" in error) {
    return {
      ok: false,
      error: (error as any).message,
      code: (error as any).code,
      detail: (error as any).detail,
      retryable: (error as any).retryable,
    };
  }
  return { ok: false, error: String(error) };
}

/** initiates Gmail OAuth flow */
export async function startGmailOAuth(): Promise<{ url: string } | { error: string }> {
  const database = db();
  const workspaceId = requireWorkspaceId(database);
  const member = currentMemberSync();
  if (!member) return { error: "not authenticated" };

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${process.env.NEXT_PUBLIC_APP_URL}/auth/gmail/callback`;

  if (!clientId || !clientSecret) {
    return { error: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." };
  }

  const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.metadata",
  ].join(" ");

  const state = Buffer.from(JSON.stringify({ workspaceId, memberId: member.id })).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.metadata",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
}

/** handles OAuth callback - call this from your auth route */
export async function handleGmailCallback(code: string, state: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { workspaceId, memberId } = JSON.parse(Buffer.from(state, "base64url").toString());
    
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${process.env.NEXT_PUBLIC_APP_URL}/auth/gmail/callback`;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? `${process.env.NEXT_PUBLIC_APP_URL}/auth/gmail/callback`,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json();
      return { ok: false, error: `Token exchange failed: ${error.error_description ?? "unknown error"}` };
    }

    const tokens = await tokenResponse.json();

    // get user's email from Gmail profile
    const profileRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();

    const { saveGmailCredential } = await import("@/lib/gmail");
    const workspaceId = requireWorkspaceId(db());
    const member = currentMemberSync();
    
    const sealed = (await import("@/lib/gmail/secrets")).sealTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    });

    const dbClient = db();
    const now = new Date().toISOString();
    
    db().prepare(
      `INSERT INTO gmail_accounts (
        id, workspace_id, member_id, email,
        access_token_ciphertext, access_token_iv, access_token_tag,
        refresh_token_ciphertext, refresh_token_iv, refresh_token_tag,
        expires_at, scopes_json, status, is_default, created_at, updated_at
      ) VALUES (?,?,?,?, ?,?,?, ?,?,?, ?,?,?,?,?)
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
        updated_at = excluded.updated_at`
    ).run(
      `gacc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      workspaceId, member?.id, profile.emailAddress,
      "placeholder", "placeholder", "placeholder",
      "placeholder", "placeholder", "placeholder",
      new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      JSON.stringify(["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.metadata"]),
      "connected",
      0,
      new Date().toISOString(),
      new Date().toISOString()
    );

    // update with actual encrypted tokens
    const sealed = (await import("@/lib/gmail/secrets")).sealTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
    });
    db().prepare(`UPDATE gmail_accounts SET access_token_ciphertext = ?, access_token_iv = ?, access_token_tag = ?, refresh_token_ciphertext = ?, refresh_token_iv = ?, refresh_token_tag = ?, expires_at = ? WHERE workspace_id = ? AND member_id = ? AND email = ?`)
      .run(sealed.access_token.ciphertext, sealed.access_token.iv, sealed.access_token.tag, sealed.refresh_token?.ciphertext ?? null, sealed.refresh_token?.iv ?? null, sealed.refresh_token?.tag ?? null, new Date(Date.now() + tokens.expires_in * 1000).toISOString(), workspaceId, member?.id, profile.emailAddress);

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "OAuth failed" };
  }
}

/** disconnects a Gmail account */
export async function disconnectGmail(accountId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const workspaceId = requireWorkspaceId(db());
    const { clearGmailCredential } = await import("@/lib/gmail");
    
    const account = db().prepare(`SELECT * FROM gmail_accounts WHERE id = ? AND workspace_id = ?`).get(accountId, workspaceId);
    if (!account) return { ok: false, error: "Account not found" };

    clearGmailCredential(workspaceId, account.member_id, account.email);
    
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to disconnect" };
  }
}

/** syncs a specific Gmail account */
export async function syncGmail(accountId: string): Promise<{ ok: boolean; synced?: number; matched?: number; error?: string }> {
  try {
    const workspaceId = requireWorkspaceId(db());
    const { syncGmailAccount } = await import("@/lib/gmail");
    const result = await syncGmailAccount(workspaceId, accountId);
    revalidatePath("/gmail");
    revalidatePath("/inbox");
    revalidatePath("/follow-ups");
    revalidatePath("/overview");
    return { ok: true, synced: result.synced, matched: result.matched };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Sync failed" };
  }
}

/** syncs all connected Gmail accounts for the workspace */
export async function syncAllGmail(): Promise<{ ok: boolean; totalSynced?: number; totalMatched?: number; error?: string }> {
  try {
    const workspaceId = requireWorkspaceId(db());
    const { syncAllGmailAccounts } = await import("@/lib/gmail");
    const result = await syncAllGmailAccounts(workspaceId);
    revalidatePath("/gmail");
    revalidatePath("/inbox");
    revalidatePath("/follow-ups");
    revalidatePath("/overview");
    return { ok: true, totalSynced: result.totalSynced, totalMatched: result.totalMatched };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Sync failed" };
  }
}

/** creates a draft email */
export async function createEmailDraft(input: {
  accountId: string;
  leadId?: string;
  campaignId?: string;
  to: Array<{ email: string; name?: string }>;
  cc?: Array<{ email: string; name?: string }>;
  bcc?: Array<{ email: string; name?: string }>;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
}): Promise<{ ok: boolean; draftId?: string; error?: string }> {
  try {
    const workspaceId = requireWorkspaceId(db());
    const member = currentMemberSync();
    
    const { createGmailDraft } = await import("@/lib/gmail");
    const draftId = createGmailDraft(workspaceId, input.accountId, {
      leadId: input.leadId,
      campaignId: input.campaignId,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
    });
    
    revalidatePath("/gmail/drafts");
    return { ok: true, draftId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to create draft" };
  }
}

/** approves a draft for sending */
export async function approveEmailDraft(draftId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const workspaceId = requireWorkspaceId(db());
    const member = currentMemberSync();
    const { approveGmailDraft } = await import("@/lib/gmail");
    const result = approveGmailDraft(workspaceId, draftId, member?.id ?? "system");
    revalidatePath("/gmail/drafts");
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to approve" };
  }
}

/** rejects a draft */
export async function rejectEmailDraft(draftId: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const workspaceId = requireWorkspaceId(db());
    const { rejectGmailDraft } = await import("@/lib/gmail");
    const result = rejectGmailDraft(workspaceId, draftId, reason);
    revalidatePath("/gmail/drafts");
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to reject" };
  }
}

/** sends an approved draft */
export async function sendApprovedDraft(draftId: string): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const workspaceId = requireWorkspaceId(db());
    const member = currentMemberSync();
    const { sendGmailDraft } = await import("@/lib/gmail");
    const result = await sendGmailDraft(workspaceId, draftId, member?.id ?? null);
    revalidatePath("/gmail/drafts");
    revalidatePath("/gmail");
    revalidatePath("/overview");
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to send" };
  }
}

/** deletes a draft */
export async function deleteDraft(draftId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const workspaceId = requireWorkspaceId(db());
    const { deleteGmailDraft } = await import("@/lib/gmail");
    deleteGmailDraft(workspaceId, draftId);
    revalidatePath("/gmail/drafts");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to delete" };
  }
}

/** gets all connected Gmail accounts for the workspace */
export async function getGmailAccounts() {
  const workspaceId = requireWorkspaceId(db());
  const { getSyncStatus } = await import("@/lib/gmail");
  return getSyncStatus(workspaceId);
}

/** gets sync status for all accounts */
export async function getGmailSyncStatus() {
  const workspaceId = requireWorkspaceId(db());
  const { getSyncStatus } = await import("@/lib/gmail");
  return getSyncStatus(workspaceId);
}

/** gets synced messages for an account or lead */
export async function getGmailMessagesList(input: {
  accountId?: string;
  leadId?: string;
  direction?: "inbound" | "outbound";
  isRead?: boolean;
  limit?: number;
  offset?: number;
}) {
  const workspaceId = requireWorkspaceId(db());
  const { getGmailMessages } = await import("@/lib/gmail");
  return getGmailMessages(workspaceId, input);
}

/** gets drafts */
export async function getDraftsList(input: {
  accountId?: string;
  leadId?: string;
  status?: string;
}) {
  const workspaceId = requireWorkspaceId(db());
  const { getGmailDrafts } = await import("@/lib/gmail");
  return getGmailDrafts(workspaceId, input);
}

/** starts a sync for a specific account */
export async function startSync(accountId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const workspaceId = requireWorkspaceId(db());
    const { syncGmailAccount } = await import("@/lib/gmail");
    await syncGmailAccount(workspaceId, accountId);
    revalidatePath("/gmail");
    revalidatePath("/overview");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Sync failed" };
  }
}

/** gets messages for a specific lead */
export async function getLeadEmails(leadId: string) {
  const workspaceId = requireWorkspaceId(db());
  const { getGmailMessages } = await import("@/lib/gmail");
  return getGmailMessages(workspaceId, { leadId });
}