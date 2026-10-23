"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLive } from "@/components/chat/LiveUpdates";
import { useT } from "@/components/i18n/LanguageProvider";
import { useMyProfile } from "@/components/social/MyProfile";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { api } from "@/lib/api";
import { badgeLabel } from "@/lib/chat";
import type { MessageKey } from "@/lib/i18n";
import { AccountBanner, AccountStatusProvider, useAccountStatus, useTimeTracker } from "./AccountBanner";
import { BackendStatus } from "./BackendStatus";

const NAV: { href: string; label: MessageKey; icon: IconName }[] = [
  { href: "/", label: "nav.dashboard", icon: "home" },
  { href: "/feed", label: "nav.feed", icon: "feed" },
  { href: "/explore", label: "nav.explore", icon: "compass" },
  { href: "/messages", label: "nav.messages", icon: "chat" },
  { href: "/notifications", label: "nav.notifications", icon: "bell" },
  { href: "/designs", label: "nav.designs", icon: "grid" },
  { href: "/saved", label: "nav.saved", icon: "bookmark" },
  { href: "/resources", label: "nav.library", icon: "book" },
  { href: "/settings", label: "nav.settings", icon: "settings" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/projects");
  return pathname.startsWith(href) || (href === "/settings" && (pathname === "/help" || pathname.startsWith("/legal")));
}

/** The unread number for a menu item (chats with new messages + requests, or unread notifications). */
function useNavCounts(): Record<string, number> {
  const { badges } = useLive();
  if (!badges) return {};
  return { "/messages": badges.chats + badges.requests, "/notifications": badges.notifications };
}

function CountBubble({ n, label }: { n: number; label: string }) {
  if (n <= 0) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-wine px-1.5 text-center text-[11px] font-medium leading-5 text-on-wine">
      {badgeLabel(n)}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

function NavLinks({ onNavigate, pathname }: { onNavigate: () => void; pathname: string | null }) {
  const { profile } = useMyProfile();
  const { t } = useT();
  const counts = useNavCounts();
  const { status } = useAccountStatus();
  // Your own profile, or the page to set one up.
  const me = profile
    ? { href: `/u/${profile.username}`, label: "nav.profile" as MessageKey, icon: "user" as IconName }
    : { href: "/profile/edit", label: "nav.setUpProfile" as MessageKey, icon: "user" as IconName };
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {[...NAV.slice(0, 7), me, ...NAV.slice(7), ...(status?.is_admin ? [{ href: "/admin", label: "nav.admin" as MessageKey, icon: "shield" as IconName }] : [])].map((item) => {
        const active = pathname !== null && isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-wine-soft font-medium text-wine before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-gold"
                : "text-muted hover:bg-sunken hover:text-ink"
            }`}
          >
            <Icon name={item.icon} />
            {t(item.label)}
            <CountBubble n={counts[item.href] ?? 0} label={item.href === "/messages" ? "unread chats" : "unread notifications"} />
          </Link>
        );
      })}
    </nav>
  );
}

// The current URL is only known in the browser, so the highlighted link is
// rendered inside <Suspense> (Next.js needs this to pre-render the page shell).
function ActiveNav({ onNavigate }: { onNavigate: () => void }) {
  return <NavLinks onNavigate={onNavigate} pathname={usePathname()} />;
}

/** Tells the user honestly whether real AI or mock providers are switched on. */
function ModeCard() {
  const { t } = useT();
  const [live, setLive] = useState<string[] | null>(null);
  useEffect(() => {
    api
      .providers()
      .then((o) => setLive([...new Set(o.services.filter((s) => s.configured && !s.is_mock && s.paid).map((s) => s.provider.split(" ")[0]))]))
      .catch(() => setLive(null));
  }, []);
  if (live === null) return null;
  if (live.length === 0) {
    return (
      <Link href="/settings/ai-providers" className="mt-auto block rounded-md border border-warn/25 bg-warn-soft px-3 py-2.5 text-xs text-ink">
        <p className="font-medium">{t("nav.demoMode")}</p>
        <p className="mt-0.5 text-muted">{t("nav.demoModeText")}</p>
      </Link>
    );
  }
  return (
    <Link href="/settings/ai-providers" className="mt-auto block rounded-md border border-ok/25 bg-ok-soft px-3 py-2.5 text-xs text-ink">
      <p className="font-medium">{t("nav.realAi")}</p>
      <p className="mt-0.5 text-muted">Using {live.join(" and ")}. Each use costs a little; see spending.</p>
    </Link>
  );
}

/** Who is signed in, with a sign-out button. */
function Account() {
  const { email, signOut } = useAuth();
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs">
      <span className="min-w-0 truncate text-muted" title={email}>
        {email}
      </span>
      <button
        type="button"
        className="shrink-0 rounded px-2 py-1 text-muted hover:bg-sunken hover:text-wine disabled:opacity-50"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signOut();
        }}
      >
        {t("nav.signOut")}
      </button>
    </div>
  );
}

/** Messages and Notifications buttons for the phone's top bar, with a dot when something is new. */
function MobileShortcuts({ onNavigate }: { onNavigate: () => void }) {
  const counts = useNavCounts();
  const items: { href: string; label: string; icon: IconName }[] = [
    { href: "/notifications", label: "Notifications", icon: "bell" },
    { href: "/messages", label: "Messages", icon: "chat" },
  ];
  return (
    <>
      {items.map((item) => {
        const n = counts[item.href] ?? 0;
        return (
          <Link key={item.href} href={item.href} onClick={onNavigate} className="relative rounded-md p-2 hover:bg-sunken" aria-label={n ? `${item.label} (${n} new)` : item.label}>
            <Icon name={item.icon} className="h-5 w-5" />
            {n > 0 && <span aria-hidden className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-wine" />}
          </Link>
        );
      })}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AccountStatusProvider>
      <Shell>{children}</Shell>
    </AccountStatusProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useTimeTracker();
  const close = () => setOpen(false);
  const nav = (
    <Suspense fallback={<NavLinks onNavigate={close} pathname={null} />}>
      <ActiveNav onNavigate={close} />
    </Suspense>
  );

  const brand = (
    <Link href="/" className="block" onClick={() => setOpen(false)}>
      <Logo />
    </Link>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface/90 px-4 py-7 backdrop-blur lg:flex">
        <div className="px-3">{brand}</div>
        <hr aria-hidden className="stitch-divider mx-3 mt-6" />
        <div className="mt-5">{nav}</div>
        <ModeCard />
        <Account />
      </aside>

      {/* Mobile top bar */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 shadow-sm backdrop-blur lg:hidden">
        {brand}
        <div className="flex items-center gap-1">
          <MobileShortcuts onNavigate={close} />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="rounded-md p-2 hover:bg-sunken"
          >
            <Icon name={open ? "close" : "menu"} className="h-5 w-5" />
          </button>
        </div>
      </header>
      {open && (
        <div className="no-print animate-fade border-b border-line bg-surface px-4 py-3 shadow-md lg:hidden">
          {nav}
          <Account />
        </div>
      )}

      <main className="min-w-0 flex-1">
        <BackendStatus />
        <AccountBanner />
        {children}
      </main>
    </div>
  );
}
