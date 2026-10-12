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

  it("refuses to import into a menu that is not empty", () => {
    const db = openDatabase(":memory:");
    importMenu(db, file);
    expect(() => importMenu(db, file)).toThrow(/not empty/);
  });
});
