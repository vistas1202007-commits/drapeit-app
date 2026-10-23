"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { isLanguage, LANGUAGE_STORAGE_KEY, LANGUAGES, translate, type Language, type MessageKey } from "@/lib/i18n";

interface LanguageValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: MessageKey) => string;
}

const LanguageContext = createContext<LanguageValue | null>(null);

/** The chosen language, remembered in this browser. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>("en");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      /* storage blocked: stay in English */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved choice is only known in the browser
    if (isLanguage(saved)) setLangState(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = LANGUAGES.find((l) => l.id === lang)?.htmlLang ?? "en";
  }, [lang]);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      /* not remembered, but still used for this visit */
    }
  }, []);

  const t = useCallback((key: MessageKey) => translate(lang, key), [lang]);
  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useT(): LanguageValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useT must be used inside <LanguageProvider>");
  return ctx;
}
