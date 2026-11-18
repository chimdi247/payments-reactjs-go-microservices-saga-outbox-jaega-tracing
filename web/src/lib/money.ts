// Money is an integer count of minor units (cents), never a float: the same
// rule the backend keeps. These helpers only convert at the edges.

export const CURRENCIES = ["USD", "EUR", "GBP", "JPY"] as const
export type Currency = (typeof CURRENCIES)[number]

/** Digits after the decimal point: 2 for dollars, 0 for yen. */
export function exponent(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

export function formatMoney(minor: number, currency: string): string {
  const e = exponent(currency)
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: e,
    maximumFractionDigits: e,
  }).format(minor / 10 ** e)
}

/** "12.50" -> 1250 (for USD). Returns null for anything that isn't a plain, exact amount. */
export function parseAmount(input: string, currency: string): number | null {
  const s = input.trim().replace(/,/g, "")
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const e = exponent(currency)
  const [whole, frac = ""] = s.split(".")
  if (frac.length > e) return null
  const minor = Number(whole + frac.padEnd(e, "0"))
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null
}

export function amountHint(currency: string): string {
  return exponent(currency) === 0 ? "whole units, like 500" : "like 12.50"
}
