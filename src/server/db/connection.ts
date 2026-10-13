import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MIGRATIONS } from "./migrations";

export type Db = Database.Database;

/** Opens (or creates) the database, applies pragmas and pending migrations. */
export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

/**
 * Applies pending migrations, each in its own transaction. Foreign keys are
 * switched off during a migration (as SQLite's documented table-rebuild
 * procedure requires, so dropping a rebuilt table does not cascade) and the
 * result is checked for broken references before committing.
 */
export function migrate(db: Db): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(MIGRATIONS[version]!);
        const problems = db.pragma("foreign_key_check") as unknown[];
        if (problems.length > 0) throw new Error(`Migration ${version + 1} broke ${problems.length} foreign key reference(s)`);
        db.pragma(`user_version = ${version + 1}`);
      })();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}

export const nowIso = (): string => new Date().toISOString();
