import { describe, expect, it } from "vitest";
import type { DesignSpec, DesignVariation } from "./types";
import { applyVariation, variationChanges } from "./variations";

const spec = {
  neckline: "V-neck",
  sleeve_style: "Full sleeves",
  silhouette: "Flared",
  embellishments: ["Zari work"],
  colour_palette: ["Wine"],
  title: "Anarkali",
} as unknown as DesignSpec;

const variation = (patch: Partial<DesignVariation>): DesignVariation => ({
  kind: "neckline",
  name: "n",
  description: "",
  why: "",
  neckline: "",
  sleeve_style: "",
  silhouette: "",
  embellishments: [],
  colour_palette: [],
  colour_hex: [],
  ...patch,
});

describe("design variations", () => {
  it("changes only the fields the variation fills in", () => {
    const next = applyVariation(variation({ neckline: "Boat neck" }), spec);
    expect(next.neckline).toBe("Boat neck");
    expect(next.sleeve_style).toBe("Full sleeves");
    expect(next.embellishments).toEqual(["Zari work"]);
    expect(next.title).toBe("Anarkali");
  });

  it("lists what changes, from and to", () => {
    const v = variation({ kind: "colour", colour_palette: ["Emerald", "Gold"] });
    expect(variationChanges(v, spec)).toEqual([["Colours", "Wine", "Emerald, Gold"]]);
    expect(applyVariation(v, spec).colour_palette).toEqual(["Emerald", "Gold"]);
  });
});
