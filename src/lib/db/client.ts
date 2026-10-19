import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { nowIso } from "./time";

const MIGRATIONS_DIR = path.join(process.cwd(), "src/lib/db/migrations");

function resolveDbFile(): string {
  if (process.env.LEADFLOW_DB_PATH) return process.env.LEADFLOW_DB_PATH;
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "leadflow.db");
}

declare global {
  // eslint-disable-next-line no-var
  var __leadflow_db: Database.Database | undefined;
}

function open(): Database.Database {
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  const file = isBuild ? ":memory:" : resolveDbFile();
  const database = new Database(file);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("synchronous = NORMAL");
  migrate(database);
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