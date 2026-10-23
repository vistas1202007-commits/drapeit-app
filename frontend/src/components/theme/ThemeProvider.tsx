"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { isDark } from "@/lib/color";
import { appTheme, DEFAULT_APPEARANCE, THEME_STORAGE_KEY, THEME_VAR_NAMES, themeVars, type Appearance, type StoredTheme } from "@/lib/themes";

interface ThemeValue {
  appearance: Appearance;
  /** Use these choices now (and remember them in this browser). Saving to the account is separate. */
  setAppearance: (a: Appearance) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function readStored(): StoredTheme | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredTheme) : null;
  } catch {
    return null;
  }
}

/** Put the app theme on <html>. "System" removes it, so globals.css follows the device's light / dark. */
function apply(a: Appearance) {
  const root = document.documentElement;
  const theme = appTheme(a);
  for (const name of THEME_VAR_NAMES) root.style.removeProperty(name);
  const stored: StoredTheme = { appearance: a, vars: null, dark: false };
  if (theme) {
    const vars = themeVars(theme);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    root.setAttribute("data-theme", a.app_theme);
    root.style.colorScheme = isDark(theme.colors.paper) ? "dark" : "light";
    stored.vars = vars;
    stored.dark = isDark(theme.colors.paper);
  } else {
    root.removeAttribute("data-theme");
    root.style.removeProperty("color-scheme");
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* not remembered, but still used for this visit */
  }
}

/** The app theme, remembered in this browser (the account copy is loaded by <ThemeSync>). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setState] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    const stored = readStored();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved choice is only known in the browser
    if (stored?.appearance) setState({ ...DEFAULT_APPEARANCE, ...stored.appearance });
  }, []);

  const setAppearance = useCallback((a: Appearance) => {
    setState(a);
    apply(a);
  }, []);

  return <ThemeContext.Provider value={{ appearance, setAppearance }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/** After sign-in: the themes saved to the account win over this browser's copy. */
export function ThemeSync() {
  const { setAppearance } = useTheme();
  useEffect(() => {
    let cancelled = false;
    api
      .appearance()
      .then((a) => !cancelled && setAppearance(a))
      .catch(() => {
        /* backend offline or migration 0011 not run yet: keep this browser's theme */
      });
    return () => {
      cancelled = true;
    };
  }, [setAppearance]);
  return null;
}
