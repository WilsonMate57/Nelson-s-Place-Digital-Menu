import { describe, expect, it, vi } from "vitest";
import { buildDailySummary } from "../src/shared/daily-summary";
import { hotelInstant } from "../src/shared/schedule";
import type { DailySummaryStatusDto } from "../src/shared/types";
import type { FetchLike } from "../src/server/whatsapp/cloud-api";
import { buildSubmission, makeTestContext, productByName, type TestContext } from "./helpers";

/**
 * Automatic daily summary. Email (SMTP) and the WhatsApp Cloud API are MOCKED
 * here; real delivery depends on the hotel's accounts and is not verified.
 */

const at = (day: string, hm: string) => hotelInstant(day, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)));

function enable(t: TestContext, patch: Record<string, unknown>) {
  const { currency: _c, ...current } = t.services.settingsRepo.get();
  t.services.settingsRepo.save({ ...current, dailySummaryEnabled: true, ...patch } as never, null);
}

async function withSale(t: TestContext) {
  const juice = productByName(await t.menu(), "Sumo natural");
  await t.request("/api/orders", { method: "POST", body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 2, optionIds: [] }] })) });
  const id = t.services.ordersRepo.list({ status: "ALL", limit: 1 })[0]!.id;
  const cookie = await t.login("reception@test.local");
  await t.request(`/api/admin/orders/${id}/status`, { method: "POST", cookie, body: JSON.stringify({ to: "CONFIRMED", expectedStatus: "PENDING" }) });
}

describe("daily summary to the manager", () => {
  it("is sent once by email after the kitchen closes, with the day's figures", async () => {
    let clock = at("2026-10-13", "12:00");
    const emailSender = vi.fn(async () => undefined);
    const t = await makeTestContext({ now: () => clock, emailSender });
    await withSale(t);
    enable(t, { managerEmail: "gerente@example.com" });

    clock = at("2026-10-13", "23:10"); // kitchen closes 23:00; due at 23:15
    await t.services.dailySummary.tick();
    expect(emailSender).not.toHaveBeenCalled();

    clock = at("2026-10-13", "23:20");
    await t.services.dailySummary.tick();
    await t.services.dailySummary.tick();
    expect(emailSender).toHaveBeenCalledTimes(1);
    const [to, subject, text] = emailSender.mock.calls[0] as unknown as [string, string, string];
    expect(to).toBe("gerente@example.com");
    expect(subject).toContain("resumo do dia 13/10/2026");
    expect(text).toContain("Vendas: *360 MT*");
    expect(text).toContain("1. Sumo natural — 2×");
    expect(t.services.dailySummary.status().recent[0]).toMatchObject({ day: "2026-10-13", status: "sent", channels: "email" });
  });

  it("does nothing while disabled, and records when no channel is configured", async () => {
    let clock = at("2026-10-13", "23:30");
    const t = await makeTestContext({ now: () => clock, emailSender: null });
    await t.services.dailySummary.tick();
    expect(t.services.dailySummary.status().recent).toEqual([]);
    enable(t, { managerEmail: "gerente@example.com" });
    await t.services.dailySummary.tick();
    await t.services.dailySummary.tick();
    const recent = t.services.dailySummary.status().recent;
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ status: "skipped", attempts: 1 });
    clock = at("2026-10-14", "08:00");
    expect(t.services.dailySummary.status().channels).toEqual({ email: false, whatsapp: false });
  });

  it("retries a failed send up to three times automatically", async () => {
    const clock = at("2026-10-13", "23:30");
    const emailSender = vi.fn(async () => {
      throw new Error("SMTP connection refused");
    });
    const t = await makeTestContext({ now: () => clock, emailSender });
    enable(t, { managerEmail: "gerente@example.com" });
    for (let i = 0; i < 5; i++) await t.services.dailySummary.tick();
    expect(emailSender).toHaveBeenCalledTimes(3);
    expect(t.services.dailySummary.status().recent[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(t.services.dailySummary.status().recent[0]!.lastError).toContain("SMTP connection refused");
  });

  it("can use a WhatsApp Business template (mocked API)", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.SUM" }] }), { status: 200 }));
    const t = await makeTestContext({
      now: () => at("2026-10-13", "23:30"),
      emailSender: null,
      fetchImpl: fetchMock,
      env: {
        WHATSAPP_MODE: "cloud_api",
        WHATSAPP_CLOUD_API_TOKEN: "test-token",
        WHATSAPP_PHONE_NUMBER_ID: "123",
        WHATSAPP_TEMPLATE_NAME: "novo_pedido",
        WHATSAPP_SUMMARY_TEMPLATE_NAME: "resumo_diario",
      },
    });
    enable(t, { managerWhatsapp: "258840000001" });
    await t.services.dailySummary.tick();
    const payload = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(payload).toMatchObject({ to: "258840000001", template: { name: "resumo_diario" } });
    const params = payload.template.components[0].parameters.map((p: { text: string }) => p.text);
    expect(params[0]).toBe("13/10/2026");
    expect(params[1]).not.toMatch(/\n/);
    expect(t.services.dailySummary.status().recent[0]!.channels).toBe("whatsapp");
  });

  it("lets an admin send a day's summary now", async () => {
    const emailSender = vi.fn(async () => undefined);
    const t = await makeTestContext({ emailSender });
    enable(t, { managerEmail: "gerente@example.com" });
    const admin = await t.login("admin@test.local");
    const res = await t.request("/api/admin/reports/daily-summary/send", { method: "POST", cookie: admin, body: JSON.stringify({ day: "2026-10-12" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as DailySummaryStatusDto).recent[0]).toMatchObject({ day: "2026-10-12", status: "sent" });
    const reception = await t.login("reception@test.local");
    expect((await t.request("/api/admin/reports/daily-summary", { cookie: reception })).status).toBe(403);
  });

  it("summarises an empty day honestly", () => {
    const empty = {
      from: "2026-10-13",
      to: "2026-10-13",
      previousFrom: "2026-10-12",
      previousTo: "2026-10-12",
      kpis: { ordersReceived: 0, ordersSold: 0, ordersCompleted: 0, ordersCancelled: 0, ordersPending: 0, revenueCents: 0, avgTicketCents: 0, itemsSold: 0, depositsConfirmedCents: 0, scheduledOrders: 0, avgMinutesToConfirm: null, avgMinutesToComplete: null },
      daily: [],
      hourly: [],
      topItems: [],
      categories: [],
      topOptions: [],
      byLocation: [],
      staff: [],
      unsoldItems: [],
      weekday: [],
      customers: { withPhone: 0, returning: 0, top: [] },
    };
    const text = buildDailySummary({ ...empty, previous: empty.kpis }, { hotelName: "Nelson's Place", currencySymbol: "MT" });
    expect(text).toContain("Resumo do dia 13/10/2026");
    expect(text).toContain("Sem pedidos neste período.");
  });
});
