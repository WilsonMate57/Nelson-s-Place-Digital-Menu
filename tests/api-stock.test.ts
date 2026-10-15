import { describe, expect, it } from "vitest";
import type { AdminProductDto, GuestOrderDto } from "../src/shared/types";
import { buildSubmission, makeTestContext, productByName, type TestContext } from "./helpers";

async function order(t: TestContext, productId: number, quantity: number) {
  return t.request("/api/orders", { method: "POST", body: JSON.stringify(buildSubmission({ items: [{ productId, quantity, optionIds: [] }] })) });
}

describe("simple stock", () => {
  it("takes units on each order, refuses more than available and sells out at zero", async () => {
    const t = await makeTestContext();
    const reception = await t.login("reception@test.local");
    const juice = productByName(await t.menu(), "Sumo natural");
    expect(juice.stockQty).toBeNull();

    const set = await t.request(`/api/admin/products/${juice.id}/stock`, { method: "PATCH", cookie: reception, body: JSON.stringify({ stockQty: 3 }) });
    expect(set.status).toBe(200);
    expect(((await set.json()) as AdminProductDto).stockQty).toBe(3);

    const tooMany = await order(t, juice.id, 4);
    expect(tooMany.status).toBe(409);
    const body = (await tooMany.json()) as { error: { code: string; details: { reason: string; available: number } } };
    expect(body.error.code).toBe("MENU_CHANGED");
    expect(body.error.details).toMatchObject({ reason: "OUT_OF_STOCK", available: 3 });
    expect(productByName(await t.menu(), "Sumo natural").stockQty).toBe(3); // nothing taken

    expect((await order(t, juice.id, 2)).status).toBe(201);
    const last = await order(t, juice.id, 1);
    expect(last.status).toBe(201);
    expect(productByName(await t.menu(), "Sumo natural").stockQty).toBe(0);

    const soldOut = await order(t, juice.id, 1);
    expect(soldOut.status).toBe(409);
    expect(((await soldOut.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("PRODUCT_UNAVAILABLE");

    // Cancelling gives the units back, once.
    const { reference } = (await last.json()) as GuestOrderDto;
    const id = t.services.ordersRepo.list({ status: "ALL", q: reference, limit: 1 })[0]!.id;
    const cancel = await t.request(`/api/admin/orders/${id}/status`, { method: "POST", cookie: reception, body: JSON.stringify({ to: "CANCELLED", expectedStatus: "PENDING" }) });
    expect(cancel.status).toBe(200);
    expect(productByName(await t.menu(), "Sumo natural").stockQty).toBe(1);
    expect(t.services.ordersRepo.releaseStockTaken(id)).toEqual([]);
  });

  it("can stop tracking stock and validates the quantity", async () => {
    const t = await makeTestContext();
    const admin = await t.login("admin@test.local");
    const juice = productByName(await t.menu(), "Sumo natural");
    const patch = (stockQty: unknown) =>
      t.request(`/api/admin/products/${juice.id}/stock`, { method: "PATCH", cookie: admin, body: JSON.stringify({ stockQty }) });
    expect((await patch(-1)).status).toBe(400);
    expect((await patch(1.5)).status).toBe(400);
    expect((await patch(0)).status).toBe(200);
    expect((await order(t, juice.id, 1)).status).toBe(409);
    expect((await patch(null)).status).toBe(200);
    expect((await order(t, juice.id, 5)).status).toBe(201);
    expect(productByName(await t.menu(), "Sumo natural").stockQty).toBeNull();
  });
});
