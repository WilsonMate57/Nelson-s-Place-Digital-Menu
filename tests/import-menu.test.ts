import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importMenu, menuFileSchema } from "../src/server/cli/import-menu";
import { openDatabase } from "../src/server/db/connection";
import { MenuRepo } from "../src/server/repositories/menu-repo";
import { priceOrder } from "../src/shared/pricing";

const file = menuFileSchema.parse(JSON.parse(readFileSync("menu-import/menu-nelsons-place.json", "utf8")));

describe("real menu import (menu-import/menu-nelsons-place.json)", () => {
  it("validates and imports every category and product", () => {
    const db = openDatabase(":memory:");
    const result = importMenu(db, file);
    const expected = file.categories.reduce((n, c) => n + c.products.length, 0);
    expect(result.products).toBe(expected);
    expect(new MenuRepo(db).listProducts({ includeArchived: false, activeCategoriesOnly: true })).toHaveLength(expected);
  });

  it("stores prices in centavos and size options as surcharges", () => {
    const db = openDatabase(":memory:");
    importMenu(db, file);
    const products = new MenuRepo(db).listProducts({ includeArchived: false, activeCategoriesOnly: true });
    const pork = products.find((p) => p.name.pt === "Costeletas de porco")!;
    expect(pork.priceCents).toBe(68000);
    const [size, side] = pork.optionGroups;
    const big = size!.options.find((o) => o.name.pt === "400 g")!;
    const total = priceOrder(
      [{ productId: pork.id, quantity: 1, optionIds: [big.id, side!.options[0]!.id] }],
      new Map([[pork.id, pork]]),
      [],
      "pt",
    );
    expect(total.totalCents).toBe(98000);
  });

  it("lets guests pick several sides and offers ice on drinks", () => {
    const db = openDatabase(":memory:");
    importMenu(db, file);
    const products = new MenuRepo(db).listProducts({ includeArchived: false, activeCategoriesOnly: true });
    const chicken = products.find((p) => p.name.pt === "Frango Nelson's Place")!;
    const sides = chicken.optionGroups.find((g) => g.name.pt === "Acompanhamento")!;
    expect(sides.minSelect).toBe(1);
    expect(sides.maxSelect).toBe(sides.options.length);
    const twoSides = priceOrder(
      [{ productId: chicken.id, quantity: 1, optionIds: sides.options.slice(0, 2).map((o) => o.id) }],
      new Map([[chicken.id, chicken]]),
      [],
      "pt",
    );
    expect(twoSides.totalCents).toBe(85000);

    const coke = products.find((p) => p.name.pt === "Coca-Cola")!;
    const ice = coke.optionGroups.find((g) => g.name.pt === "Gelo")!;
    expect(ice).toMatchObject({ minSelect: 0, maxSelect: 1 });
    expect(ice.options.map((o) => o.name.pt)).toEqual(["Com gelo"]);
    const beer = products.find((p) => p.name.pt === "Castle Lite")!;
    expect(beer.optionGroups).toHaveLength(0);
  });

  it("refuses to import into a menu that is not empty", () => {
    const db = openDatabase(":memory:");
    importMenu(db, file);
    expect(() => importMenu(db, file)).toThrow(/not empty/);
  });
});
