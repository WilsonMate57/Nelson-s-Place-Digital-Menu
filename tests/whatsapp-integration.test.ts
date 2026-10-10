import { describe, expect, it, vi } from "vitest";
import type { AdminOrderDetailDto, GuestOrderDto } from "../src/shared/types";
import type { FetchLike } from "../src/server/whatsapp/cloud-api";
import { buildSubmission, makeTestContext, productByName, type TestContext } from "./helpers";

/**
 * WhatsApp forwarding. The Cloud API is MOCKED here (no credentials exist);
 * these tests prove our handling of success/failure, not delivery by Meta.
 */

const CLOUD_ENV = {
  WHATSAPP_MODE: "cloud_api",
  WHATSAPP_CLOUD_API_TOKEN: "test-token-not-real",
  WHATSAPP_PHONE_NUMBER_ID: "1234567890",
  WHATSAPP_TEMPLATE_NAME: "novo_pedido",
};

function configureNumber(t: TestContext, number = "258840000000") {
  const { currency: _c, ...settings } = t.services.settingsRepo.get();
  t.services.settingsRepo.save({ ...settings, whatsappNumber: number }, null);
}

async function submit(t: TestContext): Promise<GuestOrderDto> {
  const juice = productByName(await t.menu(), "Sumo natural");
  const res = await t.request("/api/orders", {
    method: "POST",
    body: JSON.stringify(buildSubmission({ items: [{ productId: juice.id, quantity: 1, optionIds: [] }] })),
  });
  return (await res.json()) as GuestOrderDto;
}

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("link mode (default)", () => {
  it("returns a wa.me link built from the stored order when a number is configured", async () => {
    const t = await makeTestContext();
    configureNumber(t);
    const order = await submit(t);
    expect(order.whatsapp.mode).toBe("link");
    expect(order.whatsapp.status).toBe("link_ready");
    expect(order.whatsapp.url).toMatch(/^https:\/\/wa\.me\/258840000000\?text=/);
    const text = decodeURIComponent(order.whatsapp.url!.split("text=")[1]!);
    expect(text).toContain(order.reference);
    expect(text).toContain("Sumo natural");
  });

  it("records that the guest opened the link without claiming it was sent", async () => {
    const t = await makeTestContext();
    configureNumber(t);
    const order = await submit(t);
    const res = await t.request(`/api/orders/track/${order.publicToken}/whatsapp-opened`, { method: "POST" });
    expect(res.status).toBe(204);
    const id = t.services.ordersRepo.list({ status: "ALL", limit: 1 })[0]!.id;
    expect(t.services.whatsapp.status(id)).toBe("link_opened");
  });

  it("still persists the order when no WhatsApp number is configured", async () => {
    const t = await makeTestContext();
    const order = await submit(t);
    expect(order.whatsapp.url).toBeNull();
    expect(order.whatsapp.status).toBe("not_configured");
    expect(t.services.ordersRepo.list({ status: "ALL", limit: 5 })).toHaveLength(1);
  });

  it("gives staff the message text to copy/forward", async () => {
    const t = await makeTestContext();
    await submit(t);
    const cookie = await t.login("reception@test.local");
    const id = t.services.ordersRepo.list({ status: "ALL", limit: 1 })[0]!.id;
    const res = await t.request(`/api/admin/orders/${id}/whatsapp`, { cookie });
    const body = (await res.json()) as { text: string; shareUrl: string };
    expect(body.text).toContain("Novo pedido");
    expect(body.shareUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });
});

describe("cloud_api mode (mocked HTTP)", () => {
  it("sends a template message once and records success", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.TEST" }] }), { status: 200 }));
    const t = await makeTestContext({ env: CLOUD_ENV, fetchImpl: fetchMock });
    configureNumber(t);
    await submit(t);
    const id = t.services.ordersRepo.list({ status: "ALL", limit: 1 })[0]!.id;
    await waitFor(() => t.services.whatsapp.status(id) === "sent");

    expect(t.services.whatsapp.status(id)).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    const payload = JSON.parse(init.body as string);
    expect(payload).toMatchObject({ messaging_product: "whatsapp", to: "258840000000", type: "template", template: { name: "novo_pedido" } });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token-not-real");

    // A second delivery call must not send again.
    await t.services.whatsapp.deliver(id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the order and records a sanitised error when the API fails; staff can retry", async () => {
    let fail = true;
    const fetchMock = vi.fn<FetchLike>(async () =>
      fail
        ? new Response(JSON.stringify({ error: { code: 131030, message: "Recipient not in allowed list" } }), { status: 400 })
        : new Response(JSON.stringify({ messages: [{ id: "wamid.RETRY" }] }), { status: 200 }),
    );
    const t = await makeTestContext({ env: CLOUD_ENV, fetchImpl: fetchMock });
    configureNumber(t);
    const order = await submit(t);
    const id = t.services.ordersRepo.list({ status: "ALL", limit: 1 })[0]!.id;
    await waitFor(() => t.services.whatsapp.status(id) === "failed");

    expect(order.status).toBe("PENDING");
    const cookie = await t.login("reception@test.local");
    let detail = (await (await t.request(`/api/admin/orders/${id}`, { cookie })).json()) as AdminOrderDetailDto;
    expect(detail.integrations[0]!.status).toBe("failed");
    expect(detail.integrations[0]!.lastError).toContain("131030");
    expect(detail.integrations[0]!.lastError).not.toContain("test-token-not-real");

    fail = false;
    const retry = await t.request(`/api/admin/orders/${id}/whatsapp/retry`, { method: "POST", cookie });
    expect(retry.status).toBe(200);
    detail = (await retry.json()) as AdminOrderDetailDto;
    expect(detail.integrations[0]!.status).toBe("sent");
    expect(detail.integrations[0]!.attempts).toBe(2);
    expect((t.services.db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n).toBe(1);

    const again = await t.request(`/api/admin/orders/${id}/whatsapp/retry`, { method: "POST", cookie });
    expect(again.status).toBe(409);
  });

  it("handles network errors without crashing", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    });
    const t = await makeTestContext({ env: CLOUD_ENV, fetchImpl: fetchMock });
    configureNumber(t);
    await submit(t);
    const id = t.services.ordersRepo.list({ status: "ALL", limit: 1 })[0]!.id;
    await waitFor(() => t.services.whatsapp.status(id) === "failed");
    expect(t.services.whatsapp.status(id)).toBe("failed");
  });

  it("refuses to start without the required credentials", async () => {
    await expect(makeTestContext({ env: { WHATSAPP_MODE: "cloud_api" } })).rejects.toThrow(/requires/);
  });
});
