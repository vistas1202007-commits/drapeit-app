import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, ensureContrast } from "./color";
import { appTheme, buildCustomTheme, COLOR_TOKENS, contrastProblems, FREE_THEMES, PREMIUM_THEMES, resolveTheme, THEMES, themeVars, type CustomTheme } from "./themes";

describe("themes", () => {
  it.each([...FREE_THEMES, ...PREMIUM_THEMES])("%s passes WCAG AA for every text pair", (id) => {
    expect(contrastProblems(THEMES[id].colors)).toEqual([]);
  });

  it("defines every colour token in every theme", () => {
    for (const theme of Object.values(THEMES)) {
      for (const token of COLOR_TOKENS) expect(theme.colors[token], `${theme.id} ${token}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps globals.css (the first paint, before JavaScript) the same as the Ivory and Midnight themes", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const light = css.slice(css.indexOf("@theme"), css.indexOf("/* end of light tokens */"));
    const dark = css.slice(css.indexOf("/* dark tokens */"), css.indexOf("/* end of dark tokens */"));
    for (const token of COLOR_TOKENS) {
      expect(light, `light ${token}`).toContain(`--color-${token}: ${THEMES.light.colors[token]};`);
      expect(dark, `dark ${token}`).toContain(`--color-${token}: ${THEMES.dark.colors[token]};`);
    }
  });

  it("follows the device for System, and for a Premium theme kept after Premium ended", () => {
    const base = { app_theme: "system", profile_theme: "default", custom_theme: null, is_premium: false } as const;
    expect(appTheme(base)).toBeNull();
    expect(appTheme({ ...base, app_theme: "linen" })?.id).toBe("linen");
    expect(appTheme({ ...base, app_theme: "velvet" })).toBeNull();
    expect(appTheme({ ...base, app_theme: "velvet", is_premium: true })?.id).toBe("velvet");
  });

  it("only gives Premium themes to Premium members", () => {
    expect(resolveTheme("silk", null, false)).toBeNull();
    expect(resolveTheme("silk", null, true)?.id).toBe("silk");
    expect(resolveTheme("denim", null, false)?.id).toBe("denim");
    expect(resolveTheme("system", null, false)).toBeNull();
    expect(themeVars(THEMES.denim)["--color-wine"]).toBe(THEMES.denim.colors.wine);
  });
});

describe("custom themes", () => {
  const base: CustomTheme = { brand: "#7a1f35", background: "#f9f5ee", text: "#1f1a17", texture: "linen", font: "cormorant", cover: "drape" };

  it("keeps readable choices as they are", () => {
    const { theme, adjusted } = buildCustomTheme(base);
    expect(adjusted).toEqual([]);
    expect(theme.colors.wine).toBe("#7a1f35");
    expect(contrastProblems(theme.colors)).toEqual([]);
  });

  it.each([
    ["pale text on a light background", { ...base, text: "#e8e2da" }, "text"],
    ["a pale brand colour", { ...base, brand: "#f2c6d0" }, "brand"],
    ["dark background with a dark brand", { ...base, background: "#121212", text: "#f5f5f5", brand: "#3a0a14" }, "brand"],
    ["mid grey everything", { ...base, background: "#808080", text: "#909090", brand: "#888888" }, "text"],
  ])("fixes %s and still passes AA", (_name, custom, what) => {
    const { theme, adjusted } = buildCustomTheme(custom as CustomTheme);
    expect(adjusted).toContain(what);
    expect(contrastProblems(theme.colors)).toEqual([]);
  });

  it("nudges a colour just far enough", () => {
    const fixed = ensureContrast("#bbbbbb", "#ffffff");
    expect(contrast(fixed, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(ensureContrast("#000000", "#ffffff")).toBe("#000000");
  });
});
