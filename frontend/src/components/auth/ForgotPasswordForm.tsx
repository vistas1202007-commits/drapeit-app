"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { inputClass, labelClass } from "@/components/ui/fields";
import { authRedirectUrl, friendlyAuthError, getSupabase } from "@/lib/supabase";
import { AuthFrame, AuthMessage } from "./LoginScreen";

// The same answer for every email, so nobody can use this page to find out who has an account.
const SENT = "If this email has an account, we sent a reset link. Check your inbox (and spam). The link works once and expires after about an hour.";

/** Problems worth showing: they say nothing about whether the email has an account. */
function isServiceProblem(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("rate limit") || m.includes("too many") || m.includes("failed to fetch") || m.includes("network");
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const supabase = getSupabase();
    if (!supabase) return setError("Sign-in is not set up on this website yet.");
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirectUrl("/reset-password") });
      if (err && isServiceProblem(err.message)) setError(friendlyAuthError(err.message));
      else setSent(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isServiceProblem(message)) setError(friendlyAuthError(message));
      else setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Forgot password" subtitle="Enter the email you signed up with. We will email you a link to choose a new password.">
      <form onSubmit={submit} className="mt-5 space-y-3">
        <div>
          <label htmlFor="forgot-email" className={labelClass}>
            Email
          </label>
          <input id="forgot-email" type="email" required autoComplete="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {sent ? "Send again" : "Send reset link"}
        </Button>
      </form>
      {error && <AuthMessage tone="err">{error}</AuthMessage>}
      {sent && <AuthMessage tone="ok">{SENT}</AuthMessage>}
      <div className="mt-5 border-t border-line pt-4 text-sm">
        <Link href="/" className="text-wine hover:underline">
          ← Back to sign in
        </Link>
      </div>
    </AuthFrame>
  );
}
