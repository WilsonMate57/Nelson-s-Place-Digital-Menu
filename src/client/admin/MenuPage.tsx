import { useCallback, useEffect, useState } from "react";
import { formatMoney } from "../../shared/money";
import type { AdminCategoryDto, AdminProductDto } from "../../shared/types";
import { ProductImage } from "../components/ProductImage";
import { useToast } from "../components/Toasts";
import { api } from "../lib/api";
import { cx } from "../lib/util";
import { CategoryEditor } from "./CategoryEditor";
import { useErrorMessage } from "./errors";
import { ProductEditor } from "./ProductEditor";
import { useSession } from "./session";

interface AdminMenu {
  categories: AdminCategoryDto[];
  products: AdminProductDto[];
}

export function MenuPage() {
  const { can, settings } = useSession();
  const isAdmin = can("menu.edit");
  const canToggle = can("menu.availability", "menu.edit");
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [menu, setMenu] = useState<AdminMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [editingProduct, setEditingProduct] = useState<AdminProductDto | "new" | null>(null);
  const [newProductCategory, setNewProductCategory] = useState<number | null>(null);
  const [editingCategory, setEditingCategory] = useState<AdminCategoryDto | "new" | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const symbol = settings?.currencySymbol ?? "MT";

  const load = useCallback(async () => {
    try {
      setMenu(await api<AdminMenu>("/api/admin/menu"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [errorMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  const productAction = async (product: AdminProductDto, path: string, body?: unknown, method: "POST" | "PATCH" = "POST", message?: string) => {
    setBusyId(product.id);
    try {
      await api(`/api/admin/products/${product.id}/${path}`, { method, body });
      await load();
      if (message) toast(message);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusyId(null);
    }
  };

  if (error && !menu) return <div className="admin-page"><p className="alert alert-error">{error}</p></div>;
  if (!menu) return <div className="state-block" aria-busy="true"><span className="spinner" aria-hidden="true" /></div>;

  const q = query.trim().toLowerCase();
  const visible = menu.products.filter((p) => (showArchived || !p.isArchived) && (!q || p.name.pt.toLowerCase().includes(q) || (p.name.en ?? "").toLowerCase().includes(q)));

  return (
    <div className="admin-page">
      <div className="row-between wrap page-head">
        <div>
          <h1 className="admin-title">Menu</h1>
          <p className="muted small">
            {isAdmin
              ? "Gerir categorias, produtos, preços, opções e disponibilidade."
              : "Pode marcar artigos como esgotados ou disponíveis. O seu perfil não permite editar o menu."}
          </p>
        </div>
        {isAdmin && (
          <div className="row wrap">
            <button type="button" className="btn btn-secondary" onClick={() => setEditingCategory("new")}>
              Nova categoria
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={menu.categories.length === 0}
              onClick={() => {
                setNewProductCategory(menu.categories[0]?.id ?? null);
                setEditingProduct("new");
              }}
            >
              Novo produto
            </button>
          </div>
        )}
      </div>

      <div className="row wrap menu-filters">
        <input className="input" type="search" placeholder="Pesquisar produto" aria-label="Pesquisar produto" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Mostrar arquivados
        </label>
      </div>

      {menu.categories.length === 0 && (
        <div className="state-block card">
          <h2>O menu está vazio</h2>
          <p>{isAdmin ? "Comece por criar uma categoria (ex.: Entradas, Bebidas)." : "O menu ainda não foi criado."}</p>
        </div>
      )}

      {menu.categories.map((category) => {
        const products = visible.filter((p) => p.categoryId === category.id);
        if (q && products.length === 0) return null;
        return (
          <section key={category.id} className="card menu-admin-category" aria-labelledby={`cat-${category.id}`}>
            <div className="row-between wrap">
              <div className="row wrap">
                <h2 id={`cat-${category.id}`} className="card-title">
                  {category.name.pt}
                </h2>
                {!category.isActive && <span className="badge badge-warning">Oculta aos hóspedes</span>}
                {category.availableFrom && (
                  <span className="badge badge-scheduled">
                    🕒 {category.availableFrom}–{category.availableUntil}
                  </span>
                )}
                <span className="small muted">{category.productCount} produto(s)</span>
              </div>
              {isAdmin && (
                <div className="row">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingCategory(category)}>
                    Editar categoria
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setNewProductCategory(category.id);
                      setEditingProduct("new");
                    }}
                  >
                    + Produto
                  </button>
                </div>
              )}
            </div>
            {products.length === 0 ? (
              <p className="small muted">Sem produtos nesta categoria.</p>
            ) : (
              <ul className="admin-products">
                {products.map((p) => (
                  <li key={p.id} className={cx("admin-product", p.isArchived && "archived")}>
                    <ProductImage src={p.imageUrl} alt="" className="admin-product-thumb" />
                    <div className="admin-product-info">
                      <strong>{p.name.pt}</strong>
                      <span className="small muted">
                        {formatMoney(p.priceCents, { symbol })}
                        {p.optionGroups.length > 0 && ` · ${p.optionGroups.length} grupo(s) de opções`}
                        {!p.name.en && " · sem tradução EN"}
                      </span>
                      <span className="row wrap">
                        {p.isArchived && <span className="badge badge-muted">Arquivado</span>}
                        {!p.isArchived && !p.isAvailable && <span className="badge badge-danger">Esgotado</span>}
                      </span>
                    </div>
                    <div className="admin-product-actions">
                      {!p.isArchived && canToggle && (
                        <label className="switch" title="Disponível para encomenda">
                          <input
                            type="checkbox"
                            checked={p.isAvailable}
                            disabled={busyId === p.id}
                            onChange={(e) =>
                              void productAction(p, "availability", { isAvailable: e.target.checked }, "PATCH", e.target.checked ? `${p.name.pt}: disponível` : `${p.name.pt}: esgotado`)
                            }
                          />
                          <span className="switch-track" aria-hidden="true" />
                          <span className="switch-label">{p.isAvailable ? "Disponível" : "Esgotado"}</span>
                        </label>
                      )}
                      {isAdmin && !p.isArchived && (
                        <>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingProduct(p)}>
                            Editar
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busyId === p.id}
                            onClick={() => {
                              if (confirm(`Arquivar «${p.name.pt}»? Deixa de aparecer no menu; os pedidos antigos mantêm-se.`)) void productAction(p, "archive", undefined, "POST", "Produto arquivado.");
                            }}
                          >
                            Arquivar
                          </button>
                        </>
                      )}
                      {isAdmin && p.isArchived && (
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === p.id} onClick={() => void productAction(p, "restore", undefined, "POST", "Produto restaurado.")}>
                          Restaurar
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {isAdmin && (
        <>
          <ProductEditor
            open={editingProduct !== null}
            product={editingProduct === "new" ? null : editingProduct}
            defaultCategoryId={newProductCategory}
            categories={menu.categories}
            onClose={() => setEditingProduct(null)}
            onSaved={(saved, keepOpen) => {
              void load();
              if (keepOpen) setEditingProduct(saved);
              else setEditingProduct(null);
            }}
          />
          <CategoryEditor
            open={editingCategory !== null}
            category={editingCategory === "new" ? null : editingCategory}
            onClose={() => setEditingCategory(null)}
            onSaved={() => {
              setEditingCategory(null);
              void load();
            }}
          />
        </>
      )}
    </div>
  );
}
