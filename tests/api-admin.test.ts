import { beforeEach, describe, expect, it } from "vitest";
import type { AdminOrderDetailDto, AdminProductDto, GuestOrderDto } from "../src/shared/types";
import { buildSubmission, makeTestContext, productByName, PASSWORD, type TestContext } from "./helpers";

async function placeOrder(t: TestContext): Promise<number> {
  const juice = productByName(await t.menu(), "Sumo natural");
  const res = await t.request("/api/orders", {
    method: "POST",
    body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })),
  });
  const order = (await res.json()) as GuestOrderDto;
  return t.services.ordersRepo.list({ status: "ALL", q: order.reference, limit: 1 })[0]!.id;
}

describe("authentication and authorization", () => {
  let t: TestContext;
  beforeEach(async () => {
    t = await makeTestContext();
  });

  it("blocks every admin endpoint without a session", async () => {
    for (const [method, path] of [
      ["GET", "/api/admin/orders"],
      ["GET", "/api/admin/orders/1"],
      ["POST", "/api/admin/orders/1/status"],
      ["GET", "/api/admin/menu"],
      ["POST", "/api/admin/products"],
      ["PUT", "/api/admin/settings"],
      ["GET", "/api/admin/staff"],
    ] as const) {
      const res = await t.request(path, { method, body: method === "GET" ? undefined : "{}" });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("rejects wrong passwords and forged session cookies", async () => {
    const res = await t.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@test.local", password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
    expect((await t.request("/api/admin/orders", { cookie: "np_session=forged" })).status).toBe(401);
  });

  it("sets a hardened session cookie", async () => {
    const res = await t.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ADMIN@test.local", password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api/);
  });

  it("requires the anti-CSRF header on state-changing staff requests", async () => {
    const cookie = await t.login("admin@test.local");
    const res = await t.app.request("/api/admin/settings/orders-enabled", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ ordersEnabled: false }),
    });
    expect(res.status).toBe(403);
  });

  it("prevents non-admin staff from changing prices, menu structure, staff or settings", async () => {
    const cookie = await t.login("reception@test.local");
    const juice = productByName(await t.menu(), "Sumo natural");
    const attempts: [string, string, unknown][] = [
      ["PUT", `/api/admin/products/${juice.id}`, { categoryId: juice.categoryId, name: { pt: "x" }, priceCents: 1 }],
      ["POST", "/api/admin/products", { categoryId: juice.categoryId, name: { pt: "x" }, priceCents: 1 }],
      ["POST", `/api/admin/products/${juice.id}/archive`, {}],
      ["POST", "/api/admin/categories", { name: { pt: "x" } }],
      ["GET", "/api/admin/staff", undefined],
      ["POST", "/api/admin/staff", { email: "x@y.z", displayName: "x", role: "admin", password: "0123456789" }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await t.request(path, { method, cookie, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(productByName(await t.menu(), "Sumo natural").priceCents).toBe(18000);
  });

  it("lets any staff member toggle availability and pause ordering", async () => {
    const cookie = await t.login("reception@test.local");
    const juice = productByName(await t.menu(), "Sumo natural");
    const res = await t.request(`/api/admin/products/${juice.id}/availability`, {
      method: "PATCH",
      cookie,
      body: JSON.stringify({ isAvailable: false }),
    });
    expect(res.status).toBe(200);
    expect(productByName(await t.menu(), "Sumo natural").isAvailable).toBe(false);
    const pause = await t.request("/api/admin/settings/orders-enabled", { method: "PATCH", cookie, body: JSON.stringify({ ordersEnabled: false }) });
    expect(pause.status).toBe(200);
    expect((await t.menu()).settings.ordersEnabled).toBe(false);
  });

  it("revokes the session on logout and when a user is deactivated", async () => {
    const cookie = await t.login("reception@test.local");
    await t.request("/api/auth/logout", { method: "POST", cookie });
    expect((await t.request("/api/admin/orders", { cookie })).status).toBe(401);

    const again = await t.login("reception@test.local");
    const admin = await t.login("admin@test.local");
    const reception = t.services.staffRepo.findByEmail("reception@test.local")!;
    await t.request(`/api/admin/staff/${reception.id}`, {
      method: "PUT",
      cookie: admin,
      body: JSON.stringify({ displayName: "Recepção", role: "reception", isActive: false }),
    });
    expect((await t.request("/api/admin/orders", { cookie: again })).status).toBe(401);
  });

  it("refuses to remove the last active administrator", async () => {
    const admin = await t.login("admin@test.local");
    const self = t.services.staffRepo.findByEmail("admin@test.local")!;
    const res = await t.request(`/api/admin/staff/${self.id}`, {
      method: "PUT",
      cookie: admin,
      body: JSON.stringify({ displayName: "Admin", role: "reception", isActive: true }),
    });
    expect(res.status).toBe(409);
  });
});

describe("order status management", () => {
  it("advances through the workflow and records history with the staff member", async () => {
    const t = await makeTestContext();
    const id = await placeOrder(t);
    const cookie = await t.login("reception@test.local");
    let expected = "PENDING";
    for (const to of ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]) {
      const res = await t.request(`/api/admin/orders/${id}/status`, {
        method: "POST",
        cookie,
        body: JSON.stringify({ to, expectedStatus: expected }),
      });
      expect(res.status, to).toBe(200);
      expected = to;
    }
    const detail = (await (await t.request(`/api/admin/orders/${id}`, { cookie })).json()) as AdminOrderDetailDto;
    expect(detail.status).toBe("COMPLETED");
    expect(detail.history.map((h) => h.toStatus)).toEqual(["PENDING", "CONFIRMED", "PREPARING", "READY", "COMPLETED"]);
    expect(detail.history[1]!.staffName).toBe("Recepção");
  });

  it("rejects invalid transitions and stale updates", async () => {
    const t = await makeTestContext();
    const id = await placeOrder(t);
    const cookie = await t.login("reception@test.local");
    const skip = await t.request(`/api/admin/orders/${id}/status`, {
      method: "POST",
      cookie,
      body: JSON.stringify({ to: "COMPLETED", expectedStatus: "PENDING" }),
    });
    expect(skip.status).toBe(400);
    const stale = await t.request(`/api/admin/orders/${id}/status`, {
      method: "POST",
      cookie,
      body: JSON.stringify({ to: "PREPARING", expectedStatus: "CONFIRMED" }),
    });
    expect(stale.status).toBe(409);
    expect(t.services.ordersRepo.get(id)!.status).toBe("PENDING");
  });
});

describe("menu management", () => {
  it("creates, edits (keeping option ids) and archives products, with an audit trail", async () => {
    const t = await makeTestContext();
    const cookie = await t.login("admin@test.local");
    const menu = await t.menu();
    const created = await t.request("/api/admin/products", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        categoryId: menu.categories[0]!.id,
        name: { pt: "Chamuças", en: "Samosas" },
        priceCents: 30000,
        optionGroups: [
          { name: { pt: "Recheio" }, minSelect: 1, maxSelect: 1, options: [{ name: { pt: "Carne" }, priceDeltaCents: 0 }, { name: { pt: "Vegetais" }, priceDeltaCents: 0 }] },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const product = (await created.json()) as AdminProductDto;
    const group = product.optionGroups[0]!;

    const updated = await t.request(`/api/admin/products/${product.id}`, {
      method: "PUT",
      cookie,
      body: JSON.stringify({
        categoryId: product.categoryId,
        name: product.name,
        priceCents: 32000,
        optionGroups: [{ id: group.id, name: group.name, minSelect: 1, maxSelect: 1, options: [{ id: group.options[0]!.id, name: { pt: "Carne" }, priceDeltaCents: 0 }] }],
      }),
    });
    const after = (await updated.json()) as AdminProductDto;
    expect(after.priceCents).toBe(32000);
    expect(after.optionGroups[0]!.id).toBe(group.id);
    expect(after.optionGroups[0]!.options.map((o) => o.id)).toEqual([group.options[0]!.id]);

    await t.request(`/api/admin/products/${product.id}/archive`, { method: "POST", cookie });
    expect((await t.menu()).products.some((p) => p.id === product.id)).toBe(false);

    const audit = t.services.auditRepo.recent(10).map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(["product_created", "product_updated", "product_archived"]));
  });

  it("refuses to delete a category that still has products", async () => {
    const t = await makeTestContext();
    const cookie = await t.login("admin@test.local");
    const category = (await t.menu()).categories[0]!;
    expect((await t.request(`/api/admin/categories/${category.id}`, { method: "DELETE", cookie })).status).toBe(409);
  });

  it("validates uploaded images by content, not by declared type", async () => {
    const t = await makeTestContext();
    const cookie = await t.login("admin@test.local");
    const juice = productByName(await t.menu(), "Sumo natural");
    const fake = new FormData();
    fake.append("image", new File(["<svg onload=alert(1)>"], "x.png", { type: "image/png" }));
    const bad = await t.request(`/api/admin/products/${juice.id}/image`, { method: "POST", cookie, body: fake });
    expect(bad.status).toBe(400);

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const good = new FormData();
    good.append("image", new File([png], "x.png", { type: "image/png" }));
    const ok = await t.request(`/api/admin/products/${juice.id}/image`, { method: "POST", cookie, body: good });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as AdminProductDto).imageUrl).toMatch(/^\/uploads\/products\/[0-9a-f-]{36}\.png$/);
  });
});

describe("hotel details for printed tickets", () => {
  it("come pre-filled and are validated when saved", async () => {
    const t = await makeTestContext();
    const cookie = await t.login("admin@test.local");
    const current = (await (await t.request("/api/admin/settings", { cookie })).json()) as Record<string, unknown>;
    expect(current).toMatchObject({
      hotelNuit: "400966079",
      hotelPhone: "+258843307644",
      hotelAddress: "Kumbeza, célula A, no. 281, Q.8",
      hotelEmail: "info@nelsonsplace.co.mz",
      hotelWebsite: "www.nelsonsplace.co.mz",
    });
    const { currency: _c, whatsappMode: _w, ...body } = current;
    const bad = await t.request("/api/admin/settings", { method: "PUT", cookie, body: JSON.stringify({ ...body, hotelNuit: "40-09", hotelEmail: "x" }) });
    expect(bad.status).toBe(400);
    const ok = await t.request("/api/admin/settings", { method: "PUT", cookie, body: JSON.stringify({ ...body, hotelPhone: "+258 84 330 7644" }) });
    expect(ok.status).toBe(200);
    expect(t.services.settingsRepo.get().hotelPhone).toBe("+258 84 330 7644");
  });
});
