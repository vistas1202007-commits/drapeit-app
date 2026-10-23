"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { inputClass, labelClass } from "@/components/ui/fields";
import { api } from "@/lib/api";
import { authRedirectUrl, friendlyAuthError, getSupabase, MIN_PASSWORD } from "@/lib/supabase";

type Mode = "signin" | "signup";

// Messages other auth pages can ask the sign-in screen to show (via ?notice=...).
const NOTICES: Record<string, string> = {
  "password-updated": "Your password was changed. Please sign in with your new password.",
};

/** The centred card used by every sign-in related screen. */
export function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="animate-rise">
          <Logo size="lg" tagline center />
        </p>
        <hr className="stitch-divider mx-auto mt-6 w-40" />
        <div className="mt-6 animate-rise rounded-xl border border-line bg-surface p-6 shadow-lg">
          <h1 className="font-display text-2xl">{title}</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </main>
  );
}

export function AuthMessage({ tone, children }: { tone: "ok" | "err" | "info"; children: ReactNode }) {
  const style = tone === "ok" ? "bg-ok-soft text-ok" : tone === "err" ? "bg-err-soft text-err" : "bg-warn-soft text-ink";
  return (
    <p role={tone === "err" ? "alert" : "status"} className={`mt-4 rounded-md px-3 py-2 text-sm ${style}`}>
      {children}
    </p>
  );
}

/** A notice passed in the address (?notice=...). Only reads; the address is tidied up after rendering. */
function noticeFromUrl(): string | null {
  const key = new URLSearchParams(window.location.search).get("notice");
  return key ? (NOTICES[key] ?? null) : null;
}

export function LoginScreen({ notice }: { notice?: string | null }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // This screen only ever renders in the browser (after the sign-in check), so reading the address is safe here.
  const [urlNotice] = useState(noticeFromUrl);
  useEffect(() => {
    // Remove ?notice=... so a reload does not show the message again.
    const url = new URL(window.location.href);
    if (!url.searchParams.has("notice")) return;
    url.searchParams.delete("notice");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);

  function switchTo(next: Mode) {
    setMode(next);
    setError(null);
    setDone(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return;
    setError(null);
    setDone(null);
    if (mode === "signup" && password.length < MIN_PASSWORD) {
      setError(`Please use at least ${MIN_PASSWORD} characters for the password.`);
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
        // Signing in again brings a deactivated account back (Phase 6D). A pending deletion stays until cancelled.
        api.reactivate().catch(() => {});
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: authRedirectUrl("/") } });
        if (err) throw err;
        if (!data.session) setDone("Almost done: we sent you an email. Open the link in it to confirm your account, then sign in here.");
      }
    } catch (err) {
      setError(friendlyAuthError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  const signup = mode === "signup";
  const shownNotice = urlNotice ?? notice;
  return (
    <AuthFrame
      title={signup ? "Create your account" : "Sign in"}
      subtitle={signup ? "Free to start. Only you can see your designs." : "Your designs are private to your account."}
    >
      {shownNotice && <AuthMessage tone={urlNotice ? "ok" : "info"}>{shownNotice}</AuthMessage>}
      <form onSubmit={submit} className="mt-5 space-y-3">
        <div>
          <label htmlFor="auth-email" className={labelClass}>
            Email
          </label>
          <input id="auth-email" type="email" required autoComplete="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="auth-password" className={labelClass}>
            Password{signup && ` (at least ${MIN_PASSWORD} characters)`}
          </label>
          <input
            id="auth-password"
            type="password"
            required
            minLength={signup ? MIN_PASSWORD : undefined}
            autoComplete={signup ? "new-password" : "current-password"}
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {!signup && (
            <p className="mt-1.5 text-right text-xs">
              <Link href="/forgot-password" className="text-muted hover:text-wine hover:underline">
                Forgot password?
              </Link>
            </p>
          )}
        </div>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {signup ? "Create account" : "Sign in"}
        </Button>
      </form>
      {error && <AuthMessage tone="err">{error}</AuthMessage>}
      {done && <AuthMessage tone="ok">{done}</AuthMessage>}
      <div className="mt-5 border-t border-line pt-4 text-sm">
        {signup ? (
          <button type="button" className="text-wine hover:underline" onClick={() => switchTo("signin")}>
            ← Back to sign in
          </button>
        ) : (
          <button type="button" className="text-wine hover:underline" onClick={() => switchTo("signup")}>
            Create an account
          </button>
        )}
      </div>
      <p className="mt-4 text-xs text-muted">
        By using Drapeit you agree to the{" "}
        <Link href="/legal/terms" className="hover:text-wine hover:underline">
          Terms
        </Link>
        ,{" "}
        <Link href="/legal/privacy" className="hover:text-wine hover:underline">
          Privacy Policy
        </Link>{" "}
        and{" "}
        <Link href="/legal/guidelines" className="hover:text-wine hover:underline">
          Community Guidelines
        </Link>
        .
      </p>
    </AuthFrame>
  );
}

/** Shown when the website itself was built without the Supabase settings. */
export function NotConfiguredScreen({ missing }: { missing: string[] }) {
  return (
    <AuthFrame title="Setup needed" subtitle="This website was built without its Supabase settings, so nobody can sign in yet.">
      <p className="mt-4 text-sm">Add these environment variables (in frontend/.env.local, or in Vercel → Settings → Environment Variables), then rebuild:</p>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {missing.map((m) => (
          <li key={m}>
            <code>{m}</code>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">Step-by-step: docs/DEPLOYMENT.md</p>
    </AuthFrame>
  );
}
