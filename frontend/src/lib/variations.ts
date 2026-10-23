import type { DesignSpec, DesignVariation } from "./types";

/** The spec fields a variation changes, as [label, current value, new value]. */
export function variationChanges(v: DesignVariation, spec: DesignSpec): [string, string, string][] {
  const rows: [string, string, string][] = [];
  if (v.neckline) rows.push(["Neckline", spec.neckline, v.neckline]);
  if (v.sleeve_style) rows.push(["Sleeves", spec.sleeve_style, v.sleeve_style]);
  if (v.silhouette) rows.push(["Silhouette", spec.silhouette, v.silhouette]);
  if (v.embellishments.length) rows.push(["Embellishments", spec.embellishments.join(", "), v.embellishments.join(", ")]);
  if (v.colour_palette.length) rows.push(["Colours", spec.colour_palette.join(", "), v.colour_palette.join(", ")]);
  return rows;
}

/** The design spec with a variation applied. Empty fields in the variation mean "keep as is". */
export function applyVariation(v: DesignVariation, spec: DesignSpec): DesignSpec {
  return {
    ...spec,
    neckline: v.neckline || spec.neckline,
    sleeve_style: v.sleeve_style || spec.sleeve_style,
    silhouette: v.silhouette || spec.silhouette,
    embellishments: v.embellishments.length ? v.embellishments : spec.embellishments,
    colour_palette: v.colour_palette.length ? v.colour_palette : spec.colour_palette,
  };
}
