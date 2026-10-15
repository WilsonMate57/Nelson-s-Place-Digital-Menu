import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db/connection";
import { badRequest } from "../http/errors";
import type { OrdersRepo, PurgeFilter } from "../repositories/orders-repo";
import { dayRange } from "./report-service";

export type PurgeScope = PurgeFilter["scope"];

/**
 * Deleting orders (e.g. test orders before opening). Always takes a full
 * safety copy of the database first; nothing is deleted if the copy fails.
 */
export class MaintenanceService {
  constructor(
    private readonly db: Db,
    private readonly orders: OrdersRepo,
    /** Null only for in-memory databases (tests). */
    private readonly backupDir: string | null,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private filter(from: string, to: string, scope: PurgeScope): PurgeFilter {
    if (to < from) throw badRequest("INVALID_RANGE", "A data final deve ser igual ou posterior à inicial.");
    return { ...dayRange(from, to), scope };
  }

  previewPurge(from: string, to: string, scope: PurgeScope) {
    return this.orders.purgePreview(this.filter(from, to, scope));
  }

  async purge(from: string, to: string, scope: PurgeScope): Promise<{ deleted: number; backupFile: string | null }> {
    const filter = this.filter(from, to, scope);
    let backupFile: string | null = null;
    if (this.backupDir) {
      mkdirSync(this.backupDir, { recursive: true });
      const stamp = this.clock().toISOString().replace(/[:.]/g, "-");
      backupFile = join(this.backupDir, `antes-de-limpar-${stamp}.db`);
      await this.db.backup(backupFile);
    }
    const deleted = this.db.transaction(() => this.orders.purge(filter))();
    return { deleted, backupFile };
  }
}
