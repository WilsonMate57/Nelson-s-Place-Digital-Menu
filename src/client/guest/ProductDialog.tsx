import { useMemo, useState } from "react";
import { ORDER_LIMITS } from "../../shared/constants";
import { isOrderable } from "../../shared/pricing";
import type { OptionGroupDto, ProductDto } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { ProductImage } from "../components/ProductImage";
import { useGuest } from "./context";

interface Props {
  product: ProductDto | null;
  canOrder: boolean;
  onClose: () => void;
  onAdd: (item: { productId: number; quantity: number; optionIds: number[]; notes: string | null }) => void;
}

export function ProductDialog({ product, canOrder, onClose, onAdd }: Props) {
  const { t } = useGuest();
  return (
    <Dialog open={product !== null} onClose={onClose} title={product ? <ProductTitle product={product} /> : ""} closeLabel={t("close")}>
      {product && <ProductForm key={product.id} product={product} canOrder={canOrder} onAdd={onAdd} />}
    </Dialog>
  );
}

function ProductTitle({ product }: { product: ProductDto }) {
  const { text } = useGuest();
  return <>{text(product.name)}</>;
}

function groupRule(group: OptionGroupDto, t: ReturnType<typeof useGuest>["t"]): string {
  const all = group.maxSelect >= group.options.length;
  if (group.options.length === 1 && group.minSelect === 0) return "";
  if (group.minSelect === 1 && group.maxSelect === 1) return t("chooseOne");
  if (group.minSelect === 0 && all) return t("chooseAny");
  if (group.minSelect === 0) return t("chooseUpTo", { n: group.maxSelect });
  if (all && group.options.length > 1) return t("chooseAtLeast", { n: group.minSelect });
  if (group.minSelect === group.maxSelect) return t("chooseExactly", { n: group.minSelect });
  return t("chooseBetween", { min: group.minSelect, max: group.maxSelect });
}

function ProductForm({ product, canOrder, onAdd }: { product: ProductDto; canOrder: boolean; onAdd: Props["onAdd"] }) {
  const { t, text, money } = useGuest();
  const [selected, setSelected] = useState<Record<number, number[]>>(() =>
    Object.fromEntries(product.optionGroups.map((g) => [g.id, [] as number[]])),
  );
  const [quantity, setQuantity] = useState(1);
  const maxQuantity = Math.min(ORDER_LIMITS.maxQuantityPerLine, product.stockQty ?? ORDER_LIMITS.maxQuantityPerLine);
  const [notes, setNotes] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const optionIds = useMemo(() => Object.values(selected).flat(), [selected]);
  const unitPrice = useMemo(() => {
    const deltas = product.optionGroups.flatMap((g) => g.options).filter((o) => optionIds.includes(o.id));
    return product.priceCents + deltas.reduce((sum, o) => sum + o.priceDeltaCents, 0);
  }, [product, optionIds]);
  const incompleteGroups = product.optionGroups.filter((g) => (selected[g.id]?.length ?? 0) < g.minSelect).map((g) => g.id);

  const toggle = (group: OptionGroupDto, optionId: number) => {
    setSelected((current) => {
      const chosen = current[group.id] ?? [];
      if (group.maxSelect === 1) return { ...current, [group.id]: chosen[0] === optionId && group.minSelect === 0 ? [] : [optionId] };
      if (chosen.includes(optionId)) return { ...current, [group.id]: chosen.filter((id) => id !== optionId) };
      if (chosen.length >= group.maxSelect) return current;
      return { ...current, [group.id]: [...chosen, optionId] };
    });
  };

  const submit = () => {
    if (incompleteGroups.length) {
      setShowErrors(true);
      document.getElementById(`group-${incompleteGroups[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    onAdd({ productId: product.id, quantity, optionIds, notes: notes.trim() || null });
  };

  return (
    <div className="product-form">
      <ProductImage src={product.imageUrl} alt={text(product.name)} className="product-dialog-image" eager />
      {product.description && <p className="muted">{text(product.description)}</p>}
      <p className="price product-dialog-price">{money(product.priceCents)}</p>

      {product.optionGroups.map((group) => {
        const chosen = selected[group.id] ?? [];
        const invalid = showErrors && incompleteGroups.includes(group.id);
        const single = group.maxSelect === 1;
        // Radio buttons only for a real "pick one of several"; a lone option (e.g. "Com gelo") is a tick box.
        const radio = single && group.options.length > 1;
        return (
          <fieldset key={group.id} id={`group-${group.id}`} className="option-group" aria-invalid={invalid || undefined}>
            <legend className="row-between option-group-head">
              <span className="label">{text(group.name)}</span>
              <span className={invalid ? "badge badge-danger" : "badge badge-muted"}>
                {[group.minSelect > 0 ? t("required") : t("optional"), groupRule(group, t)].filter(Boolean).join(" · ")}
              </span>
            </legend>
            {group.options.map((option) => {
              const checked = chosen.includes(option.id);
              const atMax = !single && !checked && chosen.length >= group.maxSelect;
              return (
                <label key={option.id} className="check option-row">
                  <input
                    type={radio ? "radio" : "checkbox"}
                    name={`group-${group.id}`}
                    checked={checked}
                    disabled={!option.isAvailable || atMax || !canOrder}
                    onChange={() => toggle(group, option.id)}
                    onClick={() => {
                      // Allow un-selecting an optional radio choice.
                      if (radio && checked && group.minSelect === 0) toggle(group, option.id);
                    }}
                  />
                  <span className="option-name">
                    {text(option.name)}
                    {!option.isAvailable && <span className="badge badge-muted">{t("unavailable")}</span>}
                  </span>
                  {option.priceDeltaCents > 0 && <span className="muted small">+{money(option.priceDeltaCents)}</span>}
                </label>
              );
            })}
          </fieldset>
        );
      })}

      {canOrder && isOrderable(product) && (
        <>
          <div className="field">
            <label className="label" htmlFor="item-notes">
              {t("itemNotes")} <span className="muted">{t("optionalSuffix")}</span>
            </label>
            <textarea
              id="item-notes"
              className="textarea"
              rows={2}
              maxLength={ORDER_LIMITS.maxItemNotesLength}
              placeholder={t("itemNotesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {showErrors && incompleteGroups.length > 0 && (
            <p className="alert alert-error" role="alert">
              {t("selectRequired")}
            </p>
          )}
          <div className="product-dialog-actions">
            <div className="stepper" role="group" aria-label={t("quantity")}>
              <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label={t("decrease")}>
                −
              </button>
              <output aria-live="polite">{quantity}</output>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                disabled={quantity >= maxQuantity}
                aria-label={t("increase")}
              >
                +
              </button>
            </div>
            <button type="button" className="btn btn-primary product-add-btn" onClick={submit}>
              {t("addToOrder")} · {money(unitPrice * quantity)}
            </button>
          </div>
        </>
      )}
      {!isOrderable(product) && <p className="alert alert-warning">{t("unavailable")}</p>}
    </div>
  );
}
