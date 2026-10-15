import { describe, expect, it } from "vitest";
import { hashPassword } from "../src/server/auth/passwords";
import type { AdminProductDto, GuestOrderDto } from "../src/shared/types";
import { PASSWORD, buildSubmission, makeTestContext, productByName } from "./helpers";

describe("featured items and promotions", () => {
  it("charges the promotional price on the server while it applies", async () => {
    const t = await makeTestContext(); // clock: 2026-10-13 12:00 in Maputo
    const admin = await t.login("admin@test.local");
    const juice = productByName(await t.menu(), "Sumo natural");
    const save = (promo: unknown, extra: Record<string, unknown> = {}) =>
      t.request(`/api/admin/products/${juice.id}`, {
        method: "PUT",
        cookie: admin,
        body: JSON.stringify({ ...juice, promo, ...extra }),
      });

    expect((await save({ priceCents: 12000, fromTime: "17:00", untilTime: null })).status).toBe(400);
    const res = await save({ priceCents: 12000, fromDate: "2026-10-01", untilDate: "2026-10-31", fromTime: "11:00", untilTime: "13:00" }, {
      isFeatured: true,
      featuredLabel: { pt: "Prato do dia", en: "Dish of the day" },
    });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as AdminProductDto;
    expect(saved).toMatchObject({ isFeatured: true, featuredLabel: { pt: "Prato do dia" }, promo: { priceCents: 12000, fromTime: "11:00" } });

    const order = await t.request("/api/orders", { method: "POST", body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 2, optionIds: [] }] })) });
    expect(((await order.json()) as GuestOrderDto).totalCents).toBe(24000);

    // Outside the daily hours the regular price applies again.
    await save({ priceCents: 12000, fromDate: null, untilDate: null, fromTime: "17:00", untilTime: "19:00" });
    const later = await t.request("/api/orders", { method: "POST", body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })) });
    expect(((await later.json()) as GuestOrderDto).totalCents).toBe(juice.priceCents);
  });

  it("treats a promotion as a price change (needs «Alterar preços»)", async () => {
    const t = await makeTestContext();
    const roleId = t.services.roleRepo.create({ name: "Só menu", description: null, permissions: ["menu.edit"] });
    t.services.staffRepo.create({ email: "menu@test.local", displayName: "Menu", roleId, passwordHash: await hashPassword(PASSWORD), createdBy: null });
    const cookie = await t.login("menu@test.local");
    const juice = productByName(await t.menu(), "Sumo natural");
    const put = (body: unknown) => t.request(`/api/admin/products/${juice.id}`, { method: "PUT", cookie, body: JSON.stringify(body) });
    expect((await put({ ...juice, promo: { priceCents: 100 } })).status).toBe(403);
    // Featuring an item does not touch prices.
    expect((await put({ ...juice, isFeatured: true })).status).toBe(200);
  });
});
