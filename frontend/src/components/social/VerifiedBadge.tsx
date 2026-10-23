"use client";

import { useT } from "@/components/i18n/LanguageProvider";

/** The small wine tick shown after a verified person's name. Renders nothing for others. */
export function VerifiedBadge({ person, className = "h-3.5 w-3.5" }: { person: { verified?: boolean } | null | undefined; className?: string }) {
  const { t } = useT();
  if (!person?.verified) return null;
  const label = t("badge.verified");
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={label} className={`inline-block shrink-0 align-[-2px] text-wine ${className}`}>
      <title>{label}</title>
      <path
        fill="currentColor"
        d="M12 2l2.4 1.8 3-.2 1 2.8 2.6 1.6-.8 2.9.8 2.9-2.6 1.6-1 2.8-3-.2L12 22l-2.4-1.8-3 .2-1-2.8L3 16l.8-2.9L3 10.2l2.6-1.6 1-2.8 3 .2z"
      />
      <path d="M8 12.2l2.6 2.6L16 9.4" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
