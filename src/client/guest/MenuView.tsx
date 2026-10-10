import { useEffect, useMemo, useRef, useState } from "react";
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

export function MenuView({ categories, products, onOpenProduct }: Props) {
  const { t, text, settings } = useGuest();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<number | null>(categories[0]?.id ?? null);
  const navRef = useRef<HTMLElement>(null);

  const sections = useMemo(() => {
    const q = normalise(query.trim());
    return categories
      .map((category) => ({
        category,
        products: products.filter(
          (p) =>
            p.categoryId === category.id &&
            (!q || normalise(`${text(p.name)} ${text(p.description)} ${text(category.name)}`).includes(q)),
        ),
      }))
      .filter((s) => s.products.length > 0);
  }, [categories, products, query, text]);

  // Highlight the category currently in view.
  useEffect(() => {
    if (query) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveCategory(Number((visible.target as HTMLElement).dataset.category));
      },
      { rootMargin: "-130px 0px -60% 0px" },
    );
    document.querySelectorAll<HTMLElement>("[data-category]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections, query]);

  // Keep the active chip visible in the horizontal nav.
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>(".chip.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeCategory]);

  const jumpTo = (id: number) => {
    setActiveCategory(id);
    document.getElementById(`category-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
          {!query && categories.length > 1 && (
            <nav ref={navRef} className="chips" aria-label={t("categories")}>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={cx("chip", activeCategory === c.id && "active")}
                  aria-current={activeCategory === c.id ? "true" : undefined}
                  onClick={() => jumpTo(c.id)}
                >
                  {text(c.name)}
                </button>
              ))}
            </nav>
          )}
        </div>
      </div>

      <div className="container menu-sections">
        {sections.length === 0 &&
          (query ? (
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
          <section
            key={category.id}
            id={`category-${category.id}`}
            data-category={category.id}
            className="menu-category"
            aria-labelledby={`category-title-${category.id}`}
          >
            <h2 id={`category-title-${category.id}`} className="category-title">
              {text(category.name)}
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
