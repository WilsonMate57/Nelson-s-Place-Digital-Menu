import { describe, expect, it } from "vitest";
import type { GuestServiceRequestDto, ServiceRequestDto } from "../src/shared/types";
import { makeTestContext, type TestContext } from "./helpers";

const call = (t: TestContext, body: unknown) => t.request("/api/service-requests", { method: "POST", body: JSON.stringify(body) });

describe("calling the waiter / asking for the bill", () => {
  it("notifies staff, does not duplicate repeated calls, and shows the guest when it is handled", async () => {
    const t = await makeTestContext();
    const first = await call(t, { kind: "bill", location: { type: "table", label: "4" }, paymentMethod: "card" });
    expect(first.status).toBe(201);
    const guest = (await first.json()) as GuestServiceRequestDto;
    expect(guest).toMatchObject({ kind: "bill", status: "open" });

    // Tapping again from the same table returns the same open call.
    const again = await call(t, { kind: "bill", location: { type: "table", label: "4" }, paymentMethod: "card" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as GuestServiceRequestDto).token).toBe(guest.token);
    expect((await call(t, { kind: "waiter", location: { type: "room", label: "12" } })).status).toBe(201);

    const reception = await t.login("reception@test.local");
    const open = (await (await t.request("/api/admin/service-requests", { cookie: reception })).json()) as ServiceRequestDto[];
    expect(open.map((r) => [r.kind, r.locationLabel, r.paymentMethod])).toEqual([
      ["bill", "4", "card"],
      ["waiter", "12", null],
    ]);

    const done = await t.request(`/api/admin/service-requests/${open[0]!.id}/done`, { method: "POST", cookie: reception });
    expect(done.status).toBe(200);
    expect(((await done.json()) as ServiceRequestDto).handledByName).toBe("Recepção");
    expect((await t.request(`/api/admin/service-requests/${open[0]!.id}/done`, { method: "POST", cookie: reception })).status).toBe(409);
    expect(((await (await t.request(`/api/service-requests/${guest.token}`)).json()) as GuestServiceRequestDto).status).toBe("done");
    expect(((await (await t.request("/api/admin/service-requests", { cookie: reception })).json()) as ServiceRequestDto[])).toHaveLength(1);
  });

  it("validates the place, and can be switched off in the settings", async () => {
    const t = await makeTestContext();
    expect((await call(t, { kind: "waiter", location: { type: "table", label: "" } })).status).toBe(400);
    expect((await call(t, { kind: "waiter", location: { type: "table", label: "<script>" } })).status).toBe(400);
    expect((await call(t, { kind: "dance", location: { type: "table", label: "1" } })).status).toBe(400);
    expect((await t.request("/api/service-requests/not-a-valid-token")).status).toBe(404);

    const { currency: _c, ...current } = t.services.settingsRepo.get();
    t.services.settingsRepo.save({ ...current, serviceRequestsEnabled: false }, null);
    expect((await (await t.request("/api/menu")).json()).settings.serviceRequestsEnabled).toBe(false);
    const res = await call(t, { kind: "waiter", location: { type: "table", label: "1" } });
    expect(res.status).toBe(503);
  });
});
