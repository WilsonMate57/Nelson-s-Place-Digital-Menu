import type { IntegrationStatus, WhatsAppMode } from "../../shared/constants";
import { nowIso, type Db } from "../db/connection";

export interface IntegrationRecord {
  id: number;
  orderId: number;
  channel: WhatsAppMode;
  status: IntegrationStatus;
  attempts: number;
}

/** Records of each order's delivery to external channels (currently WhatsApp). */
export class IntegrationRepo {
  constructor(private readonly db: Db) {}

  create(orderId: number, integration: string, channel: WhatsAppMode, status: IntegrationStatus): void {
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO integration_events (order_id, integration, channel, status, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(orderId, integration, channel, status, now, now);
  }

  get(orderId: number, integration: string): IntegrationRecord | null {
    const row = this.db
      .prepare("SELECT id, order_id, channel, status, attempts FROM integration_events WHERE order_id = ? AND integration = ?")
      .get(orderId, integration) as
      | { id: number; order_id: number; channel: WhatsAppMode; status: IntegrationStatus; attempts: number }
      | undefined;
    return row ? { id: row.id, orderId: row.order_id, channel: row.channel, status: row.status, attempts: row.attempts } : null;
  }

  /**
   * Claims a record for a delivery attempt. Returns false if another attempt
   * already succeeded or is in flight, which prevents duplicate messages.
   * An attempt stuck in 'pending' (e.g. the process restarted mid-request)
   * becomes claimable again after `staleAfterMs`.
   */
  claimAttempt(orderId: number, integration: string, staleAfterMs = 120_000): boolean {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE integration_events SET status = 'pending', attempts = attempts + 1, updated_at = ?
         WHERE order_id = ? AND integration = ? AND channel = 'cloud_api'
           AND status IN ('pending','failed','not_configured')
           AND (status IN ('failed','not_configured') OR attempts = 0 OR updated_at < ?)`,
      )
      .run(new Date(now).toISOString(), orderId, integration, new Date(now - staleAfterMs).toISOString());
    return result.changes === 1;
  }

  markResult(orderId: number, integration: string, status: IntegrationStatus, error: string | null, externalId: string | null = null): void {
    this.db
      .prepare(
        `UPDATE integration_events SET status = ?, last_error = ?, external_id = COALESCE(?, external_id), updated_at = ?
         WHERE order_id = ? AND integration = ?`,
      )
      .run(status, error, externalId, nowIso(), orderId, integration);
  }

  /** Records that the guest opened the wa.me link. Does not mean the message was sent. */
  markLinkOpened(orderId: number): void {
    this.db
      .prepare(
        `UPDATE integration_events SET status = 'link_opened', attempts = attempts + 1, updated_at = ?
         WHERE order_id = ? AND integration = 'whatsapp' AND channel = 'link' AND status IN ('link_ready','link_opened')`,
      )
      .run(nowIso(), orderId);
  }
}
