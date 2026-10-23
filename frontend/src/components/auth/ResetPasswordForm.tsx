"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { inputClass, labelClass } from "@/components/ui/fields";
import { friendlyAuthError, getSupabase, MIN_PASSWORD, passwordProblem } from "@/lib/supabase";
import { AuthFrame, AuthMessage } from "./LoginScreen";

// How long to wait for Supabase to read the reset link before saying it did not work.
const LINK_WAIT_MS = 5000;
const EXPIRED = "This reset link has expired or was already used. Please ask for a new one.";

type LinkState = { kind: "checking" } | { kind: "ready" } | { kind: "invalid"; message: string };

/** Supabase puts problems with the link in the address, e.g. #error_code=otp_expired. */
function linkErrorFromUrl(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
  if (!params.get("error") && !params.get("error_code")) return null;
  return params.get("error_code") === "otp_expired" ? EXPIRED : friendlyAuthError(params.get("error_description") ?? EXPIRED);
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [link, setLink] = useState<LinkState>({ kind: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    const problem = supabase ? linkErrorFromUrl() : "Sign-in is not set up on this website yet.";
    if (problem || !supabase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the link can only be read in the browser
      setLink({ kind: "invalid", message: problem ?? EXPIRED });
      return;
    }
    // Opening the emailed link signs the user in for a short "recovery" session.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "INITIAL_SESSION")) setLink({ kind: "ready" });
    });
    supabase.auth.getSession().then(({ data: s }) => s.session && setLink({ kind: "ready" }));
    const timer = setTimeout(() => setLink((l) => (l.kind === "checking" ? { kind: "invalid", message: EXPIRED } : l)), LINK_WAIT_MS);
    return () => {
      clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);
    const supabase = getSupabase();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setBusy(false);
      return setError(friendlyAuthError(err.message));
    }
    // Sign out the short recovery session, so the user signs in again with the new password.
    await supabase.auth.signOut();
    router.replace("/?notice=password-updated");
  }

  if (link.kind === "checking") {
    return (
      <AuthFrame title="Choose a new password" subtitle="Checking your reset link…">
        <p className="mt-5 flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner /> One moment…
        </p>
      </AuthFrame>
    );
  }

  if (link.kind === "invalid") {
    return (
      <AuthFrame title="Reset link not valid" subtitle="We could not use this password reset link.">
        <AuthMessage tone="err">{link.message}</AuthMessage>
        <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-line pt-4 text-sm">
          <Link href="/forgot-password" className="text-wine hover:underline">
            Send a new link
          </Link>
          <Link href="/" className="text-muted hover:text-wine">
            Back to sign in
          </Link>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Choose a new password" subtitle={`Use at least ${MIN_PASSWORD} characters. You will sign in with it next.`}>
      <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
        <div>
          <label htmlFor="new-password" className={labelClass}>
            New password
          </label>
          <input id="new-password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label htmlFor="confirm-password" className={labelClass}>
            Confirm new password
          </label>
          <input id="confirm-password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Save new password
        </Button>
      </form>
      {error && <AuthMessage tone="err">{error}</AuthMessage>}
    </AuthFrame>
  );
}
