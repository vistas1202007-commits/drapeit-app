/* eslint-disable @next/next/no-img-element -- post pictures are served by our own API */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/social/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { NOTIFICATION_SETTINGS, notificationText } from "@/lib/chat";
import { timeAgo } from "@/lib/format";
import type { NotificationItem, NotificationSettings } from "@/lib/types";
import { useLive, useLiveEvents } from "./LiveUpdates";
import { VerifiedBadge } from "@/components/social/VerifiedBadge";

/** Accept / Decline for a waiting follow request, or Follow back for a new follower. */
function QuickAction({ item, onDone }: { item: NotificationItem; onDone: (changes: Partial<NotificationItem>) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actor = item.actor;
  if (!actor) return null;

  async function run(action: () => Promise<unknown>, changes: Partial<NotificationItem>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone(changes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  let buttons = null;
  if (item.type === "follow_request" && item.request_pending) {
    buttons = (
      <>
        <Button size="sm" variant="primary" loading={busy} onClick={() => run(() => api.answerRequest(actor.username, true), { request_pending: false })}>
          Accept
        </Button>
        <Button size="sm" disabled={busy} onClick={() => run(() => api.answerRequest(actor.username, false), { request_pending: false })}>
          Decline
        </Button>
      </>
    );
  } else if (item.type === "follow" && !item.following_actor) {
    buttons = (
      <Button size="sm" variant="primary" loading={busy} onClick={() => run(() => api.follow(actor.username, true), { following_actor: true })}>
        Follow back
      </Button>
    );
  }
  if (!buttons) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">{buttons}</div>
      {error && <p role="alert" className="max-w-48 text-right text-[11px] text-err">{error}</p>}
    </div>
  );
}

function NotificationRow({ item, onChange }: { item: NotificationItem; onChange: (n: NotificationItem) => void }) {
  const { text, href } = notificationText(item);
  const name = item.actor ? item.actor.display_name || item.actor.username : "Someone";

  function open() {
    if (item.read) return;
    onChange({ ...item, read: true });
    api.readNotification(item.id).catch(() => {});
  }

  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${item.read ? "" : "bg-wine-soft/50"}`}>
      {item.actor ? (
        <Link href={`/u/${item.actor.username}`} className="shrink-0" onClick={open}>
          <Avatar person={item.actor} />
        </Link>
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sunken text-muted" aria-hidden>
          <Icon name="user" />
        </span>
      )}
      <Link href={href} onClick={open} className="min-w-0 flex-1 text-sm">
        <span className="font-medium text-ink">{name}</span> <VerifiedBadge person={item.actor} /> <span className="text-ink">{text}</span>
        {item.comment_excerpt && <span className="mt-0.5 block truncate text-muted">“{item.comment_excerpt}”</span>}
        <span className="mt-0.5 block text-xs text-faint">
          {timeAgo(item.created_at)}
          {!item.read && (
            <>
              <span aria-hidden className="ml-2 inline-block h-2 w-2 rounded-full bg-wine align-middle" />
              <span className="sr-only"> (new)</span>
            </>
          )}
        </span>
      </Link>
      <QuickAction item={item} onDone={(changes) => onChange({ ...item, ...changes, read: true })} />
      {item.post_image_id && (
        <Link href={href} onClick={open} className="shrink-0" aria-hidden tabIndex={-1}>
          <img src={api.postImageUrl(item.post_image_id)} alt="" className="h-12 w-12 rounded-md border border-line bg-canvas object-cover" />
        </Link>
      )}
    </li>
  );
}

/** /notifications: likes, comments, replies, follows, requests, mentions, reposts and messages. */
export function NotificationsView() {
  const { badges, connected, refreshBadges } = useLive();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await api.notifications();
      // Keep pages that were already loaded below the newest one.
      setItems((current) => {
        const ids = new Set(page.notifications.map((n) => n.id));
        const last = page.notifications.at(-1)?.created_at ?? "";
        const rest = (current ?? []).filter((n) => !ids.has(n.id) && n.created_at < last);
        return [...page.notifications, ...rest];
      });
      setNext((cur) => cur ?? page.next_cursor);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notifications.");
      setItems((cur) => cur ?? []);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first page when the page opens
    void load();
  }, [load]);

  useLiveEvents((e) => e.event === "notification" && void load());
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [connected, load]);

  async function more() {
    if (!next) return;
    setBusy(true);
    try {
      const page = await api.notifications(next);
      setItems((current) => [...(current ?? []), ...page.notifications.filter((n) => !(current ?? []).some((c) => c.id === n.id))]);
      setNext(page.next_cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more.");
    } finally {
      setBusy(false);
    }
  }

  async function readAll() {
    setBusy(true);
    try {
      await api.readAllNotifications();
      setItems((current) => (current ?? []).map((n) => ({ ...n, read: true })));
      refreshBadges();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark them as read.");
    } finally {
      setBusy(false);
    }
  }

  const update = (n: NotificationItem) => {
    setItems((current) => (current ?? []).map((x) => (x.id === n.id ? n : x)));
    refreshBadges();
  };
  const unread = items?.some((n) => !n.read) ?? false;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Notifications</h1>
          <p className="mt-1 text-sm text-muted">{badges && badges.notifications > 0 ? `${badges.notifications} new` : "You are all caught up."}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={readAll} disabled={!unread || busy}>
            <Icon name="check" />
            Mark all as read
          </Button>
          <Link href="/settings/notifications" className="flex h-8 w-8 items-center justify-center rounded-md border border-line-strong text-muted hover:bg-sunken hover:text-ink" aria-label="Notification settings" title="Notification settings">
            <Icon name="settings" />
          </Link>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Notice tone="err" action={<Button size="sm" onClick={() => void load()}>Try again</Button>}>
            {error}
          </Notice>
        </div>
      )}

      {items === null ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted" role="status">
          <Spinner /> Loading notifications…
        </p>
      ) : items.length === 0 && !error ? (
        <div className="mt-6">
          <EmptyState title="No notifications yet">When people like, comment on or repost your designs, follow you, mention you or message you, it shows up here.</EmptyState>
        </div>
      ) : (
        <>
          <ul className="mt-5 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            {items.map((n) => (
              <NotificationRow key={n.id} item={n} onChange={update} />
            ))}
          </ul>
          {next && (
            <div className="mt-4 flex justify-center">
              <Button onClick={more} loading={busy}>
                Show older
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** /settings/notifications: turn each kind of notification on or off. */
export function NotificationSettingsView() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [saving, setSaving] = useState<keyof NotificationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSettings(await api.notificationSettings());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your settings.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load once when the page opens
    void load();
  }, [load]);

  async function toggle(key: keyof NotificationSettings) {
    if (!settings) return;
    const before = settings;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    setSaving(key);
    setError(null);
    try {
      setSettings(await api.saveNotificationSettings(next));
    } catch (e) {
      setSettings(before);
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
      <Link href="/notifications" className="text-xs text-muted hover:text-wine">
        ← Notifications
      </Link>
      <h1 className="mt-1 font-display text-3xl">Notification settings</h1>
      <p className="mt-1 text-sm text-muted">Choose what you want to hear about. Turning one off stops new ones; nobody is told.</p>
      {error && (
        <div className="mt-4">
          <Notice tone="err" action={<Button size="sm" onClick={() => void load()}>Try again</Button>}>
            {error}
          </Notice>
        </div>
      )}
      {settings === null ? (
        !error && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner /> Loading…
          </p>
        )
      ) : (
        <ul className="mt-5 divide-y divide-line rounded-lg border border-line bg-surface shadow-card">
          {NOTIFICATION_SETTINGS.map((s) => (
            <li key={s.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" id={`setting-${s.id}`}>
                  {s.label}
                </p>
                <p className="text-xs text-muted">{s.help}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings[s.id]}
                aria-labelledby={`setting-${s.id}`}
                disabled={saving !== null}
                onClick={() => toggle(s.id)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${settings[s.id] ? "bg-wine" : "bg-line-strong"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-canvas shadow transition-all ${settings[s.id] ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
