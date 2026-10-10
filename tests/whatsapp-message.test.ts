import { describe, expect, it } from "vitest";
import { buildOrderMessage, buildWhatsAppLink } from "../src/shared/whatsapp-message";
import { sanitiseTemplateParam, templateParameters } from "../src/server/whatsapp/cloud-api";
import type { OrderDto } from "../src/shared/types";

const order: OrderDto = {
  id: 7,
  reference: "NP-261009-K7Q4",
  status: "PENDING",
  locationType: "room",
  locationLabel: "12",
  guestName: "Ana Machava",
  contactPhone: "+258 84 000 0000",
  notes: "Sem gelo, por favor",
  language: "en",
  currency: "MZN",
  subtotalCents: 148000,
  chargesCents: 0,
  charges: [],
  totalCents: 148000,
  // 10:30 UTC = 12:30 in Maputo (UTC+2)
  createdAt: "2026-10-09T10:30:00.000Z",
  updatedAt: "2026-10-09T10:30:00.000Z",
  items: [
    {
      id: 1,
      productId: 2,
      productName: "Frango grelhado",
      unitPriceCents: 70000,
      quantity: 2,
      options: [
        { optionId: 1, groupName: "Acompanhamento", name: "Arroz", priceDeltaCents: 0 },
        { optionId: 2, groupName: "Extras", name: "Molho extra", priceDeltaCents: 5000 },
      ],
      notes: "Bem passado",
      lineTotalCents: 140000,
    },
    { id: 2, productId: 3, productName: "Água", unitPriceCents: 8000, quantity: 1, options: [], notes: null, lineTotalCents: 8000 },
  ],
};

describe("buildOrderMessage", () => {
  const text = buildOrderMessage(order, { hotelName: "Nelson's Place Apart Hotel", currencySymbol: "MT" }).replace(/[^\S\n]/g, " ");

  it("contains hotel, reference, Maputo time, location, guest and status", () => {
    expect(text).toContain("Nelson's Place Apart Hotel");
    expect(text).toContain("NP-261009-K7Q4");
    expect(text).toContain("09/10/2026");
    expect(text).toContain("12:30");
    expect(text).toContain("Apartamento: 12");
    expect(text).toContain("Hóspede: Ana Machava");
    expect(text).toContain("Contacto: +258 84 000 0000");
    expect(text).toContain("Estado: Pendente");
  });

  it("lists every item with quantity, options, notes and totals", () => {
    expect(text).toMatch(/2 × Frango grelhado — 1.?400 MT/);
    expect(text).toContain("Acompanhamento: Arroz");
    expect(text).toContain("Extras: Molho extra (+50 MT)");
    expect(text).toContain("✎ Bem passado");
    expect(text).toContain("1 × Água — 80 MT");
    expect(text).toMatch(/Total: 1.?480 MT/);
    expect(text).toContain("Observações: Sem gelo, por favor");
  });

  it("encodes the message in a wa.me link with the configured number", () => {
    const link = buildWhatsAppLink("258840000000", "Olá & adeus");
    expect(link).toBe("https://wa.me/258840000000?text=Ol%C3%A1%20%26%20adeus");
    expect(buildWhatsAppLink(null, "x")).toBe("https://wa.me/?text=x");
  });
});

describe("Cloud API template parameters", () => {
  it("never contain newlines, tabs or long runs of spaces", () => {
    expect(sanitiseTemplateParam("a\nb\t\tc     d")).toBe("a · b · c d");
    for (const param of templateParameters({ ...order, notes: "linha 1\nlinha 2" }, "MT", "https://x.test/admin/#/orders/7")) {
      expect(param).not.toMatch(/[\n\t]| {5,}/);
    }
  });

  it("include reference, location, items and total in order", () => {
    const [ref, location, items, total] = templateParameters(order, "MT", null);
    expect(ref).toBe("NP-261009-K7Q4");
    expect(location).toBe("Apartamento 12 — Ana Machava");
    expect(items).toBe("2× Frango grelhado (Arroz, Molho extra); 1× Água");
    expect(total!.replace(/\s/g, " ")).toMatch(/1.?480 MT/);
  });
});
