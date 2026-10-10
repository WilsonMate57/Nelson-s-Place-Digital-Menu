/**
 * Creates a consistent online backup of the SQLite database (safe while the
 * server is running) and keeps the most recent N copies.
 *
 *   npm run db:backup -- [--dir backups] [--keep 14]
 *
 * Schedule it daily (Plesk "Scheduled Tasks" / cron) and copy the backup
 * folder off the server. See docs/DEPLOYMENT.md.
 */
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../config";
import { openDatabase } from "../db/connection";

async function main() {
  const { values } = parseArgs({
    options: { dir: { type: "string", default: "backups" }, keep: { type: "string", default: "14" } },
  });
  const keep = Math.max(1, Number(values.keep) || 14);
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  mkdirSync(values.dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(values.dir, `nelsons-place-${stamp}.db`);
  await db.backup(target);
  db.close();

  const old = readdirSync(values.dir)
    .filter((f) => /^nelsons-place-.*\.db$/.test(f))
    .sort()
    .reverse()
    .slice(keep);
  for (const file of old) unlinkSync(join(values.dir, file));
  console.log(`Backup written to ${target} (${old.length} old backup(s) removed, keeping ${keep}).`);
}

main().catch((err: unknown) => {
  console.error("Backup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
