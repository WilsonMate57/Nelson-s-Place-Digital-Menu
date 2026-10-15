import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GuestOrderDto } from "../src/shared/types";
import { buildSubmission, makeTestContext, productByName, type TestContext } from "./helpers";

async function placeOrder(t: TestContext) {
  const juice = productByName(await t.menu(), "Sumo natural");
  const res = await t.request("/api/orders", { method: "POST", body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })) });
  const { reference } = (await res.json()) as GuestOrderDto;
  return t.services.ordersRepo.list({ status: "ALL", q: reference, limit: 1 })[0]!.id;
}

describe("deleting orders (data clean-up)", () => {
  it("previews, requires the confirmation word, backs up first and deletes only the chosen orders", async () => {
    const backupDir = mkdtempSync(join(tmpdir(), "np-backups-"));
    const t = await makeTestContext({ env: { BACKUP_DIR: backupDir } });
    const admin = await t.login("admin@test.local");
    const kept = await placeOrder(t);
    const cancelled = await placeOrder(t);
    await t.request(`/api/admin/orders/${cancelled}/status`, { method: "POST", cookie: admin, body: JSON.stringify({ to: "CANCELLED", expectedStatus: "PENDING" }) });
    await t.request(`/api/orders/track/${t.services.ordersRepo.getPublicToken(cancelled)}/messages`, { method: "POST", body: JSON.stringify({ body: "Olá" }) });

    const preview = await t.request("/api/admin/maintenance/orders?from=2026-10-13&to=2026-10-13&scope=cancelled", { cookie: admin });
    expect(await preview.json()).toEqual({ orders: 1, active: 0, messages: 1 });
    expect((await (await t.request("/api/admin/maintenance/orders?from=2026-10-13&to=2026-10-13&scope=all", { cookie: admin })).json()).orders).toBe(2);

    const body = { from: "2026-10-13", to: "2026-10-13", scope: "cancelled" };
    const unconfirmed = await t.request("/api/admin/maintenance/orders/delete", { method: "POST", cookie: admin, body: JSON.stringify({ ...body, confirm: "sim" }) });
    expect(unconfirmed.status).toBe(400);
    expect(t.services.ordersRepo.get(cancelled)).not.toBeNull();

    const res = await t.request("/api/admin/maintenance/orders/delete", { method: "POST", cookie: admin, body: JSON.stringify({ ...body, confirm: "APAGAR" }) });
    expect(res.status).toBe(200);
    const result = (await res.json()) as { deleted: number; backupFile: string };
    expect(result.deleted).toBe(1);
    expect(existsSync(result.backupFile)).toBe(true);
    expect(readdirSync(backupDir)).toHaveLength(1);
    expect(t.services.ordersRepo.get(cancelled)).toBeNull();
    expect(t.services.ordersRepo.get(kept)).not.toBeNull();
    expect(t.services.auditRepo.recent(5).some((e) => e.action === "orders_deleted")).toBe(true);
  });

  it("is reserved to profiles that manage settings", async () => {
    const t = await makeTestContext();
    const reception = await t.login("reception@test.local");
    expect((await t.request("/api/admin/maintenance/orders?from=2026-10-13&to=2026-10-13&scope=all", { cookie: reception })).status).toBe(403);
    const res = await t.request("/api/admin/maintenance/orders/delete", {
      method: "POST",
      cookie: reception,
      body: JSON.stringify({ from: "2026-10-13", to: "2026-10-13", scope: "all", confirm: "APAGAR" }),
    });
    expect(res.status).toBe(403);
  });
});
