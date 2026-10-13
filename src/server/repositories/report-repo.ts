import type { OrderLocationType } from "../../shared/constants";
import type { Db } from "../db/connection";

/**
 * Aggregations for the admin reports. All filters use UTC ISO bounds;
 * grouping by day/hour uses hotel local time (UTC+2, no DST).
 *
 * "Sales" (vendas) = orders the hotel accepted: CONFIRMED, PREPARING, READY
 * or COMPLETED. Pending and cancelled orders are excluded.
 */
const SOLD = "('CONFIRMED','PREPARING','READY','COMPLETED')";
const LOCAL = "'+2 hours'";

export interface Range {
  fromIso: string;
  toIso: string;
}

export interface ReportTotals {
  ordersReceived: number;
  ordersSold: number;
  ordersCompleted: number;
  ordersCancelled: number;
  ordersPending: number;
  revenueCents: number;
  itemsSold: number;
  depositsConfirmedCents: number;
  scheduledOrders: number;
}

export class ReportRepo {
  constructor(private readonly db: Db) {}

  totals(r: Range): ReportTotals {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS ordersReceived,
           SUM(status IN ${SOLD}) AS ordersSold,
           SUM(status = 'COMPLETED') AS ordersCompleted,
           SUM(status = 'CANCELLED') AS ordersCancelled,
           SUM(status = 'PENDING') AS ordersPending,
           COALESCE(SUM(CASE WHEN status IN ${SOLD} THEN total_cents END), 0) AS revenueCents,
           COALESCE(SUM(CASE WHEN deposit_status = 'confirmed' AND status != 'CANCELLED' THEN deposit_cents END), 0) AS depositsConfirmedCents,
           SUM(scheduled_for IS NOT NULL) AS scheduledOrders
         FROM orders WHERE created_at >= ? AND created_at <= ?`,
      )
      .get(r.fromIso, r.toIso) as Record<keyof ReportTotals, number | null>;
    const items = this.db
      .prepare(
        `SELECT COALESCE(SUM(i.quantity), 0) AS n FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE o.created_at >= ? AND o.created_at <= ? AND o.status IN ${SOLD}`,
      )
      .get(r.fromIso, r.toIso) as { n: number };
    return {
      ordersReceived: row.ordersReceived ?? 0,
      ordersSold: row.ordersSold ?? 0,
      ordersCompleted: row.ordersCompleted ?? 0,
      ordersCancelled: row.ordersCancelled ?? 0,
      ordersPending: row.ordersPending ?? 0,
      revenueCents: row.revenueCents ?? 0,
      depositsConfirmedCents: row.depositsConfirmedCents ?? 0,
      scheduledOrders: row.scheduledOrders ?? 0,
      itemsSold: items.n,
    };
  }

  /** Orders received and sales per local day. Days without orders are absent. */
  daily(r: Range): { day: string; orders: number; revenueCents: number }[] {
    return this.db
      .prepare(
        `SELECT date(created_at, ${LOCAL}) AS day, COUNT(*) AS orders,
           COALESCE(SUM(CASE WHEN status IN ${SOLD} THEN total_cents END), 0) AS revenueCents
         FROM orders WHERE created_at >= ? AND created_at <= ? AND status != 'CANCELLED'
         GROUP BY day ORDER BY day`,
      )
      .all(r.fromIso, r.toIso) as { day: string; orders: number; revenueCents: number }[];
  }

  /** Orders received per local hour of the day (cancelled excluded). */
  hourly(r: Range): { hour: number; orders: number }[] {
    return this.db
      .prepare(
        `SELECT CAST(strftime('%H', created_at, ${LOCAL}) AS INTEGER) AS hour, COUNT(*) AS orders
         FROM orders WHERE created_at >= ? AND created_at <= ? AND status != 'CANCELLED'
         GROUP BY hour ORDER BY hour`,
      )
      .all(r.fromIso, r.toIso) as { hour: number; orders: number }[];
  }

  topItems(r: Range, limit: number): { name: string; quantity: number; revenueCents: number }[] {
    return this.db
      .prepare(
        `SELECT i.product_name AS name, SUM(i.quantity) AS quantity, SUM(i.line_total_cents) AS revenueCents
         FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE o.created_at >= ? AND o.created_at <= ? AND o.status IN ${SOLD}
         GROUP BY i.product_name ORDER BY quantity DESC, revenueCents DESC LIMIT ?`,
      )
      .all(r.fromIso, r.toIso, limit) as { name: string; quantity: number; revenueCents: number }[];
  }

  /** Sales per current menu category (items whose product was deleted fall under "Outros"). */
  categories(r: Range): { name: string; quantity: number; revenueCents: number }[] {
    return this.db
      .prepare(
        `SELECT COALESCE(json_extract(c.name, '$.pt'), 'Outros') AS category_name, SUM(i.quantity) AS quantity, SUM(i.line_total_cents) AS revenueCents
         FROM order_items i JOIN orders o ON o.id = i.order_id
         LEFT JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
         WHERE o.created_at >= ? AND o.created_at <= ? AND o.status IN ${SOLD}
         GROUP BY category_name ORDER BY revenueCents DESC`,
      )
      .all(r.fromIso, r.toIso)
      .map((row) => {
        const { category_name, quantity, revenueCents } = row as { category_name: string; quantity: number; revenueCents: number };
        return { name: category_name, quantity, revenueCents };
      });
  }

  /** Most chosen options (sides, sizes, ice...), weighted by quantity. */
  topOptions(r: Range, limit: number): { group: string; name: string; count: number }[] {
    return this.db
      .prepare(
        `SELECT json_extract(opt.value, '$.groupName') AS "group", json_extract(opt.value, '$.name') AS name, SUM(i.quantity) AS count
         FROM order_items i JOIN orders o ON o.id = i.order_id, json_each(i.options_json) AS opt
         WHERE o.created_at >= ? AND o.created_at <= ? AND o.status IN ${SOLD}
         GROUP BY "group", name ORDER BY count DESC LIMIT ?`,
      )
      .all(r.fromIso, r.toIso, limit) as { group: string; name: string; count: number }[];
  }

  byLocation(r: Range): { type: OrderLocationType; orders: number; revenueCents: number }[] {
    return this.db
      .prepare(
        `SELECT location_type AS type, COUNT(*) AS orders,
           COALESCE(SUM(CASE WHEN status IN ${SOLD} THEN total_cents END), 0) AS revenueCents
         FROM orders WHERE created_at >= ? AND created_at <= ? AND status != 'CANCELLED'
         GROUP BY location_type`,
      )
      .all(r.fromIso, r.toIso) as { type: OrderLocationType; orders: number; revenueCents: number }[];
  }

  /** Average minutes from order to the first transition into `status`. */
  averageMinutesTo(r: Range, status: "CONFIRMED" | "COMPLETED"): number | null {
    const row = this.db
      .prepare(
        `SELECT AVG((julianday(h.created_at) - julianday(o.created_at)) * 1440) AS minutes
         FROM orders o JOIN (
           SELECT order_id, MIN(created_at) AS created_at FROM order_status_history WHERE to_status = ? GROUP BY order_id
         ) h ON h.order_id = o.id
         WHERE o.created_at >= ? AND o.created_at <= ? AND o.scheduled_for IS NULL`,
      )
      .get(status, r.fromIso, r.toIso) as { minutes: number | null };
    return row.minutes === null ? null : Math.round(row.minutes);
  }

  /** What each staff member did in the period (status changes are dated by when they happened). */
  staffPerformance(r: Range): { name: string; confirmed: number; completed: number; cancelled: number; avgMinutesToConfirm: number | null; replies: number }[] {
    const rows = this.db
      .prepare(
        `SELECT s.id AS id, s.display_name AS name,
           SUM(h.to_status = 'CONFIRMED') AS confirmed,
           SUM(h.to_status = 'COMPLETED') AS completed,
           SUM(h.to_status = 'CANCELLED') AS cancelled,
           AVG(CASE WHEN h.to_status = 'CONFIRMED' AND o.scheduled_for IS NULL
                    THEN (julianday(h.created_at) - julianday(o.created_at)) * 1440 END) AS avgMinutesToConfirm
         FROM order_status_history h
         JOIN staff s ON s.id = h.staff_id
         JOIN orders o ON o.id = h.order_id
         WHERE h.created_at >= ? AND h.created_at <= ?
         GROUP BY s.id ORDER BY confirmed DESC, completed DESC`,
      )
      .all(r.fromIso, r.toIso) as { id: number; name: string; confirmed: number; completed: number; cancelled: number; avgMinutesToConfirm: number | null }[];
    const replies = new Map(
      (
        this.db
          .prepare(
            `SELECT staff_id AS id, COUNT(*) AS n FROM order_messages
             WHERE sender = 'staff' AND staff_id IS NOT NULL AND created_at >= ? AND created_at <= ? GROUP BY staff_id`,
          )
          .all(r.fromIso, r.toIso) as { id: number; n: number }[]
      ).map((x) => [x.id, x.n]),
    );
    return rows.map(({ id, ...row }) => ({
      ...row,
      avgMinutesToConfirm: row.avgMinutesToConfirm === null ? null : Math.round(row.avgMinutesToConfirm),
      replies: replies.get(id) ?? 0,
    }));
  }

  /** Menu items on sale that nobody ordered in the period. */
  unsoldItems(r: Range): { name: string; category: string; isAvailable: boolean }[] {
    return (
      this.db
        .prepare(
          `SELECT json_extract(p.name, '$.pt') AS name, json_extract(c.name, '$.pt') AS category, p.is_available AS available
           FROM products p JOIN categories c ON c.id = p.category_id
           WHERE p.is_archived = 0 AND c.is_active = 1 AND NOT EXISTS (
             SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
             WHERE i.product_id = p.id AND o.created_at >= ? AND o.created_at <= ? AND o.status IN ${SOLD})
           ORDER BY c.sort_order, c.id, p.sort_order, p.id`,
        )
        .all(r.fromIso, r.toIso) as { name: string; category: string; available: number }[]
    ).map((x) => ({ name: x.name, category: x.category, isAvailable: x.available === 1 }));
  }

  /** Orders and sales per local weekday (0 = Sunday … 6 = Saturday). */
  weekday(r: Range): { weekday: number; orders: number; revenueCents: number }[] {
    return this.db
      .prepare(
        `SELECT CAST(strftime('%w', created_at, ${LOCAL}) AS INTEGER) AS weekday, COUNT(*) AS orders,
           COALESCE(SUM(CASE WHEN status IN ${SOLD} THEN total_cents END), 0) AS revenueCents
         FROM orders WHERE created_at >= ? AND created_at <= ? AND status != 'CANCELLED'
         GROUP BY weekday`,
      )
      .all(r.fromIso, r.toIso) as { weekday: number; orders: number; revenueCents: number }[];
  }

  /**
   * Customers identified by the phone number they gave (digits only). Only
   * orders with a phone count; "returning" = more than one order ever, up to
   * the end of the period.
   */
  customers(r: Range, limit: number): {
    withPhone: number;
    returning: number;
    top: { name: string | null; phone: string; ordersInPeriod: number; ordersEver: number; revenueCents: number }[];
  } {
    const digits = `replace(replace(replace(replace(replace(contact_phone, ' ', ''), '+', ''), '-', ''), '(', ''), ')', '')`;
    const rows = this.db
      .prepare(
        `WITH everyone AS (
           SELECT ${digits} AS phone, COUNT(*) AS ordersEver FROM orders
           WHERE contact_phone IS NOT NULL AND contact_phone != '' AND created_at <= ? AND status != 'CANCELLED' GROUP BY phone
         ), period AS (
           SELECT ${digits} AS phone, MAX(guest_name) AS name, MAX(contact_phone) AS display, COUNT(*) AS ordersInPeriod,
             COALESCE(SUM(CASE WHEN status IN ${SOLD} THEN total_cents END), 0) AS revenueCents
           FROM orders WHERE contact_phone IS NOT NULL AND contact_phone != '' AND created_at >= ? AND created_at <= ? AND status != 'CANCELLED'
           GROUP BY phone
         )
         SELECT p.name, p.display AS phone, p.ordersInPeriod, e.ordersEver, p.revenueCents
         FROM period p JOIN everyone e ON e.phone = p.phone
         ORDER BY p.ordersInPeriod DESC, p.revenueCents DESC`,
      )
      .all(r.toIso, r.fromIso, r.toIso) as { name: string | null; phone: string; ordersInPeriod: number; ordersEver: number; revenueCents: number }[];
    return { withPhone: rows.length, returning: rows.filter((x) => x.ordersEver > 1).length, top: rows.slice(0, limit) };
  }

  /** Orders in the range for CSV export, oldest first. */
  exportRows(r: Range) {
    return this.db
      .prepare(
        `SELECT o.reference, o.created_at, o.status, o.location_type, o.location_label, o.scheduled_for, o.guest_name,
           o.contact_phone, o.subtotal_cents, o.charges_cents, o.total_cents, o.deposit_cents, o.deposit_status,
           (SELECT COALESCE(SUM(quantity), 0) FROM order_items i WHERE i.order_id = o.id) AS item_count,
           (SELECT GROUP_CONCAT(quantity || 'x ' || product_name, '; ') FROM order_items i WHERE i.order_id = o.id) AS items
         FROM orders o WHERE o.created_at >= ? AND o.created_at <= ? ORDER BY o.created_at`,
      )
      .all(r.fromIso, r.toIso) as {
      reference: string;
      created_at: string;
      status: string;
      location_type: OrderLocationType;
      location_label: string;
      scheduled_for: string | null;
      guest_name: string | null;
      contact_phone: string | null;
      subtotal_cents: number;
      charges_cents: number;
      total_cents: number;
      deposit_cents: number;
      deposit_status: string;
      item_count: number;
      items: string | null;
    }[];
  }
}
