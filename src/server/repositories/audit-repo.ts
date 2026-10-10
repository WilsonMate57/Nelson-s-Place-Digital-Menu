import { nowIso, type Db } from "../db/connection";

export interface AuditEntry {
  id: number;
  staffName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: unknown;
  createdAt: string;
}

/** Append-only record of administrative changes (prices, menu, staff, settings). */
export class AuditRepo {
  constructor(private readonly db: Db) {}

  record(staffId: number | null, action: string, entityType: string, entityId: string | number | null, details?: unknown): void {
    this.db
      .prepare("INSERT INTO audit_log (staff_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(staffId, action, entityType, entityId === null ? null : String(entityId), details === undefined ? null : JSON.stringify(details), nowIso());
  }

  recent(limit: number): AuditEntry[] {
    const rows = this.db
      .prepare(
        `SELECT a.*, s.display_name FROM audit_log a LEFT JOIN staff s ON s.id = a.staff_id
         ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
      )
      .all(limit) as { id: number; display_name: string | null; action: string; entity_type: string; entity_id: string | null; details: string | null; created_at: string }[];
    return rows.map((r) => ({
      id: r.id,
      staffName: r.display_name,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      details: r.details ? JSON.parse(r.details) : null,
      createdAt: r.created_at,
    }));
  }
}
