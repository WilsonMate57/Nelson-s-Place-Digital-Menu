import { beforeEach, describe, expect, it } from "vitest";
import type { AdminOrderDetailDto, GuestOrderDto, OrderListResponse } from "../src/shared/types";
import { buildSubmission, makeTestContext, productByName, type TestContext } from "./helpers";

/** Integration tests: real Hono app + real SQLite (in memory). No mocks. */
describe("guest order submission", () => {
  let t: TestContext;
  beforeEach(async () => {
    t = await makeTestContext();
  });

  it("serves the public menu without archived products or secrets", async () => {
    const menu = await t.menu();
    expect(menu.categories.map((c) => c.name.pt)).toEqual(["Entradas", "Pratos principais", "Bebidas", "Sobremesas"]);
    expect(menu.products.length).toBe(5);
    expect(menu.settings.currency).toBe("MZN");
    expect(JSON.stringify(menu)).not.toMatch(/password|token|isArchived/i);
  });

  it("persists an order with server-calculated totals, ignoring client-sent prices", async () => {
    const menu = await t.menu();
    const chicken = productByName(menu, "Frango grelhado");
    const juice = productByName(menu, "Sumo natural");
    const [sides, extras] = chicken.optionGroups;
    const body = {
      ...buildSubmission({
        items: [
          { productId: chicken.id, quantity: 2, optionIds: [sides!.options[1]!.id, extras!.options[0]!.id], notes: "Bem passado" },
          { productId: juice.id, quantity: 1, optionIds: [] },
        ],
      }),
      // Malicious extras the server must ignore:
      totalCents: 1,
      priceCents: 1,
    };
    const res = await t.request("/api/orders", { method: "POST", body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    const order = (await res.json()) as GuestOrderDto;
    expect(order.reference).toMatch(/^NP-\d{6}-[A-Z2-9]{4}$/);
    expect(order.status).toBe("PENDING");
    expect(order.subtotalCents).toBe(2 * (65000 + 5000) + 18000);
    expect(order.totalCents).toBe(158000);
    expect(order.items[0]!.options.map((o) => o.name)).toEqual(["Arroz", "Molho extra"]);

    const stored = t.services.db.prepare("SELECT total_cents, status FROM orders").all();
    expect(stored).toEqual([{ total_cents: 158000, status: "PENDING" }]);
  });

  it("returns the same order for a repeated idempotency key (double click / retry)", async () => {
    const juice = productByName(await t.menu(), "Sumo natural");
    const body = JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] }));
    const [a, b] = await Promise.all([
      t.request("/api/orders", { method: "POST", body }),
      t.request("/api/orders", { method: "POST", body }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 201]);
    const [orderA, orderB] = (await Promise.all([a.json(), b.json()])) as GuestOrderDto[];
    expect(orderA!.reference).toBe(orderB!.reference);
    expect((t.services.db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n).toBe(1);
  });

  it("rejects reusing an idempotency key with different content", async () => {
    const juice = productByName(await t.menu(), "Sumo natural");
    const first = buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] });
    await t.request("/api/orders", { method: "POST", body: JSON.stringify(first) });
    const res = await t.request("/api/orders", {
      method: "POST",
      body: JSON.stringify({ ...first, items: [{ productId: juice.id, quantity: 5, optionIds: [] }] }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("rejects unavailable products", async () => {
    const water = productByName(await t.menu(), "Água mineral");
    expect(water.isAvailable).toBe(false);
    const res = await t.request("/api/orders", {
      method: "POST",
      body: JSON.stringify(buildSubmission({ items: [{ productId: water.id, quantity: 1, optionIds: [] }] })),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("PRODUCT_UNAVAILABLE");
  });

  it("rejects archived products and products in inactive categories", async () => {
    const menu = await t.menu();
    const juice = productByName(menu, "Sumo natural");
    t.services.menuRepo.setArchived(juice.id, true);
    const res = await t.request("/api/orders", {
      method: "POST",
      body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })),
    });
    expect(res.status).toBe(409);
  });

  it("validates required product options", async () => {
    const chicken = productByName(await t.menu(), "Frango grelhado");
    const res = await t.request("/api/orders", {
      method: "POST",
      body: JSON.stringify(buildSubmission({ items: [{ productId: chicken.id, quantity: 1, optionIds: [] }] })),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe("OPTION_SELECTION_COUNT");
  });

  it.each([
    ["empty cart", { items: [] }],
    ["missing location", { location: { type: "room", label: "" } }],
    ["invalid location type", { location: { type: "pool", label: "1" } }],
    ["script in location", { location: { type: "room", label: "<script>" } }],
    ["quantity above limit", { items: [{ productId: 1, quantity: 999, optionIds: [] }] }],
    ["zero quantity", { items: [{ productId: 1, quantity: 0, optionIds: [] }] }],
    ["bad idempotency key", { idempotencyKey: "abc" }],
    ["invalid phone", { contactPhone: "call me maybe" }],
  ])("rejects invalid checkout data: %s", async (_label, override) => {
    const body = { ...buildSubmission({ items: [{ productId: 1, quantity: 1, optionIds: [] }] }), ...override };
    const res = await t.request("/api/orders", { method: "POST", body: JSON.stringify(body) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("enforces hotel settings: paused ordering and required guest name", async () => {
    const juice = productByName(await t.menu(), "Sumo natural");
    const { currency: _c, ...settings } = t.services.settingsRepo.get();
    t.services.settingsRepo.save({ ...settings, requireGuestName: true }, null);
    let res = await t.request("/api/orders", {
      method: "POST",
      body: JSON.stringify(buildSubmission({ guestName: null, items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })),
    });
    expect(res.status).toBe(400);

    t.services.settingsRepo.save({ ...settings, ordersEnabled: false }, null);
    res = await t.request("/api/orders", {
      method: "POST",
      body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })),
    });
    expect(res.status).toBe(503);
  });

  it("lets the guest track status with the private token only", async () => {
    const juice = productByName(await t.menu(), "Sumo natural");
    const created = (await (
      await t.request("/api/orders", {
        method: "POST",
        body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })),
      })
    ).json()) as GuestOrderDto;
    const res = await t.request(`/api/orders/track/${created.publicToken}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as GuestOrderDto).reference).toBe(created.reference);
    expect((await t.request(`/api/orders/track/${"x".repeat(24)}`)).status).toBe(404);
  });

  it("rate-limits order submission per client IP", async () => {
    const limited = await makeTestContext({ env: { TRUST_PROXY: "true" } });
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) {
      const res = await limited.request("/api/orders", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.5" },
        body: JSON.stringify({}),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
    // Another guest is unaffected.
    const other = await limited.request("/api/orders", { method: "POST", headers: { "x-forwarded-for": "203.0.113.6" }, body: "{}" });
    expect(other.status).toBe(400);
  });
});

describe("order appears in the staff dashboard", () => {
  it("lists new orders and exposes full details to staff", async () => {
    const t = await makeTestContext();
    const juice = productByName(await t.menu(), "Sumo natural");
    await t.request("/api/orders", {
      method: "POST",
      body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 2, optionIds: [] }] })),
    });
    const cookie = await t.login("reception@test.local");
    const list = (await (await t.request("/api/admin/orders", { cookie })).json()) as OrderListResponse;
    expect(list.orders).toHaveLength(1);
    expect(list.counts.PENDING).toBe(1);
    expect(list.orders[0]!.itemCount).toBe(2);
    expect(list.orders[0]!.whatsappStatus).toBe("not_configured");

    const detail = (await (await t.request(`/api/admin/orders/${list.orders[0]!.id}`, { cookie })).json()) as AdminOrderDetailDto;
    expect(detail.items[0]!.productName).toBe("Sumo natural");
    expect(detail.history.map((h) => h.toStatus)).toEqual(["PENDING"]);
  });

  it("keeps the price snapshot when the product price changes later", async () => {
    const t = await makeTestContext();
    const juice = productByName(await t.menu(), "Sumo natural");
    await t.request("/api/orders", {
      method: "POST",
      body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })),
    });
    t.services.db.prepare("UPDATE products SET price_cents = 99900 WHERE id = ?").run(juice.id);
    const order = t.services.ordersRepo.get(1)!;
    expect(order.items[0]!.unitPriceCents).toBe(18000);
    expect(order.totalCents).toBe(18000);
  });
});
