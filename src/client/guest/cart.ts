import { useCallback, useEffect, useMemo, useState } from "react";
import { ORDER_LIMITS, type Language } from "../../shared/constants";
import { priceOrder, type PricedLine } from "../../shared/pricing";
import type { ChargeRule, ProductDto } from "../../shared/types";
import { storage, uuid } from "../lib/util";

/** A cart line stores only ids; prices are always derived from the current menu. */
export interface CartLine {
  lineId: string;
  productId: number;
  quantity: number;
  optionIds: number[];
  notes: string | null;
}

export interface CartLineView {
  line: CartLine;
  /** null when the product/options are no longer orderable. */
  priced: PricedLine | null;
}

const STORAGE_KEY = "np.cart.v1";

const sameSelection = (a: CartLine, b: Omit<CartLine, "lineId" | "quantity">) =>
  a.productId === b.productId &&
  (a.notes ?? "") === (b.notes ?? "") &&
  a.optionIds.length === b.optionIds.length &&
  [...a.optionIds].sort().every((id, i) => id === [...b.optionIds].sort()[i]);

function loadCart(): CartLine[] {
  const stored = storage.get<CartLine[]>(STORAGE_KEY);
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((l) => l && Number.isInteger(l.productId) && Number.isInteger(l.quantity) && Array.isArray(l.optionIds))
    .slice(0, ORDER_LIMITS.maxLines);
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>(loadCart);

  useEffect(() => storage.set(STORAGE_KEY, lines), [lines]);

  // Keep several open tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setLines(loadCart());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const add = useCallback((item: Omit<CartLine, "lineId">) => {
    setLines((current) => {
      const existing = current.find((l) => sameSelection(l, item));
      if (existing) {
        return current.map((l) =>
          l === existing ? { ...l, quantity: Math.min(ORDER_LIMITS.maxQuantityPerLine, l.quantity + item.quantity) } : l,
        );
      }
      if (current.length >= ORDER_LIMITS.maxLines) return current;
      return [...current, { ...item, lineId: uuid() }];
    });
  }, []);

  const setQuantity = useCallback((lineId: string, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((l) => l.lineId !== lineId)
        : current.map((l) => (l.lineId === lineId ? { ...l, quantity: Math.min(ORDER_LIMITS.maxQuantityPerLine, quantity) } : l)),
    );
  }, []);

  const remove = useCallback((lineId: string) => setLines((current) => current.filter((l) => l.lineId !== lineId)), []);
  const clear = useCallback(() => setLines([]), []);

  return { lines, add, setQuantity, remove, clear };
}

export function usePricedCart(lines: CartLine[], products: ProductDto[], charges: ChargeRule[], language: Language) {
  return useMemo(() => {
    const catalogue = new Map(products.map((p) => [p.id, p]));
    const views: CartLineView[] = lines.map((line) => {
      try {
        return { line, priced: priceOrder([line], catalogue, [], language).lines[0]! };
      } catch {
        return { line, priced: null };
      }
    });
    const valid = views.filter((v) => v.priced).map((v) => v.line);
    const totals = priceOrder(valid, catalogue, charges, language);
    return {
      views,
      hasInvalid: views.some((v) => !v.priced),
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      subtotalCents: totals.subtotalCents,
      charges: totals.charges,
      totalCents: totals.totalCents,
    };
  }, [lines, products, charges, language]);
}
