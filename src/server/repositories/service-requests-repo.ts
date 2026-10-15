import type { LocationType, PaymentMethod, ServiceRequestKind } from "../../shared/constants";
import type { ServiceRequestDto } from "../../shared/types";
import type { Db } from "../db/connection";

interface Row {
  id: number;
  public_token: string;
  kind: ServiceRequestKind;
  location_type: LocationType;
  location_label: string;
  payment_method: PaymentMethod | null;
  status: "open" | "done";
  handled_at: string | null;
  created_at: string;
  staff_name: string | null;
}

const SELECT = `SELECT r.*, s.display_name AS staff_name FROM service_requests r LEFT JOIN staff s ON s.id = r.handled_by`;

/** Guests calling the waiter or asking for the bill. */
export class ServiceRequestsRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  create(input: { token: string; kind: ServiceRequestKind; locationType: LocationType; locationLabel: string; paymentMethod: PaymentMethod | null }): number {
    return Number(
      this.db
        .prepare(
          `INSERT INTO service_requests (public_token, kind, location_type, location_label, payment_method, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.token, input.kind, input.locationType, input.locationLabel, input.paymentMethod, this.clock().toISOString()).lastInsertRowid,
    );
  }

  /** An open request of the same kind from the same place since `sinceIso` (to avoid duplicates). */
  findOpen(kind: ServiceRequestKind, locationType: LocationType, locationLabel: string, sinceIso: string): (ServiceRequestDto & { token: string }) | null {
    const row = this.db
      .prepare(
        `${SELECT} WHERE r.status = 'open' AND r.kind = ? AND r.location_type = ? AND r.location_label = ? COLLATE NOCASE AND r.created_at >= ?
         ORDER BY r.id DESC LIMIT 1`,
      )
      .get(kind, locationType, locationLabel, sinceIso) as Row | undefined;
    return row ? { ...toDto(row), token: row.public_token } : null;
  }

  get(id: number): (ServiceRequestDto & { token: string }) | null {
    const row = this.db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as Row | undefined;
    return row ? { ...toDto(row), token: row.public_token } : null;
  }

  getByToken(token: string): (ServiceRequestDto & { token: string }) | null {
    const row = this.db.prepare(`${SELECT} WHERE r.public_token = ?`).get(token) as Row | undefined;
    return row ? { ...toDto(row), token: row.public_token } : null;
  }

  listOpen(): ServiceRequestDto[] {
    return (this.db.prepare(`${SELECT} WHERE r.status = 'open' ORDER BY r.created_at, r.id LIMIT 100`).all() as Row[]).map(toDto);
  }

  /** Returns false if it was already handled. */
  markDone(id: number, staffId: number): boolean {
    return (
      this.db
        .prepare("UPDATE service_requests SET status = 'done', handled_by = ?, handled_at = ? WHERE id = ? AND status = 'open'")
        .run(staffId, this.clock().toISOString(), id).changes === 1
    );
  }
}

function toDto(r: Row): ServiceRequestDto {
  return {
    id: r.id,
    kind: r.kind,
    locationType: r.location_type,
    locationLabel: r.location_label,
    paymentMethod: r.payment_method,
    status: r.status,
    createdAt: r.created_at,
    handledAt: r.handled_at,
    handledByName: r.staff_name,
  };
}
