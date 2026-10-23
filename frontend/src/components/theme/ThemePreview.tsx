import type { ReactNode } from "react";
import { THEMES, themeStyle, type ThemeDef } from "@/lib/themes";

/** A small picture of a theme: cover, avatar, a heading in its font, a line of text and a button. */
export function MiniPreview({ theme, className = "" }: { theme: ThemeDef; className?: string }) {
  return (
    <div aria-hidden className={`theme-scope relative h-24 overflow-hidden ${className}`} style={themeStyle(theme)}>
      <div className="cover-banner absolute inset-x-0 top-0 h-8" />
      <div className="absolute left-3 top-4 h-8 w-8 rounded-full border-2 border-surface bg-gold-soft" />
      <div className="absolute inset-x-3 bottom-2.5">
        <p className="font-display text-base leading-none text-ink">Aa</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="h-1.5 w-10 rounded-full bg-muted/50" />
          <span className="h-1.5 w-6 rounded-full bg-gold/60" />
          <span className="ml-auto h-4 w-10 rounded-full bg-wine" />
        </div>
      </div>
    </div>
  );
}

/** "System" / "Default": half light, half dark. */
export function SplitPreview({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`grid h-24 grid-cols-2 overflow-hidden ${className}`}>
      <MiniPreview theme={THEMES.light} />
      <MiniPreview theme={THEMES.dark} />
    </div>
  );
}

/** A larger live preview of a profile and a post in a theme (used by "Customize your theme"). */
export function LargePreview({ theme, name, children }: { theme: ThemeDef; name: string; children?: ReactNode }) {
  return (
    <div className="theme-scope overflow-hidden rounded-xl border border-line shadow-card" style={themeStyle(theme)}>
      <div className="cover-banner h-24" />
      <div className="px-5 pb-5">
        <div className="-mt-8 h-16 w-16 rounded-full border-4 border-paper bg-gold-soft" />
        <p className="eyebrow mt-3">Designer</p>
        <p className="mt-1 font-display text-2xl leading-tight text-ink">{name}</p>
        <p className="mt-1 text-sm text-muted">Bridal lehengas and hand-embroidered blouses.</p>
        <hr className="stitch-divider my-4" />
        <div className="rounded-lg border border-line bg-surface p-3 shadow-card">
          <p className="font-display text-lg text-ink">Wine velvet anarkali</p>
          <p className="mt-0.5 text-xs text-faint">Velvet · Wedding</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-wine px-3 py-1 text-xs font-medium text-on-wine">Follow</span>
            <span className="rounded-full border border-line-strong bg-surface px-3 py-1 text-xs text-ink">Message</span>
            <span className="rounded-full bg-wine-soft px-2 py-0.5 text-[11px] text-wine">#anarkali</span>
            <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[11px] text-gold-ink">Premium</span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
