import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "../src/shared/permissions";
import type { RoleDto, StaffDto } from "../src/shared/types";
import { hashPassword } from "../src/server/auth/passwords";
import { buildSubmission, makeTestContext, PASSWORD, productByName, type TestContext } from "./helpers";

/** Creates a profile and a user with it; returns the user's session cookie. */
async function userWith(t: TestContext, permissions: string[], name = "Teste") {
  const admin = await t.login("admin@test.local");
  const res = await t.request("/api/admin/roles", { method: "POST", cookie: admin, body: JSON.stringify({ name, permissions }) });
  expect(res.status).toBe(201);
  const role = (await res.json()) as RoleDto;
  const email = `${name.toLowerCase()}@test.local`;
  t.services.staffRepo.create({ email, displayName: name, roleId: role.id, passwordHash: await hashPassword(PASSWORD), createdBy: null });
  return { cookie: await t.login(email), role, admin };
}

describe("access profiles (perfis)", () => {
  it("ships the four default profiles, with Administrador holding every permission", async () => {
    const t = await makeTestContext();
    const admin = await t.login("admin@test.local");
    const roles = (await (await t.request("/api/admin/roles", { cookie: admin })).json()) as RoleDto[];
    expect(roles.map((r) => r.name)).toEqual(["Administrador", "Gerente", "Recepção", "Cozinha"]);
    expect(roles[0]!.permissions).toEqual([...PERMISSIONS]);
    expect(roles[0]!.isSystem).toBe(true);
    expect(roles[2]!.permissions).toEqual(roles[3]!.permissions); // Cozinha = Recepção
    expect(roles[2]!.permissions).toEqual(expect.arrayContaining(["menu.edit", "menu.prices", "reports.view"]));
    expect(roles[2]!.permissions).not.toContain("reports.export");
    const me = (await (await t.request("/api/auth/me", { cookie: admin })).json()) as { staff: StaffDto };
    expect(me.staff.roleName).toBe("Administrador");
  });

  it("enforces each permission on the server", async () => {
    const t = await makeTestContext();
    const { cookie } = await userWith(t, ["orders.view"], "Leitura");
    const juice = productByName(await t.menu(), "Sumo natural");
    await t.request("/api/orders", { method: "POST", body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })) });
    const id = t.services.ordersRepo.list({ status: "ALL", limit: 1 })[0]!.id;

    expect((await t.request("/api/admin/orders", { cookie })).status).toBe(200);
    expect((await t.request(`/api/admin/orders/${id}/messages`, { cookie })).status).toBe(200);
    const denied: [string, string, unknown?][] = [
      ["POST", `/api/admin/orders/${id}/status`, { to: "CONFIRMED", expectedStatus: "PENDING" }],
      ["POST", `/api/admin/orders/${id}/status`, { to: "CANCELLED", expectedStatus: "PENDING" }],
      ["POST", `/api/admin/orders/${id}/messages`, { body: "Olá" }],
      ["POST", `/api/admin/orders/${id}/deposit/confirm`],
      ["PATCH", `/api/admin/products/${juice.id}/availability`, { isAvailable: false }],
      ["PATCH", "/api/admin/settings/orders-enabled", { ordersEnabled: false }],
      ["GET", "/api/admin/reports?from=2026-10-13&to=2026-10-13"],
    ];
    for (const [method, path, body] of denied) {
      const res = await t.request(path, { method, cookie, body: body === undefined ? undefined : JSON.stringify(body) });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it("separates advancing an order from cancelling it", async () => {
    const t = await makeTestContext();
    const { cookie } = await userWith(t, ["orders.view", "orders.status"], "Copa");
    const juice = productByName(await t.menu(), "Sumo natural");
    await t.request("/api/orders", { method: "POST", body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })) });
    const id = t.services.ordersRepo.list({ status: "ALL", limit: 1 })[0]!.id;
    const cancel = await t.request(`/api/admin/orders/${id}/status`, { method: "POST", cookie, body: JSON.stringify({ to: "CANCELLED", expectedStatus: "PENDING" }) });
    expect(cancel.status).toBe(403);
    const confirm = await t.request(`/api/admin/orders/${id}/status`, { method: "POST", cookie, body: JSON.stringify({ to: "CONFIRMED", expectedStatus: "PENDING" }) });
    expect(confirm.status).toBe(200);
  });

  it("lets a profile edit the menu without changing prices", async () => {
    const t = await makeTestContext();
    const { cookie } = await userWith(t, ["menu.edit"], "Chef");
    const juice = productByName(await t.menu(), "Sumo natural");
    const base = { categoryId: juice.categoryId, name: { pt: "Sumo natural da casa" }, priceCents: juice.priceCents };
    expect((await t.request(`/api/admin/products/${juice.id}`, { method: "PUT", cookie, body: JSON.stringify(base) })).status).toBe(200);
    expect((await t.request(`/api/admin/products/${juice.id}`, { method: "PUT", cookie, body: JSON.stringify({ ...base, priceCents: 1 }) })).status).toBe(403);
    expect((await t.request("/api/admin/products", { method: "POST", cookie, body: JSON.stringify({ ...base, name: { pt: "Novo" } }) })).status).toBe(403);
    expect(productByName(await t.menu(), "Sumo natural da casa").priceCents).toBe(18000);
  });

  it("applies permission changes immediately, protects the Administrador profile and prevents lock-outs", async () => {
    const t = await makeTestContext();
    const { cookie, role, admin } = await userWith(t, ["orders.view"], "Turno");
    expect((await t.request("/api/admin/reports?from=2026-10-13&to=2026-10-13", { cookie })).status).toBe(403);
    await t.request(`/api/admin/roles/${role.id}`, { method: "PUT", cookie: admin, body: JSON.stringify({ name: "Turno", permissions: ["orders.view", "reports.view"] }) });
    expect((await t.request("/api/admin/reports?from=2026-10-13&to=2026-10-13", { cookie })).status).toBe(200);

    expect((await t.request("/api/admin/roles/1", { method: "PUT", cookie: admin, body: JSON.stringify({ name: "Administrador", permissions: [] }) })).status).toBe(409);
    expect((await t.request("/api/admin/roles/1", { method: "DELETE", cookie: admin })).status).toBe(409);
    expect((await t.request(`/api/admin/roles/${role.id}`, { method: "DELETE", cookie: admin })).status).toBe(409); // in use
    expect((await t.request("/api/admin/roles", { method: "POST", cookie: admin, body: JSON.stringify({ name: "cozinha", permissions: [] }) })).status).toBe(409); // duplicate

    // The only admin cannot move themselves to a profile without staff management.
    const self = t.services.staffRepo.findByEmail("admin@test.local")!;
    const demote = await t.request(`/api/admin/staff/${self.id}`, { method: "PUT", cookie: admin, body: JSON.stringify({ displayName: "Admin", roleId: role.id, isActive: true }) });
    expect(demote.status).toBe(409);
    expect(t.services.staffRepo.findById(self.id)!.roleName).toBe("Administrador");
    expect(t.services.auditRepo.recent(10).map((a) => a.action)).toEqual(expect.arrayContaining(["role_created", "role_updated"]));
  });
});
