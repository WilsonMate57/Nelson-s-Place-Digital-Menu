import { effectivePriceCents } from "../../shared/pricing";
import type { ProductDto } from "../../shared/types";
import { useGuest } from "./context";

/** Price, or the promotional price with the regular one struck through while a promotion applies. */
export function PriceTag({ product, className = "price" }: { product: Pick<ProductDto, "priceCents" | "promo">; className?: string }) {
  const { t, money } = useGuest();
  const now = effectivePriceCents(product, new Date());
  if (now === product.priceCents) return <span className={className}>{money(product.priceCents)}</span>;
  return (
    <span className={`${className} price-promo`}>
      <span className="visually-hidden">{t("promo")}: </span>
      {money(now)} <s className="price-was">{money(product.priceCents)}</s>
    </span>
  );
}
