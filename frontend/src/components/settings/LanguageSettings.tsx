"use client";

import { useState } from "react";
import { useT } from "@/components/i18n/LanguageProvider";
import { LANGUAGES } from "@/lib/i18n";
import { SettingsHeader } from "./SettingsHome";

/** /settings/language: English, Hindi or Hinglish, remembered in this browser. */
export function LanguageSettings() {
  const { lang, setLang, t } = useT();
  const [changed, setChanged] = useState(false);
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <SettingsHeader title={t("settings.language")} />
      <fieldset className="mt-5 space-y-2">
        <legend className="sr-only">{t("settings.language")}</legend>
        {LANGUAGES.map((l) => (
          <label
            key={l.id}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border bg-surface px-4 py-3 ${lang === l.id ? "border-wine ring-2 ring-wine/15" : "border-line hover:border-line-strong"}`}
          >
            <input
              type="radio"
              name="language"
              checked={lang === l.id}
              onChange={() => {
                setLang(l.id);
                setChanged(true);
              }}
              className="accent-wine"
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{l.label}</span>
              <span className="block text-xs text-muted" lang={l.htmlLang}>
                {l.sample}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {changed && (
        <p role="status" className="mt-3 text-sm text-ok">
          {t("settings.languageSaved")}
        </p>
      )}
      <p className="mt-4 text-xs text-muted">{t("settings.languageNote")}</p>
    </div>
  );
}
