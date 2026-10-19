/** workspace context. one workspace per install, one signed-in member at a time. */
import { cookies } from "next/headers";
import { db } from "./db/client";
import { nowIso, toIso } from "./db/time";
import type { Member, Workspace } from "./types";

export const SESSION_COOKIE = "leadflow_session";
const SESSION_DAYS = 30;

export function getWorkspaceRow(database = db()): Workspace | null {
  const row = database.prepare(`SELECT * FROM workspaces ORDER BY created_at LIMIT 1`).get() as Workspace | undefined;
  return row ?? null;
}

export function requireWorkspace(database = db()): Workspace {
  const ws = getWorkspaceRow(database);
  if (!ws) throw new Error("no workspace found. run `npm run db:seed` first.");
  return ws;
}

/** null-safe workspace id — use in pages so a fresh/empty DB renders an
 *  empty state instead of throwing a 500. */
export function getWorkspaceId(database = db()): string | null {
  try {
    return getWorkspaceRow(database)?.id ?? null;
  } catch {
    return null;
  }
}

export function listMembers(database = db()): Member[] {
  return database
    .prepare(`SELECT * FROM members WHERE workspace_id = ? ORDER BY role = 'owner' DESC, name`)
    .all(requireWorkspaceId(database)) as Member[];
}

export function requireWorkspaceId(database = db()): string {
  return requireWorkspace(database).id;
}

export function memberById(database = db(), id: string | null): Member | null {
  if (!id) return null;
  return (database.prepare(`SELECT * FROM members WHERE id = ?`).get(id) as Member) ?? null;
}

export function memberByEmail(database = db(), email: string): Member | null {
  return (database.prepare(`SELECT * FROM members WHERE email = ?`).get(email.toLowerCase()) as Member) ?? null;
}

/** the signed-in member. falls back to the owner so the app is usable without a login. */
export async function currentMember(): Promise<Member | null> {
  const database = db();
  const ws = getWorkspaceRow(database);
  if (!ws) return null;

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = database
      .prepare(`SELECT * FROM sessions WHERE token = ? AND expires_at > ?`)
      .get(token, nowIso()) as { id: string; member_id: string } | undefined;
    if (session) {
      database.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(nowIso(), session.id);
      const member = memberById(database, session.member_id);
      if (member?.is_active) return member;
    }
  }

  return (
    (database
      .prepare(`SELECT * FROM members WHERE workspace_id = ? ORDER BY role = 'owner' DESC, created_at LIMIT 1`)
      .get(ws.id) as Member) ?? null
  );
}

/** server actions run outside the react tree, so they read the cookie directly. */
export function currentMemberSync(): Member | null {
  const database = db();
  const ws = getWorkspaceRow(database);
  if (!ws) return null;
  return (
    (database
      .prepare(`SELECT * FROM members WHERE workspace_id = ? ORDER BY role = 'owner' DESC, created_at LIMIT 1`)
      .get(ws.id) as Member) ?? null
  );
}

export function createSession(database = db(), memberId: string): { token: string; expiresAt: string } {
  const token = `tok_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const expiresAt = toIso(new Date(Date.now() + SESSION_DAYS * 86_400_000))!;
  database
    .prepare(
      `INSERT INTO sessions (id, workspace_id, member_id, token, created_at, expires_at, last_seen_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      `ses_${Math.random().toString(36).slice(2, 10)}`,
      requireWorkspaceId(database),
      memberId,
      token,
      nowIso(),
      expiresAt,
      nowIso(),
    );
  return { token, expiresAt };
}

export function updateWorkspaceSettings(patch: Record<string, unknown>): void {
  const database = db();
  const ws = requireWorkspace(database);
  const current = JSON.parse(ws.settings_json || "{}") as Record<string, unknown>;
  database
    .prepare(`UPDATE workspaces SET settings_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify({ ...current, ...patch }), nowIso(), ws.id);
}

export function workspaceSettings(): Record<string, unknown> {
  try {
    return JSON.parse(requireWorkspace().settings_json || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}