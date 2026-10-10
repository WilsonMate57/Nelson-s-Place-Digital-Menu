import { describe, expect, it } from "vitest";
import { ORDER_STATUSES } from "../src/shared/constants";
import { allowedTransitions, canTransition, isFinalStatus } from "../src/shared/order-status";

describe("order status workflow", () => {
  it("follows PENDING → CONFIRMED → PREPARING → READY → COMPLETED", () => {
    expect(canTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "PREPARING")).toBe(true);
    expect(canTransition("PREPARING", "READY")).toBe(true);
    expect(canTransition("READY", "COMPLETED")).toBe(true);
  });

  it("does not allow skipping steps or going backwards", () => {
    expect(canTransition("PENDING", "PREPARING")).toBe(false);
    expect(canTransition("PENDING", "COMPLETED")).toBe(false);
    expect(canTransition("READY", "PREPARING")).toBe(false);
  });

  it("allows cancelling any non-final order, and nothing after a final state", () => {
    for (const status of ["PENDING", "CONFIRMED", "PREPARING", "READY"] as const) {
      expect(canTransition(status, "CANCELLED")).toBe(true);
    }
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      expect(isFinalStatus(status)).toBe(true);
      expect(allowedTransitions(status)).toEqual([]);
      for (const to of ORDER_STATUSES) expect(canTransition(status, to)).toBe(false);
    }
  });
});
