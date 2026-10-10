import type { Language } from "./constants";
import { localize } from "./localize";
import type { AppliedCharge, ChargeRule, ProductDto, SelectedOptionSnapshot } from "./types";

/**
 * Price calculation used by the server (authoritative) and by the cart (estimate only).
 * Pure function: no I/O, no clock, so it can be unit-tested exhaustively.
 */

export interface PricingLineInput {
  productId: number;
  quantity: number;
  optionIds: number[];
  notes?: string | null;
}

export interface PricedLine {
  productId: number;
  productName: string;
  unitPriceCents: number;
  quantity: number;
  options: SelectedOptionSnapshot[];
  notes: string | null;
  lineTotalCents: number;
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotalCents: number;
  charges: AppliedCharge[];
  chargesCents: number;
  totalCents: number;
}

export type PricingErrorCode =
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_UNAVAILABLE"
  | "OPTION_INVALID"
  | "OPTION_UNAVAILABLE"
  | "OPTION_DUPLICATE"
  | "OPTION_SELECTION_COUNT";

export class PricingError extends Error {
  constructor(
    public readonly code: PricingErrorCode,
    public readonly lineIndex: number,
    public readonly productId: number,
  ) {
    super(`${code} (line ${lineIndex + 1}, product ${productId})`);
    this.name = "PricingError";
  }
}

/** Catalogue entries must already exclude archived products and inactive categories. */
export function priceOrder(
  lines: PricingLineInput[],
  catalogue: ReadonlyMap<number, ProductDto>,
  chargeRules: ChargeRule[],
  language: Language,
): PricedOrder {
  const priced = lines.map((line, index) => priceLine(line, index, catalogue, language));
  const subtotalCents = priced.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const charges = chargeRules.map((rule) => ({
    id: rule.id,
    label: localize(rule.label, language),
    amountCents: rule.kind === "percent" ? Math.round((subtotalCents * rule.value) / 100) : rule.value,
  }));
  const chargesCents = charges.reduce((sum, c) => sum + c.amountCents, 0);
  return { lines: priced, subtotalCents, charges, chargesCents, totalCents: subtotalCents + chargesCents };
}

function priceLine(
  line: PricingLineInput,
  index: number,
  catalogue: ReadonlyMap<number, ProductDto>,
  language: Language,
): PricedLine {
  const product = catalogue.get(line.productId);
  if (!product) throw new PricingError("PRODUCT_NOT_FOUND", index, line.productId);
  if (!product.isAvailable) throw new PricingError("PRODUCT_UNAVAILABLE", index, line.productId);

  if (new Set(line.optionIds).size !== line.optionIds.length) {
    throw new PricingError("OPTION_DUPLICATE", index, line.productId);
  }

  const selected: SelectedOptionSnapshot[] = [];
  const remaining = new Set(line.optionIds);

  for (const group of product.optionGroups) {
    const chosen = group.options.filter((o) => remaining.has(o.id));
    if (chosen.length < group.minSelect || chosen.length > group.maxSelect) {
      throw new PricingError("OPTION_SELECTION_COUNT", index, line.productId);
    }
    for (const option of chosen) {
      if (!option.isAvailable) throw new PricingError("OPTION_UNAVAILABLE", index, line.productId);
      remaining.delete(option.id);
      selected.push({
        optionId: option.id,
        groupName: localize(group.name, language),
        name: localize(option.name, language),
        priceDeltaCents: option.priceDeltaCents,
      });
    }
  }
  // Any id left over does not belong to this product.
  if (remaining.size > 0) throw new PricingError("OPTION_INVALID", index, line.productId);

  const unitPriceCents = product.priceCents + selected.reduce((sum, o) => sum + o.priceDeltaCents, 0);
  return {
    productId: product.id,
    productName: localize(product.name, language),
    unitPriceCents,
    quantity: line.quantity,
    options: selected,
    notes: line.notes ?? null,
    lineTotalCents: unitPriceCents * line.quantity,
  };
}
