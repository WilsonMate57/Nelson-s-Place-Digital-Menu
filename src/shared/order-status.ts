import type { OrderStatus } from "./constants";

/**
 * Allowed order status transitions.
 * PENDING → CONFIRMED → PREPARING → READY → COMPLETED, with CANCELLED
 * reachable from any non-final state. Final states have no transitions.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isFinalStatus(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Statuses that represent work staff still need to act on. */
export const ACTIVE_STATUSES: readonly OrderStatus[] = ["PENDING", "CONFIRMED", "PREPARING", "READY"];
