import {
  ORDER_STATUSES,
  type DepositStatus,
  type IntegrationStatus,
  type Language,
  type OrderLocationType,
  type OrderStatus,
} from "../../shared/constants";
import type { PricedOrder } from "../../shared/pricing";
import type {
  AppliedCharge,
  IntegrationEventDto,
  OrderDto,
  OrderSummaryDto,
  SelectedOptionSnapshot,
  StatusHistoryDto,
} from "../../shared/types";
import type { Db } from "../db/connection";
import { ACTIVE_STATUSES } from "../../shared/order-status";

interface OrderRow {
  id: number;
  reference: string;
  public_token: string;
  idempotency_key: string;
  request_hash: string;
  status: OrderStatus;
  location_type: OrderLocationType;
  location_label: string;
  scheduled_for: string | null;
  deposit_cents: number;
  deposit_status: DepositStatus;
  payment_reference: string | null;
  guest_name: string | null;
  contact_phone: string | null;
  notes: string | null;
  language: Language;
  currency: string;
  subtotal_cents: number;
  charges_cents: number;
  charges_json: string;
  total_cents: number;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: number;
  order_id: number;
  product_id: number | null;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  options_json: string;
  notes: string | null;
  line_total_cents: number;
}

export interface NewOrder {
  reference: string;
  publicToken: string;
  idempotencyKey: string;
  requestHash: string;
  locationType: OrderLocationType;
  locationLabel: string;
  scheduledFor: string | null;
  depositCents: number;
  paymentReference: string | null;
  guestName: string | null;
  contactPhone: string | null;
  notes: string | null;
  language: Language;
  currency: string;
  priced: PricedOrder;
  /** Products whose stock is tracked: their lines record the units taken. */
  stockTracked: ReadonlySet<number>;
}

export interface OrderListFilter {
  /** SCHEDULED = active orders with a requested time, soonest first. */
  status: OrderStatus | "ACTIVE" | "ALL" | "SCHEDULED";
  q?: string | undefined;
  /** Inclusive UTC ISO bounds. */
  fromIso?: string | undefined;
  toIso?: string | undefined;
  limit: number;
}

export interface PurgeFilter {
  /** Inclusive UTC ISO bounds on the order date. */
  fromIso: string;
  toIso: string;
  scope: "all" | "cancelled";
}

export class OrdersRepo {
  constructor(
    private readonly db: Db,
    /** Injectable clock (tests); stored timestamps use it. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private now(): string {
    return this.clock().toISOString();
  }

  findByIdempotencyKey(key: string): { id: number; requestHash: string } | null {
    const row = this.db.prepare("SELECT id, request_hash FROM orders WHERE idempotency_key = ?").get(key) as
      | { id: number; request_hash: string }
      | undefined;
    return row ? { id: row.id, requestHash: row.request_hash } : null;
  }

  referenceExists(reference: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM orders WHERE reference = ?").get(reference);
  }

  /** Must be called inside a transaction together with the related inserts. */
  insert(order: NewOrder): number {
    const now = this.now();
    const { priced } = order;
    const id = Number(
      this.db
        .prepare(
          `INSERT INTO orders (reference, public_token, idempotency_key, request_hash, status, location_type, location_label,
             scheduled_for, deposit_cents, deposit_status, payment_reference,
             guest_name, contact_phone, notes, language, currency, subtotal_cents, charges_cents, charges_json, total_cents,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          order.reference, order.publicToken, order.idempotencyKey, order.requestHash, order.locationType, order.locationLabel,
          order.scheduledFor, order.depositCents, order.depositCents > 0 ? "pending" : "not_required", order.paymentReference,
          order.guestName, order.contactPhone, order.notes, order.language, order.currency, priced.subtotalCents,
          priced.chargesCents, JSON.stringify(priced.charges), priced.totalCents, now, now,
        ).lastInsertRowid,
    );
    const insertItem = this.db.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity, options_json, notes, line_total_cents, stock_taken)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of priced.lines) {
      insertItem.run(
        id, line.productId, line.productName, line.unitPriceCents, line.quantity, JSON.stringify(line.options), line.notes, line.lineTotalCents,
        order.stockTracked.has(line.productId) ? line.quantity : 0,
      );
    }
    this.db
      .prepare("INSERT INTO order_status_history (order_id, from_status, to_status, staff_id, note, created_at) VALUES (?, NULL, 'PENDING', NULL, NULL, ?)")
      .run(id, now);
    return id;
  }

  get(id: number): OrderDto | null {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
    return row ? this.toDto(row) : null;
  }

  getByPublicToken(token: string): (OrderDto & { publicToken: string }) | null {
    const row = this.db.prepare("SELECT * FROM orders WHERE public_token = ?").get(token) as OrderRow | undefined;
    return row ? { ...this.toDto(row), publicToken: row.public_token } : null;
  }

  getPublicToken(id: number): string | null {
    const row = this.db.prepare("SELECT public_token FROM orders WHERE id = ?").get(id) as { public_token: string } | undefined;
    return row?.public_token ?? null;
  }

  list(filter: OrderListFilter): OrderSummaryDto[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status === "ACTIVE" || filter.status === "SCHEDULED") {
      where.push(`o.status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`);
      params.push(...ACTIVE_STATUSES);
      if (filter.status === "SCHEDULED") where.push("o.scheduled_for IS NOT NULL");
    } else if (filter.status !== "ALL") {
      where.push("o.status = ?");
      params.push(filter.status);
    }
    if (filter.q) {
      where.push("(o.reference LIKE ? ESCAPE '\\' OR o.location_label LIKE ? ESCAPE '\\' OR o.guest_name LIKE ? ESCAPE '\\')");
      const like = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like, like);
    }
    if (filter.fromIso) {
      where.push("o.created_at >= ?");
      params.push(filter.fromIso);
    }
    if (filter.toIso) {
      where.push("o.created_at <= ?");
      params.push(filter.toIso);
    }
    params.push(filter.limit);
    const rows = this.db
      .prepare(
        `SELECT o.*,
           (SELECT COALESCE(SUM(quantity), 0) FROM order_items i WHERE i.order_id = o.id) AS item_count,
           (SELECT status FROM integration_events e WHERE e.order_id = o.id AND e.integration = 'whatsapp') AS whatsapp_status,
           (SELECT COUNT(*) FROM order_messages m WHERE m.order_id = o.id AND m.sender = 'guest' AND m.read_at IS NULL) AS unread_messages
         FROM orders o
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY ${filter.status === "SCHEDULED" ? "o.scheduled_for ASC," : ""} o.created_at DESC, o.id DESC
         LIMIT ?`,
      )
      .all(...params) as (OrderRow & { item_count: number; whatsapp_status: IntegrationStatus | null; unread_messages: number })[];
    return rows.map((r) => ({ ...this.toBase(r), itemCount: r.item_count, whatsappStatus: r.whatsapp_status, unreadMessages: r.unread_messages }));
  }

  /** Accepted orders the kitchen still has to prepare or hand over, oldest (or soonest scheduled) first. */
  listForKitchen(): OrderDto[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM orders WHERE status IN ('CONFIRMED','PREPARING','READY')
         ORDER BY COALESCE(scheduled_for, created_at), id LIMIT 200`,
      )
      .all() as OrderRow[];
    return rows.map((r) => this.toDto(r));
  }

  countByStatus(): Record<OrderStatus, number> {
    const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
    const rows = this.db.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status").all() as { status: OrderStatus; n: number }[];
    for (const r of rows) counts[r.status] = r.n;
    return counts;
  }

  unreadMessagesTotal(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM order_messages WHERE sender = 'guest' AND read_at IS NULL").get() as { n: number }).n;
  }

  countScheduledActive(): number {
    return (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM orders WHERE scheduled_for IS NOT NULL AND status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})`)
        .get(...ACTIVE_STATUSES) as { n: number }
    ).n;
  }

  /** Marks a pending deposit as received. Returns false if it was not pending. */
  confirmDeposit(id: number, staffId: number): boolean {
    const now = this.now();
    return (
      this.db
        .prepare(
          `UPDATE orders SET deposit_status = 'confirmed', deposit_confirmed_at = ?, deposit_confirmed_by = ?, updated_at = ?
           WHERE id = ? AND deposit_status = 'pending'`,
        )
        .run(now, staffId, now, id).changes === 1
    );
  }

  /** Atomic compare-and-set; returns false if the order was not in `from`. */
  updateStatus(id: number, from: OrderStatus, to: OrderStatus, staffId: number, note: string | null): boolean {
    return this.db.transaction(() => {
      const now = this.now();
      const result = this.db
        .prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
        .run(to, now, id, from);
      if (result.changes === 0) return false;
      this.db
        .prepare("INSERT INTO order_status_history (order_id, from_status, to_status, staff_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, from, to, staffId, note, now);
      return true;
    })();
  }

  /** Units each product gave to this order, and forgets them (so they are returned only once). */
  releaseStockTaken(orderId: number): { productId: number; quantity: number }[] {
    const rows = this.db
      .prepare(
        `SELECT product_id AS productId, SUM(stock_taken) AS quantity FROM order_items
         WHERE order_id = ? AND stock_taken > 0 AND product_id IS NOT NULL GROUP BY product_id`,
      )
      .all(orderId) as { productId: number; quantity: number }[];
    this.db.prepare("UPDATE order_items SET stock_taken = 0 WHERE order_id = ?").run(orderId);
    return rows;
  }

  private purgeWhere(filter: PurgeFilter): { sql: string; params: unknown[] } {
    const clauses = ["created_at >= ?", "created_at <= ?"];
    const params: unknown[] = [filter.fromIso, filter.toIso];
    if (filter.scope === "cancelled") clauses.push("status = 'CANCELLED'");
    return { sql: clauses.join(" AND "), params };
  }

  /** What a purge would delete (orders, of which still active, and chat messages). */
  purgePreview(filter: PurgeFilter): { orders: number; active: number; messages: number } {
    const { sql, params } = this.purgeWhere(filter);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS orders,
           COALESCE(SUM(status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})), 0) AS active,
           COALESCE(SUM((SELECT COUNT(*) FROM order_messages m WHERE m.order_id = orders.id)), 0) AS messages
         FROM orders WHERE ${sql}`,
      )
      .get(...ACTIVE_STATUSES, ...params) as { orders: number; active: number; messages: number };
    return row;
  }

  /** Deletes orders permanently; items, history, chat and WhatsApp records cascade. */
  purge(filter: PurgeFilter): number {
    const { sql, params } = this.purgeWhere(filter);
    return this.db.prepare(`DELETE FROM orders WHERE ${sql}`).run(...params).changes;
  }

  history(orderId: number): StatusHistoryDto[] {
    const rows = this.db
      .prepare(
        `SELECT h.id, h.from_status, h.to_status, h.note, h.created_at, s.display_name
         FROM order_status_history h LEFT JOIN staff s ON s.id = h.staff_id
         WHERE h.order_id = ? ORDER BY h.created_at, h.id`,
      )
      .all(orderId) as { id: number; from_status: OrderStatus | null; to_status: OrderStatus; note: string | null; created_at: string; display_name: string | null }[];
    return rows.map((r) => ({
      id: r.id,
      fromStatus: r.from_status,
      toStatus: r.to_status,
      staffName: r.display_name,
      note: r.note,
      createdAt: r.created_at,
    }));
  }

  integrations(orderId: number): IntegrationEventDto[] {
    const rows = this.db
      .prepare("SELECT * FROM integration_events WHERE order_id = ? ORDER BY id")
      .all(orderId) as { id: number; integration: string; channel: IntegrationEventDto["channel"]; status: IntegrationStatus; attempts: number; last_error: string | null; updated_at: string }[];
    return rows.map((r) => ({
      id: r.id,
      integration: r.integration,
      channel: r.channel,
      status: r.status,
      attempts: r.attempts,
      lastError: r.last_error,
      updatedAt: r.updated_at,
    }));
  }

  private toBase(row: OrderRow): Omit<OrderDto, "items"> {
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      locationType: row.location_type,
      locationLabel: row.location_label,
      scheduledFor: row.scheduled_for,
      depositCents: row.deposit_cents,
      depositStatus: row.deposit_status,
      paymentReference: row.payment_reference,
      guestName: row.guest_name,
      contactPhone: row.contact_phone,
      notes: row.notes,
      language: row.language,
      currency: row.currency,
      subtotalCents: row.subtotal_cents,
      chargesCents: row.charges_cents,
      charges: JSON.parse(row.charges_json) as AppliedCharge[],
      totalCents: row.total_cents,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toDto(row: OrderRow): OrderDto {
    const items = this.db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").all(row.id) as ItemRow[];
    return {
      ...this.toBase(row),
      items: items.map((i) => ({
        id: i.id,
        productId: i.product_id,
        productName: i.product_name,
        unitPriceCents: i.unit_price_cents,
        quantity: i.quantity,
        options: JSON.parse(i.options_json) as SelectedOptionSnapshot[],
        notes: i.notes,
        lineTotalCents: i.line_total_cents,
      })),
    };
  }
}
