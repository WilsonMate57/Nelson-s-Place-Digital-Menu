import { describe, expect, it } from "vitest";
import type { ChatThreadDto, GuestOrderDto, OrderListResponse } from "../src/shared/types";
import { buildSubmission, makeTestContext, productByName, TEST_NOW } from "./helpers";

async function setup() {
  let clock = TEST_NOW;
  const t = await makeTestContext({ now: () => clock });
  const juice = productByName(await t.menu(), "Sumo natural");
  const res = await t.request("/api/orders", {
    method: "POST",
    body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })),
  });
  const order = (await res.json()) as GuestOrderDto;
  const id = t.services.ordersRepo.list({ status: "ALL", limit: 1 })[0]!.id;
  const staff = await t.login("reception@test.local");
  const guestUrl = `/api/orders/track/${order.publicToken}/messages`;
  return { t, id, staff, guestUrl, setClock: (d: Date) => void (clock = d) };
}

describe("chat between guest and staff", () => {
  it("delivers messages both ways, tracks unread and hides staff names from guests", async () => {
    const { t, id, staff, guestUrl } = await setup();
    const sent = await t.request(guestUrl, { method: "POST", body: JSON.stringify({ body: "Quanto tempo falta?" }) });
    expect(sent.status).toBe(201);

    let list = (await (await t.request("/api/admin/orders", { cookie: staff })).json()) as OrderListResponse;
    expect(list.unreadMessagesTotal).toBe(1);
    expect(list.orders[0]!.unreadMessages).toBe(1);

    // Opening the thread marks the guest's message as read.
    const thread = (await (await t.request(`/api/admin/orders/${id}/messages`, { cookie: staff })).json()) as ChatThreadDto;
    expect(thread.messages.map((m) => [m.sender, m.body])).toEqual([["guest", "Quanto tempo falta?"]]);
    list = (await (await t.request("/api/admin/orders", { cookie: staff })).json()) as OrderListResponse;
    expect(list.unreadMessagesTotal).toBe(0);

    const reply = await t.request(`/api/admin/orders/${id}/messages`, { method: "POST", cookie: staff, body: JSON.stringify({ body: "Cerca de 15 minutos." }) });
    expect(reply.status).toBe(201);
    expect(((await reply.json()) as ChatThreadDto).messages[1]!.authorName).toBe("Recepção");

    const guestView = (await (await t.request(guestUrl)).json()) as ChatThreadDto;
    expect(guestView.open).toBe(true);
    expect(guestView.messages[1]).toMatchObject({ sender: "staff", body: "Cerca de 15 minutos.", authorName: null });
    expect(guestView.messages[0]!.read).toBe(true);
    expect(t.services.auditRepo.recent(5).map((a) => a.action)).toContain("chat_reply");
  });

  it("rejects empty or oversized messages and unknown orders", async () => {
    const { t, guestUrl } = await setup();
    expect((await t.request(guestUrl, { method: "POST", body: JSON.stringify({ body: "   " }) })).status).toBe(400);
    expect((await t.request(guestUrl, { method: "POST", body: JSON.stringify({ body: "x".repeat(501) }) })).status).toBe(400);
    expect((await t.request(`/api/orders/track/${"y".repeat(24)}/messages`)).status).toBe(404);
  });

  it("requires a staff session on the dashboard side", async () => {
    const { t, id } = await setup();
    expect((await t.request(`/api/admin/orders/${id}/messages`)).status).toBe(401);
  });

  it("limits bursts of guest messages", async () => {
    const { t, guestUrl } = await setup();
    const statuses: number[] = [];
    for (let i = 0; i < 16; i++) {
      statuses.push((await t.request(guestUrl, { method: "POST", body: JSON.stringify({ body: `msg ${i}` }) })).status);
    }
    expect(statuses.slice(0, 15).every((s) => s === 201)).toBe(true);
    expect(statuses[15]).toBe(429);
  });

  it("closes the conversation 24 hours after the order is finished", async () => {
    const { t, id, staff, guestUrl, setClock } = await setup();
    await t.request(`/api/admin/orders/${id}/status`, { method: "POST", cookie: staff, body: JSON.stringify({ to: "CANCELLED", expectedStatus: "PENDING" }) });
    expect((await t.request(guestUrl, { method: "POST", body: JSON.stringify({ body: "Porquê?" }) })).status).toBe(201);
    setClock(new Date(TEST_NOW.getTime() + 25 * 3600_000));
    const late = await t.request(guestUrl, { method: "POST", body: JSON.stringify({ body: "Olá?" }) });
    expect(late.status).toBe(409);
    expect(((await (await t.request(guestUrl)).json()) as ChatThreadDto).open).toBe(false);
  });
});
