// Every Drapeit theme in one place: colour tokens, a CSS-only fabric texture, and the profile cover.
// The same token names are used by Tailwind (see app/globals.css), so `bg-paper`, `text-wine`, ...
// follow whichever theme is applied to the page (or to one part of it, like a profile).
// lib/themes.test.ts checks that every theme passes WCAG AA contrast.

import type { CSSProperties } from "react";
import { contrast, ensureContrast, HEX, isDark, mix, readableOn } from "./color";

export const COLOR_TOKENS = [
  "paper",
  "surface",
  "sunken",
  "ink",
  "muted",
  "faint",
  "line",
  "line-strong",
  "wine",
  "wine-dark",
  "wine-soft",
  "on-wine",
  "gold",
  "gold-soft",
  "gold-ink",
  "ok",
  "ok-soft",
  "warn",
  "warn-soft",
  "err",
  "err-soft",
  "canvas",
  "overlay",
  "on-overlay",
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type Palette = Record<ColorToken, string>;

export const FREE_THEMES = ["light", "dark", "linen", "cotton", "denim"] as const;
export const PREMIUM_THEMES = ["silk", "velvet", "brocade", "khadi", "chiffon"] as const;
export type FabricThemeId = (typeof FREE_THEMES)[number] | (typeof PREMIUM_THEMES)[number];
/** What people can choose: "system" follows the device's light/dark setting; "custom" is Premium. */
export type AppThemeChoice = "system" | FabricThemeId | "custom";
export type ProfileThemeChoice = "default" | FabricThemeId | "custom";

export type TextureId = "none" | "linen" | "cotton" | "denim" | "silk" | "velvet" | "brocade" | "khadi" | "chiffon";
export type FontId = "fraunces" | "cormorant" | "playfair" | "inter";
export type CoverId = "drape" | "stripes" | "motif" | "plain";

export interface ThemeDef {
  id: FabricThemeId | "custom";
  name: string;
  premium: boolean;
  description: string;
  colors: Palette;
  texture: TextureId;
  font: FontId;
  cover: CoverId;
}

export interface CustomTheme {
  brand: string;
  background: string;
  text: string;
  texture: TextureId;
  font: FontId;
  cover: CoverId;
}

export const FONTS: { id: FontId; name: string; css: string }[] = [
  { id: "fraunces", name: "Fraunces · editorial", css: "var(--font-fraunces), Georgia, serif" },
  { id: "cormorant", name: "Cormorant · couture", css: "var(--font-cormorant), Georgia, serif" },
  { id: "playfair", name: "Playfair · magazine", css: "var(--font-playfair), Georgia, serif" },
  { id: "inter", name: "Inter · clean sans", css: "var(--font-inter), system-ui, sans-serif" },
];

export const TEXTURES: { id: TextureId; name: string }[] = [
  { id: "none", name: "Plain" },
  { id: "linen", name: "Linen weave" },
  { id: "cotton", name: "Cotton" },
  { id: "denim", name: "Denim twill" },
  { id: "silk", name: "Silk sheen" },
  { id: "velvet", name: "Velvet pile" },
  { id: "brocade", name: "Brocade motif" },
  { id: "khadi", name: "Khadi slub" },
  { id: "chiffon", name: "Chiffon sheer" },
];

export const COVERS: { id: CoverId; name: string }[] = [
  { id: "drape", name: "Drape" },
  { id: "stripes", name: "Pinstripe" },
  { id: "motif", name: "Buti motif" },
  { id: "plain", name: "Plain" },
];

/** Status colours that read well on light and on dark backgrounds. */
const LIGHT_STATUS = { ok: "#2a6a4b", "ok-soft": "#e5f1ea", warn: "#7f560a", "warn-soft": "#f7edd3", err: "#a3262e", "err-soft": "#f9e5e5" };
const DARK_STATUS = { ok: "#86d1a8", "ok-soft": "#1c3328", warn: "#e7bd6a", "warn-soft": "#3a2f17", err: "#f39297", "err-soft": "#3d1d1f" };

function palette(p: Omit<Palette, "ok" | "ok-soft" | "warn" | "warn-soft" | "err" | "err-soft" | "overlay" | "on-overlay">, dark = false): Palette {
  return { ...(dark ? DARK_STATUS : LIGHT_STATUS), overlay: "#120e0c", "on-overlay": "#fbf6ee", ...p };
}

export const THEMES: Record<FabricThemeId, ThemeDef> = {
  light: {
    id: "light",
    name: "Light",
    premium: false,
    description: "Ivory paper with wine and soft gold. The classic Drapeit look.",
    texture: "none",
    font: "fraunces",
    cover: "drape",
    colors: palette({
      paper: "#f9f5ee",
      surface: "#fffdf8",
      sunken: "#f2ece2",
      ink: "#1f1a17",
      muted: "#5d554e",
      faint: "#6a625a",
      line: "#e7ddcf",
      "line-strong": "#d3c6b3",
      wine: "#7a1f35",
      "wine-dark": "#5f1729",
      "wine-soft": "#f5e8eb",
      "on-wine": "#fffdf8",
      gold: "#b48a4a",
      "gold-soft": "#f5ead6",
      "gold-ink": "#71521c",
      canvas: "#fffdf8",
    }),
  },
  dark: {
    id: "dark",
    name: "Dark",
    premium: false,
    description: "Midnight espresso tones, easy on the eyes at night.",
    texture: "none",
    font: "fraunces",
    cover: "drape",
    colors: palette(
      {
        paper: "#14100e",
        surface: "#1d1815",
        sunken: "#27201c",
        ink: "#f3ece3",
        muted: "#c4b8aa",
        faint: "#ab9f92",
        line: "#3a312b",
        "line-strong": "#4f433a",
        wine: "#ea9bab",
        "wine-dark": "#f5b7c3",
        "wine-soft": "#3a2027",
        "on-wine": "#1d1815",
        gold: "#c9a56a",
        "gold-soft": "#352b1c",
        "gold-ink": "#e5c892",
        canvas: "#f6efe4",
      },
      true,
    ),
  },
  linen: {
    id: "linen",
    name: "Linen",
    premium: false,
    description: "Natural flax with a fine woven grain.",
    texture: "linen",
    font: "fraunces",
    cover: "stripes",
    colors: palette({
      paper: "#eee6d8",
      surface: "#f8f3e9",
      sunken: "#e6dccb",
      ink: "#29231c",
      muted: "#574d41",
      faint: "#625749",
      line: "#d9ccb7",
      "line-strong": "#c4b59c",
      wine: "#7a2a33",
      "wine-dark": "#5e1f27",
      "wine-soft": "#f0dfda",
      "on-wine": "#fbf7ef",
      gold: "#a8834a",
      "gold-soft": "#efe2c9",
      "gold-ink": "#6b4e1e",
      canvas: "#fbf8f1",
    }),
  },
  cotton: {
    id: "cotton",
    name: "Cotton",
    premium: false,
    description: "Crisp white cotton, cool and airy.",
    texture: "cotton",
    font: "fraunces",
    cover: "plain",
    colors: palette({
      paper: "#f6f7f5",
      surface: "#ffffff",
      sunken: "#edf0ec",
      ink: "#1b1f23",
      muted: "#4d555c",
      faint: "#5a636a",
      line: "#e0e4df",
      "line-strong": "#cbd1ca",
      wine: "#87203a",
      "wine-dark": "#6a182d",
      "wine-soft": "#f6e7eb",
      "on-wine": "#ffffff",
      gold: "#b3904f",
      "gold-soft": "#f4ecdb",
      "gold-ink": "#6e5220",
      canvas: "#ffffff",
    }),
  },
  denim: {
    id: "denim",
    name: "Denim",
    premium: false,
    description: "Washed indigo twill with brass-button gold.",
    texture: "denim",
    font: "fraunces",
    cover: "stripes",
    colors: palette({
      paper: "#e6ecf3",
      surface: "#f5f7fa",
      sunken: "#dbe3ec",
      ink: "#13203a",
      muted: "#3d4b62",
      faint: "#4a576c",
      line: "#c9d3e0",
      "line-strong": "#afbdcf",
      wine: "#1f3c70",
      "wine-dark": "#172e57",
      "wine-soft": "#dfe7f3",
      "on-wine": "#f5f7fa",
      gold: "#a8823d",
      "gold-soft": "#efe5cf",
      "gold-ink": "#6a4f1b",
      canvas: "#fbfcfd",
    }),
  },
  silk: {
    id: "silk",
    name: "Silk",
    premium: true,
    description: "Champagne silk with a soft sheen.",
    texture: "silk",
    font: "cormorant",
    cover: "drape",
    colors: palette({
      paper: "#f7efe6",
      surface: "#fffaf3",
      sunken: "#efe4d7",
      ink: "#25191a",
      muted: "#5b4b49",
      faint: "#665653",
      line: "#e8d9c8",
      "line-strong": "#d6c1aa",
      wine: "#8a2c48",
      "wine-dark": "#6d2238",
      "wine-soft": "#f6e3e8",
      "on-wine": "#fffaf3",
      gold: "#b8904c",
      "gold-soft": "#f3e6cd",
      "gold-ink": "#6e5019",
      canvas: "#fffaf3",
    }),
  },
  velvet: {
    id: "velvet",
    name: "Velvet",
    premium: true,
    description: "Deep plum velvet with a rich pile.",
    texture: "velvet",
    font: "playfair",
    cover: "drape",
    colors: palette(
      {
        paper: "#190c12",
        surface: "#23121a",
        sunken: "#2e1822",
        ink: "#f5e7eb",
        muted: "#d2b6be",
        faint: "#b99da6",
        line: "#432634",
        "line-strong": "#5a3446",
        wine: "#eaa3b6",
        "wine-dark": "#f4c0ce",
        "wine-soft": "#3f1d2c",
        "on-wine": "#23121a",
        gold: "#d1ae6c",
        "gold-soft": "#3a2a1c",
        "gold-ink": "#e8cc95",
        canvas: "#f8eff2",
      },
      true,
    ),
  },
  brocade: {
    id: "brocade",
    name: "Brocade",
    premium: true,
    description: "Benarasi brocade: woven gold buti on silk.",
    texture: "brocade",
    font: "cormorant",
    cover: "motif",
    colors: palette({
      paper: "#f5ecda",
      surface: "#fffaee",
      sunken: "#ede1c9",
      ink: "#28190e",
      muted: "#58452f",
      faint: "#64503a",
      line: "#e3d2b0",
      "line-strong": "#cfb789",
      wine: "#7c1d24",
      "wine-dark": "#60161c",
      "wine-soft": "#f3dfd8",
      "on-wine": "#fffaee",
      gold: "#a8812f",
      "gold-soft": "#f0e0ba",
      "gold-ink": "#664a12",
      canvas: "#fffbf2",
    }),
  },
  khadi: {
    id: "khadi",
    name: "Khadi",
    premium: true,
    description: "Hand-spun khadi with earthy slubs.",
    texture: "khadi",
    font: "fraunces",
    cover: "stripes",
    colors: palette({
      paper: "#efe8da",
      surface: "#f8f4ea",
      sunken: "#e5dccb",
      ink: "#2a251e",
      muted: "#564c3f",
      faint: "#61574a",
      line: "#dacfbc",
      "line-strong": "#c6b89f",
      wine: "#6e3a1f",
      "wine-dark": "#552c17",
      "wine-soft": "#efe0d4",
      "on-wine": "#f8f4ea",
      gold: "#a07e44",
      "gold-soft": "#ede1c8",
      "gold-ink": "#634a1c",
      canvas: "#fbf8f1",
    }),
  },
  chiffon: {
    id: "chiffon",
    name: "Chiffon",
    premium: true,
    description: "Blush chiffon, light and sheer.",
    texture: "chiffon",
    font: "playfair",
    cover: "drape",
    colors: palette({
      paper: "#fbf3f5",
      surface: "#fffafb",
      sunken: "#f5e8ec",
      ink: "#2a1d23",
      muted: "#5c4a52",
      faint: "#68555e",
      line: "#efdde3",
      "line-strong": "#e0c6cf",
      wine: "#982d53",
      "wine-dark": "#7a2443",
      "wine-soft": "#fae6ed",
      "on-wine": "#fffafb",
      gold: "#b88f55",
      "gold-soft": "#f6ebda",
      "gold-ink": "#6e5122",
      canvas: "#fffafb",
    }),
  },
};

/** Text-on-background pairs that must pass WCAG AA (4.5:1) in every theme. */
export const TEXT_PAIRS: [ColorToken, ColorToken][] = [
  ["ink", "paper"],
  ["ink", "surface"],
  ["ink", "sunken"],
  ["muted", "paper"],
  ["muted", "surface"],
  ["muted", "sunken"],
  ["faint", "surface"],
  ["faint", "paper"],
  ["wine", "surface"],
  ["wine", "paper"],
  ["wine", "wine-soft"],
  ["on-wine", "wine"],
  ["on-wine", "wine-dark"],
  ["gold-ink", "gold-soft"],
  ["gold-ink", "surface"],
  ["ok", "surface"],
  ["ok", "ok-soft"],
  ["warn", "surface"],
  ["warn", "warn-soft"],
  ["err", "surface"],
  ["err", "err-soft"],
  ["ink", "err-soft"],
  ["ink", "warn-soft"],
  ["on-overlay", "overlay"],
];

/** The pairs in a palette that are below `target` (empty when everything is readable). */
export function contrastProblems(colors: Palette, target = 4.5): { pair: [ColorToken, ColorToken]; ratio: number }[] {
  return TEXT_PAIRS.map((pair) => ({ pair, ratio: contrast(colors[pair[0]], colors[pair[1]]) })).filter((p) => p.ratio < target);
}

// ---------- textures (CSS only) ----------

function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)} / ${alpha})`;
}

/** A subtle background for the whole page (or a profile), drawn with gradients only. */
export function textureCss(texture: TextureId, colors: Palette): { image: string; size: string } {
  const ink = colors.ink;
  const gold = colors.gold;
  const dark = isDark(colors.paper);
  const a = (x: number) => rgba(ink, dark ? x * 0.6 : x);
  switch (texture) {
    case "linen":
      return {
        image: `repeating-linear-gradient(0deg, ${a(0.035)} 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, ${a(0.03)} 0 1px, transparent 1px 4px)`,
        size: "auto",
      };
    case "cotton":
      return { image: `radial-gradient(${a(0.045)} 0.6px, transparent 0.8px)`, size: "5px 5px" };
    case "denim":
      return {
        image: `repeating-linear-gradient(45deg, ${rgba(colors.wine, 0.06)} 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, ${a(0.02)} 0 1px, transparent 1px 6px)`,
        size: "auto",
      };
    case "silk":
      return {
        image: `linear-gradient(115deg, transparent 20%, ${rgba("#ffffff", dark ? 0.04 : 0.45)} 45%, transparent 70%), linear-gradient(160deg, ${rgba(gold, 0.06)}, transparent 60%)`,
        size: "100% 100%",
      };
    case "velvet":
      return {
        image: `radial-gradient(ellipse at 20% 0%, ${rgba(colors.wine, 0.12)}, transparent 55%), radial-gradient(${a(0.05)} 0.7px, transparent 1px)`,
        size: "100% 100%, 3px 3px",
      };
    case "brocade":
      return {
        image: `radial-gradient(circle at 50% 50%, ${rgba(gold, 0.16)} 0 2px, transparent 2.5px), radial-gradient(circle at 0 0, ${rgba(gold, 0.1)} 0 1.5px, transparent 2px), linear-gradient(45deg, transparent 47%, ${rgba(gold, 0.06)} 49% 51%, transparent 53%), linear-gradient(-45deg, transparent 47%, ${rgba(gold, 0.06)} 49% 51%, transparent 53%)`,
        size: "28px 28px",
      };
    case "khadi":
      return {
        image: `repeating-linear-gradient(0deg, ${a(0.04)} 0 1px, transparent 1px 5px), repeating-linear-gradient(90deg, ${a(0.025)} 0 2px, transparent 2px 9px, ${a(0.04)} 9px 10px, transparent 10px 17px)`,
        size: "auto",
      };
    case "chiffon":
      return {
        image: `repeating-linear-gradient(100deg, ${rgba(colors.wine, 0.035)} 0 18px, transparent 18px 46px), linear-gradient(180deg, ${rgba("#ffffff", dark ? 0.02 : 0.35)}, transparent)`,
        size: "auto",
      };
    default:
      return { image: "none", size: "auto" };
  }
}

/** The profile cover banner. */
export function coverCss(cover: CoverId, colors: Palette): string {
  const { wine, gold, sunken, paper } = colors;
  switch (cover) {
    case "stripes":
      return `repeating-linear-gradient(90deg, ${rgba(gold, 0.5)} 0 1px, transparent 1px 14px), linear-gradient(120deg, ${wine}, ${mix(wine, paper, 0.35)})`;
    case "motif":
      return `radial-gradient(circle at 50% 50%, ${rgba(gold, 0.85)} 0 2px, transparent 2.5px) 0 0 / 22px 22px, linear-gradient(135deg, ${wine}, ${mix(wine, "#000000", 0.25)})`;
    case "plain":
      return `linear-gradient(${sunken}, ${sunken})`;
    default:
      return `radial-gradient(120% 140% at 85% -20%, ${rgba(gold, 0.55)}, transparent 55%), linear-gradient(115deg, ${wine} 0%, ${mix(wine, paper, 0.5)} 100%)`;
  }
}

// ---------- custom themes (Premium) ----------

export const DEFAULT_CUSTOM: CustomTheme = { brand: "#7a1f35", background: "#f9f5ee", text: "#1f1a17", texture: "linen", font: "cormorant", cover: "drape" };

export function isValidCustom(c: unknown): c is CustomTheme {
  const x = c as CustomTheme;
  return (
    !!x &&
    HEX.test(x.brand ?? "") &&
    HEX.test(x.background ?? "") &&
    HEX.test(x.text ?? "") &&
    TEXTURES.some((t) => t.id === x.texture) &&
    FONTS.some((f) => f.id === x.font) &&
    COVERS.some((v) => v.id === x.cover)
  );
}

/**
 * Turn a person's three colours into a full palette. Colours that would be hard to read are
 * nudged until they pass WCAG AA; `adjusted` says which ones were changed, so the screen can say so.
 */
export function buildCustomTheme(c: CustomTheme): { theme: ThemeDef; adjusted: ("text" | "brand")[] } {
  const bg = c.background;
  const dark = isDark(bg);
  const toward = dark ? "#ffffff" : "#000000";
  const away = dark ? "#000000" : "#ffffff";
  const surface = mix(bg, away, dark ? 0.15 : 0.6);
  const sunken = mix(bg, toward, dark ? 0.08 : 0.05);
  const adjusted: ("text" | "brand")[] = [];
  const ink = ensureContrast(c.text, sunken, 7);
  if (contrast(c.text, sunken) < 4.5) adjusted.push("text");
  const wine = ensureContrast(c.brand, sunken, 4.5);
  const wineSoft = mix(wine, surface, dark ? 0.8 : 0.9);
  const brandOk = contrast(c.brand, sunken) >= 4.5 && contrast(c.brand, wineSoft) >= 4.5;
  const wineFinal = brandOk ? c.brand : ensureContrast(wine, wineSoft, 4.5);
  if (!brandOk) adjusted.push("brand");
  const base = dark ? THEMES.dark.colors : THEMES.light.colors;
  const muted = ensureContrast(mix(ink, bg, 0.35), sunken, 4.6);
  const colors: Palette = {
    ...base,
    paper: bg,
    surface,
    sunken,
    ink,
    muted,
    faint: ensureContrast(mix(ink, bg, 0.45), sunken, 4.5),
    line: mix(bg, toward, 0.1),
    "line-strong": mix(bg, toward, 0.2),
    wine: wineFinal,
    "wine-dark": mix(wineFinal, toward, 0.2),
    "wine-soft": mix(wineFinal, surface, dark ? 0.8 : 0.9),
    "on-wine": readableOn(wineFinal),
    "gold-soft": mix(base.gold, surface, 0.8),
    "gold-ink": ensureContrast(base["gold-ink"], mix(base.gold, surface, 0.8), 4.5),
    canvas: dark ? THEMES.dark.colors.canvas : "#fffdf8",
  };
  for (const [fg, bgToken] of TEXT_PAIRS) {
    if (contrast(colors[fg], colors[bgToken]) < 4.5) colors[fg] = ensureContrast(colors[fg], colors[bgToken], 4.5);
  }
  return {
    theme: { id: "custom", name: "Custom", premium: true, description: "Your own colours.", colors, texture: c.texture, font: c.font, cover: c.cover },
    adjusted,
  };
}

/** The CSS custom properties that apply a theme to an element (or to the whole page). */
export function themeVars(theme: ThemeDef): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const token of COLOR_TOKENS) vars[`--color-${token}`] = theme.colors[token];
  const texture = textureCss(theme.texture, theme.colors);
  vars["--texture"] = texture.image;
  vars["--texture-size"] = texture.size;
  vars["--cover"] = coverCss(theme.cover, theme.colors);
  vars["--font-display"] = FONTS.find((f) => f.id === theme.font)?.css ?? FONTS[0].css;
  return vars;
}

/** The same as a React style, for one part of a page (a profile, a preview card). */
export function themeStyle(theme: ThemeDef): CSSProperties {
  return { ...themeVars(theme), colorScheme: isDark(theme.colors.paper) ? "dark" : "light" } as CSSProperties;
}

/** The theme to show for a choice ("system" and "default" have no fixed theme). */
export function resolveTheme(choice: string, custom: CustomTheme | null, premium: boolean): ThemeDef | null {
  if (choice === "custom") return premium && custom && isValidCustom(custom) ? buildCustomTheme(custom).theme : null;
  const theme = THEMES[choice as FabricThemeId];
  if (!theme || (theme.premium && !premium)) return null;
  return theme;
}

// ---------- remembering the app theme in this browser ----------

export const THEME_STORAGE_KEY = "drapeit-theme";

/** All variables a theme may set on <html>, so "System" can remove them again. */
export const THEME_VAR_NAMES = [...COLOR_TOKENS.map((t) => `--color-${t}`), "--texture", "--texture-size", "--cover", "--font-display"];

export interface Appearance {
  app_theme: AppThemeChoice;
  profile_theme: ProfileThemeChoice;
  custom_theme: CustomTheme | null;
  is_premium: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = { app_theme: "system", profile_theme: "default", custom_theme: null, is_premium: false };

/** What is kept in localStorage: the choices, and the ready variables for the first paint. */
export interface StoredTheme {
  appearance: Appearance;
  vars: Record<string, string> | null;
  dark: boolean;
}

/** The app theme for these choices; null = follow the device ("System", or a Premium theme without Premium). */
export function appTheme(a: Appearance): ThemeDef | null {
  return a.app_theme === "system" ? null : resolveTheme(a.app_theme, a.custom_theme, a.is_premium);
}

/**
 * Runs in <head> before the page is painted, so a chosen theme shows at once (no flash of
 * Ivory). It only copies saved variables onto <html>; lib/themes.ts made them.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||"null");if(!s||!s.vars)return;var r=document.documentElement;r.setAttribute("data-theme",s.appearance.app_theme);r.style.colorScheme=s.dark?"dark":"light";for(var k in s.vars)r.style.setProperty(k,s.vars[k])}catch(e){}})()`;
