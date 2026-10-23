"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { MessageKey } from "@/lib/i18n";

interface Item {
  title: MessageKey;
  desc?: MessageKey;
  href: string;
  /** Extra English words people may search for. */
  keywords: string;
}

interface Section {
  title: MessageKey;
  desc: MessageKey;
  icon: IconName;
  href: string;
  items: Item[];
}

export const SECTIONS: Section[] = [
  {
    title: "settings.account",
    desc: "settings.accountDesc",
    icon: "user",
    href: "/settings/account",
    items: [
      { title: "settings.editProfile", desc: "settings.editProfileDesc", href: "/profile/edit", keywords: "name username bio photo picture avatar" },
      { title: "settings.changeEmail", href: "/settings/account#email", keywords: "email address login" },
      { title: "settings.changePassword", href: "/settings/account#password", keywords: "password security login" },
      { title: "settings.verification", desc: "settings.verificationDesc", href: "/settings/verification", keywords: "verified badge tick blue verification" },
      { title: "settings.downloadData", href: "/settings/account#download", keywords: "download export data json copy backup" },
      { title: "settings.deactivate", href: "/settings/account#deactivate", keywords: "deactivate pause hide break" },
      { title: "settings.deleteAccount", href: "/settings/account#delete", keywords: "delete remove close account permanently" },
    ],
  },
  {
    title: "settings.privacy",
    desc: "settings.privacyDesc",
    icon: "shield",
    href: "/settings/privacy",
    items: [
      { title: "settings.privateAccount", href: "/settings/privacy", keywords: "private public followers requests" },
      { title: "settings.whoCanMessage", href: "/settings/privacy#messages", keywords: "messages chat dm requests" },
      { title: "settings.whoCanComment", href: "/settings/privacy#comments", keywords: "comments replies" },
      { title: "settings.whoCanMention", href: "/settings/privacy#mentions", keywords: "mention tag @" },
      { title: "settings.hiddenWords", href: "/settings/privacy#hidden-words", keywords: "hidden words filter abuse offensive" },
      { title: "settings.blocked", href: "/settings/privacy#blocked", keywords: "block blocked restrict mute unblock" },
      { title: "settings.closeFriends", href: "/close-friends", keywords: "close friends list" },
    ],
  },
  {
    title: "settings.notifications",
    desc: "settings.notificationsDesc",
    icon: "bell",
    href: "/settings/notifications",
    items: [{ title: "settings.notifications", desc: "settings.notificationsDesc", href: "/settings/notifications", keywords: "notifications alerts likes comments follows" }],
  },
  {
    title: "settings.activity",
    desc: "settings.activityDesc",
    icon: "history",
    href: "/settings/activity",
    items: [
      { title: "settings.timeSpent", href: "/settings/activity#time", keywords: "time spent usage minutes" },
      { title: "settings.likes", href: "/settings/activity#likes", keywords: "likes liked posts hearts" },
      { title: "settings.comments", href: "/settings/activity#comments", keywords: "my comments" },
      { title: "settings.archived", href: "/settings/activity#archived", keywords: "archived hidden posts" },
      { title: "settings.recentlyDeleted", href: "/settings/activity#deleted", keywords: "recently deleted restore trash bin" },
      { title: "settings.searchHistory", href: "/settings/activity#searches", keywords: "search history clear" },
    ],
  },
  {
    title: "settings.theme",
    desc: "settings.themeDesc",
    icon: "palette",
    href: "/settings/theme",
    items: [
      { title: "theme.app", href: "/settings/theme#app", keywords: "theme appearance dark mode light night colour color look" },
      { title: "theme.profile", href: "/settings/theme#profile", keywords: "profile theme cover banner background visitors" },
      { title: "theme.custom", href: "/settings/theme#custom", keywords: "custom colours colors font texture premium fabric silk velvet brocade khadi chiffon" },
    ],
  },
  {
    title: "settings.language",
    desc: "settings.languageDesc",
    icon: "book",
    href: "/settings/language",
    items: [{ title: "settings.language", desc: "settings.languageDesc", href: "/settings/language", keywords: "language hindi english hinglish bhasha" }],
  },
  {
    title: "settings.help",
    desc: "settings.helpDesc",
    icon: "comment",
    href: "/help",
    items: [
      { title: "settings.faq", href: "/help#faq", keywords: "faq help questions how" },
      { title: "settings.reportProblem", href: "/help#report", keywords: "report problem bug issue broken" },
      { title: "settings.contact", href: "/help#contact", keywords: "contact support email" },
    ],
  },
  {
    title: "settings.legal",
    desc: "settings.legalDesc",
    icon: "flag",
    href: "/legal/terms",
    items: [
      { title: "settings.terms", href: "/legal/terms", keywords: "terms service rules legal" },
      { title: "settings.privacyPolicy", href: "/legal/privacy", keywords: "privacy policy data legal" },
      { title: "settings.guidelines", href: "/legal/guidelines", keywords: "community guidelines rules" },
    ],
  },
  {
    title: "settings.ai",
    desc: "settings.aiDesc",
    icon: "plug",
    href: "/settings/ai-providers",
    items: [{ title: "settings.ai", desc: "settings.aiDesc", href: "/settings/ai-providers", keywords: "ai providers api keys cost spending anthropic gemini openai" }],
  },
];

/** The back link and title every settings page shares. */
export function SettingsHeader({ title, children }: { title: string; children?: ReactNode }) {
  const { t } = useT();
  return (
    <div className="animate-rise">
      <Link href="/settings" className="eyebrow hover:text-wine">
        ← {t("settings.title")}
      </Link>
      <h1 className="mt-1.5 font-display text-3xl sm:text-[38px]">{title}</h1>
      {children && <p className="mt-1 text-sm text-muted">{children}</p>}
    </div>
  );
}

/** /settings: every setting in one place, with a search box. */
export function SettingsHome() {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    return SECTIONS.flatMap((s) =>
      s.items
        .filter((item) => {
          const text = [t(item.title), item.desc ? t(item.desc) : "", t(s.title), item.keywords].join(" ").toLowerCase();
          return words.every((w) => text.includes(w));
        })
        .map((item) => ({ item, section: s })),
    );
  }, [query, t]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <p className="eyebrow animate-rise">Drapeit</p>
      <h1 className="mt-1.5 animate-rise font-display text-3xl sm:text-[38px]">{t("settings.title")}</h1>
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 focus-within:border-wine focus-within:ring-2 focus-within:ring-wine/15">
        <Icon name="search" className="h-4 w-4 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("settings.search")}
          aria-label={t("settings.search")}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-faint focus:outline-none"
        />
      </div>

      {matches ? (
        matches.length === 0 ? (
          <p className="mt-6 text-sm text-muted">{t("settings.noResults")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            {matches.map(({ item, section }) => (
              <li key={item.href + item.title}>
                <Link href={item.href} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/70">
                  <Icon name={section.icon} className="h-5 w-5 shrink-0 text-wine" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{t(item.title)}</span>
                    <span className="block truncate text-xs text-muted">{t(section.title)}</span>
                  </span>
                  <Icon name="chevronRight" className="h-4 w-4 text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="mt-5 space-y-3">
          {SECTIONS.map((s) => (
            <li key={s.href}>
              <Link href={s.href} className="flex items-center gap-4 rounded-lg border border-line bg-surface shadow-card px-4 py-3.5 hover:border-line-strong hover:bg-sunken/40">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wine-soft text-wine">
                  <Icon name={s.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t(s.title)}</span>
                  <span className="block text-xs text-muted">{t(s.desc)}</span>
                </span>
                <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
