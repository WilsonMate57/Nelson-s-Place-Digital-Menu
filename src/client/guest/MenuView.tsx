import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CategoryDto, ProductDto } from "../../shared/types";
import { ProductImage } from "../components/ProductImage";
import { cx } from "../lib/util";
import { useGuest } from "./context";

interface Props {
  categories: CategoryDto[];
  products: ProductDto[];
  onOpenProduct: (product: ProductDto) => void;
}

const normalise = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const CATEGORY_KEY = "np.category";
const readSavedCategory = (): number | null => {
  try {
    const value = Number(sessionStorage.getItem(CATEGORY_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

/**
 * Menu with category tabs: tapping a category switches the list to that
 * category (no long scrolling). A search looks across all categories.
 */
export function MenuView({ categories, products, onOpenProduct }: Props) {
  const { t, text, settings } = useGuest();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(readSavedCategory);
  const navRef = useRef<HTMLDivElement>(null);
  const searching = query.trim().length > 0;

  // Categories that actually have products to show.
  const withProducts = useMemo(
    () => categories.filter((c) => products.some((p) => p.categoryId === c.id)),
    [categories, products],
  );
  const active = withProducts.find((c) => c.id === selected) ?? withProducts[0] ?? null;

  const sections = useMemo(() => {
    if (!searching) {
      return active ? [{ category: active, products: products.filter((p) => p.categoryId === active.id) }] : [];
    }
    const q = normalise(query.trim());
    return withProducts
      .map((category) => ({
        category,
        products: products.filter(
          (p) => p.categoryId === category.id && normalise(`${text(p.name)} ${text(p.description)} ${text(category.name)}`).includes(q),
        ),
      }))
      .filter((s) => s.products.length > 0);
  }, [searching, active, withProducts, products, query, text]);

  // Keep the selected tab visible in the horizontally scrolling bar.
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active?.id]);

  const select = (id: number, focus = false) => {
    setSelected(id);
    try {
      sessionStorage.setItem(CATEGORY_KEY, String(id));
    } catch {
      /* ignore */
    }
    // If the guest has scrolled down, bring the start of the list back into view.
    const menu = document.getElementById("menu");
    if (menu && window.scrollY > menu.offsetTop) window.scrollTo({ top: menu.offsetTop });
    if (focus) requestAnimationFrame(() => document.getElementById(`tab-${id}`)?.focus());
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = withProducts.length - 1;
    const target =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (target === null) return;
    event.preventDefault();
    select(withProducts[target]!.id, true);
  };

  const activeIndex = active ? withProducts.indexOf(active) : -1;
  const next = activeIndex >= 0 ? withProducts[activeIndex + 1] : undefined;

  return (
    <section id="menu" className="menu" aria-label={t("exploreMenu")}>
      <div className="menu-toolbar">
        <div className="container">
          <div className="search">
            <label htmlFor="menu-search" className="visually-hidden">
              {t("searchLabel")}
            </label>
            <span className="search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              id="menu-search"
              className="input search-input"
              type="search"
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          {!searching && withProducts.length > 1 && (
            <div ref={navRef} className="chips" role="tablist" aria-label={t("categories")}>
              {withProducts.map((c, index) => {
                const isActive = c.id === active?.id;
                return (
                  <button
                    key={c.id}
                    id={`tab-${c.id}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls="menu-panel"
                    tabIndex={isActive ? 0 : -1}
                    className={cx("chip", isActive && "active")}
                    onClick={() => select(c.id)}
                    onKeyDown={(e) => onTabKey(e, index)}
                  >
                    {text(c.name)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div
        className="container menu-sections"
        id="menu-panel"
        role={searching ? undefined : "tabpanel"}
        aria-labelledby={!searching && active ? `tab-${active.id}` : undefined}
      >
        {sections.length === 0 &&
          (searching ? (
            <div className="state-block">
              <p>{t("noResults")}</p>
              <button type="button" className="btn btn-secondary" onClick={() => setQuery("")}>
                {t("clearSearch")}
              </button>
            </div>
          ) : (
            <div className="state-block">
              <p>{t("emptyMenu")}</p>
            </div>
          ))}

        {sections.map(({ category, products: items }) => (
          <section key={category.id} className="menu-category" aria-labelledby={`category-title-${category.id}`}>
            <h2 id={`category-title-${category.id}`} className="category-title">
              {text(category.name)}
              <span className="category-count">{items.length}</span>
            </h2>
            {category.description && <p className="muted category-description">{text(category.description)}</p>}
            <ul className="product-grid">
              {items.map((product) => (
                <li key={product.id}>
                  <ProductCard product={product} canOrder={settings.ordersEnabled} onOpen={() => onOpenProduct(product)} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {!searching && next && (
          <button type="button" className="next-category" onClick={() => select(next.id)}>
            <span className="muted small">{t("nextCategory")}</span>
            <strong>{text(next.name)} →</strong>
          </button>
        )}
      </div>
    </section>
  );
}

function ProductCard({ product, canOrder, onOpen }: { product: ProductDto; canOrder: boolean; onOpen: () => void }) {
  const { t, text, money } = useGuest();
  const name = text(product.name);
  return (
    <article className={cx("product-card", !product.isAvailable && "is-unavailable")}>
      <button type="button" className="product-card-hit" onClick={onOpen} aria-label={`${name}, ${money(product.priceCents)}${product.isAvailable ? "" : `, ${t("unavailable")}`}`} />
      <ProductImage src={product.imageUrl} alt="" className="product-card-image" />
      <div className="product-card-body">
        <h3 className="product-card-title">{name}</h3>
        {product.description && <p className="product-card-description">{text(product.description)}</p>}
        <div className="product-card-footer">
          <span className="price">{money(product.priceCents)}</span>
          {!product.isAvailable ? (
            <span className="badge badge-muted">{t("unavailable")}</span>
          ) : product.optionGroups.length > 0 ? (
            <span className="badge badge-muted">{t("optionsAvailable")}</span>
          ) : null}
          {product.isAvailable && canOrder && (
            <span className="product-card-add" aria-hidden="true">
              +
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
