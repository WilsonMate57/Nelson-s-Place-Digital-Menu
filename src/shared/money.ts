/**
 * All amounts are stored and transmitted as integer minor units (centavos)
 * to avoid floating-point rounding errors.
 */

export interface MoneyFormat {
  /** Symbol shown after the amount, e.g. "MT". */
  symbol: string;
  /** BCP 47 locale used for digit grouping, e.g. "pt-MZ". */
  locale?: string;
}

export function formatMoney(cents: number, format: MoneyFormat): string {
  const whole = cents % 100 === 0;
  const amount = new Intl.NumberFormat(format.locale ?? "pt-MZ", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return `${amount} ${format.symbol}`;
}

/** Converts a user-entered amount ("250", "250,50", "250.5") to centavos. Returns null if invalid. */
export function parseAmountToCents(input: string): number | null {
  const normalised = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalised)) return null;
  const [whole = "0", fraction = ""] = normalised.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function centsToInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(".", ",");
}
