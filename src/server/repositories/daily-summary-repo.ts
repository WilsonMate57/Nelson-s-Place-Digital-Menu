import type { DailySummaryStatusDto } from "../../shared/types";
import type { Db } from "../db/connection";

type Status = DailySummaryStatusDto["recent"][number]["status"];

/** Log of automatic daily summaries: one row per hotel-local day. */
export class DailySummaryRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  get(day: string): { status: Status; attempts: number } | null {
    return (this.db.prepare("SELECT status, attempts FROM daily_summaries WHERE day = ?").get(day) as { status: Status; attempts: number } | undefined) ?? null;
  }

  record(day: string, status: Status, channels: string | null, error: string | null): void {
    const now = this.clock().toISOString();
    this.db
      .prepare(
        `INSERT INTO daily_summaries (day, status, channels, attempts, last_error, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET status = excluded.status, channels = excluded.channels, attempts = attempts + 1,
           last_error = excluded.last_error, updated_at = excluded.updated_at`,
      )
      .run(day, status, channels, error, now, now);
  }

  recent(limit: number): DailySummaryStatusDto["recent"] {
    return (
      this.db.prepare("SELECT * FROM daily_summaries ORDER BY day DESC LIMIT ?").all(limit) as {
        day: string;
        status: Status;
        channels: string | null;
        attempts: number;
        last_error: string | null;
        updated_at: string;
      }[]
    ).map((r) => ({ day: r.day, status: r.status, channels: r.channels, attempts: r.attempts, lastError: r.last_error, updatedAt: r.updated_at }));
  }
}
