import { describe, expect, it } from "vitest";
import type { GuestOrderDto, KitchenDto } from "../src/shared/types";
import { buildSubmission, makeTestContext, productByName } from "./helpers";

describe("kitchen screen", () => {
  it("lists accepted orders with their items, and counts those awaiting confirmation", async () => {
    const t = await makeTestContext();
    const reception = await t.login("reception@test.local");
    const juice = productByName(await t.menu(), "Sumo natural");
    const place = async (notes: string | null) => {
      const res = await t.request("/api/orders", {
        method: "POST",
        body: JSON.stringify(buildSubmission({ notes, items: [{ productId: juice.id, quantity: 2, optionIds: [], notes: "sem gelo" }] })),
      });
      const { reference } = (await res.json()) as GuestOrderDto;
      return t.services.ordersRepo.list({ status: "ALL", q: reference, limit: 1 })[0]!.id;
    };
    const accepted = await place("Alergia a amendoim");
    await place(null); // stays pending
    await t.request(`/api/admin/orders/${accepted}/status`, { method: "POST", cookie: reception, body: JSON.stringify({ to: "CONFIRMED", expectedStatus: "PENDING" }) });

    const res = await t.request("/api/admin/kitchen", { cookie: reception });
    expect(res.status).toBe(200);
    const kitchen = (await res.json()) as KitchenDto;
    expect(kitchen.pendingCount).toBe(1);
    expect(kitchen.orders.map((o) => o.id)).toEqual([accepted]);
    expect(kitchen.orders[0]!.notes).toBe("Alergia a amendoim");
    expect(kitchen.orders[0]!.items[0]).toMatchObject({ productName: "Sumo natural", quantity: 2, notes: "sem gelo" });

    // Delivered orders leave the board.
    for (const [from, to] of [["CONFIRMED", "PREPARING"], ["PREPARING", "READY"], ["READY", "COMPLETED"]] as const) {
      await t.request(`/api/admin/orders/${accepted}/status`, { method: "POST", cookie: reception, body: JSON.stringify({ to, expectedStatus: from }) });
    }
    expect(((await (await t.request("/api/admin/kitchen", { cookie: reception })).json()) as KitchenDto).orders).toEqual([]);
  });
});
