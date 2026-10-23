"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import type { Badges } from "@/lib/types";

export interface LiveEvent {
  event: "message" | "seen" | "notification";
  conversationId: string | null;
}

interface LiveValue {
  /** null until the first load. */
  badges: Badges | null;
  refreshBadges: () => void;
  /** True while Supabase Realtime is connected; pages poll more often when it is not. */
  connected: boolean;
  /** Listen for live events; returns a function that stops listening. */
  subscribe: (listener: (e: LiveEvent) => void) => () => void;
}

const LiveContext = createContext<LiveValue | null>(null);

// How often the menu numbers are checked without a live connection, and as a safety net with one.
const POLL_OFFLINE_MS = 15_000;
const POLL_ONLINE_MS = 120_000;

/**
 * Live updates for chats and notifications.
 *
 * The database sends a tiny "something changed in chat X" ping to this user's
 * private Realtime channel ("user:<id>"); the message text never travels that
 * way. Pages that care then ask the backend for the new data. If Realtime is not
 * available, the numbers on the menu are simply checked every few seconds.
 */
export function LiveProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [badges, setBadges] = useState<Badges | null>(null);
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<(e: LiveEvent) => void>());

  const refreshBadges = useCallback(() => {
    api
      .badges()
      .then(setBadges)
      .catch(() => {
        /* keep the old numbers; the offline banner explains a missing server */
      });
  }, []);

  const subscribe = useCallback((listener: (e: LiveEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;
    const channel = supabase.channel(`user:${userId}`, { config: { private: true } });
    channel.on("broadcast", { event: "*" }, ({ event, payload }) => {
      const e: LiveEvent = { event: event as LiveEvent["event"], conversationId: (payload?.conversation_id as string | null) ?? null };
      for (const listener of listeners.current) listener(e);
      refreshBadges();
    });
    // Private channels need the signed-in user's token before subscribing.
    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel.subscribe((status) => setConnected(status === "SUBSCRIBED"));
    });
    return () => {
      cancelled = true;
      setConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [userId, refreshBadges]);

  useEffect(() => {
    refreshBadges();
    const timer = setInterval(refreshBadges, connected ? POLL_ONLINE_MS : POLL_OFFLINE_MS);
    const onVisible = () => document.visibilityState === "visible" && refreshBadges();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connected, refreshBadges]);

  return <LiveContext.Provider value={{ badges, refreshBadges, connected, subscribe }}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive must be used inside <LiveProvider>");
  return ctx;
}

/** Run `onEvent` for every live event while the component is on screen. */
export function useLiveEvents(onEvent: (e: LiveEvent) => void) {
  const { subscribe } = useLive();
  const latest = useRef(onEvent);
  useEffect(() => {
    latest.current = onEvent;
  });
  useEffect(() => subscribe((e) => latest.current(e)), [subscribe]);
}
