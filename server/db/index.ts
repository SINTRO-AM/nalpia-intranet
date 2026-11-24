import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { migrations } from "./schema.js";

export type DB = Database.Database;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");
  const done = new Set((db.prepare("SELECT id FROM _migrations").all() as { id: number }[]).map((r) => r.id));
  for (const m of migrations) {
    if (done.has(m.id)) continue;
    // PRAGMA foreign_keys has no effect inside a transaction, so it is switched outside.
    if (m.foreignKeysOff) db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(m.sql);
        if (m.foreignKeysOff) {
          const broken = db.pragma("foreign_key_check") as unknown[];
          if (broken.length) throw new Error(`Migration ${m.id} (${m.name}): ${broken.length} broken foreign key(s)`);
        }
        db.prepare("INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, Date.now());
      })();
    } finally {
      if (m.foreignKeysOff) db.pragma("foreign_keys = ON");
    }
  }
}

/** Read JSON columns robustly. */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? parseJson(row.value, fallback) : fallback;
}

export function setSetting(db: DB, key: string, value: unknown) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    JSON.stringify(value),
  );
}
