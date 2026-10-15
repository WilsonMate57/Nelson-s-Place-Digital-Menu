import { describe, expect, it } from "vitest";
import { PricingError, effectivePriceCents, priceOrder } from "../src/shared/pricing";
import type { ProductDto } from "../src/shared/types";
import { formatMoney, parseAmountToCents } from "../src/shared/money";

const chicken: ProductDto = {
  id: 1,
  categoryId: 1,
  name: { pt: "Frango", en: "Chicken" },
  description: null,
  imageUrl: null,
  priceCents: 65000,
  promo: null,
  isFeatured: false,
  featuredLabel: null,
  currency: "MZN",
  isAvailable: true,
  stockQty: null,
  sortOrder: 0,
  optionGroups: [
    {
      id: 10,
      name: { pt: "Acompanhamento" },
      minSelect: 1,
      maxSelect: 1,
      sortOrder: 0,
      options: [
        { id: 100, name: { pt: "Arroz" }, priceDeltaCents: 0, isAvailable: true, sortOrder: 0 },
        { id: 101, name: { pt: "Batata" }, priceDeltaCents: 0, isAvailable: false, sortOrder: 1 },
      ],
    },
    {
      id: 11,
      name: { pt: "Extras" },
      minSelect: 0,
      maxSelect: 2,
      sortOrder: 1,
      options: [
        { id: 110, name: { pt: "Molho" }, priceDeltaCents: 5000, isAvailable: true, sortOrder: 0 },
        { id: 111, name: { pt: "Queijo" }, priceDeltaCents: 7550, isAvailable: true, sortOrder: 1 },
      ],
    },
  ],
};
const juice: ProductDto = { ...chicken, id: 2, name: { pt: "Sumo" }, priceCents: 18000, optionGroups: [] };
const soldOut: ProductDto = { ...juice, id: 3, isAvailable: false };
const catalogue = new Map([chicken, juice, soldOut].map((p) => [p.id, p]));

describe("priceOrder", () => {
  it("computes line and order totals from catalogue prices, including option surcharges", () => {
    const result = priceOrder(
      [
        { productId: 1, quantity: 2, optionIds: [100, 110, 111] },
        { productId: 2, quantity: 3, optionIds: [] },
      ],
      catalogue,
      [],
      "pt",
    );
    expect(result.lines[0]!.unitPriceCents).toBe(65000 + 5000 + 7550);
    expect(result.lines[0]!.lineTotalCents).toBe(2 * 77550);
    expect(result.lines[1]!.lineTotalCents).toBe(54000);
    expect(result.subtotalCents).toBe(155100 + 54000);
    expect(result.totalCents).toBe(result.subtotalCents);
    expect(result.lines[0]!.options.map((o) => o.name)).toEqual(["Arroz", "Molho", "Queijo"]);
  });

  it("applies configured percentage and fixed charges", () => {
    const result = priceOrder([{ productId: 2, quantity: 1, optionIds: [] }], catalogue, [
      { id: "service", label: { pt: "Serviço" }, kind: "percent", value: 10 },
      { id: "delivery", label: { pt: "Entrega" }, kind: "fixed", value: 5000 },
    ], "pt");
    expect(result.charges).toEqual([
      { id: "service", label: "Serviço", amountCents: 1800 },
      { id: "delivery", label: "Entrega", amountCents: 5000 },
    ]);
    expect(result.totalCents).toBe(18000 + 1800 + 5000);
  });

  it.each([
    ["unknown product", [{ productId: 99, quantity: 1, optionIds: [] }], "PRODUCT_NOT_FOUND"],
    ["unavailable product", [{ productId: 3, quantity: 1, optionIds: [] }], "PRODUCT_UNAVAILABLE"],
    ["missing required option", [{ productId: 1, quantity: 1, optionIds: [] }], "OPTION_SELECTION_COUNT"],
    ["too many in single-choice group", [{ productId: 1, quantity: 1, optionIds: [100, 101] }], "OPTION_SELECTION_COUNT"],
    ["unavailable option", [{ productId: 1, quantity: 1, optionIds: [101] }], "OPTION_UNAVAILABLE"],
    ["option of another product", [{ productId: 2, quantity: 1, optionIds: [100] }], "OPTION_INVALID"],
    ["duplicate option", [{ productId: 1, quantity: 1, optionIds: [100, 110, 110] }], "OPTION_DUPLICATE"],
  ] as const)("rejects %s", (_label, lines, code) => {
    expect(() => priceOrder([...lines].map((l) => ({ ...l, optionIds: [...l.optionIds] })), catalogue, [], "pt")).toThrowError(
      expect.objectContaining({ code }) as unknown as PricingError,
    );
  });
});

describe("promotional prices", () => {
  // 2026-10-13 17:30 in Maputo (UTC+2).
  const at = (iso: string) => new Date(iso);
  const happyHour: ProductDto = {
    ...juice,
    id: 4,
    promo: { priceCents: 12000, fromDate: "2026-10-01", untilDate: "2026-10-31", fromTime: "17:00", untilTime: "19:00" },
  };
  const promoCatalogue = new Map([[4, happyHour]]);
  const unitAt = (iso: string) => priceOrder([{ productId: 4, quantity: 1, optionIds: [] }], promoCatalogue, [], "pt", at(iso)).lines[0]!.unitPriceCents;

  it("charges the promotional price only within its dates and daily hours (hotel time)", () => {
    expect(unitAt("2026-10-13T15:30:00Z")).toBe(12000); // 17:30 local
    expect(unitAt("2026-10-13T14:59:00Z")).toBe(18000); // 16:59 local
    expect(unitAt("2026-10-13T17:00:00Z")).toBe(18000); // 19:00 local: window has ended
    expect(unitAt("2026-11-01T15:30:00Z")).toBe(18000); // after the last day
    expect(effectivePriceCents({ priceCents: 18000, promo: { ...happyHour.promo!, fromTime: null, untilTime: null } }, at("2026-10-13T08:00:00Z"))).toBe(12000);
    expect(effectivePriceCents({ priceCents: 18000, promo: null }, at("2026-10-13T08:00:00Z"))).toBe(18000);
  });
});

describe("money", () => {
  it("formats centavos in meticais", () => {
    expect(formatMoney(65000, { symbol: "MT" }).replace(/\s/g, " ")).toBe("650 MT");
    expect(formatMoney(150050, { symbol: "MT" }).replace(/\s/g, " ")).toMatch(/^1.?500,50 MT$/);
  });
  it("parses user-entered amounts", () => {
    expect(parseAmountToCents("250")).toBe(25000);
    expect(parseAmountToCents("250,5")).toBe(25050);
    expect(parseAmountToCents("12.75")).toBe(1275);
    expect(parseAmountToCents("-3")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
  });
});
