"use client";

import type { Session } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LiveProvider } from "@/components/chat/LiveUpdates";
import { AppShell } from "@/components/layout/AppShell";
import { MyProfileProvider } from "@/components/social/MyProfile";
import { ThemeSync } from "@/components/theme/ThemeProvider";
import { Spinner } from "@/components/ui/Spinner";
import { api, configureAuth, prefetchBootstrap, resetBootstrap, setMediaToken } from "@/lib/api";
import { getSupabase, missingSupabaseSettings } from "@/lib/supabase";
import { LoginScreen, NotConfiguredScreen } from "./LoginScreen";

// Media tokens last two hours on the server; fetch a new one well before that.
const MEDIA_REFRESH_MS = 60 * 60 * 1000;

// Pages anyone can open without signing in (they are shown without the app's sidebar).
export const PUBLIC_PATHS = ["/forgot-password", "/reset-password", "/legal/terms", "/legal/privacy", "/legal/guidelines"];

interface AuthValue {
  email: string;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

type State =
  | { kind: "loading" }
  | { kind: "not-configured"; missing: string[] }
  | { kind: "signed-out"; notice: string | null }
  | { kind: "signed-in"; session: Session; mediaReady: boolean };

/** Shows the sign-in screen until the user is signed in, then the app (inside the app shell). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- settings are only known in the browser bundle
      setState({ kind: "not-configured", missing: missingSupabaseSettings() });
      return;
    }
    configureAuth({
      getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      onSignedOut: (message) => {
        void supabase.auth.signOut();
        setState({ kind: "signed-out", notice: `${message} Your session ended, so please sign in again.` });
      },
    });
    const show = (session: Session | null) =>
      setState((prev) => {
        if (!session) return prev.kind === "signed-out" ? prev : { kind: "signed-out", notice: null };
        return { kind: "signed-in", session, mediaReady: prev.kind === "signed-in" && prev.mediaReady };
      });
    supabase.auth.getSession().then(({ data }) => show(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // A reset link that landed on another page (for example the Site URL): finish it on the right page.
      if (event === "PASSWORD_RECOVERY" && !PUBLIC_PATHS.includes(window.location.pathname)) {
        router.replace("/reset-password");
        return;
      }
      show(session);
    });
    return () => data.subscription.unsubscribe();
  }, [router]);

  // Pictures need a media token; get one as soon as the user is signed in, and keep it fresh.
  const userId = state.kind === "signed-in" ? state.session.user.id : null;
  useEffect(() => {
    resetBootstrap(); // a different person (or nobody) is signed in now
    if (!userId) return;
    prefetchBootstrap(); // loads while the picture token (no database) lets the app frame appear
    let cancelled = false;
    const refresh = () =>
      api
        .mediaToken()
        .then((t) => setMediaToken(t.token))
        .catch(() => setMediaToken("")) // pictures will not load; the offline banner explains why
        .finally(() => !cancelled && setState((s) => (s.kind === "signed-in" && !s.mediaReady ? { ...s, mediaReady: true } : s)));
    void refresh();
    const timer = setInterval(refresh, MEDIA_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [userId]);

  const signOut = useCallback(async () => {
    await getSupabase()?.auth.signOut();
    setMediaToken("");
    resetBootstrap();
    setState({ kind: "signed-out", notice: "You are signed out." });
  }, []);

  if (isPublic) return <>{children}</>;
  if (state.kind === "not-configured") return <NotConfiguredScreen missing={state.missing} />;
  if (state.kind === "signed-out") return <LoginScreen notice={state.notice} />;
  if (state.kind === "loading" || !state.mediaReady) return <AuthLoading />;
  return (
    <AuthContext.Provider value={{ email: state.session.user.email ?? "", signOut }}>
      <MyProfileProvider>
        <ThemeSync />
        <LiveProvider userId={state.session.user.id}>
          <AppShell>{children}</AppShell>
        </LiveProvider>
      </MyProfileProvider>
    </AuthContext.Provider>
  );
}

export function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted" role="status">
      <Spinner /> Opening your notebook…
    </div>
  );
}
