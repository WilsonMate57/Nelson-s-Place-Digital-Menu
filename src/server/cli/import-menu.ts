/**
 * Imports a menu from a JSON file (see menu-import/menu-nelsons-place.json)
 * into an EMPTY database. Prices in the file are in meticais; they are
 * stored as centavos. Every product is validated with the same schema the
 * dashboard uses.
 *
 *   npm run db:import-menu -- --file menu-import/menu-nelsons-place.json
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { categoryInputSchema, productInputSchema, type ProductInput } from "../../shared/schemas";
import { loadConfig } from "../config";
import { openDatabase, type Db } from "../db/connection";
import { MenuRepo } from "../repositories/menu-repo";

const text = z.object({ pt: z.string().min(1), en: z.string().optional() });
/** [pt, en, extra price in MT] */
const optionTuple = z.union([z.tuple([z.string(), z.string()]), z.tuple([z.string(), z.string(), z.number().min(0)])]);
const groupDef = z.object({ name: text, required: z.boolean(), maxSelect: z.number().int().min(1).optional(), options: z.array(optionTuple).min(1) });
const groupRef = z.union([z.object({ preset: z.string() }), groupDef]);

export const menuFileSchema = z.object({
  source: z.string().optional(),
  presets: z.record(z.string(), groupDef).default({}),
  categories: z.array(
    z.object({
      key: z.string(),
      name: text,
      description: text.optional(),
      products: z.array(
        z.object({
          name: text,
          description: text.optional(),
          price: z.number().min(0),
          isAvailable: z.boolean().optional(),
          optionGroups: z.array(groupRef).optional(),
        }),
      ),
    }),
  ),
});
export type MenuFile = z.infer<typeof menuFileSchema>;

const toCents = (mt: number) => Math.round(mt * 100);

export function importMenu(db: Db, file: MenuFile): { categories: number; products: number } {
  const menu = new MenuRepo(db);
  const existing = (db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number }).n;
  if (existing > 0) throw new Error("The menu is not empty; import only works on an empty menu.");

  let products = 0;
  db.transaction(() => {
    file.categories.forEach((category, ci) => {
      const categoryId = menu.createCategory(
        categoryInputSchema.parse({ name: category.name, description: category.description ?? null, sortOrder: ci + 1, isActive: true }),
      );
      category.products.forEach((product, pi) => {
        const optionGroups = (product.optionGroups ?? []).map((ref) => {
          const group = "preset" in ref ? file.presets[ref.preset] : ref;
          if (!group) throw new Error(`Unknown preset "${(ref as { preset: string }).preset}" in ${product.name.pt}`);
          return {
            name: group.name,
            minSelect: group.required ? 1 : 0,
            maxSelect: group.maxSelect ?? 1,
            options: group.options.map(([pt, en, extra]) => ({ name: { pt, en }, priceDeltaCents: toCents(extra ?? 0), isAvailable: true })),
          };
        });
        const input: ProductInput = productInputSchema.parse({
          categoryId,
          name: product.name,
          description: product.description ?? null,
          priceCents: toCents(product.price),
          isAvailable: product.isAvailable ?? true,
          sortOrder: pi + 1,
          optionGroups,
        });
        menu.createProduct(input);
        products++;
      });
    });
  })();
  return { categories: file.categories.length, products };
}

function main() {
  const { values } = parseArgs({ options: { file: { type: "string" } } });
  if (!values.file) {
    console.error("Usage: npm run db:import-menu -- --file menu-import/menu-nelsons-place.json");
    process.exit(1);
  }
  const file = menuFileSchema.parse(JSON.parse(readFileSync(values.file, "utf8")));
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  try {
    const result = importMenu(db, file);
    console.log(`Imported ${result.categories} categories and ${result.products} products into ${config.databasePath}.`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] && /import-menu\.(ts|js|mjs)$/.test(process.argv[1])) main();
