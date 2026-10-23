"use client";

import { useT } from "@/components/i18n/LanguageProvider";

/** The Drapeit text logo with "by Vistas Atelier" underneath, and optionally the tagline. */
export function Logo({ size = "md", tagline = false, center = false }: { size?: "md" | "lg"; tagline?: boolean; center?: boolean }) {
  const { t } = useT();
  return (
    <span className={`block leading-none ${center ? "text-center" : ""}`}>
      <span className={`font-display italic tracking-[-0.02em] text-wine ${size === "lg" ? "text-[40px]" : "text-[26px]"}`}>Drapeit</span>
      <span className={`mt-1 block text-[10px] uppercase tracking-[0.24em] text-muted ${size === "lg" ? "text-[11px]" : ""}`}>by Vistas Atelier</span>
      {tagline && <span className="mt-3 block font-display text-sm italic text-gold-ink">{t("brand.tagline")}</span>}
    </span>
  );
}
