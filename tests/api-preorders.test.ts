import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/server/db/connection";
import { MIGRATIONS } from "../src/server/db/migrations";
import { hotelInstant } from "../src/shared/schedule";
import type { AdminOrderDetailDto, GuestOrderDto, OrderListResponse } from "../src/shared/types";
import { buildSubmission, makeTestContext, productByName, type TestContext } from "./helpers";

/** Hotel-local instant, e.g. at("2026-10-13", "19:00"). */
const at = (day: string, hm: string) => hotelInstant(day, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)));
const NOON = at("2026-10-13", "12:00");

type ErrorBody = { error: { code: string; message: string; details?: { reason?: string } } };

async function post(t: TestContext, body: unknown) {
  const res = await t.request("/api/orders", { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as GuestOrderDto & ErrorBody };
}

async function juiceItems(t: TestContext) {
  const juice = productByName(await t.menu(), "Sumo natural");
  return [{ productId: juice.id, quantity: 2, optionIds: [] }];
}

function updateSettings(t: TestContext, patch: Record<string, unknown>) {
  const { currency: _c, ...current } = t.services.settingsRepo.get();
  t.services.settingsRepo.save({ ...current, ...patch } as never, null);
}

describe("kitchen hours", () => {
  it("rejects 'as soon as possible' orders when the kitchen is closed", async () => {
    const t = await makeTestContext({ now: () => at("2026-10-13", "23:30") });
    const res = await post(t, buildSubmission({ items: await juiceItems(t) }));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("KITCHEN_CLOSED");
  });
});

describe("scheduled orders (Encomendar)", () => {
  it("accepts a time at least 45 minutes ahead and stores it", async () => {
    const t = await makeTestContext({ now: () => NOON });
    const when = at("2026-10-13", "19:00").toISOString();
    const res = await post(t, buildSubmission({ items: await juiceItems(t), scheduledFor: when, contactPhone: "+258 84 000 0000" }));
    expect(res.status).toBe(201);
    expect(res.body.scheduledFor).toBe(when);

    const cookie = await t.login("reception@test.local");
    const list = (await (await t.request("/api/admin/orders?status=SCHEDULED", { cookie })).json()) as OrderListResponse;
    expect(list.scheduledCount).toBe(1);
    expect(list.orders[0]!.scheduledFor).toBe(when);
  });

  it("requires a contact phone for scheduled orders", async () => {
    const t = await makeTestContext({ now: () => NOON });
    const res = await post(t, buildSubmission({ items: await juiceItems(t), scheduledFor: at("2026-10-13", "19:00").toISOString() }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CONTACT_REQUIRED");
  });

  it.each([
    ["less than 45 minutes ahead", "2026-10-13", "12:30", "TOO_SOON"],
    ["after the kitchen closes", "2026-10-13", "23:15", "OUTSIDE_KITCHEN_HOURS"],
    ["more than one day ahead", "2026-10-15", "12:00", "TOO_FAR"],
  ])("rejects a time %s", async (_label, day, hm, reason) => {
    const t = await makeTestContext({ now: () => NOON });
    const res = await post(
      t,
      buildSubmission({ items: await juiceItems(t), scheduledFor: at(day, hm).toISOString(), contactPhone: "840000000" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SCHEDULE_INVALID");
    expect(res.body.error.details?.reason).toBe(reason);
  });

  it("can be switched off by the hotel", async () => {
    const t = await makeTestContext({ now: () => NOON });
    updateSettings(t, { preOrdersEnabled: false });
    const res = await post(
      t,
      buildSubmission({ items: await juiceItems(t), scheduledFor: at("2026-10-13", "19:00").toISOString(), contactPhone: "840000000" }),
    );
    expect(res.body.error.code).toBe("PREORDERS_DISABLED");
  });
});

describe("category availability windows (breakfast only in the morning)", () => {
  async function withMorningOnlyDesserts(t: TestContext) {
    const menu = await t.menu();
    const desserts = menu.categories.find((c) => c.name.pt === "Sobremesas")!;
    t.services.menuRepo.updateCategory(desserts.id, {
      name: desserts.name,
      description: null,
      sortOrder: desserts.sortOrder,
      isActive: true,
      availableFrom: "07:00",
      availableUntil: "11:00",
    });
    const cake = productByName(await t.menu(), "Fatia de bolo");
    return [{ productId: cake.id, quantity: 1, optionIds: [] }];
  }

  it("exposes the window to guests", async () => {
    const t = await makeTestContext({ now: () => NOON });
    await withMorningOnlyDesserts(t);
    const desserts = (await t.menu()).categories.find((c) => c.name.pt === "Sobremesas")!;
    expect(desserts).toMatchObject({ availableFrom: "07:00", availableUntil: "11:00" });
  });

  it("rejects ordering it now outside the window, but accepts scheduling it for the morning", async () => {
    const t = await makeTestContext({ now: () => NOON });
    const items = await withMorningOnlyDesserts(t);
    const now = await post(t, buildSubmission({ items }));
    expect(now.status).toBe(409);
    expect(now.body.error.code).toBe("ITEM_NOT_AVAILABLE_NOW");

    const tomorrowLunch = await post(
      t,
      buildSubmission({ items, scheduledFor: at("2026-10-14", "12:00").toISOString(), contactPhone: "840000000" }),
    );
    expect(tomorrowLunch.body.error.details?.reason).toBe("OUTSIDE_ITEM_HOURS");

    const tomorrowMorning = await post(
      t,
      buildSubmission({ items, scheduledFor: at("2026-10-14", "09:00").toISOString(), contactPhone: "840000000" }),
    );
    expect(tomorrowMorning.status).toBe(201);
  });
});

describe("take-away with a 50% deposit", () => {
  const takeaway = (items: unknown, extra: Record<string, unknown> = {}) =>
    buildSubmission({
      items: items as never,
      location: { type: "takeaway" } as never,
      guestName: "Carlos",
      contactPhone: "+258 84 111 2222",
      paymentReference: "MP261013.1234.A00001",
      ...extra,
    });

  it("is not offered until the hotel sets payment instructions", async () => {
    const t = await makeTestContext({ now: () => NOON });
    expect((await t.menu()).settings.takeawayEnabled).toBe(false);
    const res = await post(t, takeaway(await juiceItems(t)));
    expect(res.body.error.code).toBe("TAKEAWAY_DISABLED");
  });

  it("requires name, phone and the payment reference", async () => {
    const t = await makeTestContext({ now: () => NOON });
    updateSettings(t, { paymentInstructions: { pt: "M-Pesa 84 000 0000 (Nelson's Place)" } });
    expect((await t.menu()).settings.takeawayEnabled).toBe(true);
    const items = await juiceItems(t);
    expect((await post(t, takeaway(items, { paymentReference: null }))).body.error.code).toBe("PAYMENT_REFERENCE_REQUIRED");
    expect((await post(t, takeaway(items, { contactPhone: null }))).body.error.code).toBe("CONTACT_REQUIRED");
    expect((await post(t, takeaway(items, { guestName: null }))).body.error.code).toBe("GUEST_NAME_REQUIRED");
  });

  it("calculates the deposit on the server and blocks confirmation until staff verify it", async () => {
    const t = await makeTestContext({ now: () => NOON });
    updateSettings(t, { paymentInstructions: { pt: "M-Pesa 84 000 0000" } });
    const res = await post(t, takeaway(await juiceItems(t), { scheduledFor: at("2026-10-13", "18:00").toISOString() }));
    expect(res.status).toBe(201);
    expect(res.body.totalCents).toBe(36000);
    expect(res.body.depositCents).toBe(18000);
    expect(res.body.depositStatus).toBe("pending");
    expect(res.body.locationType).toBe("takeaway");

    const cookie = await t.login("reception@test.local");
    const id = t.services.ordersRepo.list({ status: "ALL", limit: 1 })[0]!.id;
    const early = await t.request(`/api/admin/orders/${id}/status`, {
      method: "POST",
      cookie,
      body: JSON.stringify({ to: "CONFIRMED", expectedStatus: "PENDING" }),
    });
    expect(early.status).toBe(409);
    expect(((await early.json()) as ErrorBody).error.code).toBe("DEPOSIT_NOT_CONFIRMED");

    const confirm = await t.request(`/api/admin/orders/${id}/deposit/confirm`, { method: "POST", cookie });
    expect(confirm.status).toBe(200);
    expect(((await confirm.json()) as AdminOrderDetailDto).depositStatus).toBe("confirmed");
    expect((await t.request(`/api/admin/orders/${id}/deposit/confirm`, { method: "POST", cookie })).status).toBe(409);

    const ok = await t.request(`/api/admin/orders/${id}/status`, {
      method: "POST",
      cookie,
      body: JSON.stringify({ to: "CONFIRMED", expectedStatus: "PENDING" }),
    });
    expect(ok.status).toBe(200);
    expect(t.services.auditRepo.recent(5).map((a) => a.action)).toContain("deposit_confirmed");
  });

  it("does not ask for a deposit when eating at the restaurant or in the apartment", async () => {
    const t = await makeTestContext({ now: () => NOON });
    updateSettings(t, { paymentInstructions: { pt: "M-Pesa" } });
    const res = await post(t, buildSubmission({ items: await juiceItems(t) }));
    expect(res.body.depositCents).toBe(0);
    expect(res.body.depositStatus).toBe("not_required");
  });
});

describe("migration 2 on an existing database", () => {
  it("keeps existing orders and their items", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(MIGRATIONS[0]!);
    db.pragma("user_version = 1");
    db.exec(`
      INSERT INTO categories (id, name) VALUES (1, '{"pt":"Bebidas"}');
      INSERT INTO products (id, category_id, name, price_cents) VALUES (1, 1, '{"pt":"Sumo"}', 18000);
      INSERT INTO orders (id, reference, public_token, idempotency_key, request_hash, status, location_type, location_label,
        language, currency, subtotal_cents, total_cents)
      VALUES (1, 'NP-1', 'tok', 'key', 'hash', 'PENDING', 'room', '12', 'pt', 'MZN', 18000, 18000);
      INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity, line_total_cents)
      VALUES (1, 1, 'Sumo', 18000, 1, 18000);
    `);
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    expect(db.prepare("SELECT reference, deposit_status, scheduled_for FROM orders").get()).toEqual({
      reference: "NP-1",
      deposit_status: "not_required",
      scheduled_for: null,
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM order_items WHERE order_id = 1").get()).toEqual({ n: 1 });
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});
