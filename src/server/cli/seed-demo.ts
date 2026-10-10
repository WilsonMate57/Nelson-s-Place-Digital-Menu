/**
 * Loads DEMONSTRATION menu data (from the original prototype) into an empty
 * database so the interface can be explored. Names, prices and options are
 * placeholders, NOT the hotel's real menu. No photographs are included.
 *
 *   npm run db:seed-demo            (refuses if the menu is not empty)
 *   npm run db:seed-demo -- --force-production   (required when NODE_ENV=production)
 */
import { parseArgs } from "node:util";
import { loadConfig } from "../config";
import { openDatabase, type Db } from "../db/connection";
import { MenuRepo } from "../repositories/menu-repo";
import { productInputSchema, categoryInputSchema } from "../../shared/schemas";

const DEMO_NOTE = { pt: "Artigo de demonstração.", en: "Demo item." };

export function seedDemoMenu(db: Db): void {
  const menu = new MenuRepo(db);
  const cat = (name: Record<string, string>, sortOrder: number) =>
    menu.createCategory(categoryInputSchema.parse({ name, sortOrder, isActive: true }));

  const starters = cat({ pt: "Entradas", en: "Starters", fr: "Entrées", es: "Entrantes" }, 1);
  const mains = cat({ pt: "Pratos principais", en: "Main courses", fr: "Plats principaux", es: "Platos principales" }, 2);
  const drinks = cat({ pt: "Bebidas", en: "Drinks", fr: "Boissons", es: "Bebidas" }, 3);
  const desserts = cat({ pt: "Sobremesas", en: "Desserts", fr: "Desserts", es: "Postres" }, 4);

  const product = (input: unknown) => menu.createProduct(productInputSchema.parse(input));

  product({
    categoryId: starters,
    name: { pt: "Sopa do dia", en: "Soup of the day", fr: "Soupe du jour", es: "Sopa del día" },
    description: { pt: `Consulte a equipa para conhecer a sopa disponível. ${DEMO_NOTE.pt}`, en: `Ask our team about today's soup. ${DEMO_NOTE.en}` },
    priceCents: 25000,
    sortOrder: 1,
  });
  product({
    categoryId: mains,
    name: { pt: "Frango grelhado", en: "Grilled chicken", fr: "Poulet grillé", es: "Pollo a la parrilla" },
    description: { pt: `Confirmar acompanhamentos e ingredientes. ${DEMO_NOTE.pt}`, en: `Confirm sides and ingredients. ${DEMO_NOTE.en}` },
    priceCents: 65000,
    sortOrder: 1,
    optionGroups: [
      {
        name: { pt: "Acompanhamento", en: "Side" },
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: { pt: "Batata frita", en: "Chips" }, priceDeltaCents: 0 },
          { name: { pt: "Arroz", en: "Rice" }, priceDeltaCents: 0 },
          { name: { pt: "Salada", en: "Salad" }, priceDeltaCents: 0 },
        ],
      },
      {
        name: { pt: "Extras", en: "Extras" },
        minSelect: 0,
        maxSelect: 2,
        options: [
          { name: { pt: "Molho extra", en: "Extra sauce" }, priceDeltaCents: 5000 },
          { name: { pt: "Sem cebola", en: "No onion" }, priceDeltaCents: 0 },
        ],
      },
    ],
  });
  product({
    categoryId: drinks,
    name: { pt: "Sumo natural", en: "Fresh juice", fr: "Jus frais", es: "Zumo natural" },
    description: { pt: `Sabor sujeito à disponibilidade. ${DEMO_NOTE.pt}`, en: `Flavour subject to availability. ${DEMO_NOTE.en}` },
    priceCents: 18000,
    sortOrder: 1,
  });
  product({
    categoryId: drinks,
    name: { pt: "Água mineral", en: "Mineral water" },
    description: { pt: DEMO_NOTE.pt, en: DEMO_NOTE.en },
    priceCents: 8000,
    sortOrder: 2,
    isAvailable: false,
  });
  product({
    categoryId: desserts,
    name: { pt: "Fatia de bolo", en: "Slice of cake", fr: "Part de gâteau", es: "Porción de tarta" },
    description: { pt: `Confirmar variedade do dia. ${DEMO_NOTE.pt}`, en: `Confirm today's selection. ${DEMO_NOTE.en}` },
    priceCents: 22000,
    sortOrder: 1,
  });
}

function main() {
  const { values } = parseArgs({ options: { "force-production": { type: "boolean", default: false } } });
  const config = loadConfig();
  if (config.env === "production" && !values["force-production"]) {
    console.error("Refusing to load demo data in production. Pass --force-production if you really mean it.");
    process.exit(1);
  }
  const db = openDatabase(config.databasePath);
  const count = (db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number }).n;
  if (count > 0) {
    console.error("The menu already has categories; demo data was not loaded.");
    process.exit(1);
  }
  db.transaction(() => seedDemoMenu(db))();
  db.close();
  console.log(`Demo menu loaded into ${config.databasePath}. Replace it with the hotel's approved menu before going live.`);
}

if (process.argv[1] && /seed-demo\.(ts|js|mjs)$/.test(process.argv[1])) main();
