import type { ChatMessageDto } from "../../shared/types";
import type { Db } from "../db/connection";

type Sender = "guest" | "staff";

interface MessageRow {
  id: number;
  sender: Sender;
  body: string;
  created_at: string;
  read_at: string | null;
  staff_name: string | null;
}

/** Chat messages between a guest and the staff, one thread per order. */
export class MessagesRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  list(orderId: number): ChatMessageDto[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.sender, m.body, m.created_at, m.read_at, s.display_name AS staff_name
         FROM order_messages m LEFT JOIN staff s ON s.id = m.staff_id
         WHERE m.order_id = ? ORDER BY m.id`,
      )
      .all(orderId) as MessageRow[];
    return rows.map((r) => ({
      id: r.id,
      sender: r.sender,
      authorName: r.sender === "staff" ? r.staff_name : null,
      body: r.body,
      createdAt: r.created_at,
      read: r.read_at !== null,
    }));
  }

  add(orderId: number, sender: Sender, staffId: number | null, body: string): number {
    return Number(
      this.db
        .prepare("INSERT INTO order_messages (order_id, sender, staff_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(orderId, sender, staffId, body, this.clock().toISOString()).lastInsertRowid,
    );
  }

  /** Marks the other side's messages as read by `reader`. */
  markRead(orderId: number, reader: Sender): void {
    this.db
      .prepare("UPDATE order_messages SET read_at = ? WHERE order_id = ? AND sender = ? AND read_at IS NULL")
      .run(this.clock().toISOString(), orderId, reader === "staff" ? "guest" : "staff");
  }

  countRecentFromGuest(orderId: number, sinceIso: string): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS n FROM order_messages WHERE order_id = ? AND sender = 'guest' AND created_at >= ?").get(orderId, sinceIso) as {
        n: number;
      }
    ).n;
  }
}
