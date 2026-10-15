import type { CategoryInput, ProductInput } from "../../shared/schemas";
import type {
  AdminCategoryDto,
  AdminProductDto,
  LocalizedText,
  OptionGroupDto,
  ProductDto,
  ProductPromo,
} from "../../shared/types";
import type { TimeWindow } from "../../shared/schedule";
import { nowIso, type Db } from "../db/connection";
import { badRequest, conflict, notFound } from "../http/errors";

interface CategoryRow {
  id: number;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: number;
  available_from: string | null;
  available_until: string | null;
  created_at: string;
  updated_at: string;
  product_count: number;
}

interface ProductRow {
  id: number;
  category_id: number;
  name: string;
  description: string | null;
  image_path: string | null;
  price_cents: number;
  currency: string;
  is_available: number;
  is_archived: number;
  stock_qty: number | null;
  is_featured: number;
  featured_label: string | null;
  promo_json: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface GroupRow {
  id: number;
  product_id: number;
  name: string;
  min_select: number;
  max_select: number;
  sort_order: number;
}

interface OptionRow {
  id: number;
  group_id: number;
  name: string;
  price_delta_cents: number;
  is_available: number;
  sort_order: number;
}

const parseText = (json: string) => JSON.parse(json) as LocalizedText;
const parseOptionalText = (json: string | null) => (json ? parseText(json) : null);
export const imageUrl = (path: string | null) => (path ? `/uploads/${path}` : null);

/** promo_json, is_featured, featured_label */
const promoColumns = (input: ProductInput): [string | null, number, string | null] => [
  input.promo ? JSON.stringify(input.promo) : null,
  input.isFeatured ? 1 : 0,
  input.featuredLabel ? JSON.stringify(input.featuredLabel) : null,
];

export interface ProductFilter {
  includeArchived: boolean;
  /** Only products whose category is active (guest view). */
  activeCategoriesOnly: boolean;
  ids?: number[];
}

export class MenuRepo {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  listCategories(includeInactive: boolean): AdminCategoryDto[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_archived = 0) AS product_count
         FROM categories c ${includeInactive ? "" : "WHERE c.is_active = 1"}
         ORDER BY c.sort_order, c.id`,
      )
      .all() as CategoryRow[];
    return rows.map((r) => ({
      id: r.id,
      name: parseText(r.name),
      description: parseOptionalText(r.description),
      sortOrder: r.sort_order,
      isActive: r.is_active === 1,
      availableFrom: r.available_from,
      availableUntil: r.available_until,
      productCount: r.product_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /** Availability windows of the given categories (only those that have one). */
  categoryWindows(categoryIds: number[]): Map<number, TimeWindow> {
    const unique = [...new Set(categoryIds)];
    if (unique.length === 0) return new Map();
    const rows = this.db
      .prepare(`SELECT id, available_from, available_until FROM categories WHERE id IN (${unique.map(() => "?").join(",")}) AND available_from IS NOT NULL`)
      .all(...unique) as { id: number; available_from: string; available_until: string }[];
    return new Map(rows.map((r) => [r.id, { from: r.available_from, until: r.available_until }]));
  }

  categoryExists(id: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM categories WHERE id = ?").get(id);
  }

  createCategory(input: CategoryInput): number {
    const now = nowIso();
    const result = this.db
      .prepare(
        `INSERT INTO categories (name, description, sort_order, is_active, available_from, available_until, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(JSON.stringify(input.name), input.description ? JSON.stringify(input.description) : null, input.sortOrder, input.isActive ? 1 : 0, input.availableFrom, input.availableUntil, now, now);
    return Number(result.lastInsertRowid);
  }

  updateCategory(id: number, input: CategoryInput): void {
    const result = this.db
      .prepare(
        `UPDATE categories SET name = ?, description = ?, sort_order = ?, is_active = ?, available_from = ?, available_until = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(input.name), input.description ? JSON.stringify(input.description) : null, input.sortOrder, input.isActive ? 1 : 0, input.availableFrom, input.availableUntil, nowIso(), id);
    if (result.changes === 0) throw notFound("Categoria não encontrada");
  }

  deleteCategory(id: number): void {
    const used = this.db.prepare("SELECT COUNT(*) AS n FROM products WHERE category_id = ?").get(id) as { n: number };
    if (used.n > 0) {
      throw conflict("CATEGORY_NOT_EMPTY", "A categoria tem produtos (incluindo arquivados). Desactive-a ou mova os produtos.");
    }
    const result = this.db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    if (result.changes === 0) throw notFound("Categoria não encontrada");
  }

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------

  listProducts(filter: ProductFilter): AdminProductDto[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeArchived) where.push("p.is_archived = 0");
    if (filter.activeCategoriesOnly) where.push("c.is_active = 1");
    if (filter.ids) {
      if (filter.ids.length === 0) return [];
      where.push(`p.id IN (${filter.ids.map(() => "?").join(",")})`);
      params.push(...filter.ids);
    }
    const rows = this.db
      .prepare(
        `SELECT p.* FROM products p JOIN categories c ON c.id = p.category_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY c.sort_order, c.id, p.sort_order, p.id`,
      )
      .all(...params) as ProductRow[];
    const groups = this.loadOptionGroups(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      categoryId: r.category_id,
      name: parseText(r.name),
      description: parseOptionalText(r.description),
      imageUrl: imageUrl(r.image_path),
      priceCents: r.price_cents,
      promo: r.promo_json ? (JSON.parse(r.promo_json) as ProductPromo) : null,
      isFeatured: r.is_featured === 1,
      featuredLabel: parseOptionalText(r.featured_label),
      currency: r.currency,
      isAvailable: r.is_available === 1,
      isArchived: r.is_archived === 1,
      stockQty: r.stock_qty,
      sortOrder: r.sort_order,
      optionGroups: groups.get(r.id) ?? [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  getProduct(id: number): AdminProductDto {
    const [product] = this.listProducts({ includeArchived: true, activeCategoriesOnly: false, ids: [id] });
    if (!product) throw notFound("Produto não encontrado");
    return product;
  }

  /** Products that may currently be ordered: not archived and in an active category. */
  getOrderableCatalogue(productIds: number[]): Map<number, ProductDto> {
    const unique = [...new Set(productIds)];
    const products = this.listProducts({ includeArchived: false, activeCategoriesOnly: true, ids: unique });
    return new Map(products.map((p) => [p.id, p]));
  }

  getImagePath(id: number): string | null {
    const row = this.db.prepare("SELECT image_path FROM products WHERE id = ?").get(id) as
      | { image_path: string | null }
      | undefined;
    if (!row) throw notFound("Produto não encontrado");
    return row.image_path;
  }

  createProduct(input: ProductInput): number {
    return this.db.transaction(() => {
      this.assertCategory(input.categoryId);
      const now = nowIso();
      const result = this.db
        .prepare(
          `INSERT INTO products (category_id, name, description, price_cents, promo_json, is_featured, featured_label, is_available, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.categoryId, JSON.stringify(input.name), input.description ? JSON.stringify(input.description) : null, input.priceCents, ...promoColumns(input), input.isAvailable ? 1 : 0, input.sortOrder, now, now);
      const id = Number(result.lastInsertRowid);
      this.syncOptionGroups(id, input.optionGroups);
      return id;
    })();
  }

  updateProduct(id: number, input: ProductInput): void {
    this.db.transaction(() => {
      this.assertCategory(input.categoryId);
      const result = this.db
        .prepare(
          `UPDATE products SET category_id = ?, name = ?, description = ?, price_cents = ?, promo_json = ?, is_featured = ?, featured_label = ?,
             is_available = ?, sort_order = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.categoryId, JSON.stringify(input.name), input.description ? JSON.stringify(input.description) : null, input.priceCents, ...promoColumns(input), input.isAvailable ? 1 : 0, input.sortOrder, nowIso(), id);
      if (result.changes === 0) throw notFound("Produto não encontrado");
      this.syncOptionGroups(id, input.optionGroups);
    })();
  }

  setAvailability(id: number, isAvailable: boolean): void {
    const result = this.db
      .prepare("UPDATE products SET is_available = ?, updated_at = ? WHERE id = ?")
      .run(isAvailable ? 1 : 0, nowIso(), id);
    if (result.changes === 0) throw notFound("Produto não encontrado");
  }

  /** Sets the units in stock; null stops tracking stock for the product. */
  setStock(id: number, stockQty: number | null): void {
    const result = this.db.prepare("UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?").run(stockQty, nowIso(), id);
    if (result.changes === 0) throw notFound("Produto não encontrado");
  }

  /** Takes units from a tracked product; false if there are not enough. Call inside the order transaction. */
  takeStock(id: number, quantity: number): boolean {
    return (
      this.db
        .prepare("UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ? AND stock_qty IS NOT NULL AND stock_qty >= ?")
        .run(quantity, nowIso(), id, quantity).changes === 1
    );
  }

  /** Gives units back (cancelled order), unless tracking was switched off meanwhile. */
  returnStock(id: number, quantity: number): void {
    this.db.prepare("UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ? AND stock_qty IS NOT NULL").run(quantity, nowIso(), id);
  }

  setArchived(id: number, archived: boolean): void {
    const result = this.db
      .prepare("UPDATE products SET is_archived = ?, updated_at = ? WHERE id = ?")
      .run(archived ? 1 : 0, nowIso(), id);
    if (result.changes === 0) throw notFound("Produto não encontrado");
  }

  setImagePath(id: number, path: string | null): void {
    const result = this.db
      .prepare("UPDATE products SET image_path = ?, updated_at = ? WHERE id = ?")
      .run(path, nowIso(), id);
    if (result.changes === 0) throw notFound("Produto não encontrado");
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private assertCategory(categoryId: number): void {
    if (!this.categoryExists(categoryId)) throw badRequest("CATEGORY_NOT_FOUND", "Categoria inexistente");
  }

  private loadOptionGroups(productIds: number[]): Map<number, OptionGroupDto[]> {
    const result = new Map<number, OptionGroupDto[]>();
    if (productIds.length === 0) return result;
    const placeholders = productIds.map(() => "?").join(",");
    const groups = this.db
      .prepare(`SELECT * FROM option_groups WHERE product_id IN (${placeholders}) ORDER BY sort_order, id`)
      .all(...productIds) as GroupRow[];
    if (groups.length === 0) return result;
    const options = this.db
      .prepare(
        `SELECT * FROM options WHERE group_id IN (${groups.map(() => "?").join(",")}) ORDER BY sort_order, id`,
      )
      .all(...groups.map((g) => g.id)) as OptionRow[];
    const byGroup = new Map<number, OptionRow[]>();
    for (const o of options) byGroup.set(o.group_id, [...(byGroup.get(o.group_id) ?? []), o]);
    for (const g of groups) {
      const dto: OptionGroupDto = {
        id: g.id,
        name: parseText(g.name),
        minSelect: g.min_select,
        maxSelect: g.max_select,
        sortOrder: g.sort_order,
        options: (byGroup.get(g.id) ?? []).map((o) => ({
          id: o.id,
          name: parseText(o.name),
          priceDeltaCents: o.price_delta_cents,
          isAvailable: o.is_available === 1,
          sortOrder: o.sort_order,
        })),
      };
      result.set(g.product_id, [...(result.get(g.product_id) ?? []), dto]);
    }
    return result;
  }

  /**
   * Replaces a product's option groups while keeping the ids of groups and
   * options that still exist, so carts holding those ids remain valid.
   */
  private syncOptionGroups(productId: number, groups: ProductInput["optionGroups"]): void {
    const existingGroups = new Set(
      (this.db.prepare("SELECT id FROM option_groups WHERE product_id = ?").all(productId) as { id: number }[]).map((r) => r.id),
    );
    const keptGroups = new Set<number>();

    groups.forEach((group, groupIndex) => {
      let groupId: number;
      if (group.id !== undefined) {
        if (!existingGroups.has(group.id)) throw badRequest("OPTION_GROUP_INVALID", "Grupo de opções inválido");
        this.db
          .prepare("UPDATE option_groups SET name = ?, min_select = ?, max_select = ?, sort_order = ? WHERE id = ?")
          .run(JSON.stringify(group.name), group.minSelect, group.maxSelect, groupIndex, group.id);
        groupId = group.id;
      } else {
        groupId = Number(
          this.db
            .prepare("INSERT INTO option_groups (product_id, name, min_select, max_select, sort_order) VALUES (?, ?, ?, ?, ?)")
            .run(productId, JSON.stringify(group.name), group.minSelect, group.maxSelect, groupIndex).lastInsertRowid,
        );
      }
      keptGroups.add(groupId);

      const existingOptions = new Set(
        (this.db.prepare("SELECT id FROM options WHERE group_id = ?").all(groupId) as { id: number }[]).map((r) => r.id),
      );
      const keptOptions = new Set<number>();
      group.options.forEach((option, optionIndex) => {
        if (option.id !== undefined) {
          if (!existingOptions.has(option.id)) throw badRequest("OPTION_INVALID", "Opção inválida");
          this.db
            .prepare("UPDATE options SET name = ?, price_delta_cents = ?, is_available = ?, sort_order = ? WHERE id = ?")
            .run(JSON.stringify(option.name), option.priceDeltaCents, option.isAvailable ? 1 : 0, optionIndex, option.id);
          keptOptions.add(option.id);
        } else {
          this.db
            .prepare("INSERT INTO options (group_id, name, price_delta_cents, is_available, sort_order) VALUES (?, ?, ?, ?, ?)")
            .run(groupId, JSON.stringify(option.name), option.priceDeltaCents, option.isAvailable ? 1 : 0, optionIndex);
        }
      });
      for (const id of existingOptions) {
        if (!keptOptions.has(id)) this.db.prepare("DELETE FROM options WHERE id = ?").run(id);
      }
    });

    for (const id of existingGroups) {
      if (!keptGroups.has(id)) this.db.prepare("DELETE FROM option_groups WHERE id = ?").run(id);
    }
  }
}
