import { describe, expect, it } from "vitest";
import { hotelInstant } from "../src/shared/schedule";
import type { GuestOrderDto, ReportDto } from "../src/shared/types";
import { buildSubmission, makeTestContext, productByName, type TestContext } from "./helpers";

const at = (day: string, hm: string) => hotelInstant(day, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)));

async function setup() {
  let clock = at("2026-10-13", "12:00");
  const t = await makeTestContext({ now: () => clock });
  const setClock = (d: Date) => {
    clock = d;
  };
  const menu = await t.menu();
  const juice = productByName(menu, "Sumo natural");
  const chicken = productByName(menu, "Frango grelhado");
  const rice = chicken.optionGroups[0]!.options.find((o) => o.name.pt === "Arroz")!;
  const admin = await t.login("admin@test.local");
  return { t, setClock, juice, chicken, rice, admin };
}

async function order(t: TestContext, items: { productId: number; quantity: number; optionIds: number[] }[]) {
  const res = await t.request("/api/orders", { method: "POST", body: JSON.stringify(buildSubmission({ items })) });
  const body = (await res.json()) as GuestOrderDto;
  return t.services.ordersRepo.list({ status: "ALL", q: body.reference, limit: 1 })[0]!.id;
}

async function advance(t: TestContext, cookie: string, id: number, steps: string[]) {
  let expected = "PENDING";
  for (const to of steps) {
    const res = await t.request(`/api/admin/orders/${id}/status`, { method: "POST", cookie, body: JSON.stringify({ to, expectedStatus: expected }) });
    expect(res.status).toBe(200);
    expected = to;
  }
}

describe("admin reports", () => {
  it("summarises sales, items, options and hours for the period", async () => {
    const { t, setClock, juice, chicken, rice, admin } = await setup();
    // 13/10 12:00 — 2 juices, completed (360 MT)
    const a = await order(t, [{ productId: juice.id, quantity: 2, optionIds: [] }]);
    await advance(t, admin, a, ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]);
    // 13/10 19:00 — 1 chicken with rice, confirmed (650 MT)
    setClock(at("2026-10-13", "19:00"));
    const b = await order(t, [{ productId: chicken.id, quantity: 1, optionIds: [rice.id] }]);
    await advance(t, admin, b, ["CONFIRMED"]);
    // 13/10 19:30 — cancelled, must not count as a sale
    setClock(at("2026-10-13", "19:30"));
    const c = await order(t, [{ productId: juice.id, quantity: 5, optionIds: [] }]);
    await advance(t, admin, c, ["CANCELLED"]);
    // 13/10 20:00 — still pending, not a sale
    setClock(at("2026-10-13", "20:00"));
    await order(t, [{ productId: juice.id, quantity: 1, optionIds: [] }]);

    const res = await t.request("/api/admin/reports?from=2026-10-13&to=2026-10-13", { cookie: admin });
    expect(res.status).toBe(200);
    const r = (await res.json()) as ReportDto;
    expect(r.kpis).toMatchObject({
      ordersReceived: 4,
      ordersSold: 2,
      ordersCompleted: 1,
      ordersCancelled: 1,
      ordersPending: 1,
      revenueCents: 36000 + 65000,
      avgTicketCents: 50500,
      itemsSold: 3,
    });
    expect(r.previousFrom).toBe("2026-10-12");
    expect(r.previous.ordersReceived).toBe(0);
    expect(r.daily).toEqual([{ day: "2026-10-13", orders: 3, revenueCents: 101000 }]);
    expect(r.hourly).toHaveLength(24);
    expect(r.hourly[12]!.orders).toBe(1);
    expect(r.hourly[19]!.orders).toBe(1);
    expect(r.hourly[20]!.orders).toBe(1);
    expect(r.topItems[0]).toEqual({ name: "Sumo natural", quantity: 2, revenueCents: 36000 });
    expect(r.topOptions).toEqual([{ group: "Acompanhamento", name: "Arroz", count: 1 }]);
    expect(r.categories.map((x) => x.name).sort()).toEqual(["Bebidas", "Pratos principais"]);
    expect(r.byLocation).toEqual([{ type: "room", orders: 3, revenueCents: 101000 }]);
    expect(r.kpis.avgMinutesToConfirm).toBe(0);
  });

  it("fills every day of the range and compares with the previous period", async () => {
    const { t, juice, admin } = await setup();
    await order(t, [{ productId: juice.id, quantity: 1, optionIds: [] }]);
    const r = (await (await t.request("/api/admin/reports?from=2026-10-10&to=2026-10-16", { cookie: admin })).json()) as ReportDto;
    expect(r.daily.map((d) => d.day)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect([r.previousFrom, r.previousTo]).toEqual(["2026-10-03", "2026-10-09"]);
  });

  it("exports the period's orders as CSV for Excel", async () => {
    const { t, juice, admin } = await setup();
    await order(t, [{ productId: juice.id, quantity: 2, optionIds: [] }]);
    const res = await t.request("/api/admin/reports/orders.csv?from=2026-10-13&to=2026-10-13", { cookie: admin });
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("pedidos-2026-10-13-a-2026-10-13.csv");
    const csv = await res.text();
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines[0]).toContain("Referência;Data;Estado");
    expect(lines[1]).toContain(";2026-10-13 12:00;Pendente;Apartamento 12;");
    expect(lines[1]).toContain("2x Sumo natural");
    expect(lines[1]).toContain(";360,00;");
  });

  it("is restricted to administrators and validates the dates", async () => {
    const { t } = await setup();
    const reception = await t.login("reception@test.local");
    expect((await t.request("/api/admin/reports?from=2026-10-13&to=2026-10-13", { cookie: reception })).status).toBe(403);
    expect((await t.request("/api/admin/reports/orders.csv?from=2026-10-13&to=2026-10-13", { cookie: reception })).status).toBe(403);
    const admin = await t.login("admin@test.local");
    expect((await t.request("/api/admin/reports?from=2026-10-14&to=2026-10-13", { cookie: admin })).status).toBe(400);
    expect((await t.request("/api/admin/reports?from=ontem&to=hoje", { cookie: admin })).status).toBe(400);
  });
});
