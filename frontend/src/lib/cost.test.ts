import { describe, expect, it } from "vitest";
import { costInputsFromOutput, formatMoney, parseAmount } from "./cost";
import type { CostEstimateOutput } from "./types";

const output: CostEstimateOutput = {
  currency: "INR",
  region: "Jaipur",
  price_date: "Oct 2026",
  materials: [{ item: "Silk", kind: "fabric", quantity: 2.5, unit: "m", unit_price: 400, price_source: "Shop", line_total: 1000, status: "priced" }],
  labour: [{ task: "Stitching", amount: 800, note: "", status: "quoted" }],
  materials_subtotal: 1000,
  contingency_percent: 10,
  contingency_amount: 100,
  labour_subtotal: 800,
  total: 1900,
  complete: true,
  missing: [],
  assumptions: [],
  budget_amount: null,
  budget_currency: "INR",
  budget_status: "unknown",
  budget_note: "",
};

describe("cost helpers", () => {
  it("keeps the typed prices when re-using a saved estimate", () => {
    const inputs = costInputsFromOutput(output);
    expect(inputs.materials[0]).toEqual({ item: "Silk", kind: "fabric", quantity: 2.5, unit: "m", unit_price: 400, price_source: "Shop" });
    expect(inputs.labour[0]).toEqual({ task: "Stitching", amount: 800, note: "" });
    expect(inputs.contingency_percent).toBe(10);
    expect(inputs).not.toHaveProperty("total");
  });

  it("formats known and unknown currencies", () => {
    expect(formatMoney(1250, "INR")).toContain("1,250");
    expect(formatMoney(5, "not a currency")).toBe("5 not a currency");
  });

  it("reads amounts and rejects nonsense", () => {
    expect(parseAmount(" 1,200.5 ")).toBe(1200.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-3")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});
