import type { CostEstimateOutput, CostInputs } from "./types";

/** The inputs behind a saved estimate, so it can be edited and recalculated without losing prices. */
export function costInputsFromOutput(out: CostEstimateOutput): CostInputs {
  return {
    currency: out.currency,
    region: out.region,
    price_date: out.price_date,
    contingency_percent: out.contingency_percent,
    materials: out.materials.map(({ item, kind, quantity, unit, unit_price, price_source }) => ({ item, kind, quantity, unit, unit_price, price_source })),
    labour: out.labour.map(({ task, amount, note }) => ({ task, amount, note })),
  };
}

/** "₹1,250.00" for real currency codes, "1,250.00 XYZ" for anything Intl does not know. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

/** Turn a text box value into a number, or null when it is empty or not a positive number. */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, "");
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
