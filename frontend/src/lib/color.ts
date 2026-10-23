// Colour maths for themes: WCAG contrast, mixing, and nudging a colour until it is readable.

export const HEX = /^#[0-9a-f]{6}$/i;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1 to 21). AA needs 4.5 for normal text. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A mix of two colours: amount 0 = a, 1 = b. */
export function mix(a: string, b: string, amount: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as [number, number, number]);
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.18;
}

/** Black-ish or white-ish, whichever reads better on this background. */
export function readableOn(bg: string, dark = "#1a1512", light = "#fffdf8"): string {
  return contrast(dark, bg) >= contrast(light, bg) ? dark : light;
}

/**
 * Move `fg` towards black or white (whichever the background allows) until it reaches the
 * contrast `target` against `bg`. Returns the colour unchanged when it already passes.
 */
export function ensureContrast(fg: string, bg: string, target = 4.5): string {
  if (contrast(fg, bg) >= target) return fg;
  const towards = isDark(bg) ? "#ffffff" : "#000000";
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(fg, towards, step / 20);
    if (contrast(candidate, bg) >= target) return candidate;
  }
  return towards;
}
