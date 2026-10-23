// The browser's connection to Supabase. It is only used for signing in:
// all project data goes through our own backend, which checks the sign-in.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// These two values are public by design (the publishable key only allows what
// Row Level Security allows). Never put a secret or service_role key here.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let client: SupabaseClient | null = null;

/** Names of the settings that are missing, so the app can say exactly what to fix. */
export function missingSupabaseSettings(): string[] {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SUPABASE_KEY) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return missing;
}

export function getSupabase(): SupabaseClient | null {
  if (missingSupabaseSettings().length > 0) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export const MIN_PASSWORD = 8;

/** Why a new password cannot be used yet, or null when it is fine. */
export function passwordProblem(password: string, confirm?: string): string | null {
  if (password.length < MIN_PASSWORD) return `Please use at least ${MIN_PASSWORD} characters.`;
  if (confirm !== undefined && password !== confirm) return "The two passwords do not match.";
  return null;
}

/** A full address on this website, for links inside Supabase's emails. */
export function authRedirectUrl(path: string, origin = typeof window === "undefined" ? "" : window.location.origin): string {
  return `${origin}${path}`;
}

/** Supabase's sign-in errors, in plain words. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong email or password.";
  if (m.includes("should be different from the old password") || m.includes("same_password")) return "Please choose a password you have not used for this account before.";
  if (m.includes("auth session missing") || m.includes("expired") || (m.includes("invalid") && m.includes("link"))) return "This reset link has expired or was already used. Please ask for a new one.";
  if (m.includes("email not confirmed")) return "Please confirm your email first: open the link we sent you, then sign in.";
  if (m.includes("already registered") || m.includes("already been registered")) return "An account with this email already exists. Sign in instead.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please wait a few minutes and try again.";
  if (m.includes("password should be") || m.includes("weak password")) return "Please choose a stronger password (at least 8 characters, mixing letters and numbers).";
  if (m.includes("failed to fetch") || m.includes("network")) return "Cannot reach the sign-in service. Check your internet connection.";
  return message;
}
