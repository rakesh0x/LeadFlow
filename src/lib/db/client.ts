import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { nowIso } from "./time";

const MIGRATIONS_DIR = path.join(process.cwd(), "src/lib/db/migrations");

function resolveDbFile(): string {
  if (process.env.LEADFLOW_DB_PATH) return process.env.LEADFLOW_DB_PATH;
  // vercel serverless filesystem is read-only except /tmp — keep db there in prod
  if (process.env.VERCEL) {
    return path.join("/tmp", "leadflow.db");
  }
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "leadflow.db");
}

/** creates a minimal workspace + owner on fresh/empty DBs (vercel ephemeral fs).
 *  idempotent — no-op when a workspace already exists. keeps the app bootable
 *  without running db:seed. */
function ensureBootstrapped(database: Database.Database): void {
  try {
    const tables = database
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'`)
      .get() as { name: string } | undefined;
    if (!tables) return;
    const existing = database.prepare(`SELECT COUNT(*) AS n FROM workspaces`).get() as { n: number };
    if (existing.n > 0) return;
    const now = nowIso();
    const wsId = `ws_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    database
      .prepare(`INSERT INTO workspaces (id, name, slug, timezone, settings_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(wsId, "my workspace", `ws-${Date.now().toString(36)}`, "utc", "{}", now, now);
    database
      .prepare(`INSERT INTO members (id, workspace_id, name, email, role, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(`mem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`, wsId, "owner", "owner@leadflow.local", "owner", 1, now, now);
  } catch {
    // never crash boot on bootstrap — pages handle missing workspace gracefully
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __leadflow_db: Database.Database | undefined;
}

function open(): Database.Database {
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const file = isBuild ? ":memory:" : resolveDbFile();
  // /tmp is the only writable dir on vercel serverless; data/ works locally
  const database = new Database(file);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("synchronous = NORMAL");
  migrate(database);
  if (!isBuild) ensureBootstrapped(database);
  return database;
}

/** applies any migration files that have not run yet, in filename order. */
export function migrate(database: Database.Database): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  );
  const applied = new Set(
    database
      .prepare(`SELECT name FROM _migrations`)
      .all()
      .map((r) => (r as { name: string }).name),
  );

  if (!fs.existsSync(MIGRATIONS_DIR)) return;
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const run = database.transaction(() => {
      database.exec(sql);
      database.prepare(`INSERT INTO _migrations (name, applied_at) VALUES (?, ?)`).run(file, nowIso());
    });
    run();
  }
}

/** the shared connection. created once per process. */
export function db(): Database.Database {
  if (!globalThis.__leadflow_db) globalThis.__leadflow_db = open();
  return globalThis.__leadflow_db;
}

// build guard: never open file db during prerender
export function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/** opens a throwaway connection — used by scripts and the job runner. */
export function openDb(file?: string): Database.Database {
  if (file) {
    const database = new Database(file);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    database.pragma("busy_timeout = 5000");
    migrate(database);
    return database;
  }
  return db();
}

/** runs `fn` inside a transaction. nested calls reuse the outer transaction. */
export function tx<T>(fn: (database: Database.Database) => T): T {
  const database = db();
  if (database.inTransaction) return fn(database);
  return database.transaction(fn)(database);
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}