"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Button, buttonClass } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { localDay } from "@/lib/activity";
import { formatDate, formatDateTime } from "@/lib/format";
import { ONBOARDING_STEPS } from "@/lib/onboarding";
import type { AccountStatus, Onboarding } from "@/lib/types";

// How often "the app is open" is sent for Your activity → Time spent.
const PING_MS = 60_000;
const BANNER_HIDDEN_KEY = "croquis-onboarding-banner-hidden";
const AUTO_OPENED_KEY = "croquis-onboarding-opened";

/** Count time spent in the app: a small ping each minute while the page is visible. */
export function useTimeTracker() {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === "visible") api.timePing(localDay()).catch(() => {});
    };
    ping();
    const timer = setInterval(ping, PING_MS);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);
}

interface AccountValue {
  /** null while loading (or if the server could not be reached). */
  status: AccountStatus | null;
  setStatus: (s: AccountStatus) => void;
  reload: () => void;
}

const AccountContext = createContext<AccountValue | null>(null);

/** The signed-in person's account state (admin, suspension, warnings, deactivation), loaded once. */
export function AccountStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const reload = useCallback(() => {
    api.account().then(setStatus).catch(() => {});
  }, []);
  useEffect(() => reload(), [reload]);
  return <AccountContext.Provider value={{ status, setStatus, reload }}>{children}</AccountContext.Provider>;
}

export function useAccountStatus(): AccountValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccountStatus must be used inside <AccountStatusProvider>");
  return ctx;
}

function Strip({ tone, children }: { tone: "warn" | "err" | "info"; children: ReactNode }) {
  const colours = { warn: "border-warn/30 bg-warn-soft", err: "border-err/25 bg-err-soft", info: "border-wine/15 bg-wine-soft/70" }[tone];
  return <div className={`no-print flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm sm:px-8 ${colours}`}>{children}</div>;
}

/** Deactivated or waiting to be deleted: the way back. */
function DeactivationStrip({ status }: { status: AccountStatus }) {
  const { setStatus } = useAccountStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status.deactivated && !status.delete_requested_at) return null;

  async function undo() {
    setBusy(true);
    setError(null);
    try {
      const next = status.delete_requested_at ? await api.cancelDelete() : await api.reactivate();
      setStatus({ ...status, ...next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Strip tone="warn">
      <p role="status" className="min-w-0 flex-1">
        {status.delete_requested_at && status.delete_after ? (
          <>
            <span className="font-medium">Your account will be deleted on {formatDate(status.delete_after)}.</span> Until then it is hidden from
            everyone. Changed your mind?
          </>
        ) : (
          <>
            <span className="font-medium">Your account is deactivated.</span> Your profile, posts and comments are hidden from everyone.
          </>
        )}
      </p>
      <Button size="sm" variant="primary" onClick={undo} loading={busy}>
        {status.delete_requested_at ? "Cancel deletion" : "Reactivate"}
      </Button>
      {error && <p className="w-full text-xs text-err">{error}</p>}
    </Strip>
  );
}

/** Suspended by an admin: what it means, why, and until when. */
function SuspensionStrip({ status }: { status: AccountStatus }) {
  const { t } = useT();
  const s = status.suspension;
  if (!s) return null;
  return (
    <Strip tone="err">
      <Icon name="ban" className="h-5 w-5 shrink-0 text-err" />
      <div role="alert" className="min-w-0 flex-1">
        <p className="font-medium">{t("banner.suspended")}</p>
        <p className="text-muted">{t("banner.suspendedText")}</p>
        <p className="mt-0.5 text-xs text-muted">
          {t("banner.reason")}: <span className="text-ink">{s.reason}</span> · {t("banner.ends")}:{" "}
          <span className="text-ink">{s.permanent || !s.ends_at ? t("banner.permanent") : formatDateTime(s.ends_at)}</span>
        </p>
      </div>
      <Link href="/help#report" className="text-xs text-wine hover:underline">
        Think this is a mistake?
      </Link>
    </Strip>
  );
}

/** An admin's warning, until the person presses "I understand". */
function WarningStrip({ status }: { status: AccountStatus }) {
  const { t } = useT();
  const { setStatus } = useAccountStatus();
  const [busy, setBusy] = useState(false);
  const warning = status.warnings[0];
  if (!warning) return null;
  async function acknowledge() {
    setBusy(true);
    try {
      await api.acknowledgeWarning(warning.id);
      setStatus({ ...status, warnings: status.warnings.slice(1) });
    } catch {
      setBusy(false);
    }
  }
  return (
    <Strip tone="warn">
      <Icon name="flag" className="h-5 w-5 shrink-0 text-warn" />
      <div role="alert" className="min-w-0 flex-1">
        <p className="font-medium">{t("banner.warning")}</p>
        <p className="text-ink">{warning.reason}</p>
        <p className="mt-0.5 text-xs text-muted">
          Please read the{" "}
          <Link href="/legal/guidelines" className="text-wine hover:underline">
            Community Guidelines
          </Link>
          . Repeated problems can lead to a suspension.
        </p>
      </div>
      <Button size="sm" onClick={acknowledge} loading={busy}>
        {t("banner.understand")}
      </Button>
    </Strip>
  );
}

/** A gentle reminder to finish onboarding (never a block). New people are taken to /welcome once. */
function OnboardingStrip() {
  const { t } = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<Onboarding | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let wasHidden = false;
    try {
      wasHidden = sessionStorage.getItem(BANNER_HIDDEN_KEY) === "1";
    } catch {
      /* storage blocked: show it */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is only known in the browser
    setHidden(wasHidden);
    api
      .onboarding()
      .then(setState)
      .catch(() => {});
  }, []);

  // The welcome steps change the state. Opening them counts as "taken there once", and leaving them loads the
  // state again, so a finished or skipped person is not sent back and does not see an old reminder.
  const lastPath = useRef(pathname);
  useEffect(() => {
    const leftWelcome = lastPath.current === "/welcome" && pathname !== "/welcome";
    lastPath.current = pathname;
    if (pathname === "/welcome") {
      try {
        sessionStorage.setItem(AUTO_OPENED_KEY, "1");
      } catch {
        /* storage blocked: the redirect below is skipped anyway */
      }
      return;
    }
    if (!leftWelcome) return;
    setState(null); // hide the old reminder until the new state arrives
    api
      .onboarding()
      .then(setState)
      .catch(() => {});
  }, [pathname]);

  useEffect(() => {
    if (!state?.is_new || pathname === "/welcome") return;
    try {
      if (sessionStorage.getItem(AUTO_OPENED_KEY)) return;
      sessionStorage.setItem(AUTO_OPENED_KEY, "1");
    } catch {
      return;
    }
    router.push("/welcome");
  }, [state, pathname, router]);

  // Shown until finished to anyone who started the steps or has no profile yet (people who set up a profile
  // before onboarding existed are not asked again).
  if (!state || state.completed || hidden || pathname === "/welcome" || !(state.started || !state.has_profile)) return null;
  const index = state.step === "done" ? ONBOARDING_STEPS.length - 1 : Math.max(0, ONBOARDING_STEPS.indexOf(state.step));

  return (
    <Strip tone="info">
      <Icon name="sparkle" className="h-5 w-5 shrink-0 text-wine" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{t("onboarding.banner")}</span>{" "}
        <span className="text-muted">
          ({index + 1}/{ONBOARDING_STEPS.length})
        </span>
      </p>
      <Link href="/welcome" className={buttonClass("primary", "sm")}>
        {t("onboarding.continue")}
      </Link>
      <button
        type="button"
        aria-label="Hide for now"
        onClick={() => {
          setHidden(true);
          try {
            sessionStorage.setItem(BANNER_HIDDEN_KEY, "1");
          } catch {
            /* hidden for this page only */
          }
        }}
        className="rounded p-1 text-muted hover:bg-surface hover:text-ink"
      >
        <Icon name="close" className="h-4 w-4" />
      </button>
    </Strip>
  );
}

/** Every strip that can appear above the page. */
export function AccountBanner() {
  const { status } = useAccountStatus();
  return (
    <>
      {status && <SuspensionStrip status={status} />}
      {status && <WarningStrip status={status} />}
      {status && <DeactivationStrip status={status} />}
      <OnboardingStrip />
    </>
  );
}
