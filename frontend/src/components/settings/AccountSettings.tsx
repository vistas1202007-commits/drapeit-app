"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useT } from "@/components/i18n/LanguageProvider";
import { Button, buttonClass } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { authRedirectUrl, friendlyAuthError, getSupabase, passwordProblem } from "@/lib/supabase";
import type { AccountStatus } from "@/lib/types";
import { SettingsHeader } from "./SettingsHome";

export function SettingsCard({ id, icon, title, children }: { id?: string; icon: IconName; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-5 scroll-mt-20 rounded-lg border border-line bg-surface shadow-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Icon name={icon} className="mt-1 h-5 w-5 shrink-0 text-wine" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg">{title}</h2>
          {children}
        </div>
      </div>
    </section>
  );
}

function Result({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p role={ok ? "status" : "alert"} className={`mt-2 text-sm ${ok ? "text-ok" : "text-err"}`}>
      {children}
    </p>
  );
}

function ChangeEmail({ email }: { email: string }) {
  const { t } = useT();
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const supabase = getSupabase();
    const value = next.trim();
    if (!supabase || !value) return;
    if (value.toLowerCase() === email.toLowerCase()) return setResult({ ok: false, text: "That is already your email address." });
    setBusy(true);
    setResult(null);
    try {
      const { error } = await supabase.auth.updateUser({ email: value }, { emailRedirectTo: authRedirectUrl("/settings/account") });
      if (error) throw error;
      setResult({ ok: true, text: `Check your inbox: we sent a confirmation link to ${value} (and possibly to ${email}). The change happens after you open it.` });
      setNext("");
    } catch (err) {
      setResult({ ok: false, text: friendlyAuthError(err instanceof Error ? err.message : String(err)) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard id="email" icon="comment" title={t("settings.changeEmail")}>
      <p className="mt-0.5 text-sm text-muted">
        Now: <span className="font-medium text-ink">{email}</span>
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="new-email" className="sr-only">
          New email
        </label>
        <input id="new-email" type="email" required autoComplete="email" placeholder="New email address" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
        <Button type="submit" loading={busy} className="shrink-0">
          {t("settings.changeEmail")}
        </Button>
      </form>
      {result && <Result ok={result.ok}>{result.text}</Result>}
    </SettingsCard>
  );
}

function ChangePassword({ email }: { email: string }) {
  const { t } = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;
    const problem = passwordProblem(next, again);
    if (problem) return setResult({ ok: false, text: problem });
    if (next === current) return setResult({ ok: false, text: "Please choose a password you have not used for this account before." });
    setBusy(true);
    setResult(null);
    try {
      // Check the current password first, so nobody can change it on a computer you left signed in.
      const check = await supabase.auth.signInWithPassword({ email, password: current });
      if (check.error) throw new Error("Your current password is not right.");
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      setResult({ ok: true, text: "Password changed. Use the new one next time you sign in." });
      setCurrent("");
      setNext("");
      setAgain("");
    } catch (err) {
      setResult({ ok: false, text: friendlyAuthError(err instanceof Error ? err.message : String(err)) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard id="password" icon="lock" title={t("settings.changePassword")}>
      <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="pw-current" className={labelClass}>
            Current password
          </label>
          <input id="pw-current" type="password" required autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pw-new" className={labelClass}>
            New password
          </label>
          <input id="pw-new" type="password" required minLength={8} placeholder="8+ characters" autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pw-again" className={labelClass}>
            New password again
          </label>
          <input id="pw-again" type="password" required autoComplete="new-password" className={inputClass} value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>
        <div className="sm:col-span-3">
          <Button type="submit" loading={busy}>
            {t("settings.changePassword")}
          </Button>
          <Link href="/forgot-password" className="ml-3 text-xs text-muted hover:text-wine hover:underline">
            Forgot your current password?
          </Link>
        </div>
      </form>
      {result && <Result ok={result.ok}>{result.text}</Result>}
    </SettingsCard>
  );
}

function DownloadData() {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setError(null);
    try {
      await api.downloadMyData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The download did not work.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsCard id="download" icon="download" title={t("settings.downloadData")}>
      <p className="mt-0.5 text-sm text-muted">
        One JSON file with your profile, settings, designs (versions, notes and outputs), posts, comments, likes, saves, follows, messages and search history.
        Pictures stay in the app.
      </p>
      <Button className="mt-3" onClick={download} loading={busy}>
        <Icon name="download" />
        {t("settings.downloadData")}
      </Button>
      {error && <Result ok={false}>{error}</Result>}
    </SettingsCard>
  );
}

function Deactivate() {
  const { t } = useT();
  const { signOut } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function deactivate() {
    const ok = await confirm({
      title: "Deactivate your account?",
      message: "Your profile, posts and comments are hidden from everyone and nobody can message you. Nothing is deleted. Sign in again any time to bring everything back.",
      confirmLabel: "Deactivate and sign out",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.deactivate();
      await signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      setBusy(false);
    }
  }
  return (
    <SettingsCard id="deactivate" icon="eyeOff" title={t("settings.deactivate")}>
      {dialog}
      <p className="mt-0.5 text-sm text-muted">Take a break. Everything is hidden until you sign in again; nothing is deleted.</p>
      <Button className="mt-3" onClick={deactivate} loading={busy}>
        {t("settings.deactivate")}
      </Button>
      {error && <Result ok={false}>{error}</Result>}
    </SettingsCard>
  );
}

function DeleteAccount({ status, onChange }: { status: AccountStatus; onChange: (s: AccountStatus) => void }) {
  const { t } = useT();
  const { signOut } = useAuth();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expected = status.has_profile ? status.username ?? "" : status.email;
  const matches = typed.trim().replace(/^@/, "").toLowerCase() === expected.toLowerCase();

  async function run(action: () => Promise<AccountStatus>, after?: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await action());
      await after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard id="delete" icon="trash" title={t("settings.deleteAccount")}>
      {status.delete_requested_at && status.delete_after ? (
        <>
          <Notice tone="warn" title={`Your account will be deleted on ${formatDate(status.delete_after)}`}>
            It is hidden from everyone until then. After that date your designs, posts, comments, messages and pictures are removed for good.
          </Notice>
          <Button className="mt-3" variant="primary" onClick={() => run(api.cancelDelete)} loading={busy}>
            Cancel deletion
          </Button>
        </>
      ) : (
        <>
          <p className="mt-0.5 text-sm text-muted">
            Your account is hidden at once and deleted for good after <span className="font-medium text-ink">30 days</span>: designs, posts, comments,
            messages, followers and every picture. Sign in within 30 days to cancel. Tip: download your data first.
          </p>
          <label htmlFor="delete-confirm" className={`${labelClass} mt-3`}>
            To confirm, type {status.has_profile ? "your username" : "your email address"}: <span className="font-semibold text-ink">{expected}</span>
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="delete-confirm" className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <Button variant="danger" className="shrink-0" disabled={!matches} loading={busy} onClick={() => run(() => api.requestDelete(typed), signOut)}>
              {t("settings.deleteAccount")}
            </Button>
          </div>
        </>
      )}
      {error && <Result ok={false}>{error}</Result>}
    </SettingsCard>
  );
}

/** /settings/account */
export function AccountSettings() {
  const { t } = useT();
  const { email } = useAuth();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .account()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your account."));
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <SettingsHeader title={t("settings.account")} />
      {error && (
        <div className="mt-4">
          <Notice tone="err">{error}</Notice>
        </div>
      )}
      <SettingsCard icon="user" title={t("settings.editProfile")}>
        <p className="mt-0.5 text-sm text-muted">{t("settings.editProfileDesc")}</p>
        <Link href="/profile/edit" className={buttonClass("secondary", "md", "mt-3")}>
          {t("settings.editProfile")}
        </Link>
      </SettingsCard>
      <ChangeEmail email={email} />
      <ChangePassword email={email} />
      <DownloadData />
      <Deactivate />
      {status && <DeleteAccount status={status} onChange={setStatus} />}
    </div>
  );
}
