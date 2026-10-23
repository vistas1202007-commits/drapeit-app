"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useT } from "@/components/i18n/LanguageProvider";
import { useMyProfile } from "@/components/social/MyProfile";
import { LargePreview, MiniPreview, SplitPreview } from "@/components/theme/ThemePreview";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { contrast } from "@/lib/color";
import {
  buildCustomTheme,
  COVERS,
  DEFAULT_CUSTOM,
  FONTS,
  FREE_THEMES,
  PREMIUM_THEMES,
  TEXTURES,
  THEMES,
  type Appearance,
  type CustomTheme,
  type FabricThemeId,
  type ThemeDef,
} from "@/lib/themes";
import { SettingsHeader } from "./SettingsHome";

type Status = { tone: "ok" | "err" | "premium"; text: string } | null;
type Kind = "app" | "profile";

function Section({ id, title, help, children }: { id: string; title: string; help: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-10 scroll-mt-6">
      <h2 id={`${id}-title`} className="font-display text-2xl">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{help}</p>
      {children}
    </section>
  );
}

function ThemeCard({
  name,
  description,
  preview,
  selected,
  locked,
  onSelect,
}: {
  name: string;
  description: string;
  preview: ReactNode;
  selected: boolean;
  locked: boolean;
  onSelect: () => void;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`group overflow-hidden rounded-xl border bg-surface text-left shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        selected ? "border-wine ring-2 ring-wine/25" : "border-line hover:border-gold"
      }`}
    >
      <span className="relative block border-b border-line">
        {preview}
        {locked && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-overlay/75 px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-on-overlay">
            <Icon name="lock" className="h-3 w-3" /> {t("theme.premium")}
          </span>
        )}
        {selected && (
          <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-wine text-on-wine shadow-sm">
            <Icon name="check" className="h-3.5 w-3.5" />
          </span>
        )}
      </span>
      <span className="block px-3 py-2.5">
        <span className="block text-sm font-medium text-ink">{name}</span>
        <span className="mt-0.5 block text-xs text-muted">{description}</span>
      </span>
    </button>
  );
}

/** The 5 free and 5 Premium fabric themes, plus "System" (app) or "Default" (profile), plus "Custom". */
function ThemeGrid({ kind, appearance, onChoose }: { kind: Kind; appearance: Appearance; onChoose: (kind: Kind, id: string) => void }) {
  const { t } = useT();
  const current = kind === "app" ? appearance.app_theme : appearance.profile_theme;
  const custom = buildCustomTheme(appearance.custom_theme ?? DEFAULT_CUSTOM).theme;
  const card = (id: FabricThemeId) => {
    const theme = THEMES[id];
    return (
      <ThemeCard
        key={id}
        name={theme.name}
        description={theme.description}
        preview={<MiniPreview theme={theme} />}
        selected={current === id}
        locked={theme.premium && !appearance.is_premium}
        onSelect={() => onChoose(kind, id)}
      />
    );
  };
  const label = kind === "app" ? t("theme.app") : t("theme.profile");
  return (
    <div className="mt-4 space-y-5">
      <div>
        <p className="eyebrow">{t("theme.free")}</p>
        <div role="group" aria-label={`${label}: ${t("theme.free")}`} className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <ThemeCard
            name={kind === "app" ? t("theme.system") : t("theme.default")}
            description={kind === "app" ? t("theme.systemDesc") : t("theme.defaultDesc")}
            preview={<SplitPreview />}
            selected={current === (kind === "app" ? "system" : "default")}
            locked={false}
            onSelect={() => onChoose(kind, kind === "app" ? "system" : "default")}
          />
          {FREE_THEMES.map(card)}
        </div>
      </div>
      <div>
        <p className="eyebrow flex items-center gap-2">
          {t("theme.premium")} {!appearance.is_premium && <Badge tone="gold">{t("theme.premium")} · soon</Badge>}
        </p>
        <div role="group" aria-label={`${label}: ${t("theme.premium")}`} className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {PREMIUM_THEMES.map(card)}
          <ThemeCard
            name={t("theme.custom")}
            description={t("theme.customDesc")}
            preview={<MiniPreview theme={custom} />}
            selected={current === "custom"}
            locked={!appearance.is_premium}
            onSelect={() => onChoose(kind, "custom")}
          />
        </div>
      </div>
    </div>
  );
}

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value);
  }
  const id = `colour-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} picker`}
          className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-line-strong bg-surface p-1"
        />
        <input
          id={id}
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          className={`${inputClass} font-mono uppercase`}
        />
      </div>
    </div>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; name: string }[]; onChange: (v: T) => void }) {
  const id = `select-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={inputClass}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function Ratio({ label, a, b }: { label: string; a: string; b: string }) {
  const r = contrast(a, b);
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className={r >= 4.5 ? "font-medium text-ok" : "font-medium text-err"}>
        {r.toFixed(1)} : 1 {r >= 4.5 ? "AA ✓" : "✗"}
      </span>
    </li>
  );
}

/** "Customize your theme": try your own colours with a live preview. Saving needs Premium. */
function CustomEditor({ appearance, onSave, saving }: { appearance: Appearance; onSave: (c: CustomTheme, useApp: boolean, useProfile: boolean) => void; saving: boolean }) {
  const { t } = useT();
  const { profile } = useMyProfile();
  const [draft, setDraft] = useState<CustomTheme>(appearance.custom_theme ?? DEFAULT_CUSTOM);
  const [useApp, setUseApp] = useState(appearance.app_theme === "custom");
  const [useProfile, setUseProfile] = useState(appearance.profile_theme === "custom");
  const { theme, adjusted } = useMemo(() => buildCustomTheme(draft), [draft]);
  const set = <K extends keyof CustomTheme>(key: K, value: CustomTheme[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const names = { text: t("theme.text"), brand: t("theme.brand") };
  const locked = !appearance.is_premium;

  return (
    <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <ColourField label={t("theme.brand")} value={draft.brand} onChange={(v) => set("brand", v)} />
          <ColourField label={t("theme.background")} value={draft.background} onChange={(v) => set("background", v)} />
          <ColourField label={t("theme.text")} value={draft.text} onChange={(v) => set("text", v)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <Select label={t("theme.texture")} value={draft.texture} options={TEXTURES} onChange={(v) => set("texture", v)} />
          <Select label={t("theme.font")} value={draft.font} options={FONTS} onChange={(v) => set("font", v)} />
          <Select label={t("theme.cover")} value={draft.cover} options={COVERS} onChange={(v) => set("cover", v)} />
        </div>
        <div role="status" aria-live="polite" className={`rounded-lg border px-4 py-3 text-sm ${adjusted.length ? "border-warn/30 bg-warn-soft text-ink" : "border-ok/25 bg-ok-soft text-ink"}`}>
          {adjusted.length ? (
            <>
              <p>{t("theme.adjusted")}</p>
              <ul className="mt-1 list-disc pl-5">
                {adjusted.map((what) => (
                  <li key={what}>
                    {names[what]}: {what === "text" ? draft.text : draft.brand} → <span className="font-mono">{what === "text" ? theme.colors.ink : theme.colors.wine}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>{t("theme.readable")}</p>
          )}
          <ul className="mt-2 space-y-0.5 text-xs">
            <Ratio label="Text on background" a={theme.colors.ink} b={theme.colors.paper} />
            <Ratio label="Brand colour on cards" a={theme.colors.wine} b={theme.colors.surface} />
            <Ratio label="Button text" a={theme.colors["on-wine"]} b={theme.colors.wine} />
          </ul>
        </div>
        <fieldset className="space-y-2 text-sm">
          <legend className="sr-only">Where to use it</legend>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useApp} onChange={(e) => setUseApp(e.target.checked)} className="h-4 w-4 accent-wine" />
            {t("theme.useForApp")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useProfile} onChange={(e) => setUseProfile(e.target.checked)} className="h-4 w-4 accent-wine" />
            {t("theme.useForProfile")}
          </label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={locked} loading={saving} onClick={() => onSave(draft, useApp, useProfile)}>
            {locked && <Icon name="lock" className="h-3.5 w-3.5" />}
            {t("theme.saveCustom")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDraft(DEFAULT_CUSTOM)}>
            <Icon name="undo" className="h-3.5 w-3.5" /> Reset
          </Button>
        </div>
        {locked && (
          <p className="flex items-start gap-2 text-xs text-muted">
            <Badge tone="gold">{t("theme.premium")}</Badge> {t("theme.locked")}
          </p>
        )}
      </div>
      <div>
        <p className="eyebrow mb-2">{t("theme.preview")}</p>
        <LargePreview theme={theme} name={profile?.display_name || profile?.username || "Your name"} />
      </div>
    </div>
  );
}

/** /settings/theme: app theme, profile theme and the custom theme. */
export function ThemeSettings() {
  const { t } = useT();
  const { appearance, setAppearance } = useTheme();
  const { profile } = useMyProfile();
  const [status, setStatus] = useState<Status>(null);
  const [saving, setSaving] = useState(false);

  async function save(change: Partial<Pick<Appearance, "app_theme" | "profile_theme" | "custom_theme">>) {
    const before = appearance;
    setAppearance({ ...appearance, ...change }); // show it at once
    setSaving(true);
    setStatus(null);
    try {
      setAppearance(await api.saveAppearance(change));
      setStatus({ tone: "ok", text: t("theme.saved") });
    } catch (e) {
      setAppearance(before);
      const message = e instanceof Error ? e.message : "Could not save the theme.";
      setStatus(message.includes("Premium") ? { tone: "premium", text: t("theme.comingSoon") } : { tone: "err", text: message });
    } finally {
      setSaving(false);
    }
  }

  function choose(kind: Kind, id: string) {
    const premium = id === "custom" || (THEMES[id as FabricThemeId] as ThemeDef | undefined)?.premium;
    if (premium && !appearance.is_premium) {
      setStatus({ tone: "premium", text: t("theme.comingSoon") });
      return;
    }
    if (id === "custom" && !appearance.custom_theme) {
      document.getElementById("custom")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    void save(kind === "app" ? { app_theme: id as Appearance["app_theme"] } : { profile_theme: id as Appearance["profile_theme"] });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <SettingsHeader title={t("settings.theme")}>{t("settings.themeDesc")}</SettingsHeader>

      <div aria-live="polite" className="sticky top-16 z-20 mt-4 lg:top-4">
        {status && (
          <p
            className={`flex items-start gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-md animate-fade ${
              status.tone === "ok" ? "border-ok/25 bg-ok-soft" : status.tone === "err" ? "border-err/25 bg-err-soft" : "border-gold/40 bg-gold-soft"
            }`}
            role={status.tone === "err" ? "alert" : "status"}
          >
            {status.tone === "premium" && <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" />}
            <span className="flex-1">{status.text}</span>
            <button type="button" onClick={() => setStatus(null)} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Close message">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </p>
        )}
      </div>

      <Section id="app" title={t("theme.app")} help={t("theme.appHelp")}>
        <ThemeGrid kind="app" appearance={appearance} onChoose={choose} />
      </Section>

      <hr aria-hidden className="stitch-divider mt-10" />

      <Section id="profile" title={t("theme.profile")} help={t("theme.profileHelp")}>
        {profile && (
          <Link href={`/u/${profile.username}`} className="mt-2 inline-flex items-center gap-1 text-sm text-wine hover:underline">
            {t("theme.viewProfile")} <Icon name="chevronRight" className="h-3.5 w-3.5" />
          </Link>
        )}
        <ThemeGrid kind="profile" appearance={appearance} onChoose={choose} />
      </Section>

      <hr aria-hidden className="stitch-divider mt-10" />

      <Section id="custom" title={t("theme.custom")} help={t("theme.customDesc")}>
        <CustomEditor
          appearance={appearance}
          saving={saving}
          onSave={(custom, useApp, useProfile) =>
            void save({ custom_theme: custom, ...(useApp ? { app_theme: "custom" as const } : {}), ...(useProfile ? { profile_theme: "custom" as const } : {}) })
          }
        />
      </Section>
    </div>
  );
}
