import { describe, expect, it } from "vitest";
import type { AdminOrderDetailDto, GuestOrderDto, ReportDto } from "../src/shared/types";
import { buildSubmission, makeTestContext, productByName } from "./helpers";

describe("rating a delivered order", () => {
  it("accepts one rating after delivery, shows it to staff and in the reports", async () => {
    const t = await makeTestContext();
    const menu = await t.menu();
    const chicken = productByName(menu, "Frango grelhado");
    const rice = chicken.optionGroups[0]!.options.find((o) => o.name.pt === "Arroz")!;
    const res = await t.request("/api/orders", {
      method: "POST",
      body: JSON.stringify(buildSubmission({ items: [{ productId: chicken.id, quantity: 2, optionIds: [rice.id] }] })),
    });
    const placed = (await res.json()) as GuestOrderDto;
    // What "order again" needs: the product and its chosen options.
    expect(placed.items[0]).toMatchObject({ productId: chicken.id, quantity: 2, options: [{ optionId: rice.id }] });
    expect(placed.review).toBeNull();

    const rate = (body: unknown) => t.request(`/api/orders/track/${placed.publicToken}/review`, { method: "POST", body: JSON.stringify(body) });
    expect((await rate({ rating: 5 })).status).toBe(409); // not delivered yet

    const admin = await t.login("admin@test.local");
    const id = t.services.ordersRepo.list({ status: "ALL", q: placed.reference, limit: 1 })[0]!.id;
    let expected = "PENDING";
    for (const to of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) {
      await t.request(`/api/admin/orders/${id}/status`, { method: "POST", cookie: admin, body: JSON.stringify({ to, expectedStatus: expected }) });
      expected = to;
    }

    expect((await rate({ rating: 6 })).status).toBe(400);
    const ok = await rate({ rating: 4, comment: "  Muito bom, mas demorou.  " });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as GuestOrderDto).review).toMatchObject({ rating: 4, comment: "Muito bom, mas demorou." });
    expect((await rate({ rating: 1 })).status).toBe(409); // only once

    const detail = (await (await t.request(`/api/admin/orders/${id}`, { cookie: admin })).json()) as AdminOrderDetailDto;
    expect(detail.review?.rating).toBe(4);
    const report = (await (await t.request("/api/admin/reports?from=2026-10-13&to=2026-10-13", { cookie: admin })).json()) as ReportDto;
    expect(report.kpis).toMatchObject({ avgRating: 4, reviewCount: 1 });
    expect(report.reviews).toEqual([expect.objectContaining({ reference: placed.reference, rating: 4, comment: "Muito bom, mas demorou." })]);
  });
});
